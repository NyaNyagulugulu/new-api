package controller

import (
	"errors"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

func GetUserPersonas(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user")
		return
	}
	personas, err := model.ListUserPersonas(c.Request.Context(), userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, personas)
}

func CreateUserPersona(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user")
		return
	}
	var input model.UserPersonaInput
	if err := common.DecodeJson(c.Request.Body, &input); err != nil {
		common.ApiErrorMsg(c, "Invalid parameters")
		return
	}
	persona, err := model.CreateUserPersona(c.Request.Context(), userId, input)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, persona)
}

func UpdateUserPersona(c *gin.Context) {
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
	var input model.UserPersonaInput
	if err := common.DecodeJson(c.Request.Body, &input); err != nil {
		common.ApiErrorMsg(c, "Invalid parameters")
		return
	}
	if err := model.UpdateUserPersona(c.Request.Context(), userId, id, input); err != nil {
		if errors.Is(err, model.ErrUserPersonaNotFound) {
			common.ApiErrorMsg(c, "Persona not found")
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func DeleteUserPersona(c *gin.Context) {
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
	if err := model.DeleteUserPersona(c.Request.Context(), userId, id); err != nil {
		if errors.Is(err, model.ErrUserPersonaNotFound) {
			common.ApiErrorMsg(c, "Persona not found")
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
