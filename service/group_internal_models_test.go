package service

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
)

func TestIsInternalRoutingModel(t *testing.T) {
	assert.True(t, isInternalRoutingModel(constant.DeepSeekSearchModel))
	assert.True(t, isInternalRoutingModel(constant.DeepSeekFetchModel))
	assert.False(t, isInternalRoutingModel("deepseek-v4-pro"))
}
