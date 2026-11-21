package opencode

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

const (
	textToolCallPrefix = "<new_api_tool_call>"
	textToolCallSuffix = "</new_api_tool_call>"
	textToolPrompt     = `When you need to call a client tool, do not use native tool calling. Instead output exactly one tag per call in this form:
<new_api_tool_call>{"name":"tool_name","arguments":{"key":"value"}}</new_api_tool_call>
Use only a tool from the list below. The arguments value must be a JSON object that follows that tool's schema. Do not put markdown around the tag and do not add commentary inside it.
File, shell, workspace, code, and external-action requests require a client tool call. For those requests, you MUST emit the tag, must not finish with an empty response, and must not answer with only reasoning or an explanation.`
	textToolReminder = `Tool protocol reminder: if the current user request requires creating, editing, inspecting, or running anything, emit the required client-tool tag now. Never finish that request with an empty response.`
)

type textToolProtocol struct {
	allowed map[string]struct{}
	// shellTarget is enabled only for a declared, compatible exec_command schema.
	shellTarget  string
	shellWorkdir bool
}

type textToolCall struct {
	Name      string `json:"name"`
	Arguments any    `json:"arguments"`
}

func prepareTextTools(body map[string]any, tools []dto.ToolCallRequest) (*textToolProtocol, error) {
	if len(tools) == 0 {
		return nil, nil
	}

	protocol := &textToolProtocol{allowed: make(map[string]struct{}, len(tools))}
	var catalog strings.Builder
	catalog.WriteString(textToolPrompt)
	catalog.WriteString("\n\nAvailable tools:\n")
	for _, tool := range tools {
		name := strings.TrimSpace(tool.Function.Name)
		if name == "" {
			continue
		}
		protocol.allowed[name] = struct{}{}
		schema := strings.TrimSpace(string(tool.Function.Parameters))
		if schema == "" {
			schema = `{"type":"object","properties":{}}`
		}
		var schemaValue any
		if err := common.Unmarshal([]byte(schema), &schemaValue); err != nil {
			return nil, fmt.Errorf("invalid schema for tool %q: %w", name, err)
		}
		if name == "exec_command" {
			var target struct {
				Type       string `json:"type"`
				Properties map[string]struct {
					Type string `json:"type"`
				} `json:"properties"`
				Required []string `json:"required"`
			}
			if err := common.Unmarshal([]byte(schema), &target); err == nil && target.Type == "object" && target.Properties["cmd"].Type == "string" {
				compatible := true
				for _, required := range target.Required {
					if required != "cmd" {
						compatible = false
					}
				}
				if compatible {
					protocol.shellTarget = name
					protocol.shellWorkdir = target.Properties["workdir"].Type == "string"
				}
			}
		}
		schemaJSON, err := common.Marshal(schemaValue)
		if err != nil {
			return nil, fmt.Errorf("encode schema for tool %q: %w", name, err)
		}
		catalog.WriteString("- ")
		catalog.WriteString(name)
		catalog.WriteString(": ")
		catalog.Write(schemaJSON)
		catalog.WriteByte('\n')
	}
	if len(protocol.allowed) == 0 {
		return nil, errors.New("text tool mode received tools without names")
	}

	rewriteTextToolHistory(body)
	appendTextToolPrompt(body, catalog.String())
	delete(body, "tools")
	delete(body, "tool_choice")
	delete(body, "parallel_tool_calls")
	delete(body, "functions")
	delete(body, "function_call")
	body["__new_api_text_tools"] = true
	return protocol, nil
}

func extractResponsesTextTools(raw []byte) []dto.ToolCallRequest {
	if len(raw) == 0 {
		return nil
	}
	var definitions []map[string]any
	if err := common.Unmarshal(raw, &definitions); err != nil {
		return nil
	}

	var tools []dto.ToolCallRequest
	var visit func(map[string]any, string)
	visit = func(definition map[string]any, namespace string) {
		kind, _ := definition["type"].(string)
		if kind == "namespace" {
			nextNamespace, _ := definition["name"].(string)
			if namespace != "" {
				nextNamespace = namespace + "__" + nextNamespace
			}
			nested, _ := definition["tools"].([]any)
			for _, rawTool := range nested {
				tool, ok := rawTool.(map[string]any)
				if ok {
					visit(tool, nextNamespace)
				}
			}
			return
		}

		function, _ := definition["function"].(map[string]any)
		name, _ := definition["name"].(string)
		description, _ := definition["description"].(string)
		parameters := definition["parameters"]
		if function != nil {
			if name == "" {
				name, _ = function["name"].(string)
			}
			if description == "" {
				description, _ = function["description"].(string)
			}
			if parameters == nil {
				parameters = function["parameters"]
			}
		}
		if name == "" {
			return
		}
		if namespace != "" {
			name = namespace + "__" + name
		}
		encodedParameters, err := common.Marshal(parameters)
		if err != nil || string(encodedParameters) == "null" || len(encodedParameters) == 0 {
			encodedParameters = []byte(`{"type":"object","properties":{}}`)
		}
		tools = append(tools, dto.ToolCallRequest{
			Type: "function",
			Function: dto.FunctionRequest{
				Name:        name,
				Description: description,
				Parameters:  encodedParameters,
			},
		})
	}
	for _, definition := range definitions {
		visit(definition, "")
	}
	return tools
}

func appendTextToolPrompt(body map[string]any, prompt string) {
	messages, _ := body["messages"].([]any)
	promptAdded := false
	for _, raw := range messages {
		message, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		role, _ := message["role"].(string)
		if role != "system" && role != "developer" {
			continue
		}
		content, _ := message["content"].(string)
		if strings.Contains(content, textToolCallPrefix) || strings.Contains(content, textToolPrompt) {
			promptAdded = true
			break
		}
		if content == "" {
			message["content"] = prompt
		} else {
			message["content"] = content + "\n\n" + prompt
		}
		promptAdded = true
		break
	}
	if !promptAdded {
		messages = append([]any{
			map[string]any{"role": "system", "content": prompt},
		}, messages...)
		body["messages"] = messages
	}
	for index := len(messages) - 1; index >= 0; index-- {
		message, ok := messages[index].(map[string]any)
		if !ok {
			continue
		}
		if role, _ := message["role"].(string); role != "user" {
			continue
		}
		content, ok := message["content"].(string)
		if ok && !strings.Contains(content, textToolReminder) {
			message["content"] = content + "\n\n" + textToolReminder
		}
		break
	}
}

func rewriteTextToolHistory(body map[string]any) {
	messages, _ := body["messages"].([]any)
	callNames := make(map[string]string)
	for _, raw := range messages {
		message, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		role, _ := message["role"].(string)
		switch role {
		case "assistant":
			calls, _ := message["tool_calls"].([]any)
			if len(calls) == 0 {
				continue
			}
			var content strings.Builder
			if text, ok := message["content"].(string); ok {
				content.WriteString(text)
			}
			for _, rawCall := range calls {
				call, ok := rawCall.(map[string]any)
				if !ok {
					continue
				}
				function, _ := call["function"].(map[string]any)
				name, _ := function["name"].(string)
				id, _ := call["id"].(string)
				args := function["arguments"]
				if rawArguments, ok := args.(string); ok {
					var arguments map[string]common.RawMessage
					if err := common.UnmarshalJsonStr(rawArguments, &arguments); err == nil && arguments != nil {
						args = common.RawMessage(rawArguments)
					}
				}
				if id != "" {
					callNames[id] = name
				}
				encoded, err := common.Marshal(map[string]any{"id": id, "name": name, "arguments": args})
				if err != nil {
					continue
				}
				content.WriteString(textToolCallPrefix)
				content.Write(encoded)
				content.WriteString(textToolCallSuffix)
			}
			message["content"] = content.String()
			delete(message, "tool_calls")
		case "tool":
			callID, _ := message["tool_call_id"].(string)
			name := callNames[callID]
			content := valueAsText(message["content"])
			message["role"] = "user"
			message["content"] = fmt.Sprintf("Tool result for %s (%s):\n%s", name, callID, content)
			delete(message, "tool_call_id")
		}
	}
}

func valueAsText(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	encoded, err := common.Marshal(value)
	if err != nil {
		return fmt.Sprint(value)
	}
	return string(encoded)
}

type textToolStream struct {
	source   io.ReadCloser
	protocol *textToolProtocol
	pending  []byte
	done     bool
	err      error
}

func newTextToolStream(source io.ReadCloser, protocol *textToolProtocol) io.ReadCloser {
	return &textToolStream{source: source, protocol: protocol}
}

func (s *textToolStream) Read(buffer []byte) (int, error) {
	if len(s.pending) == 0 && !s.done {
		payload, err := s.convert()
		s.done = true
		if err != nil {
			s.err = err
			data, marshalErr := common.Marshal(map[string]any{
				"error": map[string]any{
					"type": "upstream_tool_conversion_error",
					"code": "invalid_tool_response", "message": err.Error(),
				},
			})
			if marshalErr != nil {
				return 0, marshalErr
			}
			payload = append(append([]byte("data: "), data...), '\n', '\n')
		}
		s.pending = payload
	}
	if len(s.pending) == 0 {
		return 0, io.EOF
	}
	n := copy(buffer, s.pending)
	s.pending = s.pending[n:]
	return n, nil
}

func (s *textToolStream) Close() error {
	return s.source.Close()
}

func (s *textToolStream) convert() ([]byte, error) {
	buffered, err := bufferChatStream(&http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		Body:       s.source,
	})
	if err != nil {
		return nil, err
	}
	body, err := io.ReadAll(buffered.Body)
	if err != nil {
		return nil, err
	}
	var response map[string]any
	if err := common.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode buffered text-tool response: %w", err)
	}
	return renderTextToolResponse(response, s.protocol)
}

func renderTextToolResponse(response map[string]any, protocol *textToolProtocol) ([]byte, error) {
	choices, _ := response["choices"].([]any)
	if len(choices) == 0 {
		return nil, errors.New("text-tool response has no choices")
	}
	choice, _ := choices[0].(map[string]any)
	message, _ := choice["message"].(map[string]any)
	if message == nil {
		return nil, errors.New("text-tool response has no assistant message")
	}
	content, _ := message["content"].(string)
	plain, calls := parseTextToolCalls(content, protocol)
	nativeCalls, _ := message["tool_calls"].([]any)
	if len(nativeCalls) > 0 && len(calls) > 0 {
		return nil, errors.New("upstream mixed native and text tool calls")
	}
	for _, raw := range nativeCalls {
		call, ok := raw.(map[string]any)
		if !ok {
			return nil, errors.New("upstream returned an invalid native tool call")
		}
		function, _ := call["function"].(map[string]any)
		name, _ := function["name"].(string)
		arguments, ok := function["arguments"].(string)
		if name == "shell" {
			if _, declared := protocol.allowed[name]; !declared && protocol.shellTarget != "" {
				translated, translateErr := protocol.translateShellCall(arguments)
				if translateErr != nil {
					return nil, translateErr
				}
				name = protocol.shellTarget
				arguments = translated
				function["name"] = name
				function["arguments"] = arguments
				ok = true
			}
		}
		if _, allowed := protocol.allowed[name]; !allowed {
			return nil, fmt.Errorf("upstream selected tool %q which the client did not provide; native compatibility tools cannot be executed", name)
		}
		var object map[string]common.RawMessage
		if !ok || common.UnmarshalJsonStr(arguments, &object) != nil || object == nil {
			return nil, fmt.Errorf("upstream returned invalid arguments for tool %q", name)
		}
		if id, _ := call["id"].(string); id == "" {
			call["id"] = "call_" + common.GetUUID()
		}
		call["index"] = len(calls)
		calls = append(calls, call)
	}
	if plain == "" && len(calls) == 0 {
		return nil, errors.New("upstream returned no visible text or client tool call")
	}
	finishReason, _ := choice["finish_reason"].(string)
	if finishReason == "" {
		return nil, errors.New("upstream text-tool response ended without a finish reason")
	}
	if len(calls) > 0 {
		if finishReason != "stop" && finishReason != "tool_calls" {
			return nil, fmt.Errorf("upstream tool call was not completed: finish_reason=%s", finishReason)
		}
		finishReason = "tool_calls"
	}

	model, _ := response["model"].(string)
	id, _ := response["id"].(string)
	events := make([]any, 0, 4)
	delta := map[string]any{"role": "assistant", "content": plain}
	if reasoning, ok := message["reasoning_content"].(string); ok && reasoning != "" {
		delta["reasoning_content"] = reasoning
	}
	events = append(events, map[string]any{
		"id": id, "object": "chat.completion.chunk", "model": model,
		"choices": []any{map[string]any{
			"index": 0, "delta": delta,
		}},
	})
	if len(calls) > 0 {
		events = append(events, map[string]any{
			"id": id, "object": "chat.completion.chunk", "model": model,
			"choices": []any{map[string]any{
				"index": 0, "delta": map[string]any{"tool_calls": calls},
			}},
		})
	}
	events = append(events, map[string]any{
		"id": id, "object": "chat.completion.chunk", "model": model,
		"choices": []any{map[string]any{
			"index": 0, "delta": map[string]any{}, "finish_reason": finishReason,
		}},
	})
	if usage, ok := response["usage"]; ok {
		events = append(events, map[string]any{
			"id": id, "object": "chat.completion.chunk", "model": model,
			"choices": []any{}, "usage": usage,
		})
	}

	var output bytes.Buffer
	for _, event := range events {
		data, err := common.Marshal(event)
		if err != nil {
			return nil, err
		}
		fmt.Fprintf(&output, "data: %s\n\n", data)
	}
	output.WriteString("data: [DONE]\n\n")
	return output.Bytes(), nil
}

// translateShellCall preserves the command and working directory while the
// receiving client retains execution, sandboxing, and permission checks.
func (p *textToolProtocol) translateShellCall(arguments string) (string, error) {
	var source map[string]common.RawMessage
	if err := common.UnmarshalJsonStr(arguments, &source); err != nil || source == nil {
		return "", errors.New("upstream shell arguments must be a JSON object")
	}
	var command string
	if err := common.Unmarshal(source["command"], &command); err != nil || strings.TrimSpace(command) == "" {
		return "", errors.New("upstream shell call requires a non-empty command")
	}
	target := map[string]common.RawMessage{"cmd": source["command"]}
	for name, value := range source {
		switch name {
		case "command":
		case "workdir":
			var workdir string
			if !p.shellWorkdir || common.Unmarshal(value, &workdir) != nil {
				return "", errors.New("client exec_command cannot preserve the upstream shell working directory")
			}
			target["workdir"] = value
		case "background":
			var background bool
			if common.Unmarshal(value, &background) != nil || background {
				return "", errors.New("client exec_command cannot preserve upstream shell background execution")
			}
		default:
			return "", fmt.Errorf("client exec_command cannot preserve upstream shell parameter %q", name)
		}
	}
	payload, err := common.Marshal(target)
	return string(payload), err
}

func parseTextToolCalls(content string, protocol *textToolProtocol) (string, []any) {
	var plain strings.Builder
	var calls []any
	for {
		start := strings.Index(content, textToolCallPrefix)
		if start < 0 {
			plain.WriteString(content)
			break
		}
		plain.WriteString(content[:start])
		content = content[start+len(textToolCallPrefix):]
		end := strings.Index(content, textToolCallSuffix)
		if end < 0 {
			plain.WriteString(textToolCallPrefix)
			plain.WriteString(content)
			break
		}
		raw := content[:end]
		content = content[end+len(textToolCallSuffix):]
		var call textToolCall
		if common.Unmarshal([]byte(raw), &call) != nil {
			plain.WriteString(textToolCallPrefix + raw + textToolCallSuffix)
			continue
		}
		if _, ok := protocol.allowed[call.Name]; !ok || strings.TrimSpace(call.Name) == "" {
			plain.WriteString(textToolCallPrefix + raw + textToolCallSuffix)
			continue
		}
		arguments := valueAsText(call.Arguments)
		calls = append(calls, map[string]any{
			"index": len(calls),
			"id":    "call_" + common.GetUUID(),
			"type":  "function",
			"function": map[string]any{
				"name":      call.Name,
				"arguments": arguments,
			},
		})
	}
	return plain.String(), calls
}
