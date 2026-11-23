package memory_setting

import "github.com/QuantumNous/new-api/setting/config"

type MemorySetting struct {
	Enabled               bool    `json:"enabled"`
	AutoExtract           bool    `json:"auto_extract"`
	ExtractEveryRounds    int     `json:"extract_every_rounds"`
	ExtractWindowMessages int     `json:"extract_window_messages"`
	RetrieveLimit         int     `json:"retrieve_limit"`
	MaxInjectedChars      int     `json:"max_injected_chars"`
	MinImportance         float64 `json:"min_importance"`
	RetentionDays         int     `json:"retention_days"`
}

var memorySetting = MemorySetting{
	Enabled:               true,
	AutoExtract:           true,
	ExtractEveryRounds:    6,
	ExtractWindowMessages: 40,
	RetrieveLimit:         5,
	MaxInjectedChars:      3_000,
	MinImportance:         0.25,
	RetentionDays:         365,
}

func init() {
	config.GlobalConfig.Register("memory_setting", &memorySetting)
}

func Get() MemorySetting {
	settings := memorySetting
	settings.ExtractEveryRounds = max(1, min(settings.ExtractEveryRounds, 100))
	settings.ExtractWindowMessages = max(2, min(settings.ExtractWindowMessages, 200))
	settings.RetrieveLimit = max(0, min(settings.RetrieveLimit, 50))
	settings.MaxInjectedChars = max(200, min(settings.MaxInjectedChars, 20_000))
	settings.MinImportance = max(0, min(settings.MinImportance, 1))
	settings.RetentionDays = max(1, min(settings.RetentionDays, 3_650))
	return settings
}
