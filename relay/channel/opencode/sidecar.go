package opencode

import (
	"bufio"
	_ "embed"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// The free tier only serves requests that look like they come from the
// official OpenCode CLI, and that CLI is a Bun binary. Go can satisfy the
// header and body checks — a paid model from Go answers "Missing API key",
// the same as from Bun — but the same free-tier request bytes that Bun gets
// served are answered with FreeUsageLimitError when Go sends them, from the
// same host and the same egress at the same moment. So the keyless lane
// forwards through Bun instead of dialing the upstream from Go.
//
// That 429 also covers an exhausted quota, which is metered per session and
// per egress address and resets at UTC midnight. Distinguishing the two is
// not possible from the response, so treat a 429 as "this address or session
// is spent" rather than as proof that the request shape is wrong.
//
//go:embed sidecar.mjs
var sidecarScript string

const (
	// sidecarBunEnv names the Bun executable. The official CLI ships one, and
	// the Docker image installs a standalone copy; an operator can point it at
	// either.
	sidecarBunEnv = "OPENCODE_BUN_PATH"
	// sidecarUpstreamEnv overrides the upstream origin, for a mirror or a test
	// double.
	sidecarUpstreamEnv = "OPENCODE_SIDECAR_UPSTREAM"
	// sidecarProxyEnv selects the egress the sidecar dials from. The free tier
	// meters per address, so a spent address answers 429 until UTC midnight and
	// another one keeps working.
	sidecarProxyEnv = "OPENCODE_SIDECAR_PROXY"
	// sidecarStartTimeout bounds how long a cold start may take before the
	// request fails with a clear message instead of hanging.
	sidecarStartTimeout = 20 * time.Second
)

var (
	sidecarOnce     sync.Once
	sidecarURL      string
	sidecarErr      error
	sidecarCmd      *exec.Cmd
	sidecarStopOnce sync.Once
)

// freeTierBaseURL is the origin a keyless request is sent through. On the first
// call it starts the sidecar; every later call reuses the running process.
func freeTierBaseURL() (string, error) {
	sidecarOnce.Do(func() {
		sidecarURL, sidecarErr = startSidecar()
	})
	if sidecarErr != nil {
		return "", sidecarErr
	}
	return sidecarURL, nil
}

// StopSidecar terminates the forwarder. It is safe to call when none started.
func StopSidecar() {
	sidecarStopOnce.Do(func() {
		if sidecarCmd == nil || sidecarCmd.Process == nil {
			return
		}
		_ = sidecarCmd.Process.Kill()
		_, _ = sidecarCmd.Process.Wait()
	})
}

func startSidecar() (string, error) {
	bun, err := resolveBun()
	if err != nil {
		return "", err
	}
	dir, err := os.MkdirTemp("", "opencode-sidecar-*")
	if err != nil {
		return "", fmt.Errorf("create sidecar dir: %w", err)
	}
	script := filepath.Join(dir, "sidecar.mjs")
	if err := os.WriteFile(script, []byte(sidecarScript), 0o600); err != nil {
		return "", fmt.Errorf("write sidecar script: %w", err)
	}

	cmd := exec.Command(bun, script)
	cmd.Env = append(os.Environ(), "OPENCODE_SIDECAR_PORT=0")
	// The sidecar's stdout pipe stays open for its lifetime. Without a wait
	// delay, reaping the child blocks until that pipe closes, which never
	// happens while the process is healthy.
	cmd.WaitDelay = 2 * time.Second
	if upstream := strings.TrimSpace(os.Getenv(sidecarUpstreamEnv)); upstream != "" {
		cmd.Env = append(cmd.Env, sidecarUpstreamEnv+"="+upstream)
	}
	if proxy := strings.TrimSpace(os.Getenv(sidecarProxyEnv)); proxy != "" {
		cmd.Env = append(cmd.Env, sidecarProxyEnv+"="+proxy)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("sidecar stdout: %w", err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("start sidecar with %s: %w", bun, err)
	}
	sidecarCmd = cmd

	// The child prints "READY <port>" once Bun.serve is listening; reading that
	// line is the readiness signal, so no polling loop is needed.
	type ready struct {
		port int
		err  error
	}
	readyCh := make(chan ready, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if !strings.HasPrefix(line, "READY ") {
				continue
			}
			port, convErr := strconv.Atoi(strings.TrimPrefix(line, "READY "))
			readyCh <- ready{port: port, err: convErr}
			return
		}
		readyCh <- ready{err: errors.New("sidecar exited before reporting its port")}
	}()

	select {
	case result := <-readyCh:
		if result.err != nil {
			StopSidecar()
			return "", fmt.Errorf("opencode free-tier sidecar: %w", result.err)
		}
		base := fmt.Sprintf("http://127.0.0.1:%d", result.port)
		if err := waitSidecarHealthy(base); err != nil {
			StopSidecar()
			return "", err
		}
		common.SysLog(fmt.Sprintf("opencode free-tier sidecar ready on port %d", result.port))
		return base, nil
	case <-time.After(sidecarStartTimeout):
		StopSidecar()
		return "", errors.New("opencode free-tier sidecar did not become ready in time")
	}
}

func waitSidecarHealthy(base string) error {
	client := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := client.Get(base + "/__health")
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return errors.New("opencode free-tier sidecar health check failed")
}

// resolveBun finds a Bun executable: the configured path first, then the
// official CLI's bundled runtime, then whatever is on PATH.
func resolveBun() (string, error) {
	candidates := []string{}
	if configured := strings.TrimSpace(os.Getenv(sidecarBunEnv)); configured != "" {
		candidates = append(candidates, configured)
	}
	candidates = append(candidates, "bun", "opencode")
	for _, candidate := range candidates {
		if path, err := exec.LookPath(candidate); err == nil {
			return path, nil
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("no Bun runtime found for the OpenCode free tier; set %s to a Bun or opencode binary", sidecarBunEnv)
}

// freeTierDialable reports whether the sidecar can be started at all, so the
// channel can fail with a precise message instead of a transport error.
func freeTierDialable() error {
	_, err := resolveBun()
	return err
}

var _ = net.Dial
