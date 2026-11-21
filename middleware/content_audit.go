package middleware

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"hash"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

const (
	contentAuditPreviewLimit = 8 << 10
)

type contentAuditSink struct {
	file     *os.File
	path     string
	relative string
	hash     hash.Hash
	size     int64
	preview  bytes.Buffer
}

func createContentAuditSink(baseDir, relativePath, previewName string) (*contentAuditSink, error) {
	fullPath, err := contentAuditFullPath(baseDir, relativePath)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o700); err != nil {
		return nil, fmt.Errorf("create %s directory: %w", previewName, err)
	}
	file, err := os.OpenFile(fullPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return nil, fmt.Errorf("create %s file: %w", previewName, err)
	}
	return &contentAuditSink{
		file:     file,
		path:     fullPath,
		relative: relativePath,
		hash:     sha256.New(),
	}, nil
}

func contentAuditFullPath(baseDir, relativePath string) (string, error) {
	cleaned := filepath.Clean(filepath.FromSlash(relativePath))
	if cleaned == "." || filepath.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid content audit file path")
	}
	fullPath := filepath.Join(baseDir, cleaned)
	relativeToBase, err := filepath.Rel(baseDir, fullPath)
	if err != nil || relativeToBase == ".." || strings.HasPrefix(relativeToBase, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("content audit file path escapes its root")
	}
	return fullPath, nil
}

func (s *contentAuditSink) Write(payload []byte) (int, error) {
	n, err := s.file.Write(payload)
	if n > 0 {
		_, _ = s.hash.Write(payload[:n])
		s.size += int64(n)
		if s.preview.Len() < contentAuditPreviewLimit {
			remaining := contentAuditPreviewLimit - s.preview.Len()
			_, _ = s.preview.Write(payload[:min(n, remaining)])
		}
	}
	return n, err
}

func (s *contentAuditSink) close() error {
	if s == nil || s.file == nil {
		return nil
	}
	return s.file.Close()
}

func (s *contentAuditSink) digest() string {
	if s == nil {
		return ""
	}
	return hex.EncodeToString(s.hash.Sum(nil))
}

type contentAuditResponseWriter struct {
	gin.ResponseWriter
	capture *contentAuditCapture
}

func (w *contentAuditResponseWriter) Write(payload []byte) (int, error) {
	w.capture.captureResponse(payload)
	return w.ResponseWriter.Write(payload)
}

func (w *contentAuditResponseWriter) WriteString(value string) (int, error) {
	return w.Write([]byte(value))
}

func (w *contentAuditResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

type contentAuditCapture struct {
	baseDir        string
	eventId        string
	relativeDir    string
	eventDir       string
	createdAt      int64
	responseMu     sync.Mutex
	responseSink   *contentAuditSink
	requestSink    *contentAuditSink
	responseFailed bool

	websocketMu     sync.Mutex
	websocketSink   *contentAuditSink
	websocketFailed bool
}

func beginContentAudit(c *gin.Context) *contentAuditCapture {
	if !common.ContentAuditEnabled() || !model.ContentAuditReady() ||
		!shouldCaptureContentAudit(c.Request.Method, c.Request.URL.Path) {
		return nil
	}
	baseDir, err := filepath.Abs(common.ContentAuditDir())
	if err != nil {
		logger.LogError(c, common.LogText("content audit disabled for request: resolve storage path: %v", err))
		return nil
	}
	eventId, err := contentAuditEventId()
	if err != nil {
		logger.LogError(c, common.LogText("content audit disabled for request: generate event id: %v", err))
		return nil
	}
	createdAt := common.GetTimestamp()
	relativeDir := filepath.ToSlash(filepath.Join(
		time.Unix(createdAt, 0).UTC().Format("2006/01/02"),
		eventId,
	))
	eventDir, err := contentAuditFullPath(baseDir, relativeDir)
	if err != nil {
		logger.LogError(c, common.LogText("content audit disabled for request: invalid event path: %v", err))
		return nil
	}
	if err := os.MkdirAll(eventDir, 0o700); err != nil {
		logger.LogError(c, common.LogText("content audit disabled for request: create event directory: %v", err))
		return nil
	}
	capture := &contentAuditCapture{
		baseDir:     baseDir,
		eventId:     eventId,
		relativeDir: relativeDir,
		eventDir:    eventDir,
		createdAt:   createdAt,
	}
	c.Set(common.ContentAuditContextKey, capture)
	c.Writer = &contentAuditResponseWriter{ResponseWriter: c.Writer, capture: capture}
	return capture
}

// RelayContentAuditedHandler tags a terminal relay handler and captures its
// request/response without changing the surrounding handler chain.
func RelayContentAuditedHandler(handler gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(RouteTagKey, "relay")
		if capture := beginContentAudit(c); capture != nil {
			defer finishContentAudit(c, capture)
		}
		handler(c)
	}
}

func contentAuditEventId() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}

func shouldCaptureContentAudit(method, requestPath string) bool {
	if method == http.MethodOptions || method == http.MethodHead {
		return false
	}
	lowerPath := strings.ToLower(requestPath)
	if strings.Contains(lowerPath, "/embeddings") ||
		strings.Contains(lowerPath, ":embedcontent") ||
		strings.Contains(lowerPath, ":batchembedcontents") {
		return false
	}
	if method == http.MethodGet {
		switch requestPath {
		case "/v1/models", "/codex/models", "/v1beta/models", "/v1beta/openai/models":
			return false
		}
	}
	return true
}

func (c *contentAuditCapture) captureResponse(payload []byte) {
	if c == nil || len(payload) == 0 {
		return
	}
	c.responseMu.Lock()
	defer c.responseMu.Unlock()
	if c.responseFailed {
		return
	}
	if c.responseSink == nil {
		sink, err := createContentAuditSink(c.baseDir, filepath.ToSlash(filepath.Join(c.relativeDir, "response.bin")), "response")
		if err != nil {
			logger.LogError(nil, common.LogText("content audit response capture failed (event_id=%s): %v", c.eventId, err))
			return
		}
		c.responseSink = sink
	}
	if _, err := c.responseSink.Write(payload); err != nil {
		logger.LogError(nil, common.LogText("content audit response write failed (event_id=%s): %v", c.eventId, err))
		_ = os.Remove(c.responseSink.path)
		_ = c.responseSink.close()
		c.responseSink = nil
		c.responseFailed = true
	}
}

// RecordWebSocketFrame appends one relayed WebSocket data frame to the current
// content audit journal. Binary payloads are base64 encoded so the journal
// remains line-delimited JSON.
func RecordWebSocketFrame(c *gin.Context, direction string, messageType int, payload []byte) {
	recorder := common.ContentAuditRecorderForRequest(c)
	if recorder == nil {
		return
	}
	recorder.RecordContentAuditFrame(direction, messageType, payload)
}

func (c *contentAuditCapture) RecordContentAuditFrame(direction string, messageType int, payload []byte) {
	if c == nil {
		return
	}
	c.websocketMu.Lock()
	defer c.websocketMu.Unlock()
	if c.websocketFailed {
		return
	}
	if c.websocketSink == nil {
		sink, err := createContentAuditSink(c.baseDir, filepath.ToSlash(filepath.Join(c.relativeDir, "websocket.ndjson")), "websocket journal")
		if err != nil {
			logger.LogError(nil, common.LogText("content audit websocket capture failed (event_id=%s): %v", c.eventId, err))
			return
		}
		c.websocketSink = sink
	}
	frame := struct {
		At        int64  `json:"at"`
		Direction string `json:"direction"`
		Type      int    `json:"type"`
		Text      string `json:"text,omitempty"`
		Data      string `json:"data_base64,omitempty"`
	}{
		At:        common.GetTimestamp(),
		Direction: direction,
		Type:      messageType,
	}
	if messageType == 1 {
		frame.Text = string(payload)
	} else {
		frame.Data = base64.StdEncoding.EncodeToString(payload)
	}
	encoded, err := common.Marshal(frame)
	if err != nil {
		return
	}
	encoded = append(encoded, '\n')
	if _, err := c.websocketSink.Write(encoded); err != nil {
		logger.LogError(nil, common.LogText("content audit websocket write failed (event_id=%s): %v", c.eventId, err))
		_ = os.Remove(c.websocketSink.path)
		_ = c.websocketSink.close()
		c.websocketSink = nil
		c.websocketFailed = true
	}
}

func finishContentAudit(c *gin.Context, capture *contentAuditCapture) {
	if capture == nil {
		return
	}
	c.Writer = capture.writerWithoutAudit(c)
	contentType := c.Writer.Header().Get("Content-Type")
	capture.captureRequest(c)
	capture.responseMu.Lock()
	_ = capture.responseSink.close()
	capture.responseMu.Unlock()
	capture.websocketMu.Lock()
	_ = capture.websocketSink.close()
	capture.websocketMu.Unlock()

	entry := &model.ContentAuditLog{
		EventId:             capture.eventId,
		RequestId:           c.GetString(common.RequestIdKey),
		UserId:              c.GetInt("id"),
		Username:            c.GetString("username"),
		TokenId:             c.GetInt("token_id"),
		TokenName:           c.GetString("token_name"),
		ChannelId:           c.GetInt(string(constant.ContextKeyChannelId)),
		ChannelName:         c.GetString(string(constant.ContextKeyChannelName)),
		CreatedAt:           capture.createdAt,
		ExpiresAt:           capture.createdAt + common.ContentAuditRetentionSeconds(),
		Method:              c.Request.Method,
		Path:                c.Request.URL.Path,
		Kind:                contentAuditKind(c.Request.URL.Path),
		ModelName:           contentAuditModelName(c),
		GroupName:           common.GetContextKeyString(c, constant.ContextKeyUsingGroup),
		Ip:                  c.ClientIP(),
		UserAgent:           c.Request.UserAgent(),
		StatusCode:          c.Writer.Status(),
		Success:             c.Writer.Status() < http.StatusBadRequest,
		IsStream:            strings.Contains(strings.ToLower(contentType), "text/event-stream"),
		RequestContentType:  c.Request.Header.Get("Content-Type"),
		ResponseContentType: contentType,
		NodeName:            common.NodeName,
	}
	if capture.requestSink != nil {
		entry.RequestFile = capture.requestSink.relative
		entry.RequestSize = capture.requestSink.size
		entry.RequestSHA256 = capture.requestSink.digest()
		entry.RequestPreview = contentAuditRequestPreview(capture.requestSink.path, entry.RequestContentType)
	}
	if capture.responseSink != nil {
		entry.ResponseFile = capture.responseSink.relative
		entry.ResponseSize = capture.responseSink.size
		entry.ResponseSHA256 = capture.responseSink.digest()
		if isTextualContentType(entry.ResponseContentType) {
			entry.ResponsePreview = contentAuditPreviewText(capture.responseSink.preview.Bytes())
		}
	}
	if capture.websocketSink != nil {
		entry.WebSocketFile = capture.websocketSink.relative
		entry.WebSocketSize = capture.websocketSink.size
		entry.WebSocketSHA256 = capture.websocketSink.digest()
		entry.IsStream = true
	}
	if err := model.CreateContentAuditLog(entry); err != nil {
		logger.LogError(c, common.LogText("content audit record write failed (event_id=%s): %v", capture.eventId, err))
		_ = os.RemoveAll(capture.eventDir)
		return
	}
	if entry.RequestFile == "" && entry.ResponseFile == "" && entry.WebSocketFile == "" {
		_ = os.RemoveAll(capture.eventDir)
	}
}

func (c *contentAuditCapture) writerWithoutAudit(ctx *gin.Context) gin.ResponseWriter {
	writer, ok := ctx.Writer.(*contentAuditResponseWriter)
	if ok && writer.capture == c {
		return writer.ResponseWriter
	}
	// A stream keep-alive writer may still wrap the audit writer. Writes are
	// already complete at this point, so restoring the request's base writer is
	// safe and keeps later middleware from retaining the capture wrapper.
	return ctx.Writer
}

func (c *contentAuditCapture) captureRequest(ctx *gin.Context) {
	storage, err := common.GetBodyStorage(ctx)
	if err != nil || storage.Size() == 0 {
		return
	}
	reader, err := storage.NewReader()
	if err != nil {
		logger.LogError(ctx, common.LogText("content audit request read failed (event_id=%s): %v", c.eventId, err))
		return
	}
	defer reader.Close()
	sink, err := createContentAuditSink(c.baseDir, filepath.ToSlash(filepath.Join(c.relativeDir, "request.bin")), "request")
	if err != nil {
		logger.LogError(ctx, common.LogText("content audit request capture failed (event_id=%s): %v", c.eventId, err))
		return
	}
	if _, err := io.Copy(sink, reader); err != nil {
		logger.LogError(ctx, common.LogText("content audit request write failed (event_id=%s): %v", c.eventId, err))
		_ = sink.close()
		_ = os.Remove(sink.path)
		return
	}
	if err := sink.close(); err != nil {
		logger.LogError(ctx, common.LogText("content audit request close failed (event_id=%s): %v", c.eventId, err))
		_ = os.Remove(sink.path)
		return
	}
	c.requestSink = sink
}

func contentAuditRequestPreview(filePath, contentType string) string {
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err == nil && mediaType == "multipart/form-data" && params["boundary"] != "" {
		return multipartRequestPreview(filePath, params["boundary"])
	}
	if !isTextualContentType(contentType) {
		return ""
	}
	file, err := os.Open(filePath)
	if err != nil {
		return ""
	}
	defer file.Close()
	preview := make([]byte, contentAuditPreviewLimit)
	n, _ := io.ReadFull(file, preview)
	return contentAuditPreviewText(preview[:n])
}

func multipartRequestPreview(filePath, boundary string) string {
	file, err := os.Open(filePath)
	if err != nil {
		return ""
	}
	defer file.Close()
	reader := multipart.NewReader(file, boundary)
	var preview strings.Builder
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return contentAuditPreviewText([]byte(preview.String()))
		}
		name := part.FormName()
		filename := part.FileName()
		partType := part.Header.Get("Content-Type")
		if filename != "" {
			hasher := sha256.New()
			size, _ := io.Copy(hasher, part)
			_ = part.Close()
			_, _ = fmt.Fprintf(
				&preview,
				"File: %s\nFilename: %s\nContent-Type: %s\nSize: %d\nSHA-256: %s\n\n",
				name,
				filename,
				partType,
				size,
				hex.EncodeToString(hasher.Sum(nil)),
			)
		} else {
			content, readErr := io.ReadAll(io.LimitReader(part, contentAuditPreviewLimit))
			_ = part.Close()
			if readErr != nil {
				continue
			}
			_, _ = fmt.Fprintf(&preview, "Field: %s\n%s\n\n", name, contentAuditPreviewText(content))
		}
		if preview.Len() >= contentAuditPreviewLimit {
			break
		}
	}
	return contentAuditPreviewText([]byte(preview.String()))
}

func contentAuditPreviewText(payload []byte) string {
	if len(payload) > contentAuditPreviewLimit {
		payload = payload[:contentAuditPreviewLimit]
	}
	if !utf8.Valid(payload) {
		return strings.ToValidUTF8(string(payload), "\uFFFD")
	}
	return string(payload)
}

func isTextualContentType(contentType string) bool {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		mediaType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	}
	mediaType = strings.ToLower(mediaType)
	return strings.HasPrefix(mediaType, "text/") ||
		mediaType == "application/json" ||
		mediaType == "application/x-ndjson" ||
		mediaType == "application/xml" ||
		mediaType == "application/x-www-form-urlencoded" ||
		strings.HasSuffix(mediaType, "+json") ||
		strings.HasSuffix(mediaType, "+xml")
}

func contentAuditModelName(c *gin.Context) string {
	if modelName := common.GetContextKeyString(c, constant.ContextKeyOriginalModel); modelName != "" {
		return modelName
	}
	return c.GetString("original_model")
}

func contentAuditKind(requestPath string) string {
	lowerPath := strings.ToLower(requestPath)
	switch {
	case strings.Contains(lowerPath, "/audio/speech"):
		return "tts"
	case strings.Contains(lowerPath, "/audio/transcriptions"), strings.Contains(lowerPath, "/audio/translations"):
		return "asr"
	case strings.Contains(lowerPath, "/realtime"):
		return "realtime"
	case strings.Contains(lowerPath, "/images/"), strings.Contains(lowerPath, "/image/"), strings.Contains(lowerPath, "/mj/"):
		return "image"
	case strings.Contains(lowerPath, "/video"):
		return "video"
	case strings.Contains(lowerPath, "/responses"):
		return "responses"
	case strings.Contains(lowerPath, "/chat/completions"), strings.Contains(lowerPath, "/completions"),
		strings.Contains(lowerPath, "/messages"), strings.Contains(lowerPath, "generatecontent"),
		strings.HasPrefix(lowerPath, "/pg/"):
		return "chat"
	case strings.Contains(lowerPath, "/tools/"), strings.Contains(lowerPath, "/alpha/search"):
		return "tools"
	case strings.Contains(lowerPath, "/rerank"):
		return "rerank"
	default:
		return "other"
	}
}
