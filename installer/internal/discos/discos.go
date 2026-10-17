// Package discos decide quais discos externos a tela mostra e quais podem
// ser gravados. É lógica pura: quem fala com o sistema operacional
// implementa a interface Sistema.
package discos

import (
	"context"
	"fmt"
	"io/fs"
	"path/filepath"
)

const (
	// MinimoBytes: abaixo disso o disco aparece, mas não pode ser escolhido.
	MinimoBytes = 4_000_000_000
	// RecomendadoBytes: abaixo disso o disco pode ser escolhido, com aviso.
	RecomendadoBytes = 16_000_000_000
	// LimiteBytes: acima disso o disco fica escondido. Aceita pen drive
	// vendido como "256 GB", que reporta um pouco mais que 256e9.
	LimiteBytes = 260_000_000_000

	// limiteContagem é onde ContarArquivos para de contar.
	limiteContagem = 10_000
)

// Situacao diz se o disco pode ser escolhido.
type Situacao string

const (
	Ok      Situacao = "ok"
	Aviso   Situacao = "aviso"
	Pequeno Situacao = "pequeno"
)

// Bruto é o disco como o sistema operacional o descreve.
type Bruto struct {
	ID, Nome    string
	Bytes       int64
	Boot        bool
	Sistema     bool
	TimeMachine bool
	// Montagens são pontos de montagem (Mac) ou letras como "E:\" (Windows).
	Montagens []string
}

// Disco é o que a tela recebe.
type Disco struct {
	ID       string   `json:"id"`
	Nome     string   `json:"nome"`
	Bytes    int64    `json:"bytes"`
	Situacao Situacao `json:"situacao"`
	Arquivos int      `json:"arquivos"`
	MaisDe   bool     `json:"maisDe"` // parou de contar em 10.000
	Rotulo   string   `json:"rotulo"` // "SanDisk 32 GB"
}

// Sistema é a ponte com o sistema operacional. As implementações ficam
// em outro arquivo, por plataforma.
type Sistema interface {
	Listar(ctx context.Context) ([]Bruto, error)
	Apagar(ctx context.Context, id, rotulo string) (montagem string, err error)
	Ejetar(ctx context.Context, id, montagem string) error
}

// Filtrar esconde disco de boot ou de sistema, disco de Time Machine e
// disco acima de LimiteBytes.
func Filtrar(b []Bruto) []Bruto {
	var saida []Bruto
	for _, d := range b {
		if d.Boot || d.Sistema || d.TimeMachine || d.Bytes > LimiteBytes {
			continue
		}
		saida = append(saida, d)
	}
	return saida
}

// Descrever monta o Disco da tela. Sempre conta arquivos, mesmo no
// disco pequeno: é barato e a tela mostra.
func Descrever(b Bruto, contar func(montagens []string) (int, bool)) Disco {
	n, mais := contar(b.Montagens)
	sit := Ok
	switch {
	case b.Bytes < MinimoBytes:
		sit = Pequeno
	case b.Bytes < RecomendadoBytes:
		sit = Aviso
	}
	return Disco{
		ID:       b.ID,
		Nome:     b.Nome,
		Bytes:    b.Bytes,
		Situacao: sit,
		Arquivos: n,
		MaisDe:   mais,
		Rotulo:   rotulo(b.Nome, b.Bytes),
	}
}

// rotulo usa GB decimal arredondado, como na caixa do pen drive.
func rotulo(nome string, bytes int64) string {
	if nome == "" {
		nome = "Pen drive"
	}
	gb := (bytes + 500_000_000) / 1_000_000_000
	return fmt.Sprintf("%s %d GB", nome, gb)
}

// ContarArquivos conta arquivos regulares, recursivamente, em todas as
// montagens somadas. Ignora erros de permissão e pastas que não existem.
// Para em 10.000 e devolve (10000, true) quando há mais que isso.
func ContarArquivos(montagens []string) (n int, maisDe bool) {
	for _, m := range montagens {
		_ = filepath.WalkDir(m, func(_ string, e fs.DirEntry, err error) error {
			if err != nil {
				// Subpasta ilegível: segue adiante sem ela.
				if e != nil && e.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			if e.Type().IsRegular() {
				n++
				if n > limiteContagem {
					return fs.SkipAll
				}
			}
			return nil
		})
		if n > limiteContagem {
			return limiteContagem, true
		}
	}
	return n, false
}

// Mesmo diz se dois discos são o mesmo: ID, Nome e Bytes iguais.
func Mesmo(a, b Disco) bool {
	return a.ID == b.ID && a.Nome == b.Nome && a.Bytes == b.Bytes
}
