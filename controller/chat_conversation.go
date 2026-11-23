package controller

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

type chatConversationSyncRequest struct {
	Sessions []model.ChatConversationInput `json:"sessions"`
	// Kept for wire compatibility with older clients. Deletions must use the
	// explicit delete endpoint so stale snapshots cannot remove other sessions.
	DeletedIds []string `json:"deleted_ids"`
}

func GetChatConversations(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user")
		return
	}

	conversations, err := model.ListChatConversations(c.Request.Context(), userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, conversations)
}

func SyncChatConversations(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user")
		return
	}

	var request chatConversationSyncRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorMsg(c, "Invalid parameters")
		return
	}

	for i := range request.Sessions {
		if err := model.ValidateChatConversationInput(&request.Sessions[i]); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	err := model.SyncChatConversations(
		c.Request.Context(),
		userId,
		request.Sessions,
	)
	if errors.Is(err, model.ErrChatConversationForbidden) {
		common.ApiErrorMsg(c, "Chat conversation not found")
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func DeleteChatConversation(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user")
		return
	}

	if err := model.DeleteChatConversation(
		c.Request.Context(),
		userId,
		c.Param("id"),
	); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
