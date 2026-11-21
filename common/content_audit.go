package common

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const ContentAuditContextKey = "content_audit_capture"

// ContentAuditFrameRecorder is implemented by the relay content capture and is
// stored on the request context for WebSocket relay goroutines.
type ContentAuditFrameRecorder interface {
	RecordContentAuditFrame(direction string, messageType int, payload []byte)
}

func ContentAuditRecorderForRequest(c *gin.Context) ContentAuditFrameRecorder {
	if c == nil {
		return nil
	}
	value, exists := c.Get(ContentAuditContextKey)
	if !exists {
		return nil
	}
	recorder, _ := value.(ContentAuditFrameRecorder)
	return recorder
}

// ContentAuditRetentionDays is the compliance retention window for relay
// request and response content. It is intentionally not configurable: the
// traceability log must expire after 30 days.
const ContentAuditRetentionDays = 30

// ContentAuditEnabled reports whether relay content capture is enabled.
func ContentAuditEnabled() bool {
	return GetEnvOrDefaultBool("CONTENT_AUDIT_ENABLED", true)
}

// ContentAuditDir returns the directory used for retained request and response
// payloads. Administrators should place it on a shared volume in multi-node
// deployments because the database only stores relative file references.
func ContentAuditDir() string {
	dir := strings.TrimSpace(os.Getenv("CONTENT_AUDIT_DIR"))
	if dir == "" {
		return filepath.Join("data", "content-audit")
	}
	return dir
}

// ContentAuditRetentionSeconds returns the fixed retention window in seconds.
func ContentAuditRetentionSeconds() int64 {
	return int64(ContentAuditRetentionDays * 24 * time.Hour / time.Second)
}
