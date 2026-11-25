package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	MaxChatConversationBatchSize = 50
	DefaultChatConversationPage  = 30
	MaxChatConversationPageSize  = 100
	MaxChatConversationIDLen     = 64
	MaxChatConversationTitle     = 200
	MaxChatConversationBytes     = 32 << 20
	MaxChatConversationTotal     = 64 << 20
	chatConversationTableName    = "chat_conversations"
)

var ErrChatConversationForbidden = errors.New("chat conversation belongs to another user")

type ChatConversation struct {
	Id        string          `json:"id" gorm:"primaryKey;type:varchar(64)"`
	UserId    int             `json:"-" gorm:"not null;index:idx_chat_conversations_user_updated,priority:1"`
	Title     string          `json:"title" gorm:"type:varchar(200);not null;default:''"`
	PersonaId int64           `json:"persona_id" gorm:"not null;default:0;index:idx_chat_conversations_user_persona"`
	Messages  json.RawMessage `json:"messages" gorm:"type:json;not null"`
	// Avoid GORM's automatic CreatedAt/UpdatedAt fields so client-provided
	// conversation timestamps are stored exactly as sent.
	StartedAt     int64 `json:"created_at" gorm:"column:created_at;type:bigint;not null;default:0"`
	LastMessageAt int64 `json:"updated_at" gorm:"column:updated_at;type:bigint;not null;default:0;index:idx_chat_conversations_user_updated,priority:2"`
}

func (ChatConversation) TableName() string {
	return chatConversationTableName
}

type ChatConversationInput struct {
	Id        string          `json:"id"`
	Title     string          `json:"title"`
	PersonaId int64           `json:"persona_id"`
	Messages  json.RawMessage `json:"messages"`
	CreatedAt int64           `json:"created_at"`
	UpdatedAt int64           `json:"updated_at"`
}

type ChatConversationSummary struct {
	Id            string `json:"id"`
	Title         string `json:"title"`
	PersonaId     int64  `json:"persona_id"`
	StartedAt     int64  `json:"created_at" gorm:"column:created_at"`
	LastMessageAt int64  `json:"updated_at" gorm:"column:updated_at"`
}

func ValidateChatConversationInput(input *ChatConversationInput) error {
	input.Id = strings.TrimSpace(input.Id)
	input.Title = strings.TrimSpace(input.Title)
	if input.Id == "" || len(input.Id) > MaxChatConversationIDLen {
		return fmt.Errorf("invalid chat conversation id")
	}
	if len(input.Title) > MaxChatConversationTitle {
		return fmt.Errorf("chat conversation title is too long")
	}
	if input.PersonaId < 0 {
		return fmt.Errorf("invalid chat conversation persona")
	}
	if len(input.Messages) == 0 {
		return fmt.Errorf("invalid chat conversation messages")
	}
	if len(input.Messages) > MaxChatConversationBytes {
		return fmt.Errorf("chat conversation is too large")
	}
	var messages []json.RawMessage
	if err := common.Unmarshal(input.Messages, &messages); err != nil {
		return fmt.Errorf("chat conversation messages must be an array: %w", err)
	}
	return nil
}

func ListChatConversations(
	ctx context.Context,
	userId int,
	page int,
	pageSize int,
) ([]ChatConversationSummary, int64, error) {
	base := DB.WithContext(ctx).
		Model(&ChatConversation{}).
		Where("user_id = ?", userId)

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	conversations := make([]ChatConversationSummary, 0, pageSize)
	err := DB.WithContext(ctx).
		Model(&ChatConversation{}).
		Where("user_id = ?", userId).
		Select("id, title, persona_id, created_at, updated_at").
		Order("updated_at DESC").
		Order("id ASC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&conversations).Error
	return conversations, total, err
}

func GetChatConversation(ctx context.Context, userId int, id string) (ChatConversation, error) {
	var conversation ChatConversation
	err := DB.WithContext(ctx).
		Where("user_id = ? AND id = ?", userId, strings.TrimSpace(id)).
		First(&conversation).Error
	return conversation, err
}

func SyncChatConversations(
	ctx context.Context,
	userId int,
	sessions []ChatConversationInput,
) error {
	if userId <= 0 {
		return fmt.Errorf("invalid user")
	}
	if len(sessions) > MaxChatConversationBatchSize {
		return fmt.Errorf("too many chat conversations in one sync batch")
	}

	return DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		totalBytes := 0
		for i := range sessions {
			totalBytes += len(sessions[i].Messages)
		}
		if totalBytes > MaxChatConversationTotal {
			return fmt.Errorf("chat conversation sync is too large")
		}

		for i := range sessions {
			input := sessions[i]
			if err := ValidateChatConversationInput(&input); err != nil {
				return err
			}

			var existing ChatConversation
			err := lockForUpdate(tx).Where("id = ?", input.Id).First(&existing).Error
			switch {
			case errors.Is(err, gorm.ErrRecordNotFound):
				if err := ensureUserPersonaOwned(tx, userId, input.PersonaId); err != nil {
					return err
				}
				now := time.Now().UnixMilli()
				createdAt := input.CreatedAt
				if createdAt <= 0 {
					createdAt = now
				}
				updatedAt := input.UpdatedAt
				if updatedAt <= 0 {
					updatedAt = now
				}
				if err := tx.Create(&ChatConversation{
					Id:            input.Id,
					UserId:        userId,
					Title:         input.Title,
					PersonaId:     input.PersonaId,
					Messages:      input.Messages,
					StartedAt:     createdAt,
					LastMessageAt: updatedAt,
				}).Error; err != nil {
					return err
				}
			case err != nil:
				return err
			case existing.UserId != userId:
				return ErrChatConversationForbidden
			default:
				if err := ensureUserPersonaOwned(tx, userId, input.PersonaId); err != nil {
					return err
				}
				if input.UpdatedAt < existing.LastMessageAt {
					continue
				}
				title := input.Title
				if title == "" {
					title = existing.Title
				}
				updates := map[string]any{
					"title":      title,
					"persona_id": input.PersonaId,
					"messages":   input.Messages,
					"updated_at": input.UpdatedAt,
				}
				if err := tx.Model(&ChatConversation{}).
					Where("id = ? AND user_id = ?", input.Id, userId).
					Updates(updates).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func DeleteChatConversation(ctx context.Context, userId int, id string) error {
	if userId <= 0 {
		return fmt.Errorf("invalid user")
	}
	id = strings.TrimSpace(id)
	if id == "" || len(id) > MaxChatConversationIDLen {
		return fmt.Errorf("invalid chat conversation id")
	}

	return DB.WithContext(ctx).
		Where("user_id = ? AND id = ?", userId, id).
		Delete(&ChatConversation{}).Error
}
