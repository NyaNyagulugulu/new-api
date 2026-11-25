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

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	UserMemoryStatusActive = "active"
	MaxUserMemoriesPerSave = 20
	MaxUserMemoryContent   = 4_000
	MaxUserMemoryKeywords  = 1_000
	MaxUserMemoryEmbedding = 4_096
)

type UserMemory struct {
	Id             int64   `json:"id" gorm:"primaryKey"`
	UserId         int     `json:"-" gorm:"not null;uniqueIndex:idx_user_memories_user_hash,priority:1;index:idx_user_memories_user_updated,priority:1"`
	ContentHash    string  `json:"-" gorm:"type:varchar(64);not null;uniqueIndex:idx_user_memories_user_hash,priority:2"`
	Content        string  `json:"content" gorm:"type:text;not null"`
	Keywords       string  `json:"keywords" gorm:"type:text;not null"`
	Category       string  `json:"category" gorm:"type:varchar(32);not null;default:''"`
	Importance     float64 `json:"importance" gorm:"not null;default:0"`
	PersonaId      int64   `json:"persona_id" gorm:"not null;default:0;index:idx_user_memories_user_persona"`
	ConversationId string  `json:"conversation_id" gorm:"type:varchar(64);not null;default:''"`
	SourceKey      string  `json:"source_key" gorm:"type:varchar(128);not null;default:''"`
	Status         string  `json:"status" gorm:"type:varchar(16);not null;index:idx_user_memories_user_updated,priority:2"`
	CreatedAt      int64   `json:"created_at" gorm:"not null;default:0"`
	UpdatedAt      int64   `json:"updated_at" gorm:"not null;default:0;index:idx_user_memories_user_updated,priority:3"`
	Embedding      string  `json:"-" gorm:"type:text"`
}

type UserMemoryInput struct {
	Content        string    `json:"content"`
	Keywords       []string  `json:"keywords"`
	Category       string    `json:"category"`
	Importance     float64   `json:"importance"`
	PersonaId      int64     `json:"persona_id"`
	ConversationId string    `json:"conversation_id"`
	SourceKey      string    `json:"source_key"`
	Embedding      []float64 `json:"embedding"`
}

type UserMemorySearchOptions struct {
	Query         string
	Embedding     []float64
	PersonaId     int64
	Limit         int
	MinImportance float64
	RetentionDays int
	MinSimilarity float64
	VectorWeight  float64
}

func hashUserMemoryContent(personaId int64, content string) string {
	normalized := strings.ToLower(strings.Join(strings.Fields(content), " "))
	if personaId > 0 {
		normalized = fmt.Sprintf("%d:%s", personaId, normalized)
	}
	sum := sha256.Sum256([]byte(normalized))
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
	if input.PersonaId < 0 {
		return fmt.Errorf("invalid memory persona")
	}
	input.Importance = min(max(input.Importance, 0), 1)
	if len(normalizeMemoryKeywords(input.Keywords)) > MaxUserMemoryKeywords {
		return fmt.Errorf("memory keywords are too long")
	}
	if len(input.ConversationId) > 64 || len(input.SourceKey) > 128 {
		return fmt.Errorf("invalid memory metadata")
	}
	return ValidateUserMemoryEmbedding(input.Embedding)
}

func ValidateUserMemoryEmbedding(embedding []float64) error {
	if len(embedding) > MaxUserMemoryEmbedding {
		return fmt.Errorf("memory embedding is too large")
	}
	for _, value := range embedding {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return fmt.Errorf("invalid memory embedding")
		}
	}
	return nil
}

func encodeMemoryEmbedding(values []float64) string {
	if len(values) == 0 {
		return ""
	}
	encoded, err := common.Marshal(values)
	if err != nil {
		return ""
	}
	return string(encoded)
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
			if err := ensureUserPersonaOwned(tx, userId, input.PersonaId); err != nil {
				return err
			}
			hash := hashUserMemoryContent(input.PersonaId, input.Content)
			embedding := encodeMemoryEmbedding(input.Embedding)
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
					"persona_id":      input.PersonaId,
					"conversation_id": input.ConversationId,
					"source_key":      input.SourceKey,
					"status":          UserMemoryStatusActive,
					"updated_at":      now,
				}
				if embedding != "" {
					updates["embedding"] = embedding
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
					PersonaId:      input.PersonaId,
					ConversationId: input.ConversationId,
					SourceKey:      input.SourceKey,
					Status:         UserMemoryStatusActive,
					CreatedAt:      now,
					UpdatedAt:      now,
					Embedding:      embedding,
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

func cosineSimilarity(left, right []float64) float64 {
	if len(left) == 0 || len(left) != len(right) {
		return 0
	}
	var dot, leftNorm, rightNorm float64
	for index := range left {
		dot += left[index] * right[index]
		leftNorm += left[index] * left[index]
		rightNorm += right[index] * right[index]
	}
	if leftNorm <= 0 || rightNorm <= 0 {
		return 0
	}
	return dot / (math.Sqrt(leftNorm) * math.Sqrt(rightNorm))
}

func decodeMemoryEmbedding(value string) []float64 {
	if value == "" {
		return nil
	}
	var embedding []float64
	if err := common.UnmarshalJsonStr(value, &embedding); err != nil {
		return nil
	}
	return embedding
}

func scoreUserMemory(
	memory UserMemory,
	tokens []string,
	query string,
	queryEmbedding []float64,
	now int64,
	minSimilarity float64,
	vectorWeight float64,
) (float64, bool) {
	content := strings.ToLower(memory.Content)
	keywords := strings.ToLower(memory.Keywords)
	relevance := 0.0
	keywordScore := 0.0
	for _, token := range tokens {
		if strings.Contains(content, token) {
			keywordScore += 2
			relevance += 2
		}
		if strings.Contains(keywords, token) {
			keywordScore += 3
			relevance += 3
		}
	}
	if query != "" && strings.Contains(content, strings.ToLower(query)) {
		keywordScore += 5
		relevance += 5
	}
	similarity := 0.0
	if len(queryEmbedding) > 0 {
		similarity = max(cosineSimilarity(queryEmbedding, decodeMemoryEmbedding(memory.Embedding)), 0)
	}
	vectorWeight = min(max(vectorWeight, 0), 1)
	score := keywordScore*(1-vectorWeight) + similarity*8*vectorWeight +
		memory.Importance*2
	ageDays := max(float64(now-memory.UpdatedAt)/86_400_000, 0)
	score += math.Exp(-ageDays / 90)
	matched := query == ""
	if query != "" {
		matched = relevance > 0 ||
			(len(queryEmbedding) > 0 && similarity >= max(minSimilarity, 0))
	}
	return score, matched
}

func SearchUserMemories(ctx context.Context, userId int, options UserMemorySearchOptions) ([]UserMemory, error) {
	if userId <= 0 {
		return nil, fmt.Errorf("invalid user")
	}
	if err := ValidateUserMemoryEmbedding(options.Embedding); err != nil {
		return nil, err
	}
	limit := max(1, min(options.Limit, 50))
	now := time.Now().UnixMilli()
	cutoff := now - int64(max(options.RetentionDays, 1))*86_400_000
	memories := make([]UserMemory, 0)
	err := DB.WithContext(ctx).
		Where("user_id = ? AND persona_id = ? AND status = ? AND importance >= ? AND updated_at >= ?",
			userId, max(options.PersonaId, 0), UserMemoryStatusActive, max(options.MinImportance, 0), cutoff).
		Order("updated_at DESC").
		Limit(500).
		Find(&memories).Error
	if err != nil {
		return nil, err
	}

	tokens := memoryQueryTokens(options.Query)
	if options.Query != "" {
		filtered := memories[:0]
		for _, memory := range memories {
			if _, matched := scoreUserMemory(
				memory,
				tokens,
				options.Query,
				options.Embedding,
				now,
				options.MinSimilarity,
				options.VectorWeight,
			); matched {
				filtered = append(filtered, memory)
			}
		}
		memories = filtered
	}
	sort.SliceStable(memories, func(i, j int) bool {
		left, _ := scoreUserMemory(
			memories[i],
			tokens,
			options.Query,
			options.Embedding,
			now,
			options.MinSimilarity,
			options.VectorWeight,
		)
		right, _ := scoreUserMemory(
			memories[j],
			tokens,
			options.Query,
			options.Embedding,
			now,
			options.MinSimilarity,
			options.VectorWeight,
		)
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

func ListUserMemories(ctx context.Context, userId int) ([]UserMemory, error) {
	if userId <= 0 {
		return nil, fmt.Errorf("invalid user")
	}
	memories := make([]UserMemory, 0)
	err := DB.WithContext(ctx).
		Where("user_id = ? AND status = ?", userId, UserMemoryStatusActive).
		Order("updated_at DESC").
		Find(&memories).Error
	return memories, err
}

func DeleteUserMemory(ctx context.Context, userId int, id int64) error {
	if userId <= 0 || id <= 0 {
		return fmt.Errorf("invalid memory")
	}
	return DB.WithContext(ctx).
		Where("id = ? AND user_id = ?", id, userId).
		Delete(&UserMemory{}).Error
}

func DeleteAllUserMemories(ctx context.Context, userId int) (int64, error) {
	if userId <= 0 {
		return 0, fmt.Errorf("invalid user")
	}
	result := DB.WithContext(ctx).
		Where("user_id = ?", userId).
		Delete(&UserMemory{})
	return result.RowsAffected, result.Error
}

func DeleteUserMemoriesForPersona(ctx context.Context, userId int, personaId int64) (int64, error) {
	if userId <= 0 || personaId < 0 {
		return 0, fmt.Errorf("invalid memory scope")
	}
	result := DB.WithContext(ctx).
		Where("user_id = ? AND persona_id = ?", userId, personaId).
		Delete(&UserMemory{})
	return result.RowsAffected, result.Error
}
