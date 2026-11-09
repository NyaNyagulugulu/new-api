package opencode

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/claude"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

// Adaptor serves the OpenCode Zen gateway. Two credentials reach the same
// upstream:
//
//   - an API key from the console (paid models, or the free models for anyone
//     who has one) is used as a normal bearer token;
//   - the keyless free tier is reached with the pooled "public" credential,
//     which only answers requests that carry the official CLI's client
//     identity — see shapeRequest for the checks that identity satisfies.
//
// Both paths share the endpoint layout and the response handling, so the
// channel behaves the same whether or not a key was supplied.
type Adaptor struct {
	openaiAdaptor openai.Adaptor
	claudeAdaptor claude.Adaptor
	// keyless reports whether this channel carries a real console API key.
	keyless bool
	// reverse maps the opaque wire name of a shaped tool back to the caller's.
	reverse map[string]string
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
	a.openaiAdaptor.Init(info)
	a.claudeAdaptor.Init(info)
	if info == nil || info.ChannelMeta == nil {
		a.keyless = true
		return
	}
	key := strings.TrimSpace(info.ApiKey)
	a.keyless = key == "" || strings.EqualFold(key, "EMPTY")
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	if info == nil {
		return "", errors.New("relay info is missing")
	}
	base := strings.TrimRight(info.ChannelBaseUrl, "/")
	// The free tier only answers the official CLI's client fingerprint, which
	// Go cannot present; the sidecar carries it. A channel with a real key
	// talks to the upstream directly, so paid traffic never pays for the hop.
	if a.keyless {
		sidecarBase, err := freeTierBaseURL()
		if err != nil {
			return "", err
		}
		base = sidecarBase
	}
	switch info.RelayMode {
	case relayconstant.RelayModeResponses:
		return base + ResponsesPath, nil
	case relayconstant.RelayModeChatCompletions:
		return base + ChatPath, nil
	}
	switch info.RelayFormat {
	case types.RelayFormatClaude:
		return base + MessagesPath, nil
	case types.RelayFormatOpenAIResponses:
		return base + ResponsesPath, nil
	}
	return base + ChatPath, nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	if c != nil && c.Request != nil {
		channel.SetupApiRequestHeader(info, c, req)
	}
	if a.keyless {
		// The keyless lane authenticates with the pooled credential and is
		// fingerprinted on the client identity; every header it needs comes
		// from the same place so a caller's headers cannot half-replace it.
		req.Del("Authorization")
		req.Del("x-api-key")
		for name, value := range sessionHeaders(sessionSeed(info)) {
			req.Set(name, value)
		}
		return nil
	}
	req.Set("Authorization", "Bearer "+strings.TrimSpace(info.ApiKey))
	if info.RelayFormat == types.RelayFormatClaude {
		if req.Get("anthropic-version") == "" {
			req.Set("anthropic-version", "2023-06-01")
		}
		req.Set("anthropic-beta", "interleaved-thinking-2025-05-14")
	}
	return nil
}

// sessionSeed keeps one caller on one upstream session. The free tier accounts
// quota per session, so minting an id per request would burn the window into
// 429s; a request id is exactly that anti-pattern. The seed is the caller's
// identity instead — one user on one token on one channel keeps one session
// across turns, and a different caller gets a different bucket.
func sessionSeed(info *relaycommon.RelayInfo) string {
	if info == nil {
		return "global"
	}
	return fmt.Sprintf("%d:%d:%d", info.ChannelId, info.TokenId, info.UserId)
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	if !a.keyless {
		return request, nil
	}
	body, err := marshalMap(request)
	if err != nil {
		return nil, fmt.Errorf("encode request for the free tier: %w", err)
	}
	a.reverse = shapeRequest(body, "chat", upstreamModel(info, request.Model))
	ensureCompletionLimit(body, "chat")
	return body, nil
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	if !a.keyless {
		return a.claudeAdaptor.ConvertClaudeRequest(c, info, request)
	}
	body, err := marshalMap(request)
	if err != nil {
		return nil, fmt.Errorf("encode request for the free tier: %w", err)
	}
	a.reverse = shapeRequest(body, "claude", upstreamModel(info, request.Model))
	return body, nil
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	if !a.keyless {
		return request, nil
	}
	body, err := marshalMap(request)
	if err != nil {
		return nil, fmt.Errorf("encode request for the free tier: %w", err)
	}
	a.reverse = shapeRequest(body, "flat", upstreamModel(info, request.Model))
	return body, nil
}

func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	if a.keyless {
		return nil, errors.New("the OpenCode free tier does not speak the Gemini wire; use the OpenAI or Claude endpoint")
	}
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertRerankRequest(c *gin.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, errors.New("the OpenCode gateway does not serve rerank")
}

func (a *Adaptor) ConvertEmbeddingRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return nil, errors.New("the OpenCode gateway does not serve embeddings")
}

func (a *Adaptor) ConvertAudioRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("the OpenCode gateway does not serve audio")
}

func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	return nil, errors.New("the OpenCode gateway does not serve image generation")
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	return channel.DoApiRequest(a, c, info, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	if a.keyless && len(a.reverse) > 0 {
		resp = a.restoreResponse(c, resp, info)
	}
	switch info.RelayFormat {
	case types.RelayFormatClaude:
		return a.claudeAdaptor.DoResponse(c, resp, info)
	case types.RelayFormatOpenAIResponses:
		return a.openaiAdaptor.DoResponse(c, resp, info)
	}
	return a.openaiAdaptor.DoResponse(c, resp, info)
}

// restoreResponse rewrites the opaque tool names a shaped request travels under
// back to the caller's spelling. The body is buffered only when a tool was
// renamed, and only the names change — usage, ids and text pass through.
func (a *Adaptor) restoreResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) *http.Response {
	if resp == nil || resp.Body == nil {
		return resp
	}
	if info != nil && info.IsStream {
		resp.Body = newRestoringStream(resp.Body, a.reverse)
		return resp
	}
	payload, readErr := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if readErr != nil {
		resp.Body = io.NopCloser(bytes.NewReader(payload))
		return resp
	}
	restored := payload
	var decoded map[string]any
	if err := common.Unmarshal(payload, &decoded); err == nil {
		restoreToolNames(decoded, a.reverse)
		if encoded, err := common.Marshal(decoded); err == nil {
			restored = encoded
		}
	}
	resp.Body = io.NopCloser(bytes.NewReader(restored))
	resp.ContentLength = int64(len(restored))
	resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(restored)))
	return resp
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}

func upstreamModel(info *relaycommon.RelayInfo, fallback string) string {
	if info != nil && info.ChannelMeta != nil && info.UpstreamModelName != "" {
		return info.UpstreamModelName
	}
	return fallback
}
