package toolbox

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/dbconf"
	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/faketoolbox"
	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/secret"
)

// Com CD2_FAKE_TOOLBOX=1 este binário de teste é o toolbox.
func TestMain(m *testing.M) {
	if os.Getenv(faketoolbox.EnvVar) == "1" {
		faketoolbox.Main()
		return
	}
	os.Exit(m.Run())
}

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func portFree(port int) bool {
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	l.Close()
	return true
}

func newSup(t *testing.T, ready time.Duration) *Supervisor {
	t.Helper()
	t.Setenv(faketoolbox.EnvVar, "1")
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	s := New(Options{
		Source: self, CacheDir: t.TempDir(), RecipeDir: filepath.Join("raiz", "core", "toolbox"),
		Port: freePort(t), HarnessPort: 18080, ReadyTimeout: ready, StopTimeout: 5 * time.Second,
	})
	t.Cleanup(func() { _ = s.Stop() })
	return s
}

func cfg(pw string) dbconf.Config {
	return dbconf.Config{Engine: "postgres", Host: "h", Port: "5432", Name: "d", User: "u", Password: pw, Schema: "public"}
}

func startErr(t *testing.T, err error) *StartError {
	t.Helper()
	var se *StartError
	if !errors.As(err, &se) {
		t.Fatalf("erro %v, quero *StartError", err)
	}
	return se
}

func TestSobeConfereDerrubaESobeDeNovo(t *testing.T) {
	s := newSup(t, 10*time.Second)
	if err := s.Start(cfg("boa")); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !s.Running() {
		t.Fatal("deveria estar rodando")
	}
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/", s.opt.Port))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("GET / = %d", resp.StatusCode)
	}
	if err := s.Stop(); err != nil {
		t.Fatal(err)
	}
	if s.Running() || !portFree(s.opt.Port) {
		t.Error("depois do Stop: ainda rodando ou porta presa")
	}
	if err := s.Start(cfg("boa2")); err != nil {
		t.Fatalf("segundo Start na mesma porta: %v", err)
	}
}

func TestPassaFlagsEAmbienteSemAChave(t *testing.T) {
	s := newSup(t, 10*time.Second)
	rep := filepath.Join(t.TempDir(), "rep.json")
	t.Setenv(faketoolbox.ReportVar, rep)
	t.Setenv("CD2_CTL_KEY", "nao-pode-vazar")
	t.Setenv("CD2_DB_HOST", "lixo-do-ambiente")
	if err := s.Start(cfg(`a\b"c`)); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(rep)
	if err != nil {
		t.Fatal(err)
	}
	var r faketoolbox.Report
	if err := json.Unmarshal(b, &r); err != nil {
		t.Fatal(err)
	}
	p := strconv.Itoa(s.opt.Port)
	want := []string{
		"--config", filepath.Join("raiz", "core", "toolbox", "postgres.yaml"),
		"--address", "127.0.0.1", "--port", p,
		"--allowed-hosts", "127.0.0.1:" + p + ",localhost:" + p,
		"--allowed-origins", "http://127.0.0.1:18080,http://localhost:18080",
		"--disable-reload",
	}
	if !reflect.DeepEqual(r.Args, want) {
		t.Errorf("args:\n got %q\nwant %q", r.Args, want)
	}
	if r.Password != `a\\b\"c` {
		t.Errorf("senha chegou %q, quero escapada para YAML", r.Password)
	}
	if r.HasKey {
		t.Error("CD2_CTL_KEY chegou ao toolbox")
	}
	if r.Engine != "postgres" || r.Host != "h" {
		t.Errorf("ambiente: engine %q host %q", r.Engine, r.Host)
	}
	if _, err := os.Stat(filepath.Join(s.opt.CacheDir, exeName())); err != nil {
		t.Errorf("o toolbox não rodou da cópia no cache: %v", err)
	}
}

func TestToolboxQueMorreNaoVazaASenha(t *testing.T) {
	s := newSup(t, 10*time.Second)
	pw := `morre"x\y`
	se := startErr(t, s.Start(cfg(pw)))
	if se.Msg != MsgDied {
		t.Errorf("Msg = %q", se.Msg)
	}
	logb, err := os.ReadFile(s.LogPath())
	if err != nil {
		t.Fatal(err)
	}
	for name, txt := range map[string]string{"Log": strings.Join(se.Log, "\n"), "toolbox.log": string(logb)} {
		for _, bad := range []string{pw, secret.YamlDQ(pw)} {
			if strings.Contains(txt, bad) {
				t.Errorf("%s contém a senha %q", name, bad)
			}
		}
		if strings.Contains(strings.ToLower(txt), "password") {
			t.Errorf("%s tem linha com password", name)
		}
		if !strings.Contains(txt, "Error: toolbox failed to initialize") {
			t.Errorf("%s perdeu a linha útil: %q", name, txt)
		}
	}
	if last := se.Log[len(se.Log)-1]; last != "(3 linha(s) omitida(s) por citar a senha)" {
		t.Errorf("última linha do Log = %q", last)
	}
	if s.Running() {
		t.Error("não deveria estar rodando")
	}
}

func TestPrazoEstourado(t *testing.T) {
	s := newSup(t, 1*time.Second)
	se := startErr(t, s.Start(cfg("lenta")))
	if !strings.Contains(se.Msg, "não respondeu em 1 segundos") {
		t.Errorf("Msg = %q", se.Msg)
	}
	if s.Running() || !portFree(s.opt.Port) {
		t.Error("o processo lento deveria ter sido derrubado")
	}
}

func TestConexaoComIsError(t *testing.T) {
	s := newSup(t, 10*time.Second)
	se := startErr(t, s.Start(cfg("iserror")))
	if se.Msg != MsgToolError {
		t.Errorf("Msg = %q", se.Msg)
	}
	if s.Running() {
		t.Error("não deveria estar rodando")
	}
}

func TestBinarioAusente(t *testing.T) {
	s := newSup(t, 10*time.Second)
	s.opt.Source = filepath.Join(t.TempDir(), "nada")
	se := startErr(t, s.Start(cfg("boa")))
	if !strings.Contains(se.Msg, "não encontrado") {
		t.Errorf("Msg = %q", se.Msg)
	}
}

func TestStartDuasVezes(t *testing.T) {
	s := newSup(t, 10*time.Second)
	if err := s.Start(cfg("boa")); err != nil {
		t.Fatal(err)
	}
	startErr(t, s.Start(cfg("boa")))
	if !s.Running() {
		t.Error("o primeiro deveria seguir rodando")
	}
}

// db_connection_status levando 3 s (mais que o limite do GET /) tem de passar dentro do prazo.
func TestConexaoLentaPassaDentroDoPrazo(t *testing.T) {
	s := newSup(t, 15*time.Second)
	t0 := time.Now()
	if err := s.Start(cfg("demora")); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if d := time.Since(t0); d < 3*time.Second || d > 15*time.Second {
		t.Errorf("levou %v, esperava entre 3 s e o prazo de 15 s", d)
	}
	if !s.Running() {
		t.Error("deveria estar rodando")
	}
}

// Uma chamada MCP pendurada não pode estourar o prazo total.
func TestPrazoRespeitadoComChamadaPendurada(t *testing.T) {
	s := newSup(t, 2*time.Second)
	t0 := time.Now()
	se := startErr(t, s.Start(cfg("demora")))
	waited := time.Since(t0)
	if !strings.Contains(se.Msg, "não respondeu em 2 segundos") {
		t.Errorf("Msg = %q", se.Msg)
	}
	// Start inclui o Stop (até 3 s de TERM); o que importa é a espera pela prontidão
	if waited > 2*time.Second+1500*time.Millisecond {
		t.Errorf("Start levou %v", waited)
	}
}
