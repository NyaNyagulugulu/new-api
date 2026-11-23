package service

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
)

func TestSearchWebForChatTruncatesQueryAndReturnsContext(t *testing.T) {
	var receivedQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		var request map[string]any
		require.NoError(t, common.Unmarshal(body, &request))
		receivedQuery, _ = request["query"].(string)
		assert.Equal(t, "/pg/tools/search", r.URL.Path)
		assert.Equal(t, "default", r.URL.Query().Get("group"))
		assert.Equal(t, "session=test-cookie", r.Header.Get("Cookie"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"results":[{"title":"Go","url":"https://go.dev/","summary":"Latest release"}]}`)
	}))
	t.Cleanup(server.Close)
	t.Setenv("INTERNAL_API_BASE_URL", server.URL)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/pg/chat/completions", nil)
	c.Request.Header.Set("Cookie", "session=test-cookie")

	query := strings.Repeat("深", 200)
	contextBlock, err := SearchWebForChat(c, "default", query)
	require.NoError(t, err)
	assert.LessOrEqual(t, utf8.RuneCountInString(receivedQuery), 128)
	assert.Contains(t, contextBlock, "https://go.dev/")
	assert.Contains(t, contextBlock, "Latest release")
}
