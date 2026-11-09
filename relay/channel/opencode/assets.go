package opencode

import (
	_ "embed"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// The two files under assets/ are verbatim captures of the official CLI:
// its tool definitions and its base system prompt. They are what the free tier
// compares a shaped body against, so they must never be edited by hand — a
// newer CLI release replaces them whole.
//
//go:embed assets/opencode_tools.json
var officialToolsJSON []byte

//go:embed assets/opencode_prompt_v2.txt
var officialPromptText string

// officialToolOrder is the captured file's key order, made explicit because a
// decoded map does not keep it and the gate compares the declaration list.
var officialToolOrder = []string{
	"bash", "edit", "glob", "grep", "read",
	"skill", "task", "todowrite", "webfetch", "write",
}

var (
	officialToolsOnce sync.Once
	officialTools     map[string]officialTool
)

func loadOfficialTools() map[string]officialTool {
	officialToolsOnce.Do(func() {
		decoded := make(map[string]struct {
			Description string `json:"description"`
			Parameters  any    `json:"parameters"`
		})
		officialTools = make(map[string]officialTool, len(officialToolOrder))
		if err := common.Unmarshal(officialToolsJSON, &decoded); err != nil {
			return
		}
		for name, definition := range decoded {
			officialTools[name] = officialTool{
				Name:        name,
				Description: definition.Description,
				Parameters:  definition.Parameters,
			}
		}
	})
	return officialTools
}

// officialToolSet renders the full official tool list in the wire shape.
func officialToolSet(shape string) []any {
	captured := loadOfficialTools()
	tools := make([]any, 0, len(officialToolOrder))
	for _, name := range officialToolOrder {
		definition, ok := captured[name]
		if !ok {
			continue
		}
		parameters := definition.Parameters
		if parameters == nil {
			parameters = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		switch shape {
		case "claude":
			tools = append(tools, map[string]any{
				"name":         name,
				"description":  definition.Description,
				"input_schema": parameters,
			})
		case "flat":
			tools = append(tools, map[string]any{
				"type":        "function",
				"name":        name,
				"description": definition.Description,
				"parameters":  parameters,
			})
		default:
			tools = append(tools, map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        name,
					"description": definition.Description,
					"parameters":  parameters,
					"strict":      false,
				},
			})
		}
	}
	return tools
}

// officialToolNames is the set of names the shaped body declares as its own.
func officialToolNames() map[string]struct{} {
	names := make(map[string]struct{}, len(officialToolOrder))
	for _, name := range officialToolOrder {
		names[name] = struct{}{}
	}
	return names
}

// builtinSkillListing is the skill block the CLI appends after its env block.
const builtinSkillListing = `Skills provide specialized instructions and workflows for specific tasks.
Use the skill tool to load a skill when a task matches its description.
<available_skills>
  <skill>
    <name>customize-opencode</name>
    <description>Use ONLY when the user is editing or creating opencode's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. Also use when creating or fixing opencode agents, subagents, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode itself.</description>
    <location>&lt;built-in&gt;</location>
  </skill>
</available_skills>`

// officialSystemPrompt assembles the prompt the CLI sends: its base prompt, the
// environment block for this host, and the built-in skill listing.
func officialSystemPrompt(model string) string {
	if officialPromptText == "" {
		return ""
	}
	apiModel := strings.TrimPrefix(strings.TrimSpace(model), "opencode/")
	if apiModel == "" {
		apiModel = "unknown"
	}
	now := time.Now().UTC()
	date := fmt.Sprintf("%s %s %02d %d", now.Format("Mon"), now.Format("Jan"), now.Day(), now.Year())
	environment := strings.Join([]string{
		"You are an AI coding assistant running through an API relay The exact model ID is opencode/" + apiModel,
		"Here is some useful information about the environment you are running in:",
		"<env>",
		"  Working directory: /workspace",
		"  project root folder: /workspace",
		"  Is directory a git repo: yes",
		"  Platform: " + runtime.GOOS,
		"  Today's date: " + date,
		"</env>",
	}, "\n")
	return officialPromptText + environment + "\n" + builtinSkillListing
}
