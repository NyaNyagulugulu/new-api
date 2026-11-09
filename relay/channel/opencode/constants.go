package opencode

const ChannelName = "opencode"

// FreeTierModels are the ids the Zen gateway serves on the anonymous free tier.
// The listing mixes paid and free ids; only these are billed as free, so they
// are what a keyless channel advertises by default.
var FreeTierModels = []string{
	"deepseek-v4.1-flash-free",
	"glm-5.3-flash-free",
	"mimo-v2.6-flash-free",
	"longcat-2.5-free",
	"crouton-alpha-free",
	"iceman-free",
	"inkling-2-small-free",
	"beam-free",
	"flint-40b-free",
	"nemotron-3.5-super-vl-free",
	"nemotron-3.5-lightning-free",
	"big-pickle",
}

// ModelList is the picker default for a channel with no explicit model list.
var ModelList = FreeTierModels

// Endpoint paths. The 2.x client groups /inference routes by provider family,
// so the family segment sits between the origin and the protocol path.
const (
	ChatPath      = "/inference/openai/v1/chat/completions"
	ResponsesPath = "/inference/openai/v1/responses"
	MessagesPath  = "/inference/anthropic/v1/messages?beta=true"
)
