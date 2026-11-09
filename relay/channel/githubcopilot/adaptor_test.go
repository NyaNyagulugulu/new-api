package githubcopilot

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	copilot "github.com/QuantumNous/new-api/service/githubcopilot"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSetupRequestHeaderUsesEndpointCredential(t *testing.T) {
	profileKey := `{"profile_id":"11111111-1111-4111-8111-111111111111","login":"octocat"}`
	adaptor := &Adaptor{
		key: copilot.ChannelKey{
			ProfileID: "11111111-1111-4111-8111-111111111111",
			Login:     "octocat",
		},
		endpoint: &copilot.Endpoint{
			Type:    "openai",
			BaseURL: "https://api.githubcopilot.com",
			APIKey:  "endpoint-key",
			Headers: map[string]string{"Editor-Version": "new-api"},
		},
		protocol: copilot.ProtocolOpenAIChat,
	}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ApiKey:      profileKey,
			ChannelType: constant.ChannelTypeGitHubCopilot,
		},
	}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	headers := http.Header{"Authorization": []string{"Bearer stale"}}

	require.NoError(t, adaptor.SetupRequestHeader(ctx, &headers, info))
	assert.Equal(t, "Bearer endpoint-key", headers.Get("Authorization"))
	assert.Empty(t, headers.Get("x-api-key"))
	assert.Equal(t, "new-api", headers.Get("Editor-Version"))
	assert.NotContains(t, headers.Get("Authorization"), "profile_id")
}

func TestSetupRequestHeaderAddsVisionHeaderForImageRequests(t *testing.T) {
	const imageData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
	tests := []struct {
		name    string
		request dto.Request
		want    bool
	}{
		{
			name: "text only",
			request: &dto.GeneralOpenAIRequest{Messages: []dto.Message{{
				Role:    "user",
				Content: "describe this request",
			}}},
		},
		{
			name: "openai chat image",
			request: &dto.GeneralOpenAIRequest{Messages: []dto.Message{{
				Role: "user",
				Content: []any{map[string]any{
					"type": "image_url",
					"image_url": map[string]any{
						"url": "data:image/png;base64," + imageData,
					},
				}},
			}}},
			want: true,
		},
		{
			name: "openai responses image",
			request: &dto.OpenAIResponsesRequest{
				Input: json.RawMessage(`[{"role":"user","content":[{"type":"input_image","image_url":"data:image/png;base64,` + imageData + `"}]}]`),
			},
			want: true,
		},
		{
			name: "claude image",
			request: &dto.ClaudeRequest{Messages: []dto.ClaudeMessage{{
				Role: "user",
				Content: []any{map[string]any{
					"type": "image",
					"source": map[string]any{
						"type":       "base64",
						"media_type": "image/png",
						"data":       imageData,
					},
				}},
			}}},
			want: true,
		},
		{
			name: "gemini image",
			request: &dto.GeminiChatRequest{Contents: []dto.GeminiChatContent{{
				Parts: []dto.GeminiPart{{
					InlineData: &dto.GeminiInlineData{MimeType: "image/png", Data: imageData},
				}},
			}}},
			want: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			adaptor := &Adaptor{
				endpoint: &copilot.Endpoint{Type: "openai", BaseURL: "https://api.githubcopilot.com"},
				protocol: copilot.ProtocolOpenAIChat,
			}
			info := &relaycommon.RelayInfo{Request: test.request}
			headers := http.Header{}
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

			require.NoError(t, adaptor.SetupRequestHeader(ctx, &headers, info))
			if test.want {
				assert.Equal(t, "true", headers.Get("Copilot-Vision-Request"))
			} else {
				assert.Empty(t, headers.Get("Copilot-Vision-Request"))
			}
		})
	}
}

func TestSanitizeRequestForModelStripsUnsupportedReasoning(t *testing.T) {
	tests := []struct {
		model          string
		wantEffort     string
		wantNested     bool
		wantResponses  bool
		wantConversion bool
	}{
		{model: "gpt-4.1"},
		{model: "gpt-4o-2024-11-20"},
		{model: "openai/gpt-4.1-2025-04-14"},
		{model: "gpt-3.5-turbo"},
		{model: "gpt-5.6-sol", wantEffort: "high", wantNested: true, wantResponses: true, wantConversion: true},
		{model: "o3-mini", wantEffort: "high", wantNested: true, wantResponses: true, wantConversion: true},
	}

	for _, test := range tests {
		t.Run(test.model, func(t *testing.T) {
			adaptor := &Adaptor{model: test.model}
			chat := &dto.GeneralOpenAIRequest{
				ReasoningEffort:     "high",
				Reasoning:           json.RawMessage(`{"effort":"high"}`),
				ReasoningConversion: &dto.ReasoningConversionState{Effort: "high"},
			}
			responses := dto.OpenAIResponsesRequest{
				Reasoning:           &dto.Reasoning{Effort: "high"},
				ReasoningConversion: &dto.ReasoningConversionState{Effort: "high"},
			}

			gotChat, ok := adaptor.sanitizeRequestForModel(chat).(*dto.GeneralOpenAIRequest)
			require.True(t, ok)
			gotResponses, ok := adaptor.sanitizeRequestForModel(responses).(dto.OpenAIResponsesRequest)
			require.True(t, ok)

			assert.Equal(t, test.wantEffort, gotChat.ReasoningEffort)
			if test.wantNested {
				assert.NotNil(t, gotChat.Reasoning)
			} else {
				assert.Nil(t, gotChat.Reasoning)
			}
			if test.wantResponses {
				require.NotNil(t, gotResponses.Reasoning)
				assert.Equal(t, "high", gotResponses.Reasoning.Effort)
			} else {
				assert.Nil(t, gotResponses.Reasoning)
			}
			if test.wantConversion {
				assert.NotNil(t, gotChat.ReasoningConversion)
				assert.NotNil(t, gotResponses.ReasoningConversion)
			} else {
				assert.Nil(t, gotChat.ReasoningConversion)
				assert.Nil(t, gotResponses.ReasoningConversion)
			}
		})
	}
}

func TestConvertRequestsStripUnsupportedReasoningForCopilot(t *testing.T) {
	adaptor := &Adaptor{
		model:    "gpt-4.1",
		endpoint: &copilot.Endpoint{Type: "openai", BaseURL: "https://api.githubcopilot.com"},
		protocol: copilot.ProtocolOpenAIChat,
	}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeGitHubCopilot,
			UpstreamModelName: "gpt-4.1",
		},
		OriginModelName: "gpt-4.1",
	}
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)

	convertedChat, err := adaptor.ConvertOpenAIRequest(ctx, info, &dto.GeneralOpenAIRequest{
		Model:           "gpt-4.1",
		ReasoningEffort: "high",
	})
	require.NoError(t, err)
	chat, ok := convertedChat.(*dto.GeneralOpenAIRequest)
	require.True(t, ok)
	assert.Empty(t, chat.ReasoningEffort)

	convertedResponses, err := adaptor.ConvertOpenAIResponsesRequest(ctx, info, dto.OpenAIResponsesRequest{
		Model:     "gpt-4.1",
		Reasoning: &dto.Reasoning{Effort: "high"},
	})
	require.NoError(t, err)
	responsesChat, ok := convertedResponses.(*dto.GeneralOpenAIRequest)
	require.True(t, ok)
	assert.Empty(t, responsesChat.ReasoningEffort)
}
