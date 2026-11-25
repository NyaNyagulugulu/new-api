package service

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeChatImportZip(t *testing.T, files map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "deepseek_data-test.zip")
	file, err := os.Create(path)
	require.NoError(t, err)
	writer := zip.NewWriter(file)
	for name, content := range files {
		entry, err := writer.Create(name)
		require.NoError(t, err)
		_, err = entry.Write([]byte(content))
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())
	require.NoError(t, file.Close())
	return path
}

func TestImportDeepSeekChatArchive(t *testing.T) {
	path := writeChatImportZip(t, map[string]string{
		"manifest.json": `{"export_format_version":3}`,
		"chat_session_index.json": `[{
			"id":"e4f4cadc-99a5-4c16-84a2-4cd8866a3343",
			"title":"Imported title",
			"inserted_at":"2026-10-11T14:16:53.583Z",
			"updated_at":"2026-11-25T03:07:23.760Z"
		}]`,
		"chat_sessions/e4f4cadc-99a5-4c16-84a2-4cd8866a3343_files/metadata.json": `{
			"messages":[{"role":"USER","fragments":[{"content":"attachment metadata"}]}]
		}`,
		"chat_sessions/e4f4cadc-99a5-4c16-84a2-4cd8866a3343.json": `{
			"id":"e4f4cadc-99a5-4c16-84a2-4cd8866a3343",
			"title":"",
			"inserted_at":"2026-10-11T14:16:53.583Z",
			"updated_at":"2026-11-25T03:07:23.760Z",
			"messages":[
				{
					"id":1,
					"role":"USER",
					"inserted_at":"2026-10-11T14:17:05.350Z",
					"fragments":[{"type":"REQUEST","content":"ping"}]
				},
				{
					"id":2,
					"role":"ASSISTANT",
					"inserted_at":"2026-10-11T14:17:06.350Z",
					"fragments":[
						{"type":"THINKING","content":"Need a brief reply."},
						{"type":"RESPONSE","content":"Pong"}
					]
				}
			]
		}`,
	})

	result, err := ImportChatConversationsFromPath(path)
	require.NoError(t, err)
	require.Len(t, result.Sessions, 1)
	assert.Equal(t, 1, result.Found)
	assert.Equal(t, 1, result.Imported)

	session := result.Sessions[0]
	assert.Equal(t, "Imported title", session.Title)
	require.Len(t, session.Messages, 2)
	assert.Equal(t, "user", session.Messages[0].From)
	assert.Equal(t, "ping", session.Messages[0].Versions[0].Content)
	assert.Equal(t, "assistant", session.Messages[1].From)
	assert.Equal(t, "Pong", session.Messages[1].Versions[0].Content)
	assert.Equal(t, "Need a brief reply.", session.Messages[1].Reasoning.Content)
}

func TestImportKeepsEveryConversation(t *testing.T) {
	files := map[string]string{}
	for index := range 55 {
		id := fmt.Sprintf("chat-%02d", index)
		files["chat_sessions/"+id+".json"] = fmt.Sprintf(`{
			"id":%q,
			"title":%q,
			"inserted_at":"2026-01-01T00:00:00Z",
			"updated_at":"2026-01-01T00:00:%02dZ",
			"messages":[{
				"id":1,
				"role":"USER",
				"inserted_at":"2026-01-01T00:00:00Z",
				"fragments":[{"type":"REQUEST","content":"hello"}]
			}]
		}`, id, id, index%60)
	}

	result, err := ImportChatConversationsFromPath(writeChatImportZip(t, files))
	require.NoError(t, err)
	assert.Equal(t, 55, result.Found)
	assert.Len(t, result.Sessions, 55)
	assert.Zero(t, result.Skipped)
}

func TestImportTruncatesLongTitlesAtAValidUTF8Boundary(t *testing.T) {
	longTitle := strings.Repeat("长", 150)
	result, err := ImportChatConversationsFromPath(writeChatImportZip(t, map[string]string{
		"chat_sessions/long-title.json": fmt.Sprintf(`{
			"id":"long-title",
			"title":%q,
			"inserted_at":"2026-01-01T00:00:00Z",
			"updated_at":"2026-01-01T00:00:01Z",
			"messages":[{
				"id":1,
				"role":"USER",
				"inserted_at":"2026-01-01T00:00:00Z",
				"fragments":[{"type":"REQUEST","content":"hello"}]
			}]
		}`, longTitle),
	}))

	require.NoError(t, err)
	require.Len(t, result.Sessions, 1)
	assert.LessOrEqual(t, len(result.Sessions[0].Title), model.MaxChatConversationTitle)
	assert.True(t, utf8.ValidString(result.Sessions[0].Title))
}

func TestImportDeepSeekChatArchiveIncludesImages(t *testing.T) {
	imageData, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
	)
	require.NoError(t, err)

	result, err := ImportChatConversationsFromPath(writeChatImportZip(t, map[string]string{
		"chat_sessions/image-chat.json": `{
			"id":"image-chat",
			"title":"Image conversation",
			"inserted_at":"2026-11-25T00:00:00Z",
			"updated_at":"2026-11-25T00:00:02Z",
			"messages":[{
				"id":1,
				"role":"USER",
				"inserted_at":"2026-11-25T00:00:01Z",
				"fragments":[
					{"type":"FILE","files":[{
						"id":"image-1",
						"file_name":"photo.png",
						"export_path":"chat_sessions/image-chat_files/photo.png",
						"is_image":true
					},{
						"id":"outside-session",
						"file_name":"other.png",
						"export_path":"chat_sessions/other-chat_files/other.png",
						"is_image":true
					}]},
					{"type":"REQUEST","content":"What is shown?"}
				]
			}]
		}`,
		"chat_sessions/image-chat_files/photo.png": string(imageData),
	}))

	require.NoError(t, err)
	require.Len(t, result.Sessions, 1)
	require.Len(t, result.Sessions[0].Messages, 1)
	attachments := result.Sessions[0].Messages[0].Versions[0].Attachments
	require.Len(t, attachments, 1)
	assert.Equal(t, "image-1", attachments[0].ID)
	assert.Equal(t, "image", attachments[0].Kind)
	assert.Equal(t, "photo.png", attachments[0].Name)
	assert.Equal(t, "image/png", attachments[0].MediaType)
	assert.True(t, strings.HasPrefix(attachments[0].DataURL, "data:image/png;base64,"))
}

func TestImportURLRejectsSSRFTargets(t *testing.T) {
	for _, rawURL := range []string{
		"http://example.com/export.zip",
		"https://127.0.0.1/export.zip",
		"https://10.0.0.8/export.zip",
		"https://169.254.169.254/latest/meta-data",
		"https://[::1]/export.zip",
		"https://user:pass@example.com/export.zip",
	} {
		t.Run(strings.ReplaceAll(rawURL, "/", "_"), func(t *testing.T) {
			_, err := DownloadChatImport(context.Background(), rawURL)
			require.Error(t, err)
		})
	}
}
