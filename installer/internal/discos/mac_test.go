package discos

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func fixture(t *testing.T, nome string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", nome))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// falso é um Executor que registra as chamadas e responde pelo texto do comando.
type falso struct {
	respostas map[string][]byte
	erros     map[string]error
	chamadas  []string
}

func (f *falso) exec(_ context.Context, nome string, args ...string) ([]byte, error) {
	linha := strings.Join(append([]string{nome}, args...), " ")
	f.chamadas = append(f.chamadas, linha)
	if err, ok := f.erros[linha]; ok {
		return nil, err
	}
	if r, ok := f.respostas[linha]; ok {
		return r, nil
	}
	return nil, fmt.Errorf("comando inesperado: %s", linha)
}

func macFalso(t *testing.T) *falso {
	return &falso{respostas: map[string][]byte{
		"diskutil list -plist external physical": fixture(t, "diskutil_list_externos.plist"),
		"diskutil info -plist /":                 fixture(t, "diskutil_info_raiz.plist"),
		"diskutil apfs list -plist":              fixture(t, "diskutil_apfs.plist"),
		"diskutil info -plist /dev/disk4":        fixture(t, "diskutil_info_disk4.plist"),
		"diskutil info -plist /dev/disk5":        fixture(t, "diskutil_info_disk5.plist"),
		"diskutil info -plist /dev/disk7":        fixture(t, "diskutil_info_disk7.plist"),
	}}
}

func TestMacListaWholeDisks(t *testing.T) {
	got, err := lerListaMac(fixture(t, "diskutil_list_externos.plist"))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"disk4", "disk5", "disk7"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("veio %v, esperava %v", got, want)
	}
}

func TestMacPapeisAPFS(t *testing.T) {
	m, err := lerApfsMac(fixture(t, "diskutil_apfs.plist"))
	if err != nil {
		t.Fatal(err)
	}
	if !contem(m["disk5"], "Backup") {
		t.Fatalf("disk5 deveria ter papel Backup: %v", m)
	}
	if !contem(m["disk0"], "System") || !contem(m["disk0"], "Data") {
		t.Fatalf("disk0 deveria ter System e Data: %v", m)
	}
	if _, ok := m["disk4"]; ok {
		t.Fatalf("disk4 não é APFS: %v", m)
	}
}

func TestMacInfoEBoot(t *testing.T) {
	nome, bytes, montagem, err := lerInfoMac(fixture(t, "diskutil_info_disk4s1_depois.plist"))
	if err != nil || nome != "" || bytes != 32010928128 || montagem != "/Volumes/CD2" {
		t.Fatalf("info: %q %d %q %v", nome, bytes, montagem, err)
	}
	nome, bytes, _, err = lerInfoMac(fixture(t, "diskutil_info_disk4.plist"))
	if err != nil || nome != "SanDisk Ultra" || bytes != 32015679488 {
		t.Fatalf("info: %q %d %v", nome, bytes, err)
	}
	boot, err := lerBootMac(fixture(t, "diskutil_info_raiz.plist"))
	if err != nil || boot != "disk3" {
		t.Fatalf("boot: %q %v", boot, err)
	}
}

func TestMacListarMarcaBootETimeMachine(t *testing.T) {
	f := macFalso(t)
	// O disco do "/" passa a ser o disk7: container sintetizado em disk3
	// com loja física lá. Aqui só reaproveitamos o boot direto.
	raiz := strings.ReplaceAll(string(fixture(t, "diskutil_info_raiz.plist")), "<string>disk3</string>", "<string>disk7</string>")
	f.respostas["diskutil info -plist /"] = []byte(raiz)

	// disk4 ganha Backups.backupdb numa pasta temporária.
	tmp := t.TempDir()
	if err := os.Mkdir(filepath.Join(tmp, "Backups.backupdb"), 0o755); err != nil {
		t.Fatal(err)
	}
	lista := strings.ReplaceAll(string(fixture(t, "diskutil_list_externos.plist")), "/Volumes/PENDRIVE", tmp)
	f.respostas["diskutil list -plist external physical"] = []byte(lista)

	brutos, err := NovoMac(f.exec).Listar(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(brutos) != 3 {
		t.Fatalf("esperava 3 discos, veio %+v", brutos)
	}
	por := map[string]Bruto{}
	for _, b := range brutos {
		por[b.ID] = b
	}
	d4, d5, d7 := por["/dev/disk4"], por["/dev/disk5"], por["/dev/disk7"]
	if d4.Nome != "SanDisk Ultra" || d4.Bytes != 32015679488 || !d4.TimeMachine || d4.Boot {
		t.Errorf("disk4: %+v", d4)
	}
	if len(d4.Montagens) != 1 || d4.Montagens[0] != tmp {
		t.Errorf("montagens do disk4: %v", d4.Montagens)
	}
	if !d5.TimeMachine || d5.Boot {
		t.Errorf("disk5 deveria ser Time Machine pelo papel Backup: %+v", d5)
	}
	if !d7.Boot || d7.TimeMachine {
		t.Errorf("disk7 deveria ser Boot: %+v", d7)
	}
	if got := Filtrar(brutos); len(got) != 0 {
		t.Errorf("o filtro deveria esconder os três: %+v", got)
	}
}

func TestMacListarDiscoLimpoAparece(t *testing.T) {
	f := macFalso(t)
	brutos, err := NovoMac(f.exec).Listar(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	got := Filtrar(brutos)
	if len(got) != 1 || got[0].ID != "/dev/disk4" || got[0].TimeMachine || got[0].Sistema || got[0].Boot {
		t.Fatalf("só o disk4 devia sobrar: %+v", got)
	}
}

func TestMacBootViaContainerAPFS(t *testing.T) {
	// "/" vive no container disk6, cuja loja física é disk5s2: o boot é disk5.
	f := macFalso(t)
	raiz := strings.ReplaceAll(string(fixture(t, "diskutil_info_raiz.plist")), "<string>disk3</string>", "<string>disk6</string>")
	f.respostas["diskutil info -plist /"] = []byte(raiz)
	brutos, err := NovoMac(f.exec).Listar(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range brutos {
		if b.ID == "/dev/disk5" && !b.Boot {
			t.Fatalf("disk5 devia ser Boot via container: %+v", b)
		}
		if b.ID == "/dev/disk4" && b.Boot {
			t.Fatalf("disk4 não é boot: %+v", b)
		}
	}
}

func TestMacApagarComandos(t *testing.T) {
	f := &falso{respostas: map[string][]byte{
		"diskutil unmountDisk force /dev/disk4":       nil,
		"diskutil eraseDisk ExFAT CD2 MBR /dev/disk4": []byte("Finished erase on disk4\n"),
		"diskutil info -plist /dev/disk4s1":           fixture(t, "diskutil_info_disk4s1_depois.plist"),
	}}
	mnt, err := NovoMac(f.exec).Apagar(context.Background(), "/dev/disk4", "CD2")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"diskutil unmountDisk force /dev/disk4",
		"diskutil eraseDisk ExFAT CD2 MBR /dev/disk4",
		"diskutil info -plist /dev/disk4s1",
	}
	if !reflect.DeepEqual(f.chamadas, want) {
		t.Fatalf("chamadas: %v", f.chamadas)
	}
	if mnt != "/Volumes/CD2" {
		t.Fatalf("montagem %q", mnt)
	}
}

func TestMacApagarMontaSeNaoMontou(t *testing.T) {
	sem := strings.ReplaceAll(string(fixture(t, "diskutil_info_disk4s1_depois.plist")), "/Volumes/CD2", "")
	f := &falso{respostas: map[string][]byte{
		"diskutil unmountDisk force /dev/disk4":       nil,
		"diskutil eraseDisk ExFAT CD2 MBR /dev/disk4": nil,
		"diskutil info -plist /dev/disk4s1":           []byte(sem),
		"diskutil mount /dev/disk4s1":                 nil,
	}}
	_, _ = NovoMac(f.exec).Apagar(context.Background(), "/dev/disk4", "CD2")
	if len(f.chamadas) != 5 || f.chamadas[3] != "diskutil mount /dev/disk4s1" {
		t.Fatalf("chamadas: %v", f.chamadas)
	}
}

func TestMacApagarFalhaDoEraseDisk(t *testing.T) {
	f := &falso{
		respostas: map[string][]byte{"diskutil unmountDisk force /dev/disk4": nil},
		erros:     map[string]error{"diskutil eraseDisk ExFAT CD2 MBR /dev/disk4": fmt.Errorf("saiu 1")},
	}
	if _, err := NovoMac(f.exec).Apagar(context.Background(), "/dev/disk4", "CD2"); err == nil {
		t.Fatal("esperava erro")
	}
}

func TestMacEjetar(t *testing.T) {
	f := &falso{respostas: map[string][]byte{"diskutil eject /dev/disk4": nil}}
	if err := NovoMac(f.exec).Ejetar(context.Background(), "/dev/disk4", "/Volumes/CD2"); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(f.chamadas, []string{"diskutil eject /dev/disk4"}) {
		t.Fatalf("chamadas: %v", f.chamadas)
	}
}

func contem(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}
