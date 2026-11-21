package model

import (
	"context"
	"strings"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var contentAuditReadyDB atomic.Pointer[gorm.DB]

// ContentAuditLog is the searchable metadata index for retained relay
// request/response payloads. Payload bodies live in files owned by the
// deployment, never in the primary database.
type ContentAuditLog struct {
	Id                  int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	EventId             string `json:"event_id" gorm:"type:varchar(64);uniqueIndex"`
	RequestId           string `json:"request_id" gorm:"type:varchar(128);index"`
	UserId              int    `json:"user_id" gorm:"index:idx_content_audit_user_time,priority:1"`
	Username            string `json:"username" gorm:"type:varchar(64);index"`
	TokenId             int    `json:"token_id" gorm:"index"`
	TokenName           string `json:"token_name" gorm:"type:varchar(128)"`
	ChannelId           int    `json:"channel_id" gorm:"index"`
	ChannelName         string `json:"channel_name" gorm:"type:varchar(255)"`
	CreatedAt           int64  `json:"created_at" gorm:"type:bigint;index;index:idx_content_audit_user_time,priority:2;index:idx_content_audit_kind_time,priority:2"`
	ExpiresAt           int64  `json:"expires_at" gorm:"type:bigint;index"`
	Method              string `json:"method" gorm:"type:varchar(16)"`
	Path                string `json:"path" gorm:"type:varchar(1024)"`
	Kind                string `json:"kind" gorm:"type:varchar(32);index:idx_content_audit_kind_time,priority:1"`
	ModelName           string `json:"model_name" gorm:"type:varchar(255);index"`
	GroupName           string `json:"group" gorm:"column:group_name;type:varchar(64)"`
	Ip                  string `json:"ip" gorm:"type:varchar(64)"`
	UserAgent           string `json:"user_agent" gorm:"type:varchar(512)"`
	StatusCode          int    `json:"status_code"`
	Success             bool   `json:"success" gorm:"index"`
	IsStream            bool   `json:"is_stream"`
	RequestContentType  string `json:"request_content_type" gorm:"type:varchar(255)"`
	ResponseContentType string `json:"response_content_type" gorm:"type:varchar(255)"`
	RequestSize         int64  `json:"request_size"`
	ResponseSize        int64  `json:"response_size"`
	RequestSHA256       string `json:"request_sha256" gorm:"type:varchar(64)"`
	ResponseSHA256      string `json:"response_sha256" gorm:"type:varchar(64)"`
	WebSocketSize       int64  `json:"websocket_size"`
	WebSocketSHA256     string `json:"websocket_sha256" gorm:"type:varchar(64)"`
	RequestPreview      string `json:"-" gorm:"type:text"`
	ResponsePreview     string `json:"-" gorm:"type:text"`
	RequestFile         string `json:"-" gorm:"type:varchar(512)"`
	ResponseFile        string `json:"-" gorm:"type:varchar(512)"`
	WebSocketFile       string `json:"-" gorm:"type:varchar(512)"`
	NodeName            string `json:"node_name" gorm:"type:varchar(255)"`
	HasRequest          bool   `json:"has_request" gorm:"-"`
	HasResponse         bool   `json:"has_response" gorm:"-"`
	HasWebSocket        bool   `json:"has_websocket" gorm:"-"`
}

type ContentAuditFilter struct {
	UserId         int
	Username       string
	ModelName      string
	Kind           string
	RequestId      string
	Ip             string
	Query          string
	StartTimestamp int64
	EndTimestamp   int64
	Success        *bool
}

func contentAuditAvailability(entry *ContentAuditLog) {
	if entry == nil {
		return
	}
	entry.HasRequest = entry.RequestFile != ""
	entry.HasResponse = entry.ResponseFile != ""
	entry.HasWebSocket = entry.WebSocketFile != ""
}

func (f ContentAuditFilter) apply(tx *gorm.DB) (*gorm.DB, error) {
	if f.UserId > 0 {
		tx = tx.Where("user_id = ?", f.UserId)
	}
	if f.Username != "" {
		tx = tx.Where("username = ?", f.Username)
	}
	if f.ModelName != "" {
		tx = tx.Where("model_name = ?", f.ModelName)
	}
	if f.Kind != "" {
		tx = tx.Where("kind = ?", f.Kind)
	}
	if f.RequestId != "" {
		tx = tx.Where("request_id = ?", f.RequestId)
	}
	if f.Ip != "" {
		tx = tx.Where("ip = ?", f.Ip)
	}
	if f.StartTimestamp > 0 {
		tx = tx.Where("created_at >= ?", f.StartTimestamp)
	}
	if f.EndTimestamp > 0 {
		tx = tx.Where("created_at <= ?", f.EndTimestamp)
	}
	if f.Success != nil {
		tx = tx.Where("success = ?", *f.Success)
	}
	if f.Query != "" {
		keyword := strings.TrimSpace(f.Query)
		if len([]rune(keyword)) < 2 {
			return nil, common.NewMessage("Fuzzy search keywords must be at least 2 characters long")
		}
		keyword = strings.ReplaceAll(keyword, "!", "!!")
		keyword = strings.ReplaceAll(keyword, "%", "!%")
		keyword = strings.ReplaceAll(keyword, "_", "!_")
		pattern := "%" + keyword + "%"
		tx = tx.Where(
			"(request_preview LIKE ? ESCAPE '!' OR response_preview LIKE ? ESCAPE '!')",
			pattern,
			pattern,
		)
	}
	return tx, nil
}

func CreateContentAuditLog(entry *ContentAuditLog) error {
	if !ContentAuditReady() {
		return gorm.ErrInvalidDB
	}
	if entry.CreatedAt == 0 {
		entry.CreatedAt = common.GetTimestamp()
	}
	if entry.ExpiresAt == 0 {
		entry.ExpiresAt = entry.CreatedAt + common.ContentAuditRetentionSeconds()
	}
	return DB.Create(entry).Error
}

func GetContentAuditLogs(filter ContentAuditFilter, startIdx int, limit int) ([]*ContentAuditLog, int64, error) {
	query, err := filter.apply(DB.Model(&ContentAuditLog{}))
	if err != nil {
		return nil, 0, err
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	entries := make([]*ContentAuditLog, 0)
	if err := query.Order("created_at DESC").Order("id DESC").Offset(startIdx).Limit(limit).Find(&entries).Error; err != nil {
		return nil, 0, err
	}
	for _, entry := range entries {
		contentAuditAvailability(entry)
	}
	return entries, total, nil
}

func GetContentAuditLogByEventId(eventId string) (*ContentAuditLog, error) {
	var entry ContentAuditLog
	if err := DB.Where("event_id = ?", eventId).Take(&entry).Error; err != nil {
		return nil, err
	}
	contentAuditAvailability(&entry)
	return &entry, nil
}

func GetExpiredContentAuditLogs(ctx context.Context, timestamp int64, limit int) ([]*ContentAuditLog, error) {
	if limit <= 0 {
		limit = 100
	}
	entries := make([]*ContentAuditLog, 0, limit)
	err := DB.WithContext(ctx).
		Where("expires_at <= ?", timestamp).
		Order("expires_at ASC").
		Limit(limit).
		Find(&entries).Error
	return entries, err
}

func DeleteContentAuditLogs(ctx context.Context, ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	result := DB.WithContext(ctx).Where("id IN ?", ids).Delete(&ContentAuditLog{})
	return result.RowsAffected, result.Error
}

func MigrateContentAuditLogs() error {
	if err := DB.AutoMigrate(&ContentAuditLog{}); err != nil {
		return err
	}
	MarkContentAuditReady()
	return nil
}

func MarkContentAuditReady() {
	contentAuditReadyDB.Store(DB)
}

func ContentAuditReady() bool {
	return DB != nil && contentAuditReadyDB.Load() == DB
}

// RefreshContentAuditReady lets a non-master node discover a table migrated by
// the master after this process started.
func RefreshContentAuditReady() bool {
	if ContentAuditReady() {
		return true
	}
	if DB == nil || !DB.Migrator().HasTable(&ContentAuditLog{}) {
		return false
	}
	MarkContentAuditReady()
	return true
}
