package service

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const contentAuditCleanupInterval = time.Hour
const contentAuditCleanupBatchSize = 100

// StartContentAuditCleanup enforces the fixed content retention window. Only
// the master removes expired records so multiple nodes do not race on files.
func StartContentAuditCleanup() {
	go func() {
		for !model.RefreshContentAuditReady() {
			time.Sleep(time.Minute)
		}
		if !common.IsMasterNode {
			return
		}
		cleanupContentAuditLogs()
		ticker := time.NewTicker(contentAuditCleanupInterval)
		defer ticker.Stop()
		for range ticker.C {
			cleanupContentAuditLogs()
		}
	}()
}

func cleanupContentAuditLogs() {
	if err := CleanupExpiredContentAuditLogs(context.Background()); err != nil {
		common.SysError(common.LogText("content audit cleanup failed: %v", err))
	}
}

// CleanupExpiredContentAuditLogs removes expired payload files before deleting
// their metadata rows. A file removal failure keeps the row so a later pass can
// retry instead of leaving unindexed retained content on disk.
func CleanupExpiredContentAuditLogs(ctx context.Context) error {
	baseDir, err := filepath.Abs(common.ContentAuditDir())
	if err != nil {
		return err
	}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		entries, err := model.GetExpiredContentAuditLogs(ctx, common.GetTimestamp(), contentAuditCleanupBatchSize)
		if err != nil {
			return err
		}
		if len(entries) == 0 {
			return nil
		}
		ids := make([]int64, 0, len(entries))
		for _, entry := range entries {
			for _, relativePath := range []string{entry.RequestFile, entry.ResponseFile, entry.WebSocketFile} {
				if relativePath == "" {
					continue
				}
				fullPath, pathErr := resolveContentAuditStoredPath(baseDir, relativePath)
				if pathErr != nil {
					return fmt.Errorf("resolve content audit file for event %s: %w", entry.EventId, pathErr)
				}
				if removeErr := os.RemoveAll(filepath.Dir(fullPath)); removeErr != nil {
					return fmt.Errorf("remove content audit files for event %s: %w", entry.EventId, removeErr)
				}
			}
			ids = append(ids, entry.Id)
		}
		deleted, err := model.DeleteContentAuditLogs(ctx, ids)
		if err != nil {
			return err
		}
		if deleted == 0 {
			return fmt.Errorf("content audit cleanup did not delete expired metadata")
		}
	}
}

func resolveContentAuditStoredPath(baseDir, relativePath string) (string, error) {
	cleaned := filepath.Clean(filepath.FromSlash(relativePath))
	if cleaned == "." || filepath.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid stored content audit path")
	}
	fullPath := filepath.Join(baseDir, cleaned)
	relativeToBase, err := filepath.Rel(baseDir, fullPath)
	if err != nil || relativeToBase == ".." || strings.HasPrefix(relativeToBase, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("stored content audit path escapes its root")
	}
	return fullPath, nil
}
