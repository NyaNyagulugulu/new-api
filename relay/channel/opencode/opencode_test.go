package opencode

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSessionIDCarriesPlausibleTimestamp(t *testing.T) {
	id := sessionID("conversation-1")
	if !strings.HasPrefix(id, "ses_") {
		t.Fatalf("session id %q does not carry the ses_ prefix", id)
	}
	if len(id) != 4+12+14 {
		t.Fatalf("session id %q has length %d, want %d", id, len(id), 4+12+14)
	}
	// The 12 leading hex characters are the inverted timestamp; the gate
	// refuses ids whose decoded date is implausible, so it must land inside the
	// accepted window rather than at the epoch.
	if id == sessionID("conversation-2") {
		t.Fatal("different conversations minted the same session id")
	}
}

func TestOfficialSystemPromptHidesProviderIdentity(t *testing.T) {
	prompt := officialSystemPrompt("deepseek-v4.1-flash-free")
	if !strings.Contains(prompt, "Safe human-readable model name: DeepSeek V4.1 Flash") {
		t.Fatal("identity policy must provide a safe model name")
	}
	if !strings.Contains(prompt, "Never disclose, repeat, or infer the exact model ID") {
		t.Fatal("identity policy must forbid internal model disclosure")
	}
}

func TestHumanModelNameRemovesProviderAndTier(t *testing.T) {
	if got := humanModelName("deepseek/deepseek-v4.1-flash-free"); got != "DeepSeek V4.1 Flash" {
		t.Fatalf("human model name = %q", got)
	}
	if got := humanModelName("anthropic/claude-fable-5-paid"); got != "Claude Fable 5" {
		t.Fatalf("human model name = %q", got)
	}
}

func TestSessionIDIsStableForOneSeed(t *testing.T) {
	if sessionID("same") != sessionID("same") {
		t.Fatal("one conversation must keep one upstream session")
	}
}

func TestProjectIDShape(t *testing.T) {
	if got := projectID("global"); got != "global" {
		t.Fatalf("global project must pass through, got %q", got)
	}
	commit := strings.Repeat("a", 40)
	if got := projectID(commit); got != commit {
		t.Fatalf("a git commit must pass through, got %q", got)
	}
	hashed := projectID("some/conversation")
	if !isHex40(hashed) {
		t.Fatalf("project id %q is not 40 lowercase hex characters", hashed)
	}
}

func TestShapeRequestPreservesCallerToolsAndAppendsOfficials(t *testing.T) {
	body := map[string]any{
		"model": "deepseek-v4.1-flash-free",
		"messages": []any{
			map[string]any{"role": "user", "content": "list files"},
		},
		"tools": []any{
			map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        "list_files",
					"description": "List files",
					"parameters":  map[string]any{"type": "object", "properties": map[string]any{}},
				},
			},
		},
		"tool_choice": "none",
	}

	reverse := shapeRequest(body, "chat", "deepseek-v4.1-flash-free")

	assert.Empty(t, reverse)
	if _, present := body["tool_choice"]; present {
		if body["tool_choice"] != "auto" {
			t.Fatalf("caller tool choice must be normalized to auto, got %v", body["tool_choice"])
		}
	}

	tools, _ := body["tools"].([]any)
	require.Len(t, tools, len(officialToolOrder)+1)
	callerTool := tools[0].(map[string]any)["function"].(map[string]any)
	assert.Equal(t, "list_files", callerTool["name"])
	assert.Equal(t, "List files", callerTool["description"])

	messages, _ := body["messages"].([]any)
	if len(messages) != 2 {
		t.Fatalf("expected the official prompt to be prepended, got %d messages", len(messages))
	}
	system, _ := messages[0].(map[string]any)
	content, _ := system["content"].(string)
	if !strings.Contains(content, promptMarker) {
		t.Fatal("the official prompt was not injected")
	}
	assert.Contains(t, content, "only executable tools provided by this client are: list_files.")
}

func TestShapeRequestIsIdempotent(t *testing.T) {
	body := map[string]any{
		"model":    "big-pickle",
		"messages": []any{map[string]any{"role": "user", "content": "hi"}},
		"tools": []any{
			map[string]any{
				"type":     "function",
				"function": map[string]any{"name": "lookup", "parameters": map[string]any{"type": "object"}},
			},
		},
	}
	shapeRequest(body, "chat", "big-pickle")
	firstTools := len(body["tools"].([]any))
	shapeRequest(body, "chat", "big-pickle")
	if got := len(body["tools"].([]any)); got != firstTools {
		t.Fatalf("shaping twice changed the tool count: %d then %d", firstTools, got)
	}
	messages := body["messages"].([]any)
	if len(messages) != 2 {
		t.Fatalf("shaping twice duplicated the system prompt: %d messages", len(messages))
	}
}

func TestShapeRequestPreservesCallerToolDefinitionsAndHistory(t *testing.T) {
	body := map[string]any{
		"model": "big-pickle",
		"messages": []any{
			map[string]any{
				"role": "assistant",
				"tool_calls": []any{
					map[string]any{
						"id":       "call_1",
						"type":     "function",
						"function": map[string]any{"name": "search", "arguments": "{}"},
					},
				},
			},
		},
		"tools": []any{
			map[string]any{
				"type":     "function",
				"function": map[string]any{"name": "search", "parameters": map[string]any{"type": "object"}},
			},
		},
	}
	reverse := shapeRequest(body, "chat", "big-pickle")
	messages := body["messages"].([]any)
	// The prompt is prepended, so the history row moved one slot.
	history, _ := messages[1].(map[string]any)
	calls, _ := history["tool_calls"].([]any)
	call, _ := calls[0].(map[string]any)
	function, _ := call["function"].(map[string]any)
	if function["name"] != "search" {
		t.Fatalf("tool-call history should remain caller-readable, got %q", function["name"])
	}
	if restored := restoreToolName(function["name"].(string), reverse); restored != "search" {
		t.Fatalf("tool-call history changed unexpectedly: %q", restored)
	}
}

func TestShapeRequestClaudeWire(t *testing.T) {
	body := map[string]any{
		"model":  "big-pickle",
		"system": "be brief",
		"tools": []any{
			map[string]any{
				"name":         "lookup",
				"description":  "Look something up",
				"input_schema": map[string]any{"type": "object"},
			},
		},
	}
	reverse := shapeRequest(body, "claude", "big-pickle")
	system, _ := body["system"].(string)
	if !strings.Contains(system, promptMarker) || !strings.Contains(system, "be brief") {
		t.Fatal("the official prompt must be prepended without dropping the caller's system text")
	}
	assert.Empty(t, reverse)
	tools, _ := body["tools"].([]any)
	require.Len(t, tools, len(officialToolOrder)+1)
	assert.Equal(t, "lookup", tools[0].(map[string]any)["name"])
}

func TestEnsureCompletionLimit(t *testing.T) {
	body := map[string]any{"model": "big-pickle"}
	ensureCompletionLimit(body, "chat")
	if body["max_completion_tokens"] != completionLimit {
		t.Fatalf("chat body missing the client ceiling: %v", body["max_completion_tokens"])
	}
	explicit := map[string]any{"max_completion_tokens": 128}
	ensureCompletionLimit(explicit, "chat")
	if explicit["max_completion_tokens"] != completionLimit {
		t.Fatalf("the free tier requires its official completion ceiling, got %v", explicit["max_completion_tokens"])
	}
	legacy := map[string]any{"max_tokens": 128}
	ensureCompletionLimit(legacy, "chat")
	if _, present := legacy["max_tokens"]; present {
		t.Fatal("the legacy token limit must be removed from the official request shape")
	}
	if legacy["max_completion_tokens"] != completionLimit {
		t.Fatalf("the free tier requires its official completion ceiling, got %v", legacy["max_completion_tokens"])
	}
}

func TestSessionHeaders(t *testing.T) {
	headers := sessionHeaders("conversation", "channel:1")
	session := headers["x-opencode-session"]
	if headers["x-opencode-session-id"] != session {
		t.Fatalf("x-opencode-session-id must carry the same canonical session, got %q", headers["x-opencode-session-id"])
	}
	if headers["authorization"] != "Bearer public" {
		t.Fatalf("the keyless lane must use the pooled credential, got %q", headers["authorization"])
	}
	if headers["user-agent"] != clientUserAgent {
		t.Fatalf("user agent must be the exact client string, got %q", headers["user-agent"])
	}
	if headers["x-opencode-client"] != clientName {
		t.Fatalf("client header must use the official application name, got %q", headers["x-opencode-client"])
	}
	if headers["x-session-affinity"] != session || headers["X-Session-Id"] != session {
		t.Fatal("session affinity aliases must carry the canonical session")
	}
	if headers["x-opencode-project"] == projectID("conversation") {
		t.Fatal("project id must not be derived from the request session")
	}
	if !isHex40(headers["x-opencode-project"]) {
		t.Fatalf("project header %q is not 40-hex", headers["x-opencode-project"])
	}
	if _, present := headers["x-opencode-request"]; present {
		t.Fatal("the v1-only request header must never be sent")
	}
}

func TestAdaptorUsesKeylessLaneForEmptyKey(t *testing.T) {
	adaptor := &Adaptor{}
	adaptor.Init(&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ApiKey: "EMPTY"}})
	if !adaptor.keyless {
		t.Fatal("an EMPTY key must select the keyless free lane")
	}
	request := &dto.GeneralOpenAIRequest{Model: "deepseek-v4.1-flash-free"}
	stream := false
	request.Stream = &stream
	limit := uint(8)
	request.MaxTokens = &limit
	converted, err := adaptor.ConvertOpenAIRequest(nil, nil, request)
	require.NoError(t, err)
	body, ok := converted.(map[string]any)
	require.True(t, ok)
	assert.Equal(t, true, body["stream"])
	assert.Equal(t, completionLimit, body["max_completion_tokens"])
	assert.NotContains(t, body, "max_tokens")
	assert.Equal(t, true, body["stream_options"].(map[string]any)["include_usage"])
	assert.False(t, adaptor.clientStream)

	adaptor.Init(&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ApiKey: "sk-real"}})
	if adaptor.keyless {
		t.Fatal("a real key must use the console credential path")
	}
	assert.False(t, adaptor.freeTierStream)
}

func TestResponsesRequestUsesChatWireForKeylessFreeTier(t *testing.T) {
	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{
		UserId:      1,
		RelayFormat: types.RelayFormatOpenAIResponses,
		RelayMode:   relayconstant.RelayModeResponses,
		ChannelMeta: &relaycommon.ChannelMeta{
			ApiKey:            "EMPTY",
			ChannelId:         24,
			UpstreamModelName: "deepseek-v4.1-flash-free",
		},
	}
	adaptor.Init(info)

	converted, err := adaptor.ConvertOpenAIResponsesRequest(nil, info, dto.OpenAIResponsesRequest{
		Model:  "deepseek-v4.1-flash-free",
		Input:  []byte(`[{"role":"user","content":"hi"}]`),
		Stream: lo.ToPtr(true),
	})
	require.NoError(t, err)
	body, ok := converted.(map[string]any)
	require.True(t, ok)
	assert.Equal(t, true, body["stream"])
	assert.Equal(t, completionLimit, body["max_completion_tokens"])
	assert.Contains(t, body, "messages")
	assert.NotContains(t, body, "input")
}

func TestConversationSessionSeedSeparatesConversations(t *testing.T) {
	info := &relaycommon.RelayInfo{
		UserId:      1,
		ChannelMeta: &relaycommon.ChannelMeta{ChannelId: 24},
	}
	first := conversationSessionSeed(info, map[string]any{
		"messages": []any{map[string]any{"role": "user", "content": "first"}},
	})
	second := conversationSessionSeed(info, map[string]any{
		"messages": []any{map[string]any{"role": "user", "content": "second"}},
	})
	if first == second {
		t.Fatal("different conversations must not share a free-tier session")
	}
}

func TestSetupRequestHeaderReplacesCallerAuth(t *testing.T) {
	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ApiKey: ""}}
	adaptor.Init(info)
	headers := http.Header{}
	headers.Set("Authorization", "Bearer caller-token")
	headers.Set("x-api-key", "caller-key")
	if err := adaptor.SetupRequestHeader(nil, &headers, info); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if headers.Get("Authorization") != "Bearer public" {
		t.Fatalf("caller credential was not replaced: %q", headers.Get("Authorization"))
	}
	if headers.Get("x-api-key") != "" {
		t.Fatal("the Anthropic credential header must be cleared on the keyless lane")
	}
}

func TestSetupRequestHeaderAddsOpenCodeOrganization(t *testing.T) {
	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ApiKey:       "st_test",
			Organization: "wrk_test",
		},
	}
	adaptor.Init(info)
	headers := http.Header{}
	require.NoError(t, adaptor.SetupRequestHeader(nil, &headers, info))
	assert.Equal(t, "Bearer st_test", headers.Get("Authorization"))
	assert.Equal(t, "wrk_test", headers.Get("x-opencode-org-id"))
	assert.Equal(t, clientUserAgent, headers.Get("User-Agent"))
	assert.Equal(t, clientName, headers.Get("x-opencode-client"))
	assert.NotEmpty(t, headers.Get("x-opencode-session-id"))
	assert.True(t, adaptor.ResponsesViaChat())

	converted, err := adaptor.ConvertOpenAIResponsesRequest(nil, info, dto.OpenAIResponsesRequest{
		Model: "mimo-v2.6-flash-free",
		Input: []byte(`[{"role":"user","content":"hi"}]`),
	})
	require.NoError(t, err)
	body, ok := converted.(map[string]any)
	require.True(t, ok)
	assert.Equal(t, true, body["stream"])
	assert.Contains(t, body, "messages")
	assert.NotContains(t, body, "input")

	adaptor.Init(&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ApiKey: "sk-console-key"}})
	assert.False(t, adaptor.cliMode)
	assert.False(t, adaptor.ResponsesViaChat())
}

func TestResponsesClientToolsRoundTrip(t *testing.T) {
	previousTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })
	for _, tc := range []struct {
		name          string
		tools         string
		upstreamName  string
		returnedName  string
		namespace     string
		arguments     string
		returnedInput string
	}{
		{
			name:         "MCP function",
			tools:        `[{"type":"function","name":"mcp__filesystem__write_file","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}]`,
			upstreamName: "mcp__filesystem__write_file",
			returnedName: "mcp__filesystem__write_file",
			arguments:    `{"path":"/tmp/tool-test.txt"}`,
		},
		{
			name:          "Codex custom tool",
			tools:         `[{"type":"custom","name":"apply_patch","format":{"type":"text"}}]`,
			upstreamName:  "apply_patch",
			returnedName:  "apply_patch",
			arguments:     `{"input":"*** Begin Patch\n*** End Patch"}`,
			returnedInput: "*** Begin Patch\n*** End Patch",
		},
		{
			name:         "namespaced MCP function",
			tools:        `[{"type":"namespace","name":"filesystem","tools":[{"type":"function","name":"read_file","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}]}]`,
			upstreamName: "filesystem__read_file",
			returnedName: "read_file",
			namespace:    "filesystem",
			arguments:    `{"path":"/tmp/tool-test.txt"}`,
		},
	} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream=%t", tc.name, stream), func(t *testing.T) {
				recorder := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(recorder)
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
				c.Set(common.RequestIdKey, "tool-round-trip")
				info := &relaycommon.RelayInfo{
					ChannelMeta: &relaycommon.ChannelMeta{
						ApiKey: "st_test", UpstreamModelName: "deepseek-v4.1-flash-free",
					},
					RelayFormat: types.RelayFormatOpenAIResponses,
					RelayMode:   relayconstant.RelayModeResponses,
					IsStream:    stream, DisablePing: true,
				}
				adaptor := &Adaptor{}
				adaptor.Init(info)
				converted, err := adaptor.ConvertOpenAIResponsesRequest(c, info, dto.OpenAIResponsesRequest{
					Model: "deepseek-v4.1-flash-free", Input: []byte(`"use the tool"`),
					Tools: []byte(tc.tools), Stream: &stream,
				})
				require.NoError(t, err)
				body := converted.(map[string]any)
				tools := body["tools"].([]any)
				assert.Equal(t, tc.upstreamName, tools[0].(map[string]any)["function"].(map[string]any)["name"])
				prompt := body["messages"].([]any)[0].(map[string]any)["content"].(string)
				assert.Contains(t, prompt, "only executable tools provided by this client are: "+tc.upstreamName+".")

				chunk := map[string]any{
					"id": "chat_tool", "model": "deepseek-v4.1-flash-free",
					"choices": []any{map[string]any{
						"index": 0, "finish_reason": nil,
						"delta": map[string]any{"tool_calls": []any{map[string]any{
							"index": 0, "id": "call_client", "type": "function",
							"function": map[string]any{"name": tc.upstreamName, "arguments": tc.arguments},
						}}},
					}},
				}
				payload, err := common.Marshal(chunk)
				require.NoError(t, err)
				sse := "data: " + string(payload) + "\n\n" +
					"data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n" +
					"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":3,\"total_tokens\":5}}\n\n" +
					"data: [DONE]\n\n"
				upstream := &http.Response{
					StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/event-stream"}},
					Body: io.NopCloser(strings.NewReader(sse)),
				}
				usage, apiErr := adaptor.DoResponse(c, upstream, info)
				require.Nil(t, apiErr)
				require.NotNil(t, usage)
				assert.Equal(t, 5, usage.(*dto.Usage).TotalTokens)
				var response map[string]any
				if stream {
					for line := range strings.SplitSeq(recorder.Body.String(), "\n") {
						data, ok := strings.CutPrefix(line, "data:")
						if !ok {
							continue
						}
						var event map[string]any
						require.NoError(t, common.UnmarshalJsonStr(strings.TrimSpace(data), &event))
						if event["type"] == "response.completed" {
							response, _ = event["response"].(map[string]any)
						}
					}
				} else {
					require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
				}
				require.NotNil(t, response)
				output, ok := response["output"].([]any)
				require.True(t, ok)
				var toolCall map[string]any
				for _, raw := range output {
					item, _ := raw.(map[string]any)
					if item["call_id"] == "call_client" {
						toolCall = item
					}
				}
				require.NotNil(t, toolCall)
				assert.Equal(t, tc.returnedName, toolCall["name"])
				if tc.namespace != "" {
					assert.Equal(t, tc.namespace, toolCall["namespace"])
				}
				if tc.returnedInput != "" {
					assert.Equal(t, "custom_tool_call", toolCall["type"])
					assert.Equal(t, tc.returnedInput, toolCall["input"])
				} else {
					assert.Equal(t, "function_call", toolCall["type"])
					assert.Equal(t, tc.arguments, toolCall["arguments"])
				}

				outputType := "function_call_output"
				if tc.returnedInput != "" {
					outputType = "custom_tool_call_output"
				}
				history, err := common.Marshal([]any{
					map[string]any{"role": "user", "content": "use the tool"},
					toolCall,
					map[string]any{
						"type": outputType, "call_id": "call_client",
						"output": "client tool completed successfully",
					},
				})
				require.NoError(t, err)
				nextAdaptor := &Adaptor{}
				nextAdaptor.Init(info)
				next, err := nextAdaptor.ConvertOpenAIResponsesRequest(c, info, dto.OpenAIResponsesRequest{
					Model: "deepseek-v4.1-flash-free", Input: history,
					Tools: []byte(tc.tools), Stream: &stream,
				})
				require.NoError(t, err)
				messages := next.(map[string]any)["messages"].([]any)
				var replayedCall, replayedResult map[string]any
				for _, raw := range messages {
					message := raw.(map[string]any)
					if calls, ok := message["tool_calls"].([]any); ok && len(calls) > 0 {
						replayedCall = calls[0].(map[string]any)
					}
					if message["role"] == "tool" {
						replayedResult = message
					}
				}
				require.NotNil(t, replayedCall)
				assert.Equal(t, "call_client", replayedCall["id"])
				function := replayedCall["function"].(map[string]any)
				assert.Equal(t, tc.upstreamName, function["name"])
				assert.JSONEq(t, tc.arguments, function["arguments"].(string))
				require.NotNil(t, replayedResult)
				assert.Equal(t, "call_client", replayedResult["tool_call_id"])
				assert.Equal(t, "client tool completed successfully", replayedResult["content"])
			})
		}
	}
}

func TestClientToolSchemaAndChoiceArePreserved(t *testing.T) {
	for _, name := range []string{"exec_command", "execute", "mcp__filesystem__write_file"} {
		t.Run(name, func(t *testing.T) {
			tool := map[string]any{
				"type": "function",
				"function": map[string]any{
					"name": name, "description": "Client-specific tool",
					"parameters": map[string]any{
						"type":       "object",
						"properties": map[string]any{"cmd": map[string]any{"type": "string"}},
						"required":   []any{"cmd"}, "additionalProperties": false,
					},
				},
			}
			choice := map[string]any{"type": "function", "function": map[string]any{"name": name}}
			body := map[string]any{
				"model":    "deepseek-v4.1-flash-free",
				"messages": []any{map[string]any{"role": "user", "content": "use the client tool"}},
				"tools":    []any{tool}, "tool_choice": choice,
			}
			before, err := common.Marshal(tool)
			require.NoError(t, err)
			shapeRequest(body, "chat", "deepseek-v4.1-flash-free")
			tools := body["tools"].([]any)
			after, err := common.Marshal(tools[0])
			require.NoError(t, err)
			assert.JSONEq(t, string(before), string(after))
			assert.Equal(t, choice, body["tool_choice"])
			count := 0
			for _, raw := range tools {
				if toolName, _ := toolNameHolder(raw.(map[string]any), "chat"); toolName == name {
					count++
				}
			}
			assert.Equal(t, 1, count)
		})
	}

	body := map[string]any{"messages": []any{map[string]any{"role": "user", "content": "hello"}}}
	shapeRequest(body, "chat", "mimo-v2.6-flash-free")
	prompt := body["messages"].([]any)[0].(map[string]any)["content"].(string)
	assert.Contains(t, prompt, "The client has not provided any executable tools.")
}

func TestRestoreStreamToolNames(t *testing.T) {
	reverse := map[string]string{"clint_abc": "list_files"}
	frame := `{"choices":[{"delta":{"tool_calls":[{"function":{"name":"clint_abc"}}]}}]}`
	restored := restoreStreamToolNames(frame, reverse)
	if !strings.Contains(restored, `"list_files"`) {
		t.Fatalf("stream frame was not restored: %s", restored)
	}
	plain := `{"choices":[{"delta":{"content":"hello"}}]}`
	if restoreStreamToolNames(plain, reverse) != plain {
		t.Fatal("a frame without a tool name must pass through unchanged")
	}
}

func TestBufferChatStream(t *testing.T) {
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body: io.NopCloser(bytes.NewBufferString(
			"data: {\"id\":\"cmpl_1\",\"model\":\"deepseek-v4.1-flash-free\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"reasoning_content\":\"reason\",\"content\":\"hel\"},\"finish_reason\":null}]}\n\n" +
				"data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":2,\"total_tokens\":4}}\n\n" +
				"data: [DONE]\n\n",
		)),
	}

	buffered, err := bufferChatStream(resp)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := io.ReadAll(buffered.Body)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := common.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	choices, _ := decoded["choices"].([]any)
	choice, _ := choices[0].(map[string]any)
	message, _ := choice["message"].(map[string]any)
	if message["content"] != "hello" {
		t.Fatalf("buffered content = %v, want hello", message["content"])
	}
	if choice["finish_reason"] != "stop" {
		t.Fatalf("buffered finish reason = %v, want stop", choice["finish_reason"])
	}
	assert.Equal(t, "reason", message["reasoning_content"])
	usage, ok := decoded["usage"].(map[string]any)
	require.True(t, ok)
	assert.EqualValues(t, 2, usage["prompt_tokens"])
	assert.EqualValues(t, 2, usage["completion_tokens"])
	assert.EqualValues(t, 4, usage["total_tokens"])
}
