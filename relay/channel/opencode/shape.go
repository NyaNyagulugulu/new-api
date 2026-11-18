package opencode

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// shapeRequest adds the CLI compatibility envelope without changing the
// caller's tool names or schemas. Only tools declared by the caller are
// executable; compatibility-only declarations must never be selected.
func shapeRequest(body map[string]any, shape string, model string) map[string]string {
	if body == nil {
		return nil
	}
	reverse := make(map[string]string)
	injectSystemPrompt(body, shape, model)
	appendClientToolPolicy(body, shape)
	tools, _ := body["tools"].([]any)
	body["tools"] = append(tools, missingOfficialTools(tools, shape)...)
	rewriteToolReferences(body, shape, reverse)
	dropNoneToolChoice(body, shape)
	if shape == "chat" && body["stream"] == true {
		streamOptionsFor(body)
	}
	return reverse
}

// appendClientToolPolicy distinguishes executable client tools from the
// declarations required by the upstream CLI compatibility envelope.
func appendClientToolPolicy(body map[string]any, shape string) {
	const marker = "# Client tool availability"
	names := make([]string, 0)
	tools, _ := body["tools"].([]any)
	for _, raw := range tools {
		tool, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if name, _ := toolNameHolder(tool, shape); name != "" {
			names = append(names, name)
		}
	}
	policy := marker + "\n"
	if len(names) == 0 {
		policy += "The client has not provided any executable tools. Answer in text and do not emit tool calls."
	} else {
		policy += "The only executable tools provided by this client are: " + strings.Join(names, ", ") + ".\n" +
			"Call these tools directly using their declared names and JSON parameter schemas. " +
			"Tools supplied by an MCP server are called in exactly the same way as other client tools. " +
			"All other tool declarations and tool catalogs earlier in these instructions are compatibility metadata, not client capabilities. " +
			"Never select a tool outside the executable list, invent a tool name, translate its arguments to another tool schema, " +
			"or wrap a tool call in execute or another tool. Use execute only if the client explicitly supplied it."
	}
	switch shape {
	case "flat":
		existing, _ := body["instructions"].(string)
		if !strings.Contains(existing, marker) {
			body["instructions"] = existing + "\n\n" + policy
		}
	case "claude":
		switch system := body["system"].(type) {
		case string:
			if !strings.Contains(system, marker) {
				body["system"] = system + "\n\n" + policy
			}
		case []any:
			for _, raw := range system {
				block, _ := raw.(map[string]any)
				if text, _ := block["text"].(string); strings.Contains(text, marker) {
					return
				}
			}
			body["system"] = append(system, map[string]any{"type": "text", "text": policy})
		}
	default:
		messages, _ := body["messages"].([]any)
		for _, raw := range messages {
			message, _ := raw.(map[string]any)
			role, _ := message["role"].(string)
			if role != "system" && role != "developer" {
				continue
			}
			switch content := message["content"].(type) {
			case string:
				if !strings.Contains(content, marker) {
					message["content"] = content + "\n\n" + policy
				}
			case []any:
				for _, rawPart := range content {
					part, _ := rawPart.(map[string]any)
					if text, _ := part["text"].(string); strings.Contains(text, marker) {
						return
					}
				}
				message["content"] = append(content, map[string]any{"type": "text", "text": policy})
			}
			return
		}
	}
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

// dropNoneToolChoice normalizes the unsupported "none" choice. Named and
// required choices keep referring to the caller's preserved definitions.
func dropNoneToolChoice(body map[string]any, shape string) {
	if choice, ok := body["tool_choice"]; ok {
		if shape == "chat" {
			if value, ok := choice.(string); ok && value == "none" {
				body["tool_choice"] = "auto"
			}
		} else if value, isString := choice.(string); isString && value == "none" {
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

// ensureCompletionLimit applies the completion ceiling used by the official
// free-tier chat shape. The gateway rejects legacy max_tokens and smaller
// caller-provided limits with the same 429 used for exhausted free usage.
func ensureCompletionLimit(body map[string]any, shape string) {
	if shape != "chat" {
		return
	}
	delete(body, "max_tokens")
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
// v2 client separates the request session id from the session-affinity id and
// sends both legacy aliases used by the gateway.
func sessionHeaders(seed string, projectSignal string) map[string]string {
	session := sessionID(seed)
	affinity := session
	headers := map[string]string{
		"content-type":          "application/json",
		"authorization":         "Bearer " + anonymousCredential,
		"user-agent":            clientUserAgent,
		"x-opencode-client":     clientName,
		"x-opencode-session-id": session,
		"x-opencode-session":    affinity,
		"x-session-affinity":    affinity,
		"X-Session-Id":          affinity,
		"x-session-id":          affinity,
		"x-opencode-project":    projectID(projectSignal),
		"accept":                "*/*",
	}
	for name, value := range traceHeaders() {
		headers[name] = value
	}
	return headers
}
