package controller

import (
	"errors"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
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

	page := 1
	if rawPage := c.Query("page"); rawPage != "" {
		parsed, err := strconv.Atoi(rawPage)
		if err != nil || parsed < 1 || parsed > 1_000_000 {
			common.ApiErrorMsg(c, "Invalid page")
			return
		}
		page = parsed
	}
	pageSize := model.DefaultChatConversationPage
	if rawPageSize := c.Query("page_size"); rawPageSize != "" {
		parsed, err := strconv.Atoi(rawPageSize)
		if err != nil || parsed < 1 {
			common.ApiErrorMsg(c, "Invalid page size")
			return
		}
		pageSize = min(parsed, model.MaxChatConversationPageSize)
	}

	conversations, total, err := model.ListChatConversations(
		c.Request.Context(),
		userId,
		page,
		pageSize,
	)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"items":     conversations,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
		"has_more":  int64(page)*int64(pageSize) < total,
	})
}

func GetChatConversation(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user")
		return
	}

	conversation, err := model.GetChatConversation(
		c.Request.Context(),
		userId,
		c.Param("id"),
	)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorMsg(c, "Chat conversation not found")
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, conversation)
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
