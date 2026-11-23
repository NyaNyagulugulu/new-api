package model

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
	"unicode"

	"gorm.io/gorm"
)

const (
	UserMemoryStatusActive = "active"
	MaxUserMemoriesPerSave = 20
	MaxUserMemoryContent   = 4_000
	MaxUserMemoryKeywords  = 1_000
)

type UserMemory struct {
	Id             int64   `json:"id" gorm:"primaryKey"`
	UserId         int     `json:"-" gorm:"not null;uniqueIndex:idx_user_memories_user_hash,priority:1;index:idx_user_memories_user_updated,priority:1"`
	ContentHash    string  `json:"-" gorm:"type:varchar(64);not null;uniqueIndex:idx_user_memories_user_hash,priority:2"`
	Content        string  `json:"content" gorm:"type:text;not null"`
	Keywords       string  `json:"keywords" gorm:"type:text;not null"`
	Category       string  `json:"category" gorm:"type:varchar(32);not null;default:''"`
	Importance     float64 `json:"importance" gorm:"not null;default:0"`
	ConversationId string  `json:"conversation_id" gorm:"type:varchar(64);not null;default:''"`
	SourceKey      string  `json:"source_key" gorm:"type:varchar(128);not null;default:''"`
	Status         string  `json:"status" gorm:"type:varchar(16);not null;index:idx_user_memories_user_updated,priority:2"`
	CreatedAt      int64   `json:"created_at" gorm:"not null;default:0"`
	UpdatedAt      int64   `json:"updated_at" gorm:"not null;default:0;index:idx_user_memories_user_updated,priority:3"`
}

type UserMemoryInput struct {
	Content        string   `json:"content"`
	Keywords       []string `json:"keywords"`
	Category       string   `json:"category"`
	Importance     float64  `json:"importance"`
	ConversationId string   `json:"conversation_id"`
	SourceKey      string   `json:"source_key"`
}

func hashUserMemoryContent(content string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.Join(strings.Fields(content), " "))))
	return hex.EncodeToString(sum[:])
}

func normalizeMemoryKeywords(keywords []string) string {
	seen := make(map[string]struct{}, len(keywords))
	normalized := make([]string, 0, len(keywords))
	for _, keyword := range keywords {
		keyword = strings.TrimSpace(keyword)
		key := strings.ToLower(keyword)
		if keyword == "" || len(keyword) > 64 {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, keyword)
		if len(normalized) >= 12 {
			break
		}
	}
	return strings.Join(normalized, ",")
}

func ValidateUserMemoryInput(input *UserMemoryInput) error {
	input.Content = strings.TrimSpace(input.Content)
	input.Category = strings.TrimSpace(input.Category)
	input.ConversationId = strings.TrimSpace(input.ConversationId)
	input.SourceKey = strings.TrimSpace(input.SourceKey)
	if input.Content == "" || len(input.Content) > MaxUserMemoryContent {
		return fmt.Errorf("invalid memory content")
	}
	if math.IsNaN(input.Importance) || math.IsInf(input.Importance, 0) {
		return fmt.Errorf("invalid memory importance")
	}
	input.Importance = min(max(input.Importance, 0), 1)
	if len(normalizeMemoryKeywords(input.Keywords)) > MaxUserMemoryKeywords {
		return fmt.Errorf("memory keywords are too long")
	}
	if len(input.ConversationId) > 64 || len(input.SourceKey) > 128 {
		return fmt.Errorf("invalid memory metadata")
	}
	return nil
}

func SaveUserMemories(ctx context.Context, userId int, inputs []UserMemoryInput) error {
	if userId <= 0 {
		return fmt.Errorf("invalid user")
	}
	if len(inputs) == 0 || len(inputs) > MaxUserMemoriesPerSave {
		return fmt.Errorf("invalid memory batch size")
	}

	now := time.Now().UnixMilli()
	return DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for i := range inputs {
			input := inputs[i]
			if err := ValidateUserMemoryInput(&input); err != nil {
				return err
			}
			hash := hashUserMemoryContent(input.Content)
			var existing UserMemory
			err := lockForUpdate(tx).
				Where("user_id = ? AND content_hash = ?", userId, hash).
				First(&existing).Error
			switch {
			case err == nil:
				updates := map[string]any{
					"importance":      max(existing.Importance, input.Importance),
					"keywords":        normalizeMemoryKeywords(append(splitMemoryKeywords(existing.Keywords), input.Keywords...)),
					"category":        input.Category,
					"conversation_id": input.ConversationId,
					"source_key":      input.SourceKey,
					"status":          UserMemoryStatusActive,
					"updated_at":      now,
				}
				if err := tx.Model(&UserMemory{}).
					Where("id = ? AND user_id = ?", existing.Id, userId).
					Updates(updates).Error; err != nil {
					return err
				}
			case errors.Is(err, gorm.ErrRecordNotFound):
				if err := tx.Create(&UserMemory{
					UserId:         userId,
					ContentHash:    hash,
					Content:        input.Content,
					Keywords:       normalizeMemoryKeywords(input.Keywords),
					Category:       input.Category,
					Importance:     input.Importance,
					ConversationId: input.ConversationId,
					SourceKey:      input.SourceKey,
					Status:         UserMemoryStatusActive,
					CreatedAt:      now,
					UpdatedAt:      now,
				}).Error; err != nil {
					return err
				}
			default:
				return err
			}
		}
		return nil
	})
}

func splitMemoryKeywords(value string) []string {
	return strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '，'
	})
}

func memoryQueryTokens(query string) []string {
	normalized := strings.ToLower(strings.TrimSpace(query))
	if normalized == "" {
		return nil
	}
	tokens := make([]string, 0)
	seen := make(map[string]struct{})
	add := func(token string) {
		token = strings.TrimSpace(token)
		if len(token) < 2 {
			return
		}
		if _, ok := seen[token]; ok {
			return
		}
		seen[token] = struct{}{}
		tokens = append(tokens, token)
	}

	var latin strings.Builder
	var cjk []rune
	flushLatin := func() {
		add(latin.String())
		latin.Reset()
	}
	flushCJK := func() {
		for i := range cjk {
			add(string(cjk[i]))
			if i > 0 {
				add(string(cjk[i-1 : i+1]))
			}
		}
		cjk = cjk[:0]
	}
	for _, r := range normalized {
		switch {
		case unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r):
			flushLatin()
			cjk = append(cjk, r)
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			flushCJK()
			latin.WriteRune(r)
		default:
			flushLatin()
			flushCJK()
		}
	}
	flushLatin()
	flushCJK()
	return tokens
}

func scoreUserMemory(memory UserMemory, tokens []string, query string, now int64) (float64, bool) {
	content := strings.ToLower(memory.Content)
	keywords := strings.ToLower(memory.Keywords)
	relevance := 0.0
	score := memory.Importance * 2
	for _, token := range tokens {
		if strings.Contains(content, token) {
			score += 2
			relevance += 2
		}
		if strings.Contains(keywords, token) {
			score += 3
			relevance += 3
		}
	}
	if query != "" && strings.Contains(content, strings.ToLower(query)) {
		score += 5
		relevance += 5
	}
	ageDays := max(float64(now-memory.UpdatedAt)/86_400_000, 0)
	score += math.Exp(-ageDays / 90)
	return score, query == "" || relevance > 0
}

func SearchUserMemories(
	ctx context.Context,
	userId int,
	query string,
	limit int,
	minImportance float64,
	retentionDays int,
) ([]UserMemory, error) {
	if userId <= 0 {
		return nil, fmt.Errorf("invalid user")
	}
	limit = max(1, min(limit, 50))
	now := time.Now().UnixMilli()
	cutoff := now - int64(max(retentionDays, 1))*86_400_000
	memories := make([]UserMemory, 0)
	err := DB.WithContext(ctx).
		Where("user_id = ? AND status = ? AND importance >= ? AND updated_at >= ?",
			userId, UserMemoryStatusActive, max(minImportance, 0), cutoff).
		Order("updated_at DESC").
		Limit(500).
		Find(&memories).Error
	if err != nil {
		return nil, err
	}

	tokens := memoryQueryTokens(query)
	if query != "" {
		filtered := memories[:0]
		for _, memory := range memories {
			if _, matched := scoreUserMemory(memory, tokens, query, now); matched {
				filtered = append(filtered, memory)
			}
		}
		memories = filtered
	}
	sort.SliceStable(memories, func(i, j int) bool {
		left, _ := scoreUserMemory(memories[i], tokens, query, now)
		right, _ := scoreUserMemory(memories[j], tokens, query, now)
		if left == right {
			return memories[i].UpdatedAt > memories[j].UpdatedAt
		}
		return left > right
	})
	if len(memories) > limit {
		memories = memories[:limit]
	}
	return memories, nil
}

func DeleteUserMemory(ctx context.Context, userId int, id int64) error {
	if userId <= 0 || id <= 0 {
		return fmt.Errorf("invalid memory")
	}
	return DB.WithContext(ctx).
		Where("id = ? AND user_id = ?", id, userId).
		Delete(&UserMemory{}).Error
}
