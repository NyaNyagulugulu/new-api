package opencode

import (
	"bufio"
	"bytes"
	"io"
	"strings"
)

// restoringStream rewrites opaque tool names back to the caller's spelling while
// an SSE body streams through. Frames are read line by line and passed on
// immediately, so latency and the shape of the stream are unchanged; only the
// `name` field of a tool-call delta is touched.
type restoringStream struct {
	source  io.ReadCloser
	reverse map[string]string
	reader  *bufio.Reader
	pending []byte
	done    bool
}

func newRestoringStream(source io.ReadCloser, reverse map[string]string) io.ReadCloser {
	return &restoringStream{
		source:  source,
		reverse: reverse,
		reader:  bufio.NewReaderSize(source, 32*1024),
	}
}

func (s *restoringStream) Read(buffer []byte) (int, error) {
	if len(s.pending) > 0 {
		n := copy(buffer, s.pending)
		s.pending = s.pending[n:]
		return n, nil
	}
	if s.done {
		return 0, io.EOF
	}
	line, err := s.reader.ReadBytes('\n')
	if len(line) > 0 {
		restored := line
		trimmed := bytes.TrimSpace(line)
		if bytes.HasPrefix(trimmed, []byte("data:")) {
			frame := strings.TrimSpace(strings.TrimPrefix(string(trimmed), "data:"))
			if frame != "" && frame != "[DONE]" {
				restored = []byte("data: " + restoreStreamToolNames(frame, s.reverse) + "\n")
			}
		}
		n := copy(buffer, restored)
		if n < len(restored) {
			s.pending = restored[n:]
		}
		return n, nil
	}
	if err != nil {
		s.done = true
		return 0, err
	}
	return 0, nil
}

func (s *restoringStream) Close() error {
	s.done = true
	return s.source.Close()
}
