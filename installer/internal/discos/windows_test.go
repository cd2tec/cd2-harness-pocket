package discos

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestWindowsUmDiscoObjeto(t *testing.T) {
	got, err := lerDiscosWindows(fixture(t, "windows_um_disco.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "2" || got[0].Nome != "SanDisk Ultra USB 3.0" || got[0].Bytes != 32015679488 {
		t.Fatalf("veio %+v", got)
	}
	// Com um disco só, DriveLetters pode vir como texto solto.
	if len(got[0].Montagens) != 1 || got[0].Montagens[0] != `E:\` {
		t.Fatalf("montagens %v", got[0].Montagens)
	}
}

func TestWindowsLista(t *testing.T) {
	got, err := lerDiscosWindows(fixture(t, "windows_lista.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("veio %+v", got)
	}
	if got[0].ID != "2" || got[0].Boot || len(got[0].Montagens) != 1 || got[0].Montagens[0] != `E:\` {
		t.Errorf("disco 2: %+v", got[0])
	}
	if got[1].ID != "3" || !got[1].Boot || len(got[1].Montagens) != 0 {
		t.Errorf("disco 3: %+v", got[1])
	}
	if f := Filtrar(got); len(f) != 1 || f[0].ID != "2" {
		t.Errorf("filtro: %+v", f)
	}
}

func TestWindowsVazio(t *testing.T) {
	for _, entrada := range []string{"", "  \r\n", "[]", "\ufeff[]"} {
		got, err := lerDiscosWindows([]byte(entrada))
		if err != nil || len(got) != 0 {
			t.Errorf("%q: %+v %v", entrada, got, err)
		}
	}
	if _, err := lerDiscosWindows([]byte("isto não é json")); err == nil {
		t.Error("esperava erro")
	}
}

func TestWindowsListarChamaPowerShell(t *testing.T) {
	var args []string
	x := func(_ context.Context, nome string, a ...string) ([]byte, error) {
		args = append([]string{nome}, a...)
		return fixture(t, "windows_lista.json"), nil
	}
	got, err := NovoWindows(x).Listar(context.Background())
	if err != nil || len(got) != 2 {
		t.Fatalf("%+v %v", got, err)
	}
	if !strings.Contains(args[len(args)-1], "Get-Disk") {
		t.Fatalf("o script de listar devia estar no -Command: %v", args)
	}
}

func TestWindowsApagarChamaPowerShell(t *testing.T) {
	var args []string
	x := func(_ context.Context, nome string, a ...string) ([]byte, error) {
		args = append([]string{nome}, a...)
		return []byte("E\r\n"), nil
	}
	mnt, err := NovoWindows(x).Apagar(context.Background(), "2", "CD2")
	if err != nil {
		t.Fatal(err)
	}
	if mnt != `E:\` {
		t.Fatalf("montagem %q", mnt)
	}
	if len(args) != 6 || args[0] != "powershell" || args[1] != "-NoProfile" || args[2] != "-ExecutionPolicy" ||
		args[3] != "Bypass" || args[4] != "-Command" {
		t.Fatalf("args: %q", args)
	}
	cmd := args[5]
	// O script embutido vai inteiro, dentro de & { ... }, seguido dos parâmetros.
	if !strings.HasPrefix(cmd, "& { ") || !strings.Contains(cmd, strings.TrimSpace(apagarPS1)) ||
		!strings.HasSuffix(cmd, "} -DiskNumber 2 -Label 'CD2'") {
		t.Fatalf("-Command inesperado:\n%s", cmd)
	}
}

func TestWindowsApagarRecusaIDInvalidoERotuloComAspas(t *testing.T) {
	chamou := false
	x := func(context.Context, string, ...string) ([]byte, error) { chamou = true; return []byte("E"), nil }
	if _, err := NovoWindows(x).Apagar(context.Background(), "2; calc", "CD2"); err == nil || chamou {
		t.Fatal("ID que não é número tem de ser recusado sem chamar o PowerShell")
	}
	var cmd string
	y := func(_ context.Context, _ string, a ...string) ([]byte, error) {
		cmd = a[len(a)-1]
		return []byte("F"), nil
	}
	if _, err := NovoWindows(y).Apagar(context.Background(), "2", "O'Neil"); err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(cmd, "-Label 'O''Neil'") {
		t.Fatalf("aspas simples devem ser dobradas: %s", cmd)
	}
}

func TestWindowsApagarSemLetraDaErro(t *testing.T) {
	x := func(context.Context, string, ...string) ([]byte, error) { return []byte("\r\n"), nil }
	if _, err := NovoWindows(x).Apagar(context.Background(), "2", "CD2"); err == nil {
		t.Fatal("saída sem letra deve dar erro")
	}
	e := func(context.Context, string, ...string) ([]byte, error) { return nil, fmt.Errorf("falhou") }
	if _, err := NovoWindows(e).Apagar(context.Background(), "2", "CD2"); err == nil {
		t.Fatal("erro do executor deve subir")
	}
}

func TestWindowsEjetar(t *testing.T) {
	var cmd string
	x := func(_ context.Context, _ string, a ...string) ([]byte, error) { cmd = a[len(a)-1]; return nil, nil }
	if err := NovoWindows(x).Ejetar(context.Background(), "2", `E:\`); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(cmd, "InvokeVerb('Eject')") || !strings.HasSuffix(cmd, "} -Letter 'E'") {
		t.Fatalf("-Command: %s", cmd)
	}
	if err := NovoWindows(x).Ejetar(context.Background(), "2", ""); err == nil {
		t.Fatal("montagem vazia deve dar erro")
	}
}
