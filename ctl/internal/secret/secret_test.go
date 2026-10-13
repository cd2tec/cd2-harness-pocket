package secret

import (
	"bytes"
	"strings"
	"testing"
)

var hard = []string{`'abc`, `"abc`, `a: b`, `a #b`, `a\b"c`, `$x y'z#`, `{x}: [y]`}

func TestYamlDQ(t *testing.T) {
	cases := map[string]string{
		`'abc`:     `'abc`,
		`"abc`:     `\"abc`,
		`a\b"c`:    `a\\b\"c`,
		`a: b`:     `a: b`,
		`$x y'z#`:  `$x y'z#`,
		`{x}: [y]`: `{x}: [y]`,
		`\"`:       `\\\"`,
	}
	for in, want := range cases {
		if got := YamlDQ(in); got != want {
			t.Errorf("YamlDQ(%q) = %q, quero %q", in, got, want)
		}
	}
}

func TestScrubberTiraSenhaCruaEscapadaEPassword(t *testing.T) {
	for _, pw := range hard {
		var out bytes.Buffer
		s := NewScrubber(&out, pw)
		in := "ok 1\nerro com " + pw + " no meio\nyaml: \"" + YamlDQ(pw) + "\"\nFATAL: PassWord authentication failed\nok 2"
		// aos pedaços de 3 bytes, para a senha cruzar a fronteira entre Writes
		for i := 0; i < len(in); i += 3 {
			if _, err := s.Write([]byte(in[i:min(i+3, len(in))])); err != nil {
				t.Fatal(err)
			}
		}
		if err := s.Close(); err != nil {
			t.Fatal(err)
		}
		if out.String() != "ok 1\nok 2\n" {
			t.Errorf("senha %q: saiu %q", pw, out.String())
		}
		if s.Dropped() != 3 {
			t.Errorf("senha %q: %d linhas omitidas, quero 3", pw, s.Dropped())
		}
	}
}

func TestScrubberSenhaVaziaNaoApagaTudo(t *testing.T) {
	var out bytes.Buffer
	s := NewScrubber(&out, "")
	s.Write([]byte("linha a\nlinha b\n"))
	s.Close()
	if out.String() != "linha a\nlinha b\n" || s.Dropped() != 0 {
		t.Errorf("saiu %q, %d omitidas", out.String(), s.Dropped())
	}
}

func TestScrubberDescartaPedacoGigante(t *testing.T) {
	var out bytes.Buffer
	s := NewScrubber(&out, "segredo")
	s.Write([]byte(strings.Repeat("x", maxLine+10)))
	s.Write([]byte("ainda o mesmo pedaço\nok\n"))
	s.Close()
	if out.String() != "ok\n" || s.Dropped() != 1 {
		t.Errorf("saiu %q, %d omitidas", out.String(), s.Dropped())
	}
}

func TestScrubberCRLF(t *testing.T) {
	var out bytes.Buffer
	s := NewScrubber(&out, "segredo")
	s.Write([]byte("a\r\nb\r\n"))
	s.Close()
	if out.String() != "a\nb\n" {
		t.Errorf("saiu %q", out.String())
	}
}
