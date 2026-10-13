//go:build !windows

package main

import (
	"bytes"
	"io"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"
)

// filho sobe um processo auxiliar (sleep) e devolve o comando já iniciado.
func filho(t *testing.T) *exec.Cmd {
	t.Helper()
	cmd := exec.Command("sleep", "300")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	return cmd
}

func TestProcessAlive(t *testing.T) {
	if !processAlive(os.Getpid()) {
		t.Error("o próprio processo deveria estar vivo")
	}
	if !processAlive(1) {
		t.Error("PID 1 existe (EPERM conta como vivo)")
	}
	for _, pid := range []int{0, -1} {
		if processAlive(pid) {
			t.Errorf("PID %d não pode contar como vivo", pid)
		}
	}
	cmd := filho(t)
	pid := cmd.Process.Pid
	if !processAlive(pid) {
		t.Fatal("o filho deveria estar vivo")
	}
	_ = cmd.Process.Kill()
	_ = cmd.Wait() // recolhe o zumbi
	if processAlive(pid) {
		t.Error("o filho morto ainda conta como vivo")
	}
}

func TestEncerraQuandoOLauncherSome(t *testing.T) {
	old := parentPollInterval
	parentPollInterval = 200 * time.Millisecond
	t.Cleanup(func() { parentPollInterval = old })
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	p := l.Addr().(*net.TCPAddr).Port
	l.Close()
	if p <= 2001 {
		t.Skip("porta efêmera baixa demais")
	}
	cmd := filho(t)
	var out bytes.Buffer
	done := make(chan int, 1)
	args := []string{"--root", t.TempDir(), "--cache", t.TempDir(), "--harness-port", strconv.Itoa(p - 3000),
		"--parent-pid", strconv.Itoa(cmd.Process.Pid)}
	go func() { done <- run(args, testKey, make(chan os.Signal), &syncBuf{b: &out}, io.Discard) }()
	// com o launcher vivo, segue no ar
	select {
	case c := <-done:
		t.Fatalf("encerrou com o launcher vivo (code %d)", c)
	case <-time.After(1 * time.Second):
	}
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
	t0 := time.Now()
	select {
	case c := <-done:
		if c != 0 {
			t.Errorf("saiu com %d", c)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("não encerrou em 5 s depois que o launcher sumiu")
	}
	t.Logf("encerrou %v depois do kill", time.Since(t0))
	if s := out.String(); !strings.Contains(s, "sumiu") || !strings.Contains(s, "cd2-ctl encerrado") {
		t.Errorf("saida %q", s)
	}
	if _, err := net.Dial("tcp", "127.0.0.1:"+strconv.Itoa(p)); err == nil {
		t.Error("a porta de controle continua aberta")
	}
}

func TestParentPidNegativo(t *testing.T) {
	var errb bytes.Buffer
	code := run([]string{"--root", "r", "--cache", t.TempDir(), "--harness-port", "18080", "--parent-pid", "-5"}, testKey, nil, io.Discard, &errb)
	if code != 2 || !strings.Contains(errb.String(), "uso:") {
		t.Errorf("code %d, %q", code, errb.String())
	}
}
