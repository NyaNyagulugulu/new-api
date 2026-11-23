package service

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gin-gonic/gin"
)

func TestEmbedMemoryTextsUsesInternalAuthenticatedRelay(t *testing.T) {
	var requestBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		requestBody = string(body)
		assert.Equal(t, "/pg/embeddings", r.URL.Path)
		assert.Equal(t, "session=test-cookie", r.Header.Get("Cookie"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"index":0,"embedding":[0.1,0.2]},{"index":1,"embedding":[0.3,0.4]}]}`)
	}))
	t.Cleanup(server.Close)
	t.Setenv("INTERNAL_API_BASE_URL", server.URL)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/user/self/memories", nil)
	c.Request.Header.Set("Cookie", "session=test-cookie")

	vectors, err := EmbedMemoryTexts(c, "embedding-test", "default", []string{"a", "b"})
	require.NoError(t, err)
	assert.Equal(t, [][]float64{{0.1, 0.2}, {0.3, 0.4}}, vectors)
	assert.JSONEq(t, `{"model":"embedding-test","group":"default","input":["a","b"]}`, requestBody)
}
