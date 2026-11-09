package opencode

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// shapeRequest makes one request body read as an official CLI session. Every
// step is a check the free tier performs, so a body missing any of them is
// refused before the model is reached:
//
//  1. the official system prompt, folded into the wire's system slot;
//  2. every caller tool renamed to an opaque wire name, so no foreign client's
//     tool vocabulary is visible;
//  3. the full official tool set appended;
//  4. every outbound reference to a renamed tool rewritten to match, keeping
//     the body self-consistent;
//  5. tool_choice "none" dropped — the gate refuses it outright.
//
// It returns the wire name -> caller name map used to restore the caller's
// spelling on the response side.
func shapeRequest(body map[string]any, shape string, model string) map[string]string {
	if body == nil {
		return nil
	}
	reverse := make(map[string]string)
	injectSystemPrompt(body, shape, model)
	renameTools(body, shape, reverse)
	rewriteToolReferences(body, shape, reverse)
	dropNoneToolChoice(body, shape)
	if shape == "chat" && body["stream"] == true {
		streamOptionsFor(body)
	}
	return reverse
}

// injectSystemPrompt prepends the official prompt to the wire's system slot. A
// body that already carries the marker is left alone, so a retried request
// cannot accumulate copies.
func injectSystemPrompt(body map[string]any, shape string, model string) {
	prompt := officialSystemPrompt(model)
	if prompt == "" {
		return
	}
	switch shape {
	case "flat":
		existing, _ := body["instructions"].(string)
		if strings.Contains(existing, promptMarker) {
			return
		}
		body["instructions"] = joinPrompt(prompt, existing)
	case "claude":
		if systemCarriesMarker(body["system"]) {
			return
		}
		body["system"] = prependToSystem(body["system"], prompt)
	default:
		messages, ok := body["messages"].([]any)
		if !ok {
			body["messages"] = []any{map[string]any{"role": "system", "content": prompt}}
			return
		}
		for index, raw := range messages {
			message, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			role, _ := message["role"].(string)
			if role != "system" && role != "developer" {
				continue
			}
			if contentCarriesMarker(message["content"]) {
				return
			}
			message["content"] = prependToContent(message["content"], prompt)
			messages[index] = message
			return
		}
		body["messages"] = append([]any{map[string]any{"role": "system", "content": prompt}}, messages...)
	}
}

func joinPrompt(prompt string, existing string) string {
	if strings.TrimSpace(existing) == "" {
		return prompt
	}
	return prompt + "\n\n" + existing
}

func systemCarriesMarker(system any) bool {
	switch value := system.(type) {
	case string:
		return strings.Contains(value, promptMarker)
	case []any:
		for _, block := range value {
			if contentCarriesMarker(block) {
				return true
			}
		}
	}
	return false
}

func contentCarriesMarker(content any) bool {
	switch value := content.(type) {
	case string:
		return strings.Contains(value, promptMarker)
	case []any:
		for _, part := range value {
			block, ok := part.(map[string]any)
			if !ok {
				continue
			}
			text, _ := block["text"].(string)
			if strings.Contains(text, promptMarker) {
				return true
			}
		}
	}
	return false
}

func prependToSystem(system any, prompt string) any {
	switch value := system.(type) {
	case string:
		return joinPrompt(prompt, value)
	case []any:
		return append([]any{map[string]any{"type": "text", "text": prompt}}, value...)
	default:
		return prompt
	}
}

func prependToContent(content any, prompt string) any {
	switch value := content.(type) {
	case string:
		return joinPrompt(prompt, value)
	case []any:
		return append([]any{map[string]any{"type": "text", "text": prompt}}, value...)
	default:
		return prompt
	}
}

// renameTools hides every caller tool behind an opaque wire name and appends
// the official set. A declaration that already is an official tool keeps its
// name and is not appended twice.
func renameTools(body map[string]any, shape string, reverse map[string]string) {
	official := officialToolNames()
	used := make(map[string]struct{}, len(official))
	for name := range official {
		used[name] = struct{}{}
	}
	tools, _ := body["tools"].([]any)
	shaped := make([]any, 0, len(tools)+len(officialToolOrder))
	for _, raw := range tools {
		tool, ok := raw.(map[string]any)
		if !ok {
			shaped = append(shaped, raw)
			continue
		}
		name, holder := toolNameHolder(tool, shape)
		if name == "" {
			// Responses built-ins and Anthropic server tools carry no client
			// name and are forwarded untouched.
			shaped = append(shaped, tool)
			continue
		}
		if _, isOfficial := official[name]; isOfficial {
			shaped = append(shaped, tool)
			continue
		}
		if strings.HasPrefix(name, "clint_") {
			// Already shaped on an earlier pass.
			shaped = append(shaped, tool)
			continue
		}
		wire := renameWireName(name, used)
		reverse[wire] = name
		holder["name"] = wire
		shaped = append(shaped, tool)
	}
	// A body that already carries the whole official set was shaped on an
	// earlier pass (a retried or resumed turn): appending again would declare
	// every official tool twice, which the gate reads as a different client.
	body["tools"] = append(shaped, missingOfficialTools(shaped, shape)...)
}

// missingOfficialTools renders only the officials the shaped list does not
// already declare.
func missingOfficialTools(shaped []any, shape string) []any {
	declared := make(map[string]struct{}, len(shaped))
	for _, raw := range shaped {
		tool, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if name, _ := toolNameHolder(tool, shape); name != "" {
			declared[name] = struct{}{}
		}
	}
	pending := make([]any, 0, len(officialToolOrder))
	for _, tool := range officialToolSet(shape) {
		entry, ok := tool.(map[string]any)
		if !ok {
			continue
		}
		name, _ := toolNameHolder(entry, shape)
		if _, present := declared[name]; present {
			continue
		}
		pending = append(pending, tool)
	}
	return pending
}

// toolNameHolder returns the map that owns the tool's name for this wire shape,
// and that name. An empty name means the entry has none (a built-in).
func toolNameHolder(tool map[string]any, shape string) (string, map[string]any) {
	if shape == "chat" {
		function, ok := tool["function"].(map[string]any)
		if !ok {
			return "", nil
		}
		name, _ := function["name"].(string)
		return name, function
	}
	if shape == "flat" {
		kind, _ := tool["type"].(string)
		if kind != "" && kind != "function" && kind != "custom" {
			return "", nil
		}
	}
	name, _ := tool["name"].(string)
	return name, tool
}

// rewriteToolReferences keeps every outbound mention of a renamed tool in sync:
// a named tool_choice, the function_call shortcut, and the call history each
// wire keeps.
func rewriteToolReferences(body map[string]any, shape string, reverse map[string]string) {
	if len(reverse) == 0 {
		return
	}
	forward := make(map[string]string, len(reverse))
	for wire, original := range reverse {
		forward[original] = wire
	}
	rename := func(name string) (string, bool) {
		wire, ok := forward[name]
		return wire, ok
	}

	if choice, ok := body["tool_choice"].(map[string]any); ok {
		if function, ok := choice["function"].(map[string]any); ok {
			if name, _ := function["name"].(string); name != "" {
				if wire, renamed := rename(name); renamed {
					function["name"] = wire
				}
			}
		} else if name, _ := choice["name"].(string); name != "" {
			if wire, renamed := rename(name); renamed {
				choice["name"] = wire
			}
		}
		if allowed, ok := choice["allowed_tools"].([]any); ok {
			for _, entry := range allowed {
				tool, ok := entry.(map[string]any)
				if !ok {
					continue
				}
				if name, _ := tool["name"].(string); name != "" {
					if wire, renamed := rename(name); renamed {
						tool["name"] = wire
					}
				}
			}
		}
	}

	if call, ok := body["function_call"].(map[string]any); ok {
		if name, _ := call["name"].(string); name != "" {
			if wire, renamed := rename(name); renamed {
				call["name"] = wire
			}
		}
	}

	if shape == "flat" {
		if input, ok := body["input"].([]any); ok {
			for _, entry := range input {
				item, ok := entry.(map[string]any)
				if !ok {
					continue
				}
				kind, _ := item["type"].(string)
				if kind != "function_call" && kind != "custom_tool_call" {
					continue
				}
				if name, _ := item["name"].(string); name != "" {
					if wire, renamed := rename(name); renamed {
						item["name"] = wire
					}
				}
			}
		}
		return
	}

	messages, _ := body["messages"].([]any)
	for _, raw := range messages {
		message, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if calls, ok := message["tool_calls"].([]any); ok {
			for _, entry := range calls {
				call, ok := entry.(map[string]any)
				if !ok {
					continue
				}
				function, ok := call["function"].(map[string]any)
				if !ok {
					continue
				}
				if name, _ := function["name"].(string); name != "" {
					if wire, renamed := rename(name); renamed {
						function["name"] = wire
					}
				}
			}
		}
		content, _ := message["content"].([]any)
		for _, entry := range content {
			block, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			if kind, _ := block["type"].(string); kind != "tool_use" {
				continue
			}
			if name, _ := block["name"].(string); name != "" {
				if wire, renamed := rename(name); renamed {
					block["name"] = wire
				}
			}
		}
	}
}

// dropNoneToolChoice removes tool_choice "none", which the gate refuses. The
// Responses wire defaults to "auto" instead, as the official client does.
func dropNoneToolChoice(body map[string]any, shape string) {
	if choice, ok := body["tool_choice"]; ok {
		if value, isString := choice.(string); isString && value == "none" {
			delete(body, "tool_choice")
		} else if object, isObject := choice.(map[string]any); isObject {
			if kind, _ := object["type"].(string); kind == "none" {
				delete(body, "tool_choice")
			}
		}
	}
	if shape == "flat" {
		if _, present := body["tool_choice"]; !present {
			body["tool_choice"] = "auto"
		}
	}
}

// ensureCompletionLimit gives a chat body the ceiling the 2.x client always
// sends when the caller named none.
func ensureCompletionLimit(body map[string]any, shape string) {
	if shape != "chat" {
		return
	}
	if _, present := body["max_completion_tokens"]; present {
		return
	}
	if _, present := body["max_tokens"]; present {
		return
	}
	body["max_completion_tokens"] = completionLimit
}

// restoreToolNames rewrites wire names back to the caller's spelling in a
// non-streaming response body.
func restoreToolNames(payload map[string]any, reverse map[string]string) {
	if len(reverse) == 0 {
		return
	}
	choices, _ := payload["choices"].([]any)
	for _, raw := range choices {
		choice, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		message, ok := choice["message"].(map[string]any)
		if !ok {
			continue
		}
		calls, _ := message["tool_calls"].([]any)
		for _, entry := range calls {
			call, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			function, ok := call["function"].(map[string]any)
			if !ok {
				continue
			}
			if name, _ := function["name"].(string); name != "" {
				function["name"] = restoreToolName(name, reverse)
			}
		}
	}
}

// restoreStreamToolNames rewrites wire names in one SSE frame. Frames that do
// not name a tool are returned unchanged.
func restoreStreamToolNames(frame string, reverse map[string]string) string {
	if len(reverse) == 0 || !strings.Contains(frame, "clint_") {
		return frame
	}
	var payload map[string]any
	if err := common.Unmarshal([]byte(frame), &payload); err != nil {
		return frame
	}
	changed := false
	choices, _ := payload["choices"].([]any)
	for _, raw := range choices {
		choice, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		delta, ok := choice["delta"].(map[string]any)
		if !ok {
			continue
		}
		calls, _ := delta["tool_calls"].([]any)
		for _, entry := range calls {
			call, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			function, ok := call["function"].(map[string]any)
			if !ok {
				continue
			}
			name, _ := function["name"].(string)
			if name == "" {
				continue
			}
			if restored := restoreToolName(name, reverse); restored != name {
				function["name"] = restored
				changed = true
			}
		}
	}
	if !changed {
		return frame
	}
	data, err := common.Marshal(payload)
	if err != nil {
		return frame
	}
	return string(data)
}

// sessionHeaders returns the client-identity headers one request carries. The
// official 1.19.5 client sends the canonical id on both session headers and a
// project id alongside them; the project id derives from the session so one
// conversation's retries share one upstream quota bucket.
func sessionHeaders(seed string) map[string]string {
	session := sessionID(seed)
	headers := map[string]string{
		"content-type":          "application/json",
		"authorization":         "Bearer " + anonymousCredential,
		"user-agent":            clientUserAgent,
		"x-opencode-client":     "cli",
		"x-opencode-session":    session,
		"x-opencode-session-id": session,
		"x-opencode-project":    projectID(session),
		"accept":                "*/*",
	}
	for name, value := range traceHeaders() {
		headers[name] = value
	}
	return headers
}
