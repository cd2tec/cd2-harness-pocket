package secret

import (
	"bytes"
	"os/exec"
	"runtime"
	"strings"
	"testing"
)

// Mesmo Scrubber em Stdout e Stderr: o os/exec usa um pipe so, entao pedacos parciais de
// stdout e stderr chegam na ordem em que o filho escreveu e a senha partida em dois
// Writes e descartada.
func TestScrubberComProcessoFilho(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("usa sh")
	}
	var out bytes.Buffer
	s := NewScrubber(&out, "secret")
	script := `printf 'ok 1\nsec'; sleep 0.05; printf 'ret\n'; printf 'err 1\n' >&2; sleep 0.05; printf 'pass'; sleep 0.05; printf 'word\nok 2\n' >&2`
	cmd := exec.Command("sh", "-c", script)
	cmd.Stdout, cmd.Stderr = s, s
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	got := out.String()
	if strings.Contains(got, "sec") || strings.Contains(got, "ret") || strings.Contains(got, "pass") {
		t.Errorf("vazou fragmento: %q", got)
	}
	if got != "ok 1\nerr 1\nok 2\n" || s.Dropped() != 2 {
		t.Errorf("saiu %q, %d omitidas", got, s.Dropped())
	}
}
