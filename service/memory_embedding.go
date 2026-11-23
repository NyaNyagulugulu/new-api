package service

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
)

const defaultInternalEmbeddingBaseURL = "http://127.0.0.1:3000"

type internalEmbeddingResponse struct {
	Data []struct {
		Index     int       `json:"index"`
		Embedding []float64 `json:"embedding"`
	} `json:"data"`
}

// EmbedMemoryTexts sends an embedding request through the normal authenticated
// relay endpoint, so the current user bears the model cost while the browser
// only talks to the memory APIs.
func EmbedMemoryTexts(
	c *gin.Context,
	model string,
	group string,
	input []string,
) ([][]float64, error) {
	if len(input) == 0 {
		return nil, nil
	}
	baseURL := strings.TrimRight(os.Getenv("INTERNAL_API_BASE_URL"), "/")
	if baseURL == "" {
		baseURL = defaultInternalEmbeddingBaseURL
	}
	body, err := common.Marshal(map[string]any{
		"model": model,
		"group": group,
		"input": input,
	})
	if err != nil {
		return nil, err
	}

	request, err := http.NewRequestWithContext(
		c.Request.Context(),
		http.MethodPost,
		baseURL+"/pg/embeddings",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	if cookie := c.Request.Header.Get("Cookie"); cookie != "" {
		request.Header.Set("Cookie", cookie)
	}
	if authorization := c.Request.Header.Get("Authorization"); authorization != "" {
		request.Header.Set("Authorization", authorization)
	}

	client := &http.Client{Timeout: 60 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, response.Body)
		return nil, fmt.Errorf("memory embedding request failed with status %d", response.StatusCode)
	}

	var payload internalEmbeddingResponse
	if err := common.DecodeJson(response.Body, &payload); err != nil {
		return nil, err
	}
	embeddings := make([][]float64, len(input))
	for _, item := range payload.Data {
		if item.Index >= 0 && item.Index < len(embeddings) {
			embeddings[item.Index] = item.Embedding
		}
	}
	return embeddings, nil
}
