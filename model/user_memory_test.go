package model

import (
	"context"
	"os"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func testUserMemoryDatabaseMatrix(t *testing.T) {
	t.Helper()
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(dsn)
			}

			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)

			previousDB := DB
			DB = db
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&UserMemory{}))
				DB = previousDB
				require.NoError(t, sqlDB.Close())
			})
			require.NoError(t, db.AutoMigrate(&UserMemory{}))
			require.NoError(t, db.AutoMigrate(&UserMemory{}))

			require.NoError(t, SaveUserMemories(context.Background(), 1, []UserMemoryInput{
				{
					Content:    "The user prefers PostgreSQL for new services.",
					Keywords:   []string{"database", "postgresql"},
					Category:   "preference",
					Importance: 0.9,
				},
				{
					Content:    "The user is planning a dashboard redesign.",
					Keywords:   []string{"dashboard", "design"},
					Category:   "plan",
					Importance: 0.7,
				},
			}))
			require.NoError(t, SaveUserMemories(context.Background(), 1, []UserMemoryInput{{
				Content:    "The user prefers PostgreSQL for new services.",
				Keywords:   []string{"database"},
				Category:   "preference",
				Importance: 0.95,
			}}))
			require.NoError(t, SaveUserMemories(context.Background(), 2, []UserMemoryInput{{
				Content:    "Another user's private memory.",
				Keywords:   []string{"private"},
				Category:   "fact",
				Importance: 0.8,
			}}))

			memories, err := SearchUserMemories(context.Background(), 1, "database", 5, 0.2, 365)
			require.NoError(t, err)
			require.Len(t, memories, 1)
			assert.Contains(t, memories[0].Content, "PostgreSQL")
			assert.Equal(t, 0.95, memories[0].Importance)

			otherMemories, err := SearchUserMemories(context.Background(), 2, "", 5, 0.2, 365)
			require.NoError(t, err)
			require.Len(t, otherMemories, 1)
			require.NoError(t, DeleteUserMemory(context.Background(), 1, otherMemories[0].Id))
			otherMemories, err = SearchUserMemories(context.Background(), 2, "", 5, 0.2, 365)
			require.NoError(t, err)
			assert.Len(t, otherMemories, 1)

			require.NoError(t, DeleteUserMemory(context.Background(), 1, memories[0].Id))
			memories, err = SearchUserMemories(context.Background(), 1, "database", 5, 0.2, 365)
			require.NoError(t, err)
			assert.Empty(t, memories)

			var count int64
			require.NoError(t, db.Model(&UserMemory{}).Where("user_id = ?", 1).Count(&count).Error)
			assert.Equal(t, int64(1), count)
		})
	}
}

func TestUserMemoryDatabaseMatrix(t *testing.T) {
	testUserMemoryDatabaseMatrix(t)
}
