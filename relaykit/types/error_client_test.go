package types

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func upstreamError() *NewAPIError {
	return WithOpenAIError(OpenAIError{
		Message: "Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going",
		Type:    "FreeUsageLimitError",
		Code:    "FreeUsageLimitError",
	}, http.StatusTooManyRequests, ErrOptionWithUpstreamFailure())
}

func TestUpstreamFailureIsSanitizedForCaller(t *testing.T) {
	err := upstreamError()

	require.True(t, err.IsUpstreamFailure())
	require.Equal(t, http.StatusTooManyRequests, err.ClientStatusCode())

	body := err.ClientErrorBody(RelayFormatOpenAI, "req-1").(OpenAIErrorResponse)
	require.Equal(t, UpstreamFailureMessage+" (request id: req-1)", body.Error.Message)
	// The provider's 429 is safe to expose as a status and lets clients show the
	// sanitized error instead of a generic server-failure message.
	require.Equal(t, "new_api_error", body.Error.Type)
	require.Equal(t, "429", body.Error.Code)
	require.Nil(t, body.Error.Param)
	require.NotContains(t, body.Error.Message, "opencode.ai")
	require.NotContains(t, body.Error.Message, "FreeUsageLimitError")

	// The internal error still carries everything the upstream said, so logs and
	// retry/health decisions keep working on the real detail.
	require.Equal(t, http.StatusTooManyRequests, err.StatusCode)
	require.Contains(t, err.Error(), "Free usage limit reached")
	require.Equal(t, "FreeUsageLimitError", err.ToOpenAIError().Type)
}

func TestAnthropicEnvelopeUsesAnthropicErrorTypes(t *testing.T) {
	err := upstreamError()

	body := err.ClientErrorBody(RelayFormatClaude, "").(ClaudeErrorResponse)
	require.Equal(t, "error", body.Type)
	require.Equal(t, "rate_limit_error", body.Error.Type)
	require.Equal(t, UpstreamFailureMessage, body.Error.Message)
}

func TestGeminiEnvelopeUsesGoogleStatusNames(t *testing.T) {
	require.Equal(t, GeminiErrorResponse{Error: GeminiError{Code: 500, Message: "boom", Status: "INTERNAL"}},
		NewErrorWithStatusCode(errors.New("boom"), ErrorCodeBadResponse, http.StatusInternalServerError).ClientErrorBody(RelayFormatGemini, ""))

	require.Equal(t, "RESOURCE_EXHAUSTED",
		NewErrorWithStatusCode(errors.New("slow down"), ErrorCodeInvalidRequest, http.StatusTooManyRequests).ClientErrorBody(RelayFormatGemini, "").(GeminiErrorResponse).Error.Status)
}

func TestResponsesStreamErrorIsAFlatEvent(t *testing.T) {
	err := upstreamError()

	body := err.ClientStreamErrorBody(RelayFormatOpenAIResponses, "req-9", 7).(ResponsesErrorEvent)
	require.Equal(t, "error", body.Type)
	require.Equal(t, "429", body.Code)
	require.Equal(t, UpstreamFailureMessage+" (request id: req-9)", body.Message)
	require.Nil(t, body.Param)
	require.Equal(t, 7, body.SequenceNumber)
}

func TestUpstreamStatusSurvivesWithoutLeakingTheBody(t *testing.T) {
	err := upstreamError()

	// Every protocol reports the provider status, while the message stays
	// sanitized.
	require.Equal(t, http.StatusTooManyRequests, err.ClientStatusCode())
	require.Equal(t, http.StatusTooManyRequests, err.ClientErrorStatus())

	openAI := err.ClientErrorBody(RelayFormatOpenAI, "").(OpenAIErrorResponse)
	require.Equal(t, "429", openAI.Error.Code)
	require.Equal(t, "new_api_error", openAI.Error.Type)

	// Anthropic has no code field: its error.type is the only classification.
	claude := err.ClientErrorBody(RelayFormatClaude, "").(ClaudeErrorResponse)
	require.Equal(t, "rate_limit_error", claude.Error.Type)

	gemini := err.ClientErrorBody(RelayFormatGemini, "").(GeminiErrorResponse)
	require.Equal(t, http.StatusTooManyRequests, gemini.Error.Code)
	require.Equal(t, "RESOURCE_EXHAUSTED", gemini.Error.Status)

	responses := err.ClientStreamErrorBody(RelayFormatOpenAIResponses, "", 0).(ResponsesErrorEvent)
	require.Equal(t, "429", responses.Code)

	for _, body := range []any{openAI, claude, gemini, responses} {
		encoded, marshalErr := json.Marshal(body)
		require.NoError(t, marshalErr)
		require.NotContains(t, string(encoded), "opencode.ai")
		require.NotContains(t, string(encoded), "Free models work in OpenCode")
	}
}

func TestUpstreamFailureWithoutUsableStatusFallsBackToGenericCode(t *testing.T) {
	err := WithOpenAIError(OpenAIError{Message: "boom"}, 0, ErrOptionWithUpstreamFailure())

	require.Equal(t, http.StatusInternalServerError, err.ClientStatusCode())
	body := err.ClientErrorBody(RelayFormatOpenAI, "").(OpenAIErrorResponse)
	require.Equal(t, string(ClientErrorCodeUpstream), body.Error.Code)
	require.Equal(t, "new_api_error", body.Error.Type)
}

func TestLocalErrorKeepsItsOwnMessageAndStatus(t *testing.T) {
	err := NewErrorWithStatusCode(errors.New("invalid api key"), ErrorCodeInvalidRequest, http.StatusUnauthorized)

	require.False(t, err.IsUpstreamFailure())
	require.Equal(t, http.StatusUnauthorized, err.ClientStatusCode())

	body := err.ClientErrorBody(RelayFormatOpenAI, "").(OpenAIErrorResponse)
	require.Equal(t, "invalid api key", body.Error.Message)
	require.Equal(t, "new_api_error", body.Error.Type)
	require.Equal(t, string(ErrorCodeInvalidRequest), body.Error.Code)

	encoded, marshalErr := json.Marshal(body)
	require.NoError(t, marshalErr)
	require.Equal(t, `{"error":{"code":"invalid_request","message":"invalid api key","type":"new_api_error"}}`, string(encoded))
}

func TestModelNotFoundUsesClientErrorStatus(t *testing.T) {
	err := NewErrorWithStatusCode(errors.New("model is unavailable"), ErrorCodeModelNotFound, http.StatusServiceUnavailable)

	require.Equal(t, http.StatusNotFound, err.ClientStatusCode())
	encoded, marshalErr := json.Marshal(err.ClientErrorBody(RelayFormatOpenAI, ""))
	require.NoError(t, marshalErr)
	require.Equal(t, `{"error":{"code":"model_not_found","message":"model is unavailable","type":"new_api_error"}}`, string(encoded))
}

func TestChannelConfigurationErrorIsNotTreatedAsUpstream(t *testing.T) {
	// This failure is raised while building the request for the channel, before
	// any upstream answer exists, so it keeps its own message and status.
	err := NewErrorWithStatusCode(errors.New("model mapped target not found"), ErrorCodeChannelModelMappedError, http.StatusBadRequest)

	require.False(t, err.IsUpstreamFailure())
	require.Equal(t, http.StatusBadRequest, err.ClientStatusCode())

	body := err.ClientErrorBody(RelayFormatOpenAI, "").(OpenAIErrorResponse)
	require.Equal(t, "model mapped target not found", body.Error.Message)
	require.Equal(t, "new_api_error", body.Error.Type)
	require.Equal(t, string(ErrorCodeChannelModelMappedError), body.Error.Code)
}

func TestTransportFailureIsSanitizedForCaller(t *testing.T) {
	err := NewOpenAIError(errors.New("dial tcp 10.0.0.7:443: connect: connection refused"), ErrorCodeDoRequestFailed, http.StatusInternalServerError)

	require.True(t, err.IsUpstreamFailure())
	require.NotContains(t, err.ClientErrorBody(RelayFormatOpenAI, "").(OpenAIErrorResponse).Error.Message, "10.0.0.7")
	require.Equal(t, http.StatusInternalServerError, err.ClientStatusCode())
}
