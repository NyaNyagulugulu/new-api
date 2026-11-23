package controller

import (
	"bytes"
	"errors"
	"fmt"
	"io"
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
	if err := enrichPlaygroundWebSearch(c); err != nil {
		common.SysError(common.LogText("web search enrichment failed: %s", err.Error()))
	}
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

func enrichPlaygroundWebSearch(c *gin.Context) error {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return err
	}
	rawBody, err := storage.Bytes()
	if err != nil {
		return err
	}

	var request map[string]any
	if err := common.Unmarshal(rawBody, &request); err != nil {
		return err
	}
	enabled, _ := request["web_search"].(bool)
	if !enabled {
		return nil
	}
	delete(request, "web_search")

	query := playgroundSearchQuery(request)
	contextBlock := ""
	if query != "" {
		group, _ := request["group"].(string)
		contextBlock, err = service.SearchWebForChat(c, group, query)
		if err != nil {
			common.SysError(common.LogText("web search failed: %s", err.Error()))
		}
	}
	if contextBlock != "" {
		injectPlaygroundSearchContext(request, contextBlock)
	}
	return replacePlaygroundRequestBody(c, storage, request)
}

func playgroundSearchQuery(request map[string]any) string {
	messages, _ := request["messages"].([]any)
	for index := len(messages) - 1; index >= 0; index-- {
		message, _ := messages[index].(map[string]any)
		if role, _ := message["role"].(string); role != "user" {
			continue
		}
		switch content := message["content"].(type) {
		case string:
			return strings.TrimSpace(content)
		case []any:
			for _, part := range content {
				partMap, _ := part.(map[string]any)
				if text, _ := partMap["text"].(string); strings.TrimSpace(text) != "" {
					return strings.TrimSpace(text)
				}
			}
		}
	}
	return ""
}

func injectPlaygroundSearchContext(request map[string]any, contextBlock string) {
	messages, _ := request["messages"].([]any)
	for index := len(messages) - 1; index >= 0; index-- {
		message, _ := messages[index].(map[string]any)
		if role, _ := message["role"].(string); role != "user" {
			continue
		}
		switch content := message["content"].(type) {
		case string:
			message["content"] = content + "\n\n---\n" + contextBlock
		case []any:
			message["content"] = append(content, map[string]any{
				"type": "text",
				"text": contextBlock,
			})
		}
		return
	}
}

func replacePlaygroundRequestBody(
	c *gin.Context,
	oldStorage common.BodyStorage,
	request map[string]any,
) error {
	encoded, err := common.Marshal(request)
	if err != nil {
		return err
	}
	storage, err := common.CreateBodyStorage(encoded)
	if err != nil {
		return err
	}
	_ = oldStorage.Close()
	c.Set(common.KeyBodyStorage, storage)
	c.Request.Body = io.NopCloser(bytes.NewReader(encoded))
	c.Request.ContentLength = int64(len(encoded))
	return nil
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
