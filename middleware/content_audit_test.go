package middleware

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupContentAuditTest(t *testing.T) (*gorm.DB, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	previousDB := model.DB
	model.DB = db
	require.NoError(t, model.MigrateContentAuditLogs())
	dir := t.TempDir()
	t.Setenv("CONTENT_AUDIT_ENABLED", "true")
	t.Setenv("CONTENT_AUDIT_DIR", dir)
	t.Cleanup(func() {
		model.DB = previousDB
		assert.NoError(t, sqlDB.Close())
	})
	return db, dir
}

func TestRelayContentAuditCapturesJSONRequestAndStreamingResponse(t *testing.T) {
	db, dir := setupContentAuditTest(t)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(common.RequestIdKey, "request-content-audit")
		c.Next()
	})
	router.POST("/v1/chat/completions", RouteTag("relay"), func(c *gin.Context) {
		var request map[string]any
		require.NoError(t, common.UnmarshalBodyReusable(c, &request))
		c.Set("id", 7)
		c.Set("username", "audit-user")
		c.Set("token_id", 11)
		c.Set("token_name", "audit-token")
		common.SetContextKey(c, "original_model", "gpt-audit")
		common.SetContextKey(c, "group", "default")
		common.SetContextKey(c, "channel_id", 21)
		common.SetContextKey(c, "channel_name", "audit-channel")
		c.Header("Content-Type", "text/event-stream")
		c.Status(http.StatusOK)
		_, _ = c.Writer.WriteString("data: {\"delta\":\"retained answer\"}\n\n")
		_, _ = c.Writer.WriteString("data: [DONE]\n\n")
	})
	body := `{"model":"gpt-audit","messages":[{"role":"user","content":"retained prompt"}]}`
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Oneapi-Request-Id", "request-content-audit")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code)

	var entry model.ContentAuditLog
	require.NoError(t, db.First(&entry).Error)
	assert.Equal(t, 7, entry.UserId)
	assert.Equal(t, "audit-user", entry.Username)
	assert.Equal(t, "gpt-audit", entry.ModelName)
	assert.Equal(t, "chat", entry.Kind)
	assert.Equal(t, "request-content-audit", entry.RequestId)
	assert.Equal(t, int64(common.ContentAuditRetentionSeconds()), entry.ExpiresAt-entry.CreatedAt)
	assert.True(t, entry.IsStream)
	assert.NotEmpty(t, entry.RequestFile)
	assert.NotEmpty(t, entry.ResponseFile)
	assert.Contains(t, entry.RequestPreview, "retained prompt")
	assert.Contains(t, entry.ResponsePreview, "retained answer")

	requestBody, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(entry.RequestFile)))
	require.NoError(t, err)
	assert.JSONEq(t, body, string(requestBody))
	responseBody, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(entry.ResponseFile)))
	require.NoError(t, err)
	assert.Contains(t, string(responseBody), "retained answer")
	assert.Contains(t, string(responseBody), "[DONE]")
}

func TestRelayContentAuditExtractsMultipartFieldsAndSkipsEmbeddings(t *testing.T) {
	db, _ := setupContentAuditTest(t)
	router := gin.New()
	router.POST("/v1/audio/transcriptions", RouteTag("relay"), func(c *gin.Context) {
		c.Set("id", 8)
		c.Set("username", "audio-user")
		c.Data(http.StatusOK, "application/json", []byte(`{"text":"retained transcript"}`))
	})
	router.POST("/v1/embeddings", RouteTag("relay"), func(c *gin.Context) {
		c.Data(http.StatusOK, "application/json", []byte(`{"data":[]}`))
	})

	var multipartBody bytes.Buffer
	writer := multipart.NewWriter(&multipartBody)
	require.NoError(t, writer.WriteField("model", "whisper-audit"))
	require.NoError(t, writer.WriteField("prompt", "retained audio context"))
	filePart, err := writer.CreateFormFile("file", "sample.wav")
	require.NoError(t, err)
	_, err = filePart.Write([]byte("audio bytes"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	request := httptest.NewRequest(http.MethodPost, "/v1/audio/transcriptions", &multipartBody)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code)

	var entry model.ContentAuditLog
	require.NoError(t, db.First(&entry).Error)
	assert.Equal(t, "asr", entry.Kind)
	assert.Contains(t, entry.RequestPreview, "Field: prompt")
	assert.Contains(t, entry.RequestPreview, "retained audio context")
	assert.Contains(t, entry.RequestPreview, "Filename: sample.wav")
	assert.Contains(t, entry.RequestPreview, "Size: 11")
	assert.Contains(t, entry.RequestPreview, "SHA-256:")

	request = httptest.NewRequest(http.MethodPost, "/v1/embeddings", bytes.NewBufferString(`{"input":"vector input"}`))
	request.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code)

	var count int64
	require.NoError(t, db.Model(&model.ContentAuditLog{}).Count(&count).Error)
	assert.EqualValues(t, 1, count, "embedding requests must not be retained")
}

func TestContentAuditCleanupRemovesExpiredMetadataAndFiles(t *testing.T) {
	db, dir := setupContentAuditTest(t)
	relativeFile := filepath.ToSlash(filepath.Join("2020", "01", "01", "expired", "response.bin"))
	fullPath := filepath.Join(dir, filepath.FromSlash(relativeFile))
	require.NoError(t, os.MkdirAll(filepath.Dir(fullPath), 0o700))
	require.NoError(t, os.WriteFile(fullPath, []byte("expired content"), 0o600))
	entry := model.ContentAuditLog{
		EventId:      "expired-content",
		CreatedAt:    1,
		ExpiresAt:    2,
		ResponseFile: relativeFile,
	}
	require.NoError(t, db.Create(&entry).Error)

	require.NoError(t, service.CleanupExpiredContentAuditLogs(context.Background()))
	var count int64
	require.NoError(t, db.Model(&model.ContentAuditLog{}).Count(&count).Error)
	assert.Zero(t, count)
	assert.NoFileExists(t, fullPath)
}

func TestRelayContentAuditRecordsWebSocketFrames(t *testing.T) {
	db, dir := setupContentAuditTest(t)
	router := gin.New()
	router.GET("/v1/realtime", RouteTag("relay"), func(c *gin.Context) {
		c.Set("id", 9)
		c.Set("username", "realtime-user")
		recorder := common.ContentAuditRecorderForRequest(c)
		require.NotNil(t, recorder)
		recorder.RecordContentAuditFrame("client", 1, []byte(`{"type":"input_audio_buffer.append","audio":"client-audio"}`))
		recorder.RecordContentAuditFrame("upstream", 1, []byte(`{"type":"response.audio.delta","delta":"upstream-audio"}`))
		c.Status(http.StatusSwitchingProtocols)
	})
	request := httptest.NewRequest(http.MethodGet, "/v1/realtime", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, http.StatusSwitchingProtocols, response.Code)

	var entry model.ContentAuditLog
	require.NoError(t, db.First(&entry).Error)
	assert.Equal(t, "realtime", entry.Kind)
	assert.NotEmpty(t, entry.WebSocketFile)
	assert.True(t, entry.IsStream)
	journal, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(entry.WebSocketFile)))
	require.NoError(t, err)
	assert.Contains(t, string(journal), `"direction":"client"`)
	assert.Contains(t, string(journal), "client-audio")
	assert.Contains(t, string(journal), `"direction":"upstream"`)
	assert.Contains(t, string(journal), "upstream-audio")
}
