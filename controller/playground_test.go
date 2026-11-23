package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestInjectPlaygroundSearchContextIntoLatestUserMessage(t *testing.T) {
	request := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "old"},
			map[string]any{"role": "assistant", "content": "answer"},
			map[string]any{"role": "user", "content": "latest"},
		},
	}

	injectPlaygroundSearchContext(request, "search result")

	messages := request["messages"].([]any)
	assert.Equal(t, "old", messages[0].(map[string]any)["content"])
	assert.Equal(t, "latest\n\n---\nsearch result", messages[2].(map[string]any)["content"])
}
