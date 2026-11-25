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

func testUserPersonaDatabaseMatrix(t *testing.T) {
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
				require.NoError(t, db.Migrator().DropTable(&ChatConversation{}))
				require.NoError(t, db.Migrator().DropTable(&UserPersona{}))
				DB = previousDB
				require.NoError(t, sqlDB.Close())
			})

			require.NoError(t, db.AutoMigrate(&UserPersona{}, &UserMemory{}, &ChatConversation{}))
			require.NoError(t, db.AutoMigrate(&UserPersona{}, &UserMemory{}, &ChatConversation{}))
			require.ErrorIs(t, DeleteUserPersona(context.Background(), 1, 0), ErrUserPersonaNotFound)

			persona, err := CreateUserPersona(context.Background(), 1, UserPersonaInput{
				Name:   " Luna ",
				Traits: " Calm, precise, and curious. ",
			})
			require.NoError(t, err)
			assert.NotZero(t, persona.Id)
			assert.Equal(t, "Luna", persona.Name)
			assert.Equal(t, "Calm, precise, and curious.", persona.Traits)

			personas, err := ListUserPersonas(context.Background(), 1)
			require.NoError(t, err)
			require.Len(t, personas, 1)
			assert.Equal(t, persona.Id, personas[0].Id)

			require.NoError(t, UpdateUserPersona(context.Background(), 1, persona.Id, UserPersonaInput{
				Name:   "Luna",
				Traits: "Updated traits",
			}))
			require.ErrorIs(t, UpdateUserPersona(context.Background(), 2, persona.Id, UserPersonaInput{
				Name:   "Other",
				Traits: "",
			}), ErrUserPersonaNotFound)
			require.ErrorIs(t, DeleteUserPersona(context.Background(), 2, persona.Id), ErrUserPersonaNotFound)

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
			require.NoError(t, SyncChatConversations(context.Background(), 1, []ChatConversationInput{{
				Id:        "chat-persona",
				Title:     "Persona chat",
				PersonaId: persona.Id,
				Messages:  json.RawMessage(messages),
				CreatedAt: 1,
				UpdatedAt: 1,
			}}))
			require.NoError(t, SaveUserMemories(context.Background(), 1, []UserMemoryInput{{
				Content:    "Persona-specific memory",
				Category:   "fact",
				PersonaId:  persona.Id,
				Importance: 0.8,
			}}))

			require.NoError(t, DeleteUserPersona(context.Background(), 1, persona.Id))
			personas, err = ListUserPersonas(context.Background(), 1)
			require.NoError(t, err)
			assert.Empty(t, personas)

			conversations, err := ListChatConversations(context.Background(), 1)
			require.NoError(t, err)
			require.Len(t, conversations, 1)
			assert.Zero(t, conversations[0].PersonaId)

			var memoryCount int64
			require.NoError(t, db.Model(&UserMemory{}).Where("user_id = ?", 1).Count(&memoryCount).Error)
			assert.Zero(t, memoryCount)
		})
	}
}

func TestUserPersonaDatabaseMatrix(t *testing.T) {
	testUserPersonaDatabaseMatrix(t)
}
