package controller

import (
	"encoding/hex"
	"errors"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func GetContentAuditLogs(c *gin.Context) {
	page := common.GetPageQuery(c)
	if page.Page < 1 || page.PageSize < 1 || page.Page > 100000000 {
		common.ApiErrorT(c, "Invalid content audit pagination")
		return
	}
	now := common.GetTimestamp()
	earliest := now - common.ContentAuditRetentionSeconds()
	filter := model.ContentAuditFilter{
		Username:  strings.TrimSpace(c.Query("username")),
		ModelName: strings.TrimSpace(c.Query("model_name")),
		Kind:      strings.TrimSpace(c.Query("kind")),
		RequestId: strings.TrimSpace(c.Query("request_id")),
		Ip:        strings.TrimSpace(c.Query("ip")),
		Query:     strings.TrimSpace(c.Query("q")),
	}
	if raw := strings.TrimSpace(c.Query("user_id")); raw != "" {
		userId, err := strconv.Atoi(raw)
		if err != nil || userId < 0 {
			common.ApiErrorT(c, "Invalid content audit filters")
			return
		}
		filter.UserId = userId
	}
	for name, target := range map[string]*int64{"start_timestamp": &filter.StartTimestamp, "end_timestamp": &filter.EndTimestamp} {
		if raw := c.Query(name); raw != "" {
			parsed, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || parsed < 0 {
				common.ApiErrorT(c, "Invalid content audit time range")
				return
			}
			*target = parsed
		}
	}
	if filter.StartTimestamp == 0 || filter.StartTimestamp < earliest {
		filter.StartTimestamp = earliest
	}
	if filter.EndTimestamp == 0 || filter.EndTimestamp > now {
		filter.EndTimestamp = now
	}
	if filter.EndTimestamp < filter.StartTimestamp {
		common.ApiErrorT(c, "Invalid content audit time range")
		return
	}
	if raw := c.Query("success"); raw != "" {
		if raw != "true" && raw != "false" {
			common.ApiErrorT(c, "Invalid content audit result")
			return
		}
		success := raw == "true"
		filter.Success = &success
	}
	entries, total, err := model.GetContentAuditLogs(filter, page.GetStartIdx(), page.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetItems(entries)
	page.SetTotal(int(total))
	common.ApiSuccess(c, page)
}

func GetContentAuditLogDetail(c *gin.Context) {
	eventId := c.Param("event_id")
	if !validContentAuditEventId(eventId) {
		common.ApiErrorT(c, "Invalid content audit record")
		return
	}
	entry, err := model.GetContentAuditLogByEventId(eventId)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorT(c, "Content audit record not found")
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "content_audit.view", map[string]any{
		"event_id": eventId,
		"part":     "metadata",
	})
	common.ApiSuccess(c, struct {
		*model.ContentAuditLog
		RequestPreview  string `json:"request_preview"`
		ResponsePreview string `json:"response_preview"`
	}{
		ContentAuditLog: entry,
		RequestPreview:  entry.RequestPreview,
		ResponsePreview: entry.ResponsePreview,
	})
}

func GetContentAuditContent(c *gin.Context) {
	eventId := c.Param("event_id")
	if !validContentAuditEventId(eventId) {
		common.ApiErrorT(c, "Invalid content audit record")
		return
	}
	part := c.Param("part")
	if part != "request" && part != "response" && part != "websocket" {
		common.ApiErrorT(c, "Invalid content audit record")
		return
	}
	entry, err := model.GetContentAuditLogByEventId(eventId)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorT(c, "Content audit record not found")
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	relativePath, contentType, size := contentAuditPart(entry, part)
	if relativePath == "" {
		common.ApiErrorT(c, "Content audit record has no retained content")
		return
	}
	fullPath, err := resolveContentAuditPath(relativePath)
	if err != nil {
		common.ApiErrorT(c, "Content audit file is unavailable")
		return
	}
	file, err := os.Open(fullPath)
	if err != nil {
		common.ApiErrorT(c, "Content audit file is unavailable")
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		common.ApiErrorT(c, "Content audit file is unavailable")
		return
	}
	inline := c.Query("inline") == "1" && safeContentAuditInlineType(contentType)
	if inline {
		contentType = inlineContentAuditContentType(contentType)
		c.Header("Content-Disposition", `inline; filename="`+eventId+`-`+part+`.bin"`)
	} else {
		contentType = "application/octet-stream"
		c.Header("Content-Disposition", `attachment; filename="`+eventId+`-`+part+`.bin"`)
	}
	if contentType != "" {
		c.Header("Content-Type", contentType)
	}
	c.Header("Cache-Control", "no-store")
	c.Header("Content-Security-Policy", "default-src 'none'; sandbox")
	c.Header("X-Content-Type-Options", "nosniff")
	recordManageAudit(c, "content_audit.view", map[string]any{
		"event_id": eventId,
		"part":     part,
		"size":     size,
	})
	http.ServeContent(c.Writer, c.Request, filepath.Base(fullPath), info.ModTime(), file)
}

func validContentAuditEventId(eventId string) bool {
	if len(eventId) != 32 {
		return false
	}
	_, err := hex.DecodeString(eventId)
	return err == nil
}

func contentAuditPart(entry *model.ContentAuditLog, part string) (string, string, int64) {
	switch part {
	case "request":
		return entry.RequestFile, entry.RequestContentType, entry.RequestSize
	case "response":
		return entry.ResponseFile, entry.ResponseContentType, entry.ResponseSize
	case "websocket":
		return entry.WebSocketFile, "application/x-ndjson; charset=utf-8", entry.WebSocketSize
	default:
		return "", "", 0
	}
}

func resolveContentAuditPath(relativePath string) (string, error) {
	baseDir, err := filepath.Abs(common.ContentAuditDir())
	if err != nil {
		return "", err
	}
	cleaned := filepath.Clean(filepath.FromSlash(relativePath))
	if cleaned == "." || filepath.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", errors.New("invalid content audit path")
	}
	fullPath := filepath.Join(baseDir, cleaned)
	relativeToBase, err := filepath.Rel(baseDir, fullPath)
	if err != nil || relativeToBase == ".." || strings.HasPrefix(relativeToBase, ".."+string(filepath.Separator)) {
		return "", errors.New("content audit path escapes its root")
	}
	return fullPath, nil
}

func safeContentAuditInlineType(contentType string) bool {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		mediaType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	}
	mediaType = strings.ToLower(mediaType)
	if strings.HasPrefix(mediaType, "text/") ||
		mediaType == "application/json" ||
		mediaType == "application/x-ndjson" ||
		mediaType == "application/xml" ||
		strings.HasSuffix(mediaType, "+json") ||
		strings.HasSuffix(mediaType, "+xml") {
		return true
	}
	switch mediaType {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp",
		"audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/opus", "audio/flac", "audio/aac", "audio/mp4",
		"video/mp4", "video/webm", "video/quicktime":
		return true
	default:
		return false
	}
}

func inlineContentAuditContentType(contentType string) string {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		mediaType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	}
	mediaType = strings.ToLower(mediaType)
	if strings.HasPrefix(mediaType, "text/") ||
		mediaType == "application/json" ||
		mediaType == "application/x-ndjson" ||
		mediaType == "application/xml" ||
		strings.HasSuffix(mediaType, "+json") ||
		strings.HasSuffix(mediaType, "+xml") {
		return "text/plain; charset=utf-8"
	}
	return mediaType
}
