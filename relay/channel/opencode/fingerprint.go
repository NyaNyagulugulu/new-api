package opencode

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"sync"
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
	// The Zen free tier checks the current OpenCode application identity. Keep
	// this in the same format as the v2 client rather than the retired v1
	// provider-utils/runtime user agent.
	clientChannel   = "latest"
	clientVersion   = "2.3.2"
	clientName      = "cli"
	clientUserAgent = "opencode/" + clientChannel + "/" + clientVersion + "/" + clientName
	// anonymousCredential is the pooled keyless credential the free tier uses.
	anonymousCredential = "public"
	// completionLimit is the ceiling a 2.x chat body always carries.
	completionLimit = 32000
	// promptMarker identifies a body that already carries the official prompt.
	promptMarker = "You are an AI agent running in OpenCode, a coding agent harness."
	// modelsPath lists the ids this gateway serves.
	modelsPath = "/inference/v1/models"
)

var (
	sessionIDsMu sync.Mutex
	sessionIDs   = make(map[string]string)
)

// sessionID follows the current OpenCode v2 ID generator. Its first 12 hex
// characters are the bitwise inverse of the current millisecond timestamp
// shifted by 12 bits, followed by a stable per-seed random-looking suffix.
func sessionID(seed string) string {
	sessionIDsMu.Lock()
	defer sessionIDsMu.Unlock()
	if id, ok := sessionIDs[seed]; ok {
		return id
	}

	sum := sha256.Sum256([]byte("ses\x00" + seed))
	stamp := (time.Now().UnixMilli() << 12) | 1
	inverted := ^stamp & 0xffffffffffff
	const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	suffix := make([]byte, 14)
	for i := range suffix {
		suffix[i] = alphabet[int(sum[i%len(sum)])%len(alphabet)]
	}
	id := fmt.Sprintf("ses_%012x%s", inverted, suffix)
	sessionIDs[seed] = id
	return id
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
		headers.Set("x-opencode-client", clientName)
		return headers
	}
	for name, value := range sessionHeaders("catalog:opencode", "catalog:opencode") {
		headers.Set(name, value)
	}
	return headers
}
