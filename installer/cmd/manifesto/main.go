// Comando manifesto monta o manifesto.json da release "iadebolso" e o escreve em stdout.
// Os valores fixos vêm dos scripts de preparo; o SHA-256 do ZIP é calculado do arquivo.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/cd2tec/cd2-ia-de-bolso/installer/internal/manifesto"
)

func main() {
	if err := executar(); err != nil {
		fmt.Fprintln(os.Stderr, "manifesto:", err)
		os.Exit(1)
	}
}

func executar() error {
	prepUnix := flag.String("prepare-unix", "", "caminho de core/prepare-unix.sh")
	prepWin := flag.String("prepare-windows", "", "caminho de core/prepare-windows.ps1")
	versaoArq := flag.String("version-file", "", "caminho do arquivo VERSION")
	zip := flag.String("zip", "", "arquivo ZIP da release (para o SHA-256 e o tamanho)")
	zipURL := flag.String("zip-url", "", "URL pública do ZIP")
	llamaURL := flag.String("llamafile-url", "", "URL do llamafile")
	llamaBytes := flag.Int64("llamafile-bytes", 0, "tamanho do llamafile em bytes")
	modeloBytes := flag.Int64("modelo-bytes", 0, "tamanho do modelo em bytes")
	flag.Parse()

	for nome, v := range map[string]string{
		"-prepare-unix": *prepUnix, "-prepare-windows": *prepWin, "-version-file": *versaoArq,
		"-zip": *zip, "-zip-url": *zipURL, "-llamafile-url": *llamaURL,
	} {
		if v == "" {
			return fmt.Errorf("falta a flag %s", nome)
		}
	}

	unix, err := os.ReadFile(*prepUnix)
	if err != nil {
		return err
	}
	win, err := os.ReadFile(*prepWin)
	if err != nil {
		return err
	}
	fixos, err := manifesto.DosScripts(string(unix), string(win))
	if err != nil {
		return err
	}
	versao, err := os.ReadFile(*versaoArq)
	if err != nil {
		return err
	}
	sha, tamanho, err := shaDoArquivo(*zip)
	if err != nil {
		return err
	}

	var m manifesto.Manifesto
	m.Versao = strings.TrimSpace(string(versao))
	m.Zip = manifesto.Arquivo{URL: *zipURL, SHA256: sha, Bytes: tamanho}
	m.Llamafile = manifesto.Arquivo{URL: *llamaURL, Bytes: *llamaBytes}
	m.Modelo = manifesto.Arquivo{URL: fixos.ModeloURL, SHA256: fixos.ModeloSHA256, Bytes: *modeloBytes}
	m.ModeloNome = fixos.ModeloNome
	m.Toolbox.Versao = fixos.ToolboxVersao
	m.Toolbox.Base = fixos.ToolboxBase
	m.Toolbox.Plataformas = fixos.Plataformas
	m.Ctl.Versao = fixos.CtlVersao
	m.Ctl.Base = fixos.CtlBase

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(m)
}

func shaDoArquivo(caminho string) (string, int64, error) {
	f, err := os.Open(caminho)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}
