package dbconf

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// As senhas difíceis da spec: aspas, dois pontos, cerquilha, barra, cifrão, chaves e colchetes.
var hardPasswords = []string{`'abc`, `"abc`, `a: b`, `a #b`, `a\b"c`, `$x y'z#`, `{x}: [y]`}

func sample(pw string) Config {
	return Config{Engine: "postgres", Host: "db.local", Port: "5432", Name: "cd2", User: "leitor", Password: pw, Schema: "public"}
}

// testdata/v050-N.env foram gravados pelo core/db-env.sh da v0.5.0 (db_env_write), um por senha.
func fixture(i int) string { return filepath.Join("testdata", fmt.Sprintf("v050-%d.env", i+1)) }

func TestFormatIgualAoDaV050(t *testing.T) {
	for i, pw := range hardPasswords {
		want, err := os.ReadFile(fixture(i))
		if err != nil {
			t.Fatal(err)
		}
		if got := Format(sample(pw)); string(got) != string(want) {
			t.Errorf("senha %q:\n got %q\nwant %q", pw, got, want)
		}
	}
}

func TestLoadLeArquivoDaV050(t *testing.T) {
	for i, pw := range hardPasswords {
		c, err := Load(fixture(i))
		if err != nil {
			t.Fatalf("senha %q: %v", pw, err)
		}
		if c != sample(pw) {
			t.Errorf("senha %q: leu %+v", pw, c)
		}
	}
}

func TestSaveGravaSoDoDonoEVoltaIgual(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "db.env")
	for _, pw := range hardPasswords {
		if err := Save(path, sample(pw)); err != nil {
			t.Fatal(err)
		}
		c, err := Load(path)
		if err != nil {
			t.Fatal(err)
		}
		if c != sample(pw) {
			t.Errorf("senha %q: voltou %+v", pw, c)
		}
	}
	if runtime.GOOS != "windows" {
		st, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if m := st.Mode().Perm(); m != 0o600 {
			t.Errorf("permissão %o, quero 600", m)
		}
	}
	ents, _ := os.ReadDir(dir)
	if len(ents) != 1 {
		t.Errorf("sobrou arquivo temporário: %v", ents)
	}
}

func TestShLeOQueOGoGrava(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("sem sh no Windows")
	}
	path := filepath.Join(t.TempDir(), "db.env")
	for _, pw := range hardPasswords {
		if err := Save(path, sample(pw)); err != nil {
			t.Fatal(err)
		}
		out, err := exec.Command("sh", "-c", `set -a; . "$1"; set +a; printf '%s' "$CD2_DB_PASSWORD"`, "sh", path).Output()
		if err != nil {
			t.Fatal(err)
		}
		if string(out) != pw {
			t.Errorf("sh leu %q, quero %q", out, pw)
		}
	}
}

func TestParseToleraCRLFComentarioESemAspas(t *testing.T) {
	in := "# teste\r\nCD2_DB_ENGINE=postgres\r\nCD2_DB_HOST=127.0.0.1\r\n\r\nCD2_DB_PASSWORD='cd2 s3nh@'\\''x'\r\nOUTRA=1\r\n"
	c, err := Parse(strings.NewReader(in))
	if err != nil {
		t.Fatal(err)
	}
	if c.Engine != "postgres" || c.Host != "127.0.0.1" || c.Password != "cd2 s3nh@'x" {
		t.Errorf("leu %+v", c)
	}
}

func TestParseRecusaArquivoQuebrado(t *testing.T) {
	if _, err := Parse(strings.NewReader("CD2_DB_ENGINE='postgres\n")); err == nil {
		t.Error("aspas sem fechar passou")
	}
	if _, err := Parse(strings.NewReader("CD2_DB_HOST='h'\n")); err == nil {
		t.Error("arquivo sem motor passou")
	}
}

func TestRemove(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db.env")
	if err := Remove(path); err != nil {
		t.Errorf("arquivo ausente deu erro: %v", err)
	}
	if err := Save(path, sample("x")); err != nil {
		t.Fatal(err)
	}
	if err := Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("db.env continua lá")
	}
}

func TestEnvSemAspas(t *testing.T) {
	got := sample(`a'b`).Env()
	if len(got) != 7 || got[0] != "CD2_DB_ENGINE=postgres" || got[5] != `CD2_DB_PASSWORD=a'b` {
		t.Errorf("Env = %q", got)
	}
}
