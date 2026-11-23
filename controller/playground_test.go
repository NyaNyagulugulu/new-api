package controller

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

func TestEnrichPlaygroundWebSearchInjectsResultsAndReportsSources(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var receivedQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		require.NoError(t, common.DecodeJson(r.Body, &request))
		receivedQuery, _ = request["query"].(string)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"results":[{"title":"DeepSeek","url":"https://deepseek.com/","summary":"Current release"}]}`)
	}))
	t.Cleanup(server.Close)
	t.Setenv("INTERNAL_API_BASE_URL", server.URL)

	body := []byte(`{
		"model":"deepseek-chat",
		"group":"default",
		"web_search":true,
		"messages":[{
			"role":"user",
			"content":"查一下最新的 DeepSeek\n\n---\nLong-term memories for the current user are below.\n- [fact] private memory"
		}]
	}`)
	storage, err := common.CreateBodyStorage(body)
	require.NoError(t, err)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/pg/chat/completions", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(common.KeyBodyStorage, storage)
	t.Cleanup(func() { _ = storage.Close() })

	status, sources, err := enrichPlaygroundWebSearch(c)
	require.NoError(t, err)
	assert.Equal(t, "used", status)
	assert.Equal(t, "最新的 DeepSeek", receivedQuery)
	assert.Equal(t, []service.WebSearchSource{{
		Href:  "https://deepseek.com/",
		Title: "DeepSeek",
	}}, sources)

	updatedStorage, err := common.GetBodyStorage(c)
	require.NoError(t, err)
	updatedBody, err := updatedStorage.Bytes()
	require.NoError(t, err)
	var updatedRequest map[string]any
	require.NoError(t, common.Unmarshal(updatedBody, &updatedRequest))
	assert.NotContains(t, updatedRequest, "web_search")
	messages := updatedRequest["messages"].([]any)
	content := messages[0].(map[string]any)["content"].(string)
	assert.Contains(t, content, "Web search results for the current question")
	assert.Contains(t, content, "Current release")
}
