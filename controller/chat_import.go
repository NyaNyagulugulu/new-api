package controller

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

func ImportChatConversations(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user")
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.MaxChatImportBytes)
	path, cleanup, err := prepareChatImportSource(c)
	if err != nil {
		common.ApiErrorMsg(c, "Invalid chat import source")
		return
	}
	defer cleanup()

	result, err := service.ImportChatConversationsFromPath(path)
	if err != nil {
		common.SysError(err.Error())
		common.ApiErrorMsg(c, "Unable to import conversations")
		return
	}
	common.ApiSuccess(c, result)
}

func prepareChatImportSource(c *gin.Context) (string, func(), error) {
	if strings.HasPrefix(c.ContentType(), "multipart/form-data") {
		fileHeader, err := c.FormFile("file")
		if err == nil {
			source, err := fileHeader.Open()
			if err != nil {
				return "", func() {}, err
			}
			defer source.Close()
			return writeChatImportTemp(source)
		}
		rawURL := strings.TrimSpace(c.PostForm("url"))
		if rawURL != "" {
			return downloadChatImport(c, rawURL)
		}
		return "", func() {}, err
	}

	var request struct {
		URL string `json:"url"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		return "", func() {}, err
	}
	return downloadChatImport(c, strings.TrimSpace(request.URL))
}

func writeChatImportTemp(source io.Reader) (string, func(), error) {
	file, err := os.CreateTemp("", "new-api-chat-import-*.upload")
	if err != nil {
		return "", func() {}, err
	}
	path := file.Name()
	cleanup := func() { _ = os.Remove(path) }
	written, copyErr := io.Copy(file, io.LimitReader(source, service.MaxChatImportBytes+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || written > service.MaxChatImportBytes {
		cleanup()
		if written > service.MaxChatImportBytes {
			return "", func() {}, fmt.Errorf("chat import file is too large")
		}
		if copyErr != nil {
			return "", func() {}, copyErr
		}
		return "", func() {}, closeErr
	}
	return path, cleanup, nil
}

func downloadChatImport(c *gin.Context, rawURL string) (string, func(), error) {
	path, err := service.DownloadChatImport(c.Request.Context(), rawURL)
	if err != nil {
		return "", func() {}, err
	}
	return path, func() { _ = os.Remove(path) }, nil
}
