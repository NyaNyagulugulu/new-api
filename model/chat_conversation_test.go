package model

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type chatConversationLegacy struct {
	Id        string          `gorm:"primaryKey;type:varchar(64)"`
	UserId    int             `gorm:"not null;index:idx_chat_conversations_user_updated,priority:1"`
	Title     string          `gorm:"type:varchar(200);not null;default:''"`
	Messages  json.RawMessage `gorm:"type:json;not null"`
	CreatedAt int64           `gorm:"type:bigint;not null;default:0"`
	UpdatedAt int64           `gorm:"type:bigint;not null;default:0;index:idx_chat_conversations_user_updated,priority:2"`
}

func (chatConversationLegacy) TableName() string {
	return "chat_conversations"
}

func testChatConversationDatabaseMatrix(t *testing.T) {
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
				require.NoError(t, db.Migrator().DropTable(&ChatConversation{}))
				require.NoError(t, db.Migrator().DropTable(&UserPersona{}))
				DB = previousDB
				require.NoError(t, sqlDB.Close())
			})

			require.NoError(t, db.Migrator().DropTable(&ChatConversation{}))
			require.NoError(t, db.AutoMigrate(&chatConversationLegacy{}))
			require.NoError(t, db.Create(&chatConversationLegacy{
				Id:        "legacy-chat",
				UserId:    1,
				Title:     "Legacy chat",
				Messages:  json.RawMessage(`[{"key":"legacy-message"}]`),
				CreatedAt: 1,
				UpdatedAt: 1,
			}).Error)
			require.NoError(t, db.AutoMigrate(&UserPersona{}, &ChatConversation{}))
			require.NoError(t, db.AutoMigrate(&ChatConversation{}))
			assert.True(t, db.Migrator().HasColumn(&ChatConversation{}, "PersonaId"))
			var migrated ChatConversation
			require.NoError(t, db.Where("id = ?", "legacy-chat").First(&migrated).Error)
			assert.Zero(t, migrated.PersonaId)
			require.NoError(t, DeleteChatConversation(context.Background(), 1, "legacy-chat"))
			persona := UserPersona{
				UserId:    1,
				Name:      "Luna",
				Traits:    "Calm and precise",
				CreatedAt: 1,
				UpdatedAt: 1,
			}
			require.NoError(t, db.Create(&persona).Error)

			messages, err := common.Marshal([]map[string]any{
				{
					"key":  "message-1",
					"from": "user",
					"versions": []map[string]any{
						{"id": "version-1", "content": "Hello"},
					},
				},
			})
			require.NoError(t, err)

			session := ChatConversationInput{
				Id:        "chat-1",
				Title:     "First chat",
				PersonaId: persona.Id,
				Messages:  json.RawMessage(messages),
				CreatedAt: 10,
				UpdatedAt: 20,
			}
			require.NoError(t, SyncChatConversations(
				context.Background(),
				1,
				[]ChatConversationInput{session},
			))

			rows, err := ListChatConversations(context.Background(), 1)
			require.NoError(t, err)
			require.Len(t, rows, 1)
			assert.Equal(t, "First chat", rows[0].Title)
			assert.Equal(t, persona.Id, rows[0].PersonaId)
			assert.Equal(t, int64(10), rows[0].StartedAt)
			assert.Equal(t, int64(20), rows[0].LastMessageAt)
			assert.JSONEq(t, string(messages), string(rows[0].Messages))

			otherRows, err := ListChatConversations(context.Background(), 2)
			require.NoError(t, err)
			assert.Empty(t, otherRows)

			session.Title = "Updated chat"
			session.UpdatedAt = 30
			require.NoError(t, SyncChatConversations(
				context.Background(),
				1,
				[]ChatConversationInput{session},
			))
			rows, err = ListChatConversations(context.Background(), 1)
			require.NoError(t, err)
			assert.Equal(t, "Updated chat", rows[0].Title)
			assert.Equal(t, int64(30), rows[0].LastMessageAt)

			staleSession := session
			staleSession.Title = "Stale title"
			staleSession.UpdatedAt = 25
			require.NoError(t, SyncChatConversations(
				context.Background(),
				1,
				[]ChatConversationInput{staleSession},
			))
			rows, err = ListChatConversations(context.Background(), 1)
			require.NoError(t, err)
			assert.Equal(t, "Updated chat", rows[0].Title)

			newerWithoutTitle := session
			newerWithoutTitle.Title = ""
			newerWithoutTitle.UpdatedAt = 40
			newerWithoutTitle.Messages = json.RawMessage(`[{"key":"message-2"}]`)
			require.NoError(t, SyncChatConversations(
				context.Background(),
				1,
				[]ChatConversationInput{newerWithoutTitle},
			))
			rows, err = ListChatConversations(context.Background(), 1)
			require.NoError(t, err)
			assert.Equal(t, "Updated chat", rows[0].Title)
			assert.JSONEq(t, string(newerWithoutTitle.Messages), string(rows[0].Messages))
			assert.Equal(t, int64(40), rows[0].LastMessageAt)

			require.ErrorIs(t, SyncChatConversations(
				context.Background(),
				2,
				[]ChatConversationInput{session},
			), ErrChatConversationForbidden)

			require.NoError(t, DeleteChatConversation(context.Background(), 2, "chat-1"))
			rows, err = ListChatConversations(context.Background(), 1)
			require.NoError(t, err)
			require.Len(t, rows, 1)

			require.NoError(t, SyncChatConversations(
				context.Background(),
				1,
				[]ChatConversationInput{{
					Id:        "chat-2",
					Title:     "Another chat",
					Messages:  json.RawMessage(`[{"key":"message-3"}]`),
					CreatedAt: 50,
					UpdatedAt: 50,
				}},
			))
			rows, err = ListChatConversations(context.Background(), 1)
			require.NoError(t, err)
			require.Len(t, rows, 2)
			assert.Equal(t, "chat-2", rows[0].Id)

			require.NoError(t, DeleteChatConversation(context.Background(), 1, "chat-1"))
			rows, err = ListChatConversations(context.Background(), 1)
			require.NoError(t, err)
			require.Len(t, rows, 1)
			assert.Equal(t, "chat-2", rows[0].Id)
			assert.Equal(t, int64(50), rows[0].LastMessageAt)
		})
	}
}

func TestChatConversationDatabaseMatrix(t *testing.T) {
	testChatConversationDatabaseMatrix(t)
}
