package discos

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

//go:embed listar.ps1
var listarPS1 string

//go:embed apagar.ps1
var apagarPS1 string

//go:embed ejetar.ps1
var ejetarPS1 string

type windowsSistema struct{ x Executor }

// NovoWindows devolve o Sistema que fala com o PowerShell através de x.
func NovoWindows(x Executor) Sistema { return windowsSistema{x: x} }

// powershell monta a chamada. O "-Command <script>" puro não recebe
// parâmetros no PowerShell 5.1; por isso o script vai dentro de & { ... }
// e os parâmetros vêm depois da chave.
func (w windowsSistema) powershell(ctx context.Context, script string, params ...string) ([]byte, error) {
	cmd := "& { " + strings.TrimSpace(script) + " }"
	if len(params) > 0 {
		cmd += " " + strings.Join(params, " ")
	}
	return w.x(ctx, "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd)
}

// aspas protege um texto para dentro de aspas simples do PowerShell.
func aspas(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

type windowsDisco struct {
	Number       int64           `json:"Number"`
	FriendlyName string          `json:"FriendlyName"`
	Size         int64           `json:"Size"`
	IsBoot       bool            `json:"IsBoot"`
	IsSystem     bool            `json:"IsSystem"`
	DriveLetters json.RawMessage `json:"DriveLetters"`
}

// lerDiscosWindows lê a saída do ConvertTo-Json do PowerShell 5.1. Com um
// disco só ele devolve um objeto, não uma lista; aceita as duas formas.
func lerDiscosWindows(js []byte) ([]Bruto, error) {
	t := strings.TrimSpace(strings.TrimPrefix(string(js), "\xef\xbb\xbf"))
	if t == "" || t == "null" {
		return nil, nil
	}
	var lista []windowsDisco
	if strings.HasPrefix(t, "{") {
		var um windowsDisco
		if err := json.Unmarshal([]byte(t), &um); err != nil {
			return nil, fmt.Errorf("lista de discos ilegível: %w", err)
		}
		lista = []windowsDisco{um}
	} else if err := json.Unmarshal([]byte(t), &lista); err != nil {
		return nil, fmt.Errorf("lista de discos ilegível: %w", err)
	}
	var saida []Bruto
	for _, d := range lista {
		b := Bruto{
			ID:      strconv.FormatInt(d.Number, 10),
			Nome:    strings.TrimSpace(d.FriendlyName),
			Bytes:   d.Size,
			Boot:    d.IsBoot,
			Sistema: d.IsSystem,
		}
		for _, l := range letras(d.DriveLetters) {
			b.Montagens = append(b.Montagens, l+`:\`)
		}
		saida = append(saida, b)
	}
	return saida, nil
}

// letras aceita DriveLetters como lista ou como texto solto.
func letras(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var lista []string
	if json.Unmarshal(raw, &lista) == nil {
		return limpaLetras(lista)
	}
	var uma string
	if json.Unmarshal(raw, &uma) == nil {
		return limpaLetras([]string{uma})
	}
	return nil
}

func limpaLetras(l []string) []string {
	var s []string
	for _, x := range l {
		if x = strings.TrimSpace(x); x != "" {
			s = append(s, strings.ToUpper(x[:1]))
		}
	}
	return s
}

func (w windowsSistema) Listar(ctx context.Context) ([]Bruto, error) {
	out, err := w.powershell(ctx, listarPS1)
	if err != nil {
		return nil, fmt.Errorf("não consegui listar os discos: %w", err)
	}
	return lerDiscosWindows(out)
}

func (w windowsSistema) Apagar(ctx context.Context, id, rotulo string) (string, error) {
	// O ID vira argumento de PowerShell: só número, nada mais.
	n, err := strconv.Atoi(id)
	if err != nil || n < 0 {
		return "", fmt.Errorf("número de disco inválido: %q", id)
	}
	out, err := w.powershell(ctx, apagarPS1, "-DiskNumber", strconv.Itoa(n), "-Label", aspas(rotulo))
	if err != nil {
		return "", fmt.Errorf("a formatação falhou: %w", err)
	}
	l := limpaLetras([]string{ultimaLinha(string(out))})
	if len(l) == 0 {
		return "", fmt.Errorf("formatei, mas a partição não recebeu letra")
	}
	return l[0] + `:\`, nil
}

func (w windowsSistema) Ejetar(ctx context.Context, _, montagem string) error {
	l := limpaLetras([]string{montagem})
	if len(l) == 0 {
		return fmt.Errorf("sem letra de unidade para ejetar")
	}
	if _, err := w.powershell(ctx, ejetarPS1, "-Letter", aspas(l[0])); err != nil {
		return fmt.Errorf("não consegui ejetar %s: %w", l[0], err)
	}
	return nil
}

// ultimaLinha devolve a última linha não vazia: o script imprime só a
// letra, mas qualquer aviso solto antes dela não pode atrapalhar.
func ultimaLinha(s string) string {
	linhas := strings.Split(strings.ReplaceAll(s, "\r", ""), "\n")
	for i := len(linhas) - 1; i >= 0; i-- {
		if t := strings.TrimSpace(linhas[i]); t != "" {
			return t
		}
	}
	return ""
}
