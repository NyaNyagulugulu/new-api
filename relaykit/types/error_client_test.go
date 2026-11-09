package types

import (
	"errors"
	"net/http"
	"strings"
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
	require.Equal(t, http.StatusInternalServerError, err.ClientStatusCode())

	payload := err.ToClientOpenAIError("req-1")
	require.Equal(t, UpstreamFailureMessage+" (request id: req-1)", payload.Message)
	require.Equal(t, string(ErrorTypeUpstreamError), payload.Type)
	require.NotContains(t, payload.Message, "opencode.ai")
	require.NotContains(t, payload.Message, "FreeUsageLimitError")

	// The internal error still carries everything the upstream said, so logs and
	// retry/health decisions keep working on the real detail.
	require.Equal(t, http.StatusTooManyRequests, err.StatusCode)
	require.Contains(t, err.Error(), "Free usage limit reached")
	require.Equal(t, "FreeUsageLimitError", err.ToOpenAIError().Type)
}

func TestUpstreamClaudeFailureIsSanitizedForCaller(t *testing.T) {
	err := WithClaudeError(ClaudeError{Type: "overloaded_error", Message: "upstream secret detail"}, http.StatusServiceUnavailable, ErrOptionWithUpstreamFailure())

	require.True(t, err.IsUpstreamFailure())
	require.Equal(t, http.StatusInternalServerError, err.ClientStatusCode())

	payload := err.ToClientClaudeError("")
	require.Equal(t, "error", payload.Type)
	require.Equal(t, UpstreamFailureMessage, payload.Message)
	require.NotContains(t, payload.Message, "secret")
}

func TestTransportFailureIsSanitizedForCaller(t *testing.T) {
	err := NewOpenAIError(errors.New("dial tcp 10.0.0.7:443: connect: connection refused"), ErrorCodeDoRequestFailed, http.StatusInternalServerError)

	require.True(t, err.IsUpstreamFailure())
	require.NotContains(t, err.ToClientOpenAIError("").Message, "10.0.0.7")
}

func TestLocalErrorKeepsItsOwnMessageAndStatus(t *testing.T) {
	err := NewErrorWithStatusCode(errors.New("invalid api key"), ErrorCodeInvalidRequest, http.StatusUnauthorized)

	require.False(t, err.IsUpstreamFailure())
	require.Equal(t, http.StatusUnauthorized, err.ClientStatusCode())
	require.Equal(t, "invalid api key", err.ToClientOpenAIError("").Message)
}

func TestChannelConfigurationErrorIsNotTreatedAsUpstream(t *testing.T) {
	err := WithOpenAIError(OpenAIError{
		Message: "model mapped target not found",
		Type:    "new_api_error",
		Code:    string(ErrorCodeChannelModelMappedError),
	}, http.StatusBadRequest)

	require.False(t, err.IsUpstreamFailure())
	require.Equal(t, http.StatusBadRequest, err.ClientStatusCode())
	require.Equal(t, "model mapped target not found", err.ToClientOpenAIError("").Message)
}

func TestUpstreamMessageStaysAvailableForBackendLog(t *testing.T) {
	err := upstreamError()
	require.True(t, strings.Contains(err.ErrorWithStatusCode(), "Free usage limit reached"))
}
