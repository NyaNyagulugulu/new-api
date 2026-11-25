package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
)

const (
	MaxUserPersonas      = 50
	MaxUserPersonaName   = 80
	MaxUserPersonaTraits = 4_000
)

var ErrUserPersonaNotFound = errors.New("user persona not found")

type UserPersona struct {
	Id        int64  `json:"id" gorm:"primaryKey"`
	UserId    int    `json:"-" gorm:"not null;index:idx_user_personas_user_updated,priority:1"`
	Name      string `json:"name" gorm:"type:varchar(80);not null"`
	Traits    string `json:"traits" gorm:"type:text;not null"`
	CreatedAt int64  `json:"created_at" gorm:"not null;default:0"`
	UpdatedAt int64  `json:"updated_at" gorm:"not null;default:0;index:idx_user_personas_user_updated,priority:2"`
}

type UserPersonaInput struct {
	Name   string `json:"name"`
	Traits string `json:"traits"`
}

func ValidateUserPersonaInput(input *UserPersonaInput) error {
	input.Name = strings.TrimSpace(input.Name)
	input.Traits = strings.TrimSpace(input.Traits)
	if input.Name == "" || utf8.RuneCountInString(input.Name) > MaxUserPersonaName {
		return fmt.Errorf("invalid persona name")
	}
	if utf8.RuneCountInString(input.Traits) > MaxUserPersonaTraits {
		return fmt.Errorf("persona traits are too long")
	}
	return nil
}

func ListUserPersonas(ctx context.Context, userId int) ([]UserPersona, error) {
	if userId <= 0 {
		return nil, fmt.Errorf("invalid user")
	}
	personas := make([]UserPersona, 0)
	err := DB.WithContext(ctx).
		Where("user_id = ?", userId).
		Order("updated_at DESC").
		Order("id DESC").
		Limit(MaxUserPersonas).
		Find(&personas).Error
	return personas, err
}

func CreateUserPersona(
	ctx context.Context,
	userId int,
	input UserPersonaInput,
) (UserPersona, error) {
	if userId <= 0 {
		return UserPersona{}, fmt.Errorf("invalid user")
	}
	if err := ValidateUserPersonaInput(&input); err != nil {
		return UserPersona{}, err
	}

	var persona UserPersona
	err := DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&UserPersona{}).Where("user_id = ?", userId).Count(&count).Error; err != nil {
			return err
		}
		if count >= MaxUserPersonas {
			return fmt.Errorf("too many personas")
		}
		now := time.Now().UnixMilli()
		persona = UserPersona{
			UserId:    userId,
			Name:      input.Name,
			Traits:    input.Traits,
			CreatedAt: now,
			UpdatedAt: now,
		}
		return tx.Create(&persona).Error
	})
	return persona, err
}

func UpdateUserPersona(
	ctx context.Context,
	userId int,
	id int64,
	input UserPersonaInput,
) error {
	if userId <= 0 || id <= 0 {
		return ErrUserPersonaNotFound
	}
	if err := ValidateUserPersonaInput(&input); err != nil {
		return err
	}
	result := DB.WithContext(ctx).
		Model(&UserPersona{}).
		Where("id = ? AND user_id = ?", id, userId).
		Updates(map[string]any{
			"name":       input.Name,
			"traits":     input.Traits,
			"updated_at": time.Now().UnixMilli(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrUserPersonaNotFound
	}
	return nil
}

func DeleteUserPersona(ctx context.Context, userId int, id int64) error {
	if userId <= 0 || id <= 0 {
		return ErrUserPersonaNotFound
	}
	return DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var persona UserPersona
		if err := tx.Where("id = ? AND user_id = ?", id, userId).First(&persona).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrUserPersonaNotFound
			}
			return err
		}
		if err := tx.Where("user_id = ? AND persona_id = ?", userId, id).
			Delete(&UserMemory{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&ChatConversation{}).
			Where("user_id = ? AND persona_id = ?", userId, id).
			Update("persona_id", 0).Error; err != nil {
			return err
		}
		return tx.Delete(&persona).Error
	})
}

func ensureUserPersonaOwned(tx *gorm.DB, userId int, personaId int64) error {
	if personaId < 0 {
		return fmt.Errorf("invalid persona")
	}
	if personaId == 0 {
		return nil
	}
	var count int64
	if err := tx.Model(&UserPersona{}).
		Where("id = ? AND user_id = ?", personaId, userId).
		Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return ErrUserPersonaNotFound
	}
	return nil
}
