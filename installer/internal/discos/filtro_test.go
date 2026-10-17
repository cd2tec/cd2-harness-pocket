package discos

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestFiltrarEscondeBootSistemaTimeMachine(t *testing.T) {
	entrada := []Bruto{
		{ID: "ok", Bytes: 32_000_000_000},
		{ID: "boot", Bytes: 32_000_000_000, Boot: true},
		{ID: "sistema", Bytes: 32_000_000_000, Sistema: true},
		{ID: "tm", Bytes: 32_000_000_000, TimeMachine: true},
	}
	saida := Filtrar(entrada)
	if len(saida) != 1 || saida[0].ID != "ok" {
		t.Fatalf("esperava só o disco ok, veio %+v", saida)
	}
}

func TestFiltrarLimite(t *testing.T) {
	saida := Filtrar([]Bruto{
		{ID: "no-limite", Bytes: 260_000_000_000},
		{ID: "acima", Bytes: 260_000_000_001},
	})
	if len(saida) != 1 || saida[0].ID != "no-limite" {
		t.Fatalf("esperava só no-limite, veio %+v", saida)
	}
}

func TestDescreverSituacao(t *testing.T) {
	casos := []struct {
		bytes int64
		quer  Situacao
	}{
		{3_999_999_999, Pequeno},
		{4_000_000_000, Aviso},
		{15_999_999_999, Aviso},
		{16_000_000_000, Ok},
	}
	for _, c := range casos {
		d := Descrever(Bruto{ID: "x", Bytes: c.bytes}, func([]string) (int, bool) { return 0, false })
		if d.Situacao != c.quer {
			t.Errorf("%d bytes: situação %q, queria %q", c.bytes, d.Situacao, c.quer)
		}
	}
}

func TestDescreverCopiaCampos(t *testing.T) {
	d := Descrever(Bruto{ID: "7", Nome: "SanDisk", Bytes: 32_000_000_000, Montagens: []string{"E:\\"}},
		func(m []string) (int, bool) { return 12, true })
	if d.ID != "7" || d.Nome != "SanDisk" || d.Bytes != 32_000_000_000 || d.Arquivos != 12 || !d.MaisDe {
		t.Fatalf("campos errados: %+v", d)
	}
}

func TestRotulo(t *testing.T) {
	d := Descrever(Bruto{Nome: "SanDisk Ultra", Bytes: 32_017_047_552}, func([]string) (int, bool) { return 0, false })
	if d.Rotulo != "SanDisk Ultra 32 GB" {
		t.Errorf("rótulo %q", d.Rotulo)
	}
	d = Descrever(Bruto{Bytes: 32_017_047_552}, func([]string) (int, bool) { return 0, false })
	if d.Rotulo != "Pen drive 32 GB" {
		t.Errorf("rótulo %q", d.Rotulo)
	}
}

func TestContarArquivosPara(t *testing.T) {
	vazia := t.TempDir()
	if n, mais := ContarArquivos([]string{vazia}); n != 0 || mais {
		t.Fatalf("pasta vazia: %d, %v", n, mais)
	}
	cheia := t.TempDir()
	for i := 0; i < 10_005; i++ {
		if err := os.WriteFile(filepath.Join(cheia, fmt.Sprintf("a%d", i)), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if n, mais := ContarArquivos([]string{cheia}); n != 10_000 || !mais {
		t.Fatalf("pasta cheia: %d, %v", n, mais)
	}
}

func TestContarArquivosSomaMontagensERecursivo(t *testing.T) {
	a, b := t.TempDir(), t.TempDir()
	os.MkdirAll(filepath.Join(a, "sub", "fundo"), 0o755)
	os.WriteFile(filepath.Join(a, "1"), nil, 0o644)
	os.WriteFile(filepath.Join(a, "sub", "2"), nil, 0o644)
	os.WriteFile(filepath.Join(a, "sub", "fundo", "3"), nil, 0o644)
	os.WriteFile(filepath.Join(b, "4"), nil, 0o644)
	if n, mais := ContarArquivos([]string{a, b, filepath.Join(a, "nao-existe")}); n != 4 || mais {
		t.Fatalf("esperava 4, veio %d, %v", n, mais)
	}
}

func TestMesmo(t *testing.T) {
	a := Disco{ID: "1", Nome: "X", Bytes: 100}
	if !Mesmo(a, Disco{ID: "1", Nome: "X", Bytes: 100, Arquivos: 5}) {
		t.Error("deveria ser o mesmo")
	}
	if Mesmo(a, Disco{ID: "1", Nome: "X", Bytes: 101}) {
		t.Error("Bytes diferentes deveria ser false")
	}
	if Mesmo(a, Disco{ID: "1", Nome: "Y", Bytes: 100}) || Mesmo(a, Disco{ID: "2", Nome: "X", Bytes: 100}) {
		t.Error("Nome ou ID diferentes deveria ser false")
	}
}
