package opencode

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// restoringStream rewrites opaque tool names back to the caller's spelling while
// an SSE body streams through. Frames are read line by line and passed on
// immediately, so latency and the shape of the stream are unchanged; only the
// `name` field of a tool-call delta is touched.
type restoringStream struct {
	source  io.ReadCloser
	reverse map[string]string
	reader  *bufio.Reader
	pending []byte
	done    bool
}

func newRestoringStream(source io.ReadCloser, reverse map[string]string) io.ReadCloser {
	return &restoringStream{
		source:  source,
		reverse: reverse,
		reader:  bufio.NewReaderSize(source, 32*1024),
	}
}

func (s *restoringStream) Read(buffer []byte) (int, error) {
	if len(s.pending) > 0 {
		n := copy(buffer, s.pending)
		s.pending = s.pending[n:]
		return n, nil
	}
	if s.done {
		return 0, io.EOF
	}
	line, err := s.reader.ReadBytes('\n')
	if len(line) > 0 {
		restored := line
		trimmed := bytes.TrimSpace(line)
		if bytes.HasPrefix(trimmed, []byte("data:")) {
			frame := strings.TrimSpace(strings.TrimPrefix(string(trimmed), "data:"))
			if frame != "" && frame != "[DONE]" {
				restored = []byte("data: " + restoreStreamToolNames(frame, s.reverse) + "\n")
			}
		}
		n := copy(buffer, restored)
		if n < len(restored) {
			s.pending = restored[n:]
		}
		return n, nil
	}
	if err != nil {
		s.done = true
		return 0, err
	}
	return 0, nil
}

func (s *restoringStream) Close() error {
	s.done = true
	return s.source.Close()
}

func bufferChatStream(resp *http.Response) (*http.Response, error) {
	if resp == nil || resp.Body == nil {
		return resp, fmt.Errorf("invalid OpenCode stream response")
	}
	defer resp.Body.Close()

	result := map[string]any{
		"object": "chat.completion",
		"choices": []any{
			map[string]any{
				"index": 0,
				"message": map[string]any{
					"role":    "assistant",
					"content": "",
				},
			},
		},
	}
	choice := result["choices"].([]any)[0].(map[string]any)
	message := choice["message"].(map[string]any)
	toolCalls := make(map[int]map[string]any)
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 32*1024), 4*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		data, ok := strings.CutPrefix(line, "data:")
		if !ok {
			continue
		}
		data = strings.TrimSpace(data)
		if data == "" {
			continue
		}
		if data == "[DONE]" {
			break
		}

		var chunk map[string]any
		if err := common.UnmarshalJsonStr(data, &chunk); err != nil {
			return resp, fmt.Errorf("decode OpenCode stream chunk: %w", err)
		}
		for _, key := range []string{"id", "model", "created"} {
			if value, ok := chunk[key]; ok {
				result[key] = value
			}
		}
		if usage, ok := chunk["usage"]; ok {
			result["usage"] = usage
		}
		choices, _ := chunk["choices"].([]any)
		for _, rawChoice := range choices {
			chunkChoice, ok := rawChoice.(map[string]any)
			if !ok {
				continue
			}
			if finishReason, ok := chunkChoice["finish_reason"]; ok && finishReason != nil {
				choice["finish_reason"] = finishReason
			}
			delta, _ := chunkChoice["delta"].(map[string]any)
			if content, ok := delta["content"].(string); ok {
				message["content"] = message["content"].(string) + content
			}
			if reasoning, ok := delta["reasoning_content"].(string); ok {
				existing, _ := message["reasoning_content"].(string)
				message["reasoning_content"] = existing + reasoning
			}
			rawToolCalls, _ := delta["tool_calls"].([]any)
			for _, rawToolCall := range rawToolCalls {
				toolCall, ok := rawToolCall.(map[string]any)
				if !ok {
					continue
				}
				index, _ := toolCall["index"].(float64)
				toolIndex := int(index)
				accumulated := toolCalls[toolIndex]
				if accumulated == nil {
					accumulated = map[string]any{
						"index": toolIndex,
						"type":  "function",
						"function": map[string]any{
							"name":      "",
							"arguments": "",
						},
					}
					toolCalls[toolIndex] = accumulated
				}
				if id, ok := toolCall["id"].(string); ok && id != "" {
					accumulated["id"] = id
				}
				if function, ok := toolCall["function"].(map[string]any); ok {
					target := accumulated["function"].(map[string]any)
					if name, ok := function["name"].(string); ok {
						target["name"] = name
					}
					if arguments, ok := function["arguments"].(string); ok {
						target["arguments"] = target["arguments"].(string) + arguments
					}
				}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return resp, fmt.Errorf("read OpenCode stream: %w", err)
	}
	if len(toolCalls) > 0 {
		indices := make([]int, 0, len(toolCalls))
		for index := range toolCalls {
			indices = append(indices, index)
		}
		slices.Sort(indices)
		accumulated := make([]any, 0, len(indices))
		for _, index := range indices {
			accumulated = append(accumulated, toolCalls[index])
		}
		message["tool_calls"] = accumulated
	}
	payload, err := common.Marshal(result)
	if err != nil {
		return resp, fmt.Errorf("encode buffered OpenCode response: %w", err)
	}
	resp.Body = io.NopCloser(bytes.NewReader(payload))
	resp.ContentLength = int64(len(payload))
	resp.Header.Set("Content-Type", "application/json")
	resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(payload)))
	return resp, nil
}
