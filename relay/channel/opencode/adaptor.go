package opencode

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
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
	"github.com/QuantumNous/new-api/relaykit/relayconvert"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

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
	// OAuth session tokens use the CLI wire just like anonymous requests.
	cliMode bool
	// freeTierStream records that the upstream request was forced into the
	// official streaming shape. Non-streaming callers are buffered back into
	// a normal OpenAI response in DoResponse.
	freeTierStream   bool
	clientStream     bool
	responsesViaChat bool
	sessionSeed      string
	textToolsEnabled bool
	textTools        *textToolProtocol
	// reverse maps the opaque wire name of a shaped tool back to the caller's.
	reverse map[string]string
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
	a.openaiAdaptor.Init(info)
	a.claudeAdaptor.Init(info)
	a.freeTierStream = false
	a.clientStream = info != nil && info.IsStream
	a.responsesViaChat = false
	a.sessionSeed = ""
	a.reverse = nil
	a.textToolsEnabled = false
	a.textTools = nil
	if info == nil || info.ChannelMeta == nil {
		a.keyless = true
		a.cliMode = true
		return
	}
	key := strings.TrimSpace(info.ApiKey)
	a.keyless = key == "" || strings.EqualFold(key, "EMPTY")
	a.cliMode = a.keyless || strings.HasPrefix(key, "st_")
	a.textToolsEnabled = a.cliMode
	if a.cliMode && info.ChannelOtherSettings.OpenCodeTextTools != nil {
		a.textToolsEnabled = *info.ChannelOtherSettings.OpenCodeTextTools
	}
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	if info == nil {
		return "", errors.New("relay info is missing")
	}
	base := strings.TrimRight(info.ChannelBaseUrl, "/")
	// The free tier only answers the official CLI's client fingerprint, which
	// Go cannot present; the sidecar carries it. A channel with a real key
	// talks to the upstream directly, so paid traffic never pays for the hop.
	if a.cliMode {
		sidecarBase, err := freeTierBaseURL()
		if err != nil {
			return "", err
		}
		base = sidecarBase
	}
	switch info.RelayMode {
	case relayconstant.RelayModeResponses:
		if a.cliMode {
			return base + ChatPath, nil
		}
		return base + ResponsesPath, nil
	case relayconstant.RelayModeChatCompletions:
		return base + ChatPath, nil
	}
	switch info.RelayFormat {
	case types.RelayFormatClaude:
		return base + MessagesPath, nil
	case types.RelayFormatOpenAIResponses:
		if a.cliMode {
			return base + ChatPath, nil
		}
		return base + ResponsesPath, nil
	}
	return base + ChatPath, nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	if c != nil && c.Request != nil {
		channel.SetupApiRequestHeader(info, c, req)
	}
	if a.cliMode {
		// The keyless lane authenticates with the pooled credential and is
		// fingerprinted on the client identity; every header it needs comes
		// from the same place so a caller's headers cannot half-replace it.
		req.Del("Authorization")
		req.Del("x-api-key")
		seed := a.sessionSeed
		if seed == "" {
			seed = sessionSeed(info)
		}
		for name, value := range sessionHeaders(seed, projectSeed(info)) {
			req.Set(name, value)
		}
		if !a.keyless {
			req.Set("Authorization", "Bearer "+strings.TrimSpace(info.ApiKey))
			if organization := strings.TrimSpace(info.Organization); organization != "" {
				req.Set("x-opencode-org-id", organization)
			}
		}
		return nil
	}
	req.Set("Authorization", "Bearer "+strings.TrimSpace(info.ApiKey))
	if organization := strings.TrimSpace(info.Organization); organization != "" {
		req.Set("x-opencode-org-id", organization)
	}
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

func conversationSessionSeed(info *relaycommon.RelayInfo, body map[string]any) string {
	base := sessionSeed(info)
	messages, _ := body["messages"].([]any)
	for _, raw := range messages {
		message, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if role, _ := message["role"].(string); role != "user" {
			continue
		}
		content, err := common.Marshal(message["content"])
		if err != nil {
			return base
		}
		sum := sha256.Sum256(append([]byte("opencode-conversation\x00"), content...))
		return base + ":" + hex.EncodeToString(sum[:8])
	}
	return base
}

func projectSeed(info *relaycommon.RelayInfo) string {
	if info == nil {
		return "global"
	}
	return fmt.Sprintf("channel:%d:user:%d:token:%d", info.ChannelId, info.UserId, info.TokenId)
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	if !a.cliMode {
		return request, nil
	}
	body, err := marshalMap(request)
	if err != nil {
		return nil, fmt.Errorf("encode request for the free tier: %w", err)
	}
	return a.prepareChatRequest(info, body, request, nil)
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	if !a.cliMode {
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
	if !a.cliMode {
		return request, nil
	}
	result, err := service.ConvertRequestByID(c, info, relayconvert.ConverterOpenAIResponsesToOpenAIChat, &request)
	if err != nil {
		return nil, fmt.Errorf("convert Responses request for the free tier: %w", err)
	}
	chatRequest, ok := result.Value.(*dto.GeneralOpenAIRequest)
	if !ok {
		return nil, fmt.Errorf("expected Chat Completions request, got %T", result.Value)
	}
	body, err := marshalMap(chatRequest)
	if err != nil {
		return nil, fmt.Errorf("encode request for the free tier: %w", err)
	}
	a.responsesViaChat = true
	return a.prepareChatRequest(info, body, chatRequest, []byte(request.Tools))
}

func (a *Adaptor) prepareChatRequest(info *relaycommon.RelayInfo, body map[string]any, request *dto.GeneralOpenAIRequest, responseTools []byte) (any, error) {
	a.freeTierStream = true
	a.clientStream = request.Stream != nil && *request.Stream
	a.sessionSeed = conversationSessionSeed(info, body)
	if a.textToolsEnabled {
		tools := request.Tools
		if len(tools) == 0 {
			tools = extractResponsesTextTools(responseTools)
		}
		if len(tools) > 0 {
			protocol, err := prepareTextTools(body, tools)
			if err != nil {
				return nil, types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest)
			}
			a.textTools = protocol
		}
	}
	body["stream"] = true
	a.reverse = shapeRequest(body, "chat", upstreamModel(info, request.Model))
	ensureCompletionLimit(body, "chat")
	return body, nil
}

func (a *Adaptor) ResponsesViaChat() bool {
	return a.cliMode
}

func (a *Adaptor) RequestConversionRequired() bool {
	return a.cliMode
}

func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	if a.cliMode {
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
	resp, err := channel.DoApiRequest(a, c, info, requestBody)
	if err == nil && resp != nil && resp.StatusCode == http.StatusOK && resp.Body != nil && a.textTools != nil {
		resp.Body = newTextToolStream(resp.Body, a.textTools)
		resp.ContentLength = -1
		resp.Header.Del("Content-Length")
	}
	return resp, err
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	if a.cliMode && a.freeTierStream && info != nil {
		info.IsStream = a.clientStream
		if !info.IsStream {
			var bufferErr error
			resp, bufferErr = bufferChatStream(resp)
			if bufferErr != nil {
				return nil, types.NewOpenAIError(bufferErr, types.ErrorCodeBadResponseBody, http.StatusBadGateway)
			}
		}
	}
	if a.cliMode && a.responsesViaChat {
		if info.IsStream {
			return openai.OaiChatToResponsesStreamHandler(c, info, resp)
		}
		return openai.OaiChatToResponsesHandler(c, info, resp)
	}
	if a.cliMode && len(a.reverse) > 0 {
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
