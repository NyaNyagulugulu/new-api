package controller

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

func Playground(c *gin.Context) {
	playgroundRelay(c, types.RelayFormatOpenAI)
}

func PlaygroundEmbeddings(c *gin.Context) {
	playgroundRelay(c, types.RelayFormatEmbedding)
}

func PlaygroundToolsSearch(c *gin.Context) {
	var newAPIError *types.NewAPIError
	defer func() {
		if newAPIError != nil {
			c.JSON(newAPIError.ClientStatusCode(), newAPIError.ClientErrorBody(types.RelayFormatDeepSeekTools, c.GetString(common.RequestIdKey), common.UpstreamAddresses(c)...))
		}
	}()

	if c.GetBool("use_access_token") {
		newAPIError = types.NewError(errors.New(i18n.T(c, i18n.MsgRelayAccessTokenUnsupported)), types.ErrorCodeAccessDenied, types.ErrOptionWithSkipRetry())
		return
	}

	userId := c.GetInt("id")
	userCache, err := model.GetUserCache(userId)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		return
	}

	userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	usingGroup := strings.TrimSpace(c.Query("group"))
	if usingGroup == "" {
		usingGroup = common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	}
	if usingGroup == "" {
		usingGroup = userGroup
	}

	groups := []string{usingGroup}
	if usingGroup == "auto" {
		groups = service.GetUserAutoGroup(userGroup)
	} else if !service.GroupInUserUsableGroups(userGroup, usingGroup) &&
		usingGroup != userGroup {
		newAPIError = types.NewError(errors.New("group not available"), types.ErrorCodeAccessDenied, types.ErrOptionWithSkipRetry())
		return
	}

	channel, selectedGroup, err := service.SelectInternalSearchChannel(
		groups,
		[]int{constant.ChannelTypeDeepSeek},
	)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
		return
	}

	common.SetContextKey(c, constant.ContextKeyUsingGroup, selectedGroup)
	if err := middleware.SetupContextForSelectedChannel(c, channel, constant.DeepSeekSearchModel); err != nil {
		newAPIError = err
		return
	}
	userCache.WriteContext(c)

	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("playground-search-%s", selectedGroup),
		Group:  selectedGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	Relay(c, types.RelayFormatDeepSeekTools)
}

func playgroundRelay(c *gin.Context, relayFormat types.RelayFormat) {
	var newAPIError *types.NewAPIError

	defer func() {
		if newAPIError != nil {
			c.JSON(newAPIError.ClientStatusCode(), newAPIError.ClientErrorBody(relayFormat, c.GetString(common.RequestIdKey), common.UpstreamAddresses(c)...))
		}
	}()

	useAccessToken := c.GetBool("use_access_token")
	if useAccessToken {
		newAPIError = types.NewError(errors.New(i18n.T(c, i18n.MsgRelayAccessTokenUnsupported)), types.ErrorCodeAccessDenied, types.ErrOptionWithSkipRetry())
		return
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, relayFormat, nil, nil)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
		return
	}

	userId := c.GetInt("id")

	// Write user context to ensure acceptUnsetRatio is available
	userCache, err := model.GetUserCache(userId)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		return
	}
	userCache.WriteContext(c)

	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("playground-%s", relayInfo.UsingGroup),
		Group:  relayInfo.UsingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	Relay(c, relayFormat)
}
