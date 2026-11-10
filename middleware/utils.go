package middleware

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

// abortWithRelayError rejects a relay request with the error envelope of the
// protocol it used, so callers parse it with the SDK they already have.
func abortWithRelayError(c *gin.Context, statusCode int, message string, code ...types.ErrorCode) {
	codeStr := types.ErrorCode("")
	if len(code) > 0 {
		codeStr = code[0]
	}
	userId := c.GetInt("id")
	_, preparedPluginRoute := c.Get(pluginruntime.ContextKeyRouteRequest)
	if !preparedPluginRoute || !RespondTaskPluginError(c, &dto.TaskError{
		Code:       string(codeStr),
		Message:    message,
		StatusCode: statusCode,
	}) {
		apiErr := types.NewErrorWithStatusCode(errors.New(message), codeStr, statusCode)
		c.JSON(statusCode, apiErr.ClientErrorBody(types.RelayFormatForPath(c.Request.URL.Path), c.GetString(common.RequestIdKey)))
	}
	c.Abort()
	logger.LogError(c.Request.Context(), common.LogText("user %d | %s", userId, message))
}

// invalidRequestStatus is the status of a request whose body could not be
// read or parsed: 413 when the body exceeds MAX_REQUEST_BODY_MB, else 400.
func invalidRequestStatus(err error) int {
	if common.IsRequestBodyTooLargeError(err) {
		return http.StatusRequestEntityTooLarge
	}
	return http.StatusBadRequest
}

func abortWithMidjourneyMessage(c *gin.Context, statusCode int, code int, description string) {
	c.JSON(statusCode, gin.H{
		"description": description,
		"type":        "new_api_error",
		"code":        code,
	})
	c.Abort()
	logger.LogError(c.Request.Context(), description)
}
