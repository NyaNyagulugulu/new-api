package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/memory_setting"

	"github.com/gin-gonic/gin"
)

func GetUserMemorySettings(c *gin.Context) {
	common.ApiSuccess(c, memory_setting.Get())
}

func GetUserMemories(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user")
		return
	}
	settings := memory_setting.Get()
	limit := settings.RetrieveLimit
	if limit <= 0 {
		limit = 20
	}
	memories, err := model.SearchUserMemories(c.Request.Context(), userId, model.UserMemorySearchOptions{
		Query:         c.Query("q"),
		Limit:         limit,
		MinImportance: settings.MinImportance,
		RetentionDays: settings.RetentionDays,
		MinSimilarity: settings.MinSimilarity,
		VectorWeight:  settings.VectorWeight,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, memories)
}

type searchUserMemoriesRequest struct {
	Query     string    `json:"query"`
	Embedding []float64 `json:"embedding"`
}

func SearchUserMemories(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user")
		return
	}
	var request searchUserMemoriesRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorMsg(c, "Invalid parameters")
		return
	}
	if err := model.ValidateUserMemoryEmbedding(request.Embedding); err != nil {
		common.ApiErrorMsg(c, "Invalid parameters")
		return
	}
	settings := memory_setting.Get()
	memories, err := model.SearchUserMemories(c.Request.Context(), userId, model.UserMemorySearchOptions{
		Query:         request.Query,
		Embedding:     request.Embedding,
		Limit:         settings.RetrieveLimit,
		MinImportance: settings.MinImportance,
		RetentionDays: settings.RetentionDays,
		MinSimilarity: settings.MinSimilarity,
		VectorWeight:  settings.VectorWeight,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, memories)
}

type saveUserMemoriesRequest struct {
	Memories []model.UserMemoryInput `json:"memories"`
}

func SaveUserMemories(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user")
		return
	}
	var request saveUserMemoriesRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorMsg(c, "Invalid parameters")
		return
	}
	if err := model.SaveUserMemories(c.Request.Context(), userId, request.Memories); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func DeleteUserMemory(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user")
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		common.ApiErrorMsg(c, "Invalid parameters")
		return
	}
	if err := model.DeleteUserMemory(c.Request.Context(), userId, id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
