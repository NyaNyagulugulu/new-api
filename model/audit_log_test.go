package model

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/schema"
)

func TestContentAuditLogDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "content_audit_matrix_"}})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			versionSQL := "SELECT version()"
			if dialect == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
			t.Logf("database version: %s", version)

			previousDB := DB
			DB = db
			t.Cleanup(func() {
				DB = previousDB
				assert.NoError(t, db.Migrator().DropTable(&ContentAuditLog{}))
				assert.NoError(t, sqlDB.Close())
			})

			for range 2 {
				require.NoError(t, MigrateContentAuditLogs())
			}
			now := common.GetTimestamp()
			entries := []*ContentAuditLog{
				{EventId: "content-event-chat", UserId: 1, Username: "alice", CreatedAt: now - 20, RequestPreview: "retained keyword in chat", ResponsePreview: "chat answer", Kind: "chat", ModelName: "gpt-audit", Success: true},
				{EventId: "content-event-image", UserId: 2, Username: "bob", CreatedAt: now - 10, RequestPreview: "image prompt", ResponsePreview: "retained keyword in image", Kind: "image", ModelName: "image-audit", Success: false, ResponseFile: "image/response.bin"},
				{EventId: "content-event-expired", UserId: 1, Username: "alice", CreatedAt: 1, ExpiresAt: 2, Kind: "other", ModelName: "old-audit"},
			}
			for _, entry := range entries {
				require.NoError(t, CreateContentAuditLog(entry))
			}
			assert.Error(t, db.Create(&ContentAuditLog{EventId: "content-event-chat"}).Error, "event IDs must remain unique")

			logs, total, err := GetContentAuditLogs(ContentAuditFilter{Query: "retained keyword"}, 0, 10)
			require.NoError(t, err)
			assert.EqualValues(t, 2, total)
			require.Len(t, logs, 2)
			assert.Equal(t, "content-event-image", logs[0].EventId, "newest records sort first")
			assert.True(t, logs[0].HasResponse)

			logs, total, err = GetContentAuditLogs(ContentAuditFilter{Kind: "chat"}, 0, 10)
			require.NoError(t, err)
			assert.EqualValues(t, 1, total)
			require.Len(t, logs, 1)
			assert.Equal(t, "content-event-chat", logs[0].EventId)
			assert.Equal(t, now-20+common.ContentAuditRetentionSeconds(), logs[0].ExpiresAt)

			entry, err := GetContentAuditLogByEventId("content-event-image")
			require.NoError(t, err)
			assert.Equal(t, "image-audit", entry.ModelName)

			expired, err := GetExpiredContentAuditLogs(context.Background(), now-1, 10)
			require.NoError(t, err)
			require.Len(t, expired, 1)
			assert.Equal(t, "content-event-expired", expired[0].EventId)
			deleted, err := DeleteContentAuditLogs(context.Background(), []int64{expired[0].Id})
			require.NoError(t, err)
			assert.EqualValues(t, 1, deleted)
		})
	}
}

// TestAuditLogSortIndexDatabaseMatrix verifies audit ordering and index migrations across supported databases.
func TestAuditLogSortIndexDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "audit_sort_test_"}})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			previousType := common.LogDatabaseType()
			common.SetLogDatabaseType(common.DatabaseType(dialect))
			t.Cleanup(func() {
				common.SetLogDatabaseType(previousType)
				assert.NoError(t, sqlDB.Close())
			})
			versionSQL := "SELECT version()"
			if dialect == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
			t.Logf("database version: %s", version)
			for _, upgrade := range []bool{false, true} {
				t.Run(fmt.Sprintf("upgrade=%v", upgrade), func(t *testing.T) {
					db := db
					if dialect == "postgres" {
						db = db.Begin()
						require.NoError(t, db.Error)
						t.Cleanup(func() { assert.NoError(t, db.Rollback().Error) })
						schemaName := fmt.Sprintf("audit_sort_test_%d", time.Now().UnixNano())
						require.NoError(t, db.Exec("CREATE SCHEMA ?", clause.Table{Name: schemaName}).Error)
						require.NoError(t, db.Exec("SET LOCAL search_path TO ?", clause.Table{Name: schemaName}).Error)
					} else {
						t.Cleanup(func() { assert.NoError(t, db.Migrator().DropTable(&AuditLog{})) })
					}
					previousLogDB := LOG_DB
					LOG_DB = db
					t.Cleanup(func() { LOG_DB = previousLogDB })
					require.NoError(t, MigrateAuditLogs())
					if upgrade {
						require.NoError(t, db.Migrator().DropIndex(&AuditLog{}, "idx_audit_time_event"))
					}
					entries := []AuditLog{
						{EventId: "event-older", CreatedAt: 100, UserId: 1, ActorRole: common.RoleCommonUser},
						{EventId: "event-a", CreatedAt: 200, UserId: 1, ActorRole: common.RoleCommonUser},
						{EventId: "event-z", CreatedAt: 200, UserId: 1, ActorRole: common.RoleCommonUser},
					}
					require.NoError(t, db.Create(&entries).Error)
					originalIndexes, err := db.Migrator().GetIndexes(&AuditLog{})
					require.NoError(t, err)
					for range 2 {
						require.NoError(t, MigrateAuditLogs())
					}
					indexes, err := db.Migrator().GetIndexes(&AuditLog{})
					require.NoError(t, err)
					byName := make(map[string]gorm.Index, len(indexes))
					for _, index := range indexes {
						byName[index.Name()] = index
					}
					index, ok := byName["idx_audit_time_event"]
					require.True(t, ok, "migration must create the audit ordering index")
					var columns []string
					if dialect == "postgres" {
						// GORM's PostgreSQL GetIndexes does not preserve index key order.
						require.NoError(t, db.Raw(`
SELECT attribute.attname
FROM pg_catalog.pg_index AS index_meta
CROSS JOIN LATERAL unnest(index_meta.indkey) WITH ORDINALITY AS index_column(attnum, ordinal_position)
JOIN pg_catalog.pg_attribute AS attribute
  ON attribute.attrelid = index_meta.indrelid AND attribute.attnum = index_column.attnum
WHERE index_meta.indexrelid = to_regclass(?)
ORDER BY index_column.ordinal_position
`, index.Name()).Scan(&columns).Error)
					} else {
						columns = index.Columns()
					}
					assert.Equal(t, []string{"created_at", "event_id"}, columns)
					for _, original := range originalIndexes {
						preserved, ok := byName[original.Name()]
						require.True(t, ok, "existing index %s must remain", original.Name())
						assert.Equal(t, original.Columns(), preserved.Columns(), original.Name())
						originalUnique, originalKnown := original.Unique()
						preservedUnique, preservedKnown := preserved.Unique()
						assert.Equal(t, originalKnown, preservedKnown, original.Name())
						assert.Equal(t, originalUnique, preservedUnique, original.Name())
					}
					var stored []AuditLog
					require.NoError(t, db.Order("id").Find(&stored).Error)
					assert.Equal(t, entries, stored, "migration must preserve existing audit records")
					logs, total, err := GetAuditLogs(AuditLogFilter{}, 0, 2, common.RoleRootUser)
					require.NoError(t, err)
					assert.EqualValues(t, 3, total)
					require.Len(t, logs, 2)
					assert.Equal(t, []string{"event-z", "event-a"}, []string{logs[0].EventId, logs[1].EventId})
					logs, total, err = GetAuditLogs(AuditLogFilter{}, 2, 2, common.RoleRootUser)
					require.NoError(t, err)
					assert.EqualValues(t, 3, total)
					require.Len(t, logs, 1)
					assert.Equal(t, "event-older", logs[0].EventId)
					assert.Error(t, db.Create(&AuditLog{EventId: "event-a"}).Error, "event IDs must remain unique")
				})
			}
		})
	}
}
