package opencode

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// The Zen free tier answers only requests that look like the official OpenCode
// CLI's. The checks that matter are the client identity (user agent), the
// session identity (four headers carrying one canonical id), and the body shape
// (official system prompt, official tool set, client tool names hidden behind
// opaque wire names). Each one refuses on its own, so all of them are emitted
// together for every request.

const (
	// clientVersion is the OpenCode CLI release the wire imitates. The project
	// has never published a 2.x line; 1.19.5 is the release this shape was
	// captured from.
	clientVersion = "1.19.5"
	// clientUserAgent must be sent alone and unmodified: the gate matches the
	// whole string, and any prefix or suffix stops reading as the official
	// client. The runtime suffix is part of what the CLI actually sends.
	clientUserAgent = "opencode/" + clientVersion + " ai-sdk/provider-utils/4.0.23 runtime/bun/1.4.4"
	// anonymousCredential is the pooled keyless credential the free tier uses.
	anonymousCredential = "public"
	// completionLimit is the ceiling a 2.x chat body always carries.
	completionLimit = 32000
	// sessionWindow is how far before today a minted session may be dated.
	sessionWindow = 30 * 24 * time.Hour
	// promptMarker identifies a body that already carries the official prompt.
	promptMarker = "You are opencode, an interactive CLI tool"
	// modelsPath lists the ids this gateway serves.
	modelsPath = "/inference/v1/models"
)

var base62Alphabet = []byte("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")

// sessionID returns the canonical session id for one conversation seed. The
// upstream decodes the 12 leading hex characters as a descending timestamp and
// refuses ids whose date is implausible, so the id is dated today's UTC
// midnight minus a digest-derived offset of at most sessionWindow. The digest
// only picks the offset; it never supplies the date.
func sessionID(seed string) string {
	sum := sha256.Sum256([]byte("ses\x00" + seed))
	offset := int64(uint32(sum[0])<<24|uint32(sum[1])<<16|uint32(sum[2])<<8|uint32(sum[3])) % int64(sessionWindow/time.Millisecond)
	midnight := time.Now().UTC().Truncate(24 * time.Hour).UnixMilli()
	stamp := (midnight - offset) << 12
	inverted := ^stamp & 0xffffffffffff
	return fmt.Sprintf("ses_%012x%s", inverted, base62(sum[6:16], 14))
}

// projectID renders a project signal into the 40-hex shape the gate expects.
// A literal "global" and a genuine git commit pass through unchanged.
func projectID(signal string) string {
	if signal == "global" || isHex40(signal) {
		return signal
	}
	sum := sha256.Sum256([]byte("opencode-project\x00" + signal))
	return hex.EncodeToString(sum[:20])
}

func isHex40(value string) bool {
	if len(value) != 40 {
		return false
	}
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

// base62 renders bytes big-endian as exactly width base62 characters.
func base62(data []byte, width int) string {
	out := make([]byte, width)
	// Long division over the byte slice, least significant digit first.
	digits := make([]byte, 0, width+8)
	work := append([]byte(nil), data...)
	for len(work) > 0 {
		remainder := 0
		next := work[:0]
		for _, byteValue := range work {
			current := remainder*256 + int(byteValue)
			quotient := current / 62
			remainder = current % 62
			if len(next) > 0 || quotient != 0 {
				next = append(next, byte(quotient))
			}
		}
		digits = append(digits, base62Alphabet[remainder])
		work = next
	}
	for i := range out {
		out[i] = base62Alphabet[0]
	}
	for i := 0; i < len(digits) && i < width; i++ {
		out[width-1-i] = digits[i]
	}
	return string(out)
}

// traceHeaders renders one W3C Trace Context pair. The official client carries
// both on every inference request, with fresh ids per request.
func traceHeaders() map[string]string {
	traceID := randomHex(16)
	spanID := randomHex(8)
	parentID := randomHex(8)
	return map[string]string{
		"traceparent": "00-" + traceID + "-" + spanID + "-01",
		"b3":          traceID + "-" + spanID + "-1-" + parentID,
	}
}

func randomHex(size int) string {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		// A trace id is decoration, not a credential: a weak one costs nothing.
		return strings.Repeat("0", size*2)
	}
	return hex.EncodeToString(buffer)
}

// shapeOf names the wire a request speaks, which drives both the tool shape and
// the system prompt injection point.
func shapeOf(relayFormat string) string {
	switch relayFormat {
	case "claude":
		return "claude"
	case "openai_responses":
		return "flat"
	default:
		return "chat"
	}
}

// officialTool is one tool of the captured official set, rendered in the shape
// the wire expects.
type officialTool struct {
	Name        string
	Description string
	Parameters  any
}

// renameWireName is the opaque name one client tool travels under. The free
// tier refuses a body that still carries another client's tool vocabulary, so
// no client tool name reaches the wire.
func renameWireName(name string, used map[string]struct{}) string {
	sum := sha256.Sum256([]byte(name))
	base := "clint_" + hex.EncodeToString(sum[:])[:12]
	if _, taken := used[base]; !taken {
		used[base] = struct{}{}
		return base
	}
	for suffix := 2; ; suffix++ {
		candidate := fmt.Sprintf("%s_%d", base, suffix)
		if _, taken := used[candidate]; !taken {
			used[candidate] = struct{}{}
			return candidate
		}
	}
}

// restoreToolName maps a wire name back to the caller's spelling. Unknown names
// (the injected officials, or a name the caller never declared) pass through.
func restoreToolName(name string, reverse map[string]string) string {
	if original, ok := reverse[name]; ok {
		return original
	}
	return name
}

// streamOptionsFor forces usage reporting on a streamed chat body so the lane's
// usage frames survive shaping.
func streamOptionsFor(body map[string]any) {
	existing, ok := body["stream_options"].(map[string]any)
	if !ok {
		body["stream_options"] = map[string]any{"include_usage": true}
		return
	}
	existing["include_usage"] = true
}

// marshalMap keeps the shared json helpers in use; business code must not call
// encoding/json directly.
func marshalMap(value any) (map[string]any, error) {
	data, err := common.Marshal(value)
	if err != nil {
		return nil, err
	}
	result := make(map[string]any)
	if err := common.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// ModelsPath is the listing endpoint; exported for the channel's model
// discovery, which is the one request that needs no shaping.
func ModelsPath() string { return modelsPath }

// DiscoveryHeaders are the headers the model listing needs. The listing is the
// one endpoint that answers a bare request, but it still names the free tier's
// client so a listing made by this channel matches what the channel then sends.
// A channel that carries a real console key lists with that key instead.
func DiscoveryHeaders(apiKey string) http.Header {
	headers := make(http.Header, 10)
	if apiKey != "" && !strings.EqualFold(apiKey, "EMPTY") {
		headers.Set("Authorization", "Bearer "+apiKey)
		headers.Set("User-Agent", clientUserAgent)
		headers.Set("x-opencode-client", "cli")
		return headers
	}
	for name, value := range sessionHeaders("catalog:opencode") {
		headers.Set(name, value)
	}
	return headers
}
