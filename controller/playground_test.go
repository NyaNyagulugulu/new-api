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

func TestPlaygroundSearchQueryExcludesInjectedMemoryContext(t *testing.T) {
	request := map[string]any{
		"messages": []any{
			map[string]any{
				"role": "user",
				"content": "搜索最新的 DeepSeek 模型\n\n---\n" +
					"Long-term memories for the current user are below.\n" +
					"- [preference] 用户喜欢猫娘角色",
			},
		},
	}

	assert.Equal(t, "最新的 DeepSeek 模型", playgroundSearchQuery(request))
}

func TestPlaygroundSearchQueryUsesPreviousQuestionForSearchDirective(t *testing.T) {
	request := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "你说的对，但是"},
			map[string]any{"role": "assistant", "content": "但是什么？"},
			map[string]any{"role": "user", "content": "你自己上网查一查"},
		},
	}

	assert.Equal(t, "你说的对，但是", playgroundSearchQuery(request))
}
