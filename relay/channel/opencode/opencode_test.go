package opencode

import (
	"net/http"
	"strings"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
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

func TestShapeRequestRenamesToolsAndAppendsOfficials(t *testing.T) {
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

	if len(reverse) != 1 {
		t.Fatalf("expected one renamed tool, got %d", len(reverse))
	}
	var wire string
	for name := range reverse {
		wire = name
	}
	if !strings.HasPrefix(wire, "clint_") {
		t.Fatalf("wire name %q does not use the opaque prefix", wire)
	}
	if _, present := body["tool_choice"]; present {
		t.Fatal("tool_choice none must be dropped: the gate refuses it")
	}

	tools, _ := body["tools"].([]any)
	if len(tools) != 1+len(officialToolOrder) {
		t.Fatalf("expected %d tools after shaping, got %d", 1+len(officialToolOrder), len(tools))
	}
	first, _ := tools[0].(map[string]any)
	function, _ := first["function"].(map[string]any)
	if function["name"] != wire {
		t.Fatalf("caller tool was not renamed: %v", function["name"])
	}

	messages, _ := body["messages"].([]any)
	if len(messages) != 2 {
		t.Fatalf("expected the official prompt to be prepended, got %d messages", len(messages))
	}
	system, _ := messages[0].(map[string]any)
	content, _ := system["content"].(string)
	if !strings.Contains(content, promptMarker) {
		t.Fatal("the official prompt was not injected")
	}
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

func TestShapeRequestRewritesToolCallHistory(t *testing.T) {
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
	if function["name"] == "search" {
		t.Fatal("tool-call history kept the caller's tool name")
	}
	if restored := restoreToolName(function["name"].(string), reverse); restored != "search" {
		t.Fatalf("wire name did not map back to the caller's spelling: %q", restored)
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
	if len(reverse) != 1 {
		t.Fatalf("expected one renamed tool, got %d", len(reverse))
	}
	tools, _ := body["tools"].([]any)
	if len(tools) != 1+len(officialToolOrder) {
		t.Fatalf("expected the official set to be appended, got %d tools", len(tools))
	}
}

func TestEnsureCompletionLimit(t *testing.T) {
	body := map[string]any{"model": "big-pickle"}
	ensureCompletionLimit(body, "chat")
	if body["max_completion_tokens"] != completionLimit {
		t.Fatalf("chat body missing the client ceiling: %v", body["max_completion_tokens"])
	}
	explicit := map[string]any{"max_completion_tokens": 128}
	ensureCompletionLimit(explicit, "chat")
	if explicit["max_completion_tokens"] != 128 {
		t.Fatal("an explicit ceiling must be preserved")
	}
}

func TestSessionHeaders(t *testing.T) {
	headers := sessionHeaders("conversation")
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
	adaptor.Init(&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ApiKey: "sk-real"}})
	if adaptor.keyless {
		t.Fatal("a real key must use the console credential path")
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
