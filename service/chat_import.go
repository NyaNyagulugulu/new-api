package service

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const (
	MaxChatImportBytes            = 512 << 20
	MaxChatImportJSONBytes        = 128 << 20
	MaxChatImportSessionJSONBytes = 16 << 20
	MaxChatImportSessions         = 50
	MaxChatImportZipEntries       = 5_000
	chatImportRequestTimeout      = 10 * time.Minute
	chatImportMaxRedirects        = 3
	deepSeekSessionDirectory      = "chat_sessions/"
	deepSeekSessionIndexPath      = "chat_session_index.json"
)

var (
	chatImportSessionIDPattern = regexp.MustCompile(`[^A-Za-z0-9_-]+`)
	chatImportProtection       = &common.SSRFProtection{
		AllowPrivateIp:         false,
		DomainFilterMode:       false,
		IpFilterMode:           false,
		AllowedPorts:           []int{443},
		ApplyIPFilterForDomain: true,
	}
)

type ImportedMessageVersion struct {
	ID      string `json:"id"`
	Content string `json:"content"`
}

type ImportedMessageReasoning struct {
	Content  string  `json:"content"`
	Duration float64 `json:"duration"`
}

type ImportedMessage struct {
	Key       string                    `json:"key"`
	From      string                    `json:"from"`
	Versions  []ImportedMessageVersion  `json:"versions"`
	CreatedAt int64                     `json:"createdAt,omitempty"`
	Status    string                    `json:"status,omitempty"`
	Reasoning *ImportedMessageReasoning `json:"reasoning,omitempty"`
}

type ImportedChatSession struct {
	ID        string            `json:"id"`
	Title     string            `json:"title"`
	Messages  []ImportedMessage `json:"messages"`
	CreatedAt int64             `json:"createdAt"`
	UpdatedAt int64             `json:"updatedAt"`
}

type ChatImportResult struct {
	Sessions []ImportedChatSession `json:"sessions"`
	Found    int                   `json:"found"`
	Imported int                   `json:"imported"`
	Skipped  int                   `json:"skipped"`
}

type deepSeekSessionIndexEntry struct {
	ID         string  `json:"id"`
	Title      *string `json:"title"`
	InsertedAt string  `json:"inserted_at"`
	UpdatedAt  string  `json:"updated_at"`
}

type deepSeekSession struct {
	ID         string            `json:"id"`
	Title      *string           `json:"title"`
	InsertedAt string            `json:"inserted_at"`
	UpdatedAt  string            `json:"updated_at"`
	Messages   []deepSeekMessage `json:"messages"`
}

type deepSeekMessage struct {
	ID         any                `json:"id"`
	Role       string             `json:"role"`
	InsertedAt string             `json:"inserted_at"`
	Fragments  []deepSeekFragment `json:"fragments"`
}

type deepSeekFragment struct {
	Type    string `json:"type"`
	Content string `json:"content"`
}

func ImportChatConversationsFromPath(path string) (ChatImportResult, error) {
	file, err := os.Open(path)
	if err != nil {
		return ChatImportResult{}, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return ChatImportResult{}, err
	}
	if info.Size() <= 0 || info.Size() > MaxChatImportBytes {
		return ChatImportResult{}, fmt.Errorf("chat import file has an invalid size")
	}

	magic := make([]byte, 4)
	n, err := file.ReadAt(magic, 0)
	if err != nil && err != io.EOF {
		return ChatImportResult{}, err
	}
	if n >= 4 && magic[0] == 'P' && magic[1] == 'K' {
		return importDeepSeekZip(file, info.Size())
	}
	if info.Size() > MaxChatImportJSONBytes {
		return ChatImportResult{}, fmt.Errorf("chat import JSON is too large")
	}

	data, err := io.ReadAll(io.LimitReader(file, info.Size()))
	if err != nil {
		return ChatImportResult{}, err
	}
	sessions, err := parseImportJSON(data, strings.TrimSuffix(path, ".json"))
	if err != nil {
		return ChatImportResult{}, err
	}
	return finalizeChatImport(sessions, len(sessions)), nil
}

func importDeepSeekZip(file *os.File, size int64) (ChatImportResult, error) {
	archive, err := zip.NewReader(file, size)
	if err != nil {
		return ChatImportResult{}, fmt.Errorf("invalid ZIP archive")
	}
	if len(archive.File) > MaxChatImportZipEntries {
		return ChatImportResult{}, fmt.Errorf("ZIP archive contains too many entries")
	}

	index := make(map[string]deepSeekSessionIndexEntry)
	totalJSONBytes := int64(0)
	sessions := make([]ImportedChatSession, 0)

	for _, entry := range archive.File {
		if normalizeChatImportZipEntryName(entry.Name) != deepSeekSessionIndexPath {
			continue
		}
		if entry.FileInfo().IsDir() || entry.UncompressedSize64 > MaxChatImportSessionJSONBytes {
			break
		}
		totalJSONBytes += int64(entry.UncompressedSize64)
		if totalJSONBytes > MaxChatImportJSONBytes {
			return ChatImportResult{}, fmt.Errorf("chat import JSON is too large")
		}
		data, err := readZipEntry(entry, MaxChatImportSessionJSONBytes)
		if err != nil {
			return ChatImportResult{}, err
		}
		var entries []deepSeekSessionIndexEntry
		if err := common.Unmarshal(data, &entries); err != nil {
			return ChatImportResult{}, fmt.Errorf("invalid chat session index")
		}
		for _, item := range entries {
			index[item.ID] = item
		}
		break
	}

	for _, entry := range archive.File {
		name := normalizeChatImportZipEntryName(entry.Name)
		relativeName := strings.TrimPrefix(name, deepSeekSessionDirectory)
		isSessionFile := strings.HasPrefix(name, deepSeekSessionDirectory) &&
			strings.HasSuffix(relativeName, ".json") &&
			!strings.Contains(relativeName, "/")
		if !isSessionFile {
			continue
		}
		if entry.FileInfo().IsDir() || entry.UncompressedSize64 > MaxChatImportSessionJSONBytes {
			continue
		}
		totalJSONBytes += int64(entry.UncompressedSize64)
		if totalJSONBytes > MaxChatImportJSONBytes {
			return ChatImportResult{}, fmt.Errorf("chat import JSON is too large")
		}
		data, err := readZipEntry(entry, MaxChatImportSessionJSONBytes)
		if err != nil {
			return ChatImportResult{}, err
		}

		sessionID := strings.TrimSuffix(relativeName, ".json")
		session, err := convertDeepSeekSession(data, sessionID, index[strings.TrimSpace(sessionID)])
		if err != nil {
			continue
		}
		sessions = append(sessions, session)
	}

	if len(sessions) == 0 {
		return ChatImportResult{}, fmt.Errorf("no DeepSeek conversations found")
	}
	return finalizeChatImport(sessions, len(sessions)), nil
}

func normalizeChatImportZipEntryName(name string) string {
	return strings.TrimPrefix(strings.TrimSpace(name), "./")
}

func readZipEntry(entry *zip.File, maxBytes uint64) ([]byte, error) {
	reader, err := entry.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, int64(maxBytes)+1))
	if err != nil {
		return nil, err
	}
	if uint64(len(data)) > maxBytes {
		return nil, fmt.Errorf("chat import entry is too large")
	}
	return data, nil
}

func parseImportJSON(data []byte, fallbackID string) ([]ImportedChatSession, error) {
	var envelope struct {
		Sessions []deepSeekSession `json:"sessions"`
	}
	if err := common.Unmarshal(data, &envelope); err == nil && len(envelope.Sessions) > 0 {
		sessions := make([]ImportedChatSession, 0, len(envelope.Sessions))
		for _, session := range envelope.Sessions {
			converted, err := convertDeepSeekSessionValue(
				session,
				fallbackID,
				deepSeekSessionIndexEntry{},
			)
			if err == nil {
				sessions = append(sessions, converted)
			}
		}
		if len(sessions) > 0 {
			return sessions, nil
		}
	}

	var session deepSeekSession
	converted, err := convertDeepSeekSession(data, fallbackID, deepSeekSessionIndexEntry{})
	if err == nil && len(converted.Messages) > 0 {
		return []ImportedChatSession{converted}, nil
	}
	if err := common.Unmarshal(data, &session); err != nil {
		return nil, fmt.Errorf("unsupported chat import JSON")
	}
	if len(session.Messages) == 0 {
		return nil, fmt.Errorf("no conversations found")
	}
	return nil, fmt.Errorf("unsupported chat import JSON")
}

func convertDeepSeekSession(
	data []byte,
	fallbackID string,
	index deepSeekSessionIndexEntry,
) (ImportedChatSession, error) {
	var session deepSeekSession
	if err := common.Unmarshal(data, &session); err != nil {
		return ImportedChatSession{}, err
	}
	return convertDeepSeekSessionValue(session, fallbackID, index)
}

func convertDeepSeekSessionValue(
	session deepSeekSession,
	fallbackID string,
	index deepSeekSessionIndexEntry,
) (ImportedChatSession, error) {
	sessionID := cleanChatImportSessionID(firstNonEmpty(session.ID, index.ID, fallbackID))
	if sessionID == "" {
		return ImportedChatSession{}, fmt.Errorf("invalid chat session id")
	}

	createdAt := parseChatImportTime(session.InsertedAt)
	if createdAt == 0 {
		createdAt = parseChatImportTime(index.InsertedAt)
	}
	updatedAt := parseChatImportTime(session.UpdatedAt)
	if updatedAt == 0 {
		updatedAt = parseChatImportTime(index.UpdatedAt)
	}

	messages := make([]ImportedMessage, 0, len(session.Messages))
	for messageIndex, source := range session.Messages {
		role := strings.ToLower(strings.TrimSpace(source.Role))
		if role != "user" && role != "assistant" && role != "system" {
			continue
		}

		contentParts := make([]string, 0, len(source.Fragments))
		reasoningParts := make([]string, 0, len(source.Fragments))
		for _, fragment := range source.Fragments {
			content := strings.TrimSpace(fragment.Content)
			if content == "" {
				continue
			}
			if strings.EqualFold(fragment.Type, "THINKING") {
				reasoningParts = append(reasoningParts, content)
				continue
			}
			contentParts = append(contentParts, content)
		}
		content := strings.Join(contentParts, "\n\n")
		reasoning := strings.Join(reasoningParts, "\n\n")
		if content == "" && reasoning == "" {
			continue
		}

		messageTime := parseChatImportTime(source.InsertedAt)
		if messageTime == 0 {
			messageTime = createdAt
		}
		if messageTime > updatedAt {
			updatedAt = messageTime
		}
		messageID := strings.TrimSpace(fmt.Sprint(source.ID))
		if messageID == "" || messageID == "<nil>" {
			messageID = fmt.Sprintf("message-%d", messageIndex+1)
		}
		key := fmt.Sprintf("%s:%s:%d", sessionID, messageID, messageIndex)
		message := ImportedMessage{
			Key:       key,
			From:      role,
			Versions:  []ImportedMessageVersion{{ID: key + "-v1", Content: content}},
			CreatedAt: messageTime,
			Status:    "complete",
		}
		if reasoning != "" {
			message.Reasoning = &ImportedMessageReasoning{
				Content:  reasoning,
				Duration: 0,
			}
		}
		messages = append(messages, message)
	}
	if len(messages) == 0 {
		return ImportedChatSession{}, fmt.Errorf("chat session has no readable messages")
	}
	if createdAt == 0 {
		createdAt = messages[0].CreatedAt
	}
	if updatedAt == 0 {
		updatedAt = messages[len(messages)-1].CreatedAt
	}
	if updatedAt < createdAt {
		updatedAt = createdAt
	}

	title := ""
	if session.Title != nil {
		title = strings.TrimSpace(*session.Title)
	}
	if title == "" && index.Title != nil {
		title = strings.TrimSpace(*index.Title)
	}
	if len(title) > model.MaxChatConversationTitle {
		title = title[:model.MaxChatConversationTitle]
		for !utf8.ValidString(title) {
			title = title[:len(title)-1]
		}
	}
	return ImportedChatSession{
		ID:        sessionID,
		Title:     title,
		Messages:  messages,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}, nil
}

func cleanChatImportSessionID(value string) string {
	original := strings.TrimSpace(value)
	value = chatImportSessionIDPattern.ReplaceAllString(original, "-")
	value = strings.Trim(value, "-_")
	if len(value) > 64 {
		value = value[:64]
	}
	if value != "" {
		return value
	}
	sum := sha256.Sum256([]byte(original))
	return "import-" + hex.EncodeToString(sum[:8])
}

func parseChatImportTime(value string) int64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return 0
	}
	return parsed.UnixMilli()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func finalizeChatImport(sessions []ImportedChatSession, found int) ChatImportResult {
	byID := make(map[string]ImportedChatSession, len(sessions))
	for _, session := range sessions {
		existing, ok := byID[session.ID]
		if !ok || session.UpdatedAt > existing.UpdatedAt {
			byID[session.ID] = session
		}
	}
	unique := make([]ImportedChatSession, 0, len(byID))
	for _, session := range byID {
		unique = append(unique, session)
	}
	sort.SliceStable(unique, func(i, j int) bool {
		return unique[i].UpdatedAt > unique[j].UpdatedAt
	})
	if len(unique) > MaxChatImportSessions {
		unique = unique[:MaxChatImportSessions]
	}
	return ChatImportResult{
		Sessions: unique,
		Found:    found,
		Imported: len(unique),
		Skipped:  max(found-len(unique), 0),
	}
}

func DownloadChatImport(ctx context.Context, rawURL string) (string, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" || len(rawURL) > 4096 {
		return "", fmt.Errorf("invalid import URL")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return "", fmt.Errorf("invalid import URL")
	}
	if err := chatImportProtection.ValidateURL(rawURL); err != nil {
		return "", fmt.Errorf("import URL is not allowed")
	}

	protectedProtection := func() (*common.SSRFProtection, bool, error) {
		return chatImportProtection, true, nil
	}
	client := newProtectedFetchHTTPClientWithProxy(
		nil,
		nil,
		protectedProtection,
		func(*http.Request) (*url.URL, error) { return nil, nil },
	)
	client.Timeout = chatImportRequestTimeout
	client.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		if len(via) >= chatImportMaxRedirects {
			return fmt.Errorf("too many redirects")
		}
		if request.URL.Scheme != "https" || request.URL.User != nil {
			return fmt.Errorf("redirect URL is not allowed")
		}
		if err := chatImportProtection.ValidateURL(request.URL.String()); err != nil {
			return fmt.Errorf("redirect URL is not allowed")
		}
		return nil
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", fmt.Errorf("invalid import URL")
	}
	request.Header.Set("Accept", "application/zip,application/json,application/octet-stream")
	request.Header.Set("User-Agent", "new-api-chat-import/1")
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("failed to download chat import")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("chat import download failed with status %d", response.StatusCode)
	}
	if response.ContentLength > MaxChatImportBytes {
		return "", fmt.Errorf("chat import file is too large")
	}

	file, err := os.CreateTemp("", "new-api-chat-import-*.download")
	if err != nil {
		return "", err
	}
	path := file.Name()
	written, copyErr := io.Copy(file, io.LimitReader(response.Body, MaxChatImportBytes+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || written > MaxChatImportBytes {
		_ = os.Remove(path)
		if written > MaxChatImportBytes {
			return "", fmt.Errorf("chat import file is too large")
		}
		if copyErr != nil {
			return "", copyErr
		}
		return "", closeErr
	}
	return path, nil
}
