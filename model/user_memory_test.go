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

type userMemoryLegacy struct {
	Id             int64   `gorm:"primaryKey"`
	UserId         int     `gorm:"not null;uniqueIndex:idx_user_memories_user_hash,priority:1;index:idx_user_memories_user_updated,priority:1"`
	ContentHash    string  `gorm:"type:varchar(64);not null;uniqueIndex:idx_user_memories_user_hash,priority:2"`
	Content        string  `gorm:"type:text;not null"`
	Keywords       string  `gorm:"type:text;not null"`
	Category       string  `gorm:"type:varchar(32);not null;default:''"`
	Importance     float64 `gorm:"not null;default:0"`
	ConversationId string  `gorm:"type:varchar(64);not null;default:''"`
	SourceKey      string  `gorm:"type:varchar(128);not null;default:''"`
	Status         string  `gorm:"type:varchar(16);not null;index:idx_user_memories_user_updated,priority:2"`
	CreatedAt      int64   `gorm:"not null;default:0"`
	UpdatedAt      int64   `gorm:"not null;default:0;index:idx_user_memories_user_updated,priority:3"`
}

func (userMemoryLegacy) TableName() string {
	return "user_memories"
}

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
			require.NoError(t, db.Migrator().DropTable(&UserMemory{}))
			require.NoError(t, db.AutoMigrate(&userMemoryLegacy{}))
			require.NoError(t, db.Create(&userMemoryLegacy{
				UserId:      9,
				ContentHash: "legacy",
				Content:     "Legacy memory",
				Status:      UserMemoryStatusActive,
			}).Error)
			require.NoError(t, db.AutoMigrate(&UserMemory{}))
			assert.True(t, db.Migrator().HasColumn(&UserMemory{}, "Embedding"))
			var legacyRows int64
			require.NoError(t, db.Model(&UserMemory{}).Where("user_id = ?", 9).Count(&legacyRows).Error)
			assert.Equal(t, int64(1), legacyRows)

			require.NoError(t, SaveUserMemories(context.Background(), 1, []UserMemoryInput{
				{
					Content:    "The user prefers PostgreSQL for new services.",
					Keywords:   []string{"database", "postgresql"},
					Category:   "preference",
					Importance: 0.9,
					Embedding:  []float64{1, 0, 0},
				},
				{
					Content:    "The user is planning a dashboard redesign.",
					Keywords:   []string{"dashboard", "design"},
					Category:   "plan",
					Importance: 0.7,
					Embedding:  []float64{0, 1, 0},
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

			listed, err := ListUserMemories(context.Background(), 1)
			require.NoError(t, err)
			require.Len(t, listed, 2)
			assert.ElementsMatch(t, []string{
				"The user prefers PostgreSQL for new services.",
				"The user is planning a dashboard redesign.",
			}, []string{listed[0].Content, listed[1].Content})

			memories, err := SearchUserMemories(context.Background(), 1, UserMemorySearchOptions{
				Query:         "database",
				Limit:         5,
				MinImportance: 0.2,
				RetentionDays: 365,
			})
			require.NoError(t, err)
			require.Len(t, memories, 1)
			assert.Contains(t, memories[0].Content, "PostgreSQL")
			assert.Equal(t, 0.95, memories[0].Importance)

			otherMemories, err := SearchUserMemories(context.Background(), 2, UserMemorySearchOptions{
				Limit:         5,
				MinImportance: 0.2,
				RetentionDays: 365,
			})
			require.NoError(t, err)
			require.Len(t, otherMemories, 1)
			require.NoError(t, DeleteUserMemory(context.Background(), 1, otherMemories[0].Id))
			otherMemories, err = SearchUserMemories(context.Background(), 2, UserMemorySearchOptions{
				Limit:         5,
				MinImportance: 0.2,
				RetentionDays: 365,
			})
			require.NoError(t, err)
			assert.Len(t, otherMemories, 1)

			require.NoError(t, DeleteUserMemory(context.Background(), 1, memories[0].Id))
			memories, err = SearchUserMemories(context.Background(), 1, UserMemorySearchOptions{
				Query:         "database",
				Limit:         5,
				MinImportance: 0.2,
				RetentionDays: 365,
			})
			require.NoError(t, err)
			assert.Empty(t, memories)

			var count int64
			require.NoError(t, db.Model(&UserMemory{}).Where("user_id = ?", 1).Count(&count).Error)
			assert.Equal(t, int64(1), count)

			require.NoError(t, SaveUserMemories(context.Background(), 1, []UserMemoryInput{{
				Content:    "Vector memory about PostgreSQL",
				Keywords:   []string{"vector"},
				Category:   "fact",
				Importance: 0.8,
				Embedding:  []float64{1, 0, 0},
			}}))
			vectorMatches, err := SearchUserMemories(context.Background(), 1, UserMemorySearchOptions{
				Embedding:     []float64{1, 0, 0},
				Limit:         1,
				MinImportance: 0.2,
				RetentionDays: 365,
				MinSimilarity: 0.4,
				VectorWeight:  1,
			})
			require.NoError(t, err)
			require.Len(t, vectorMatches, 1)
			assert.Contains(t, vectorMatches[0].Content, "PostgreSQL")

			deleted, err := DeleteAllUserMemories(context.Background(), 1)
			require.NoError(t, err)
			assert.Equal(t, int64(2), deleted)
			listed, err = ListUserMemories(context.Background(), 1)
			require.NoError(t, err)
			assert.Empty(t, listed)
			require.NoError(t, db.Model(&UserMemory{}).Where("user_id = ?", 2).Count(&count).Error)
			assert.Equal(t, int64(1), count)
		})
	}
}

func TestUserMemoryDatabaseMatrix(t *testing.T) {
	testUserMemoryDatabaseMatrix(t)
}
