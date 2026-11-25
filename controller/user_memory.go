package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
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

func ListUserMemories(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user")
		return
	}
	memories, err := model.ListUserMemories(c.Request.Context(), userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, memories)
}

type searchUserMemoriesRequest struct {
	Query string `json:"query"`
	Group string `json:"group"`
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
	settings := memory_setting.Get()
	var embedding []float64
	if settings.EmbeddingEnabled && settings.EmbeddingModel != "" && request.Query != "" {
		group := strings.TrimSpace(settings.EmbeddingGroup)
		if group == "" {
			group = strings.TrimSpace(request.Group)
		}
		if group == "" {
			group = common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
		}
		vectors, err := service.EmbedMemoryTexts(
			c,
			settings.EmbeddingModel,
			group,
			[]string{request.Query},
		)
		if err == nil && len(vectors) > 0 {
			embedding = vectors[0]
		}
	}
	memories, err := model.SearchUserMemories(c.Request.Context(), userId, model.UserMemorySearchOptions{
		Query:         request.Query,
		Embedding:     embedding,
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
	Group    string                  `json:"group"`
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
	settings := memory_setting.Get()
	if settings.EmbeddingEnabled && settings.EmbeddingModel != "" && len(request.Memories) > 0 {
		group := strings.TrimSpace(settings.EmbeddingGroup)
		if group == "" {
			group = strings.TrimSpace(request.Group)
		}
		if group == "" {
			group = common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
		}
		texts := make([]string, 0, len(request.Memories))
		indexes := make([]int, 0, len(request.Memories))
		for i := range request.Memories {
			if len(request.Memories[i].Embedding) == 0 {
				texts = append(texts, request.Memories[i].Content)
				indexes = append(indexes, i)
			}
		}
		if len(texts) > 0 {
			vectors, err := service.EmbedMemoryTexts(c, settings.EmbeddingModel, group, texts)
			if err == nil {
				for i, index := range indexes {
					if i < len(vectors) {
						request.Memories[index].Embedding = vectors[i]
					}
				}
			}
		}
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

func DeleteAllUserMemories(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user")
		return
	}
	deleted, err := model.DeleteAllUserMemories(c.Request.Context(), userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": deleted})
}
