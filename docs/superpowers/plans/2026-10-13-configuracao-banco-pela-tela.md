# Configuração do banco pela tela (`cd2-ctl`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quem usa o pen drive configura o banco só pela tela Ferramentas: um controlador novo em Go (`cd2-ctl`) recebe a conexão do navegador, sobe o MCP Toolbox com ela, grava o `db.env` só se der certo e volta para a conexão anterior se falhar; junto, o produto vira "Harness Pocket" no front e "IA de Bolso" no site.

**Architecture:** `cd2-ctl` (módulo Go em `ctl/`, só biblioteca padrão) escuta em `127.0.0.1:P+2000`, protegido por uma chave de sessão que o launcher sorteia e passa pelo ambiente; ele é o único dono do toolbox (`127.0.0.1:P+1000`). Pacotes pequenos e testáveis: `dbconf` (db.env e validação), `secret` (escape YAML e filtro de log), `toolbox` (supervisor do processo), `control` (estado e rollback), `api` (HTTP e segurança). Os launchers deixam de perguntar no terminal: sobem llamafile e `cd2-ctl` e abrem a janela com `#k=<chave>`; o front guarda a chave no `sessionStorage` e fala com o `cd2-ctl` por `fetch`.

**Tech Stack:** Go 1.23+ (stdlib), POSIX sh, PowerShell 5.1, JavaScript sem framework, `node:test`, GitHub Actions, Docker (bancos de teste), MCP Toolbox v1.14.0.

**Spec:** `docs/superpowers/specs/2026-10-13-configuracao-banco-pela-tela-design.md`

## Pré-condições

1. Trabalhar num worktree a partir de `main` (`superpowers:using-git-worktrees`, branch `feat/ctl-banco`). Todos os caminhos deste plano são relativos à raiz desse worktree.
2. **Go não está instalado no Mac.** O primeiro passo da Task 1 é instalar (`brew install go`), e o executor **pergunta ao usuário antes**.
3. `bin/` e `models/` são ignorados pelo Git e não existem num worktree novo. Copie do cache do gravador (clone APFS, instantâneo):
   ```bash
   cp -Rc ~/Library/Caches/cd2-harness/usb/CD2-HARNESS/bin ~/Library/Caches/cd2-harness/usb/CD2-HARNESS/models .
   ls bin/toolbox bin/toolbox/darwin-arm64/toolbox models
   ```
   Expected: `darwin-amd64 darwin-arm64 linux-amd64 windows-amd64`, o caminho do toolbox e `qwen3-4b-thinking-2507.Q4_K_M.gguf`.
4. Bancos de teste no ar: `docker compose -f tests/toolbox/docker-compose.yml up -d postgres mariadb` (Postgres em 55432, MariaDB em 53306, senha `cd2 s3nh@'x`).
5. Já existe um `~/Library/Caches/cd2-harness/db.env` da v0.5.0 neste Mac (conexão real do usuário). As Tasks 9 e 12 fazem backup dele antes de testar e devolvem no fim. Não abrir nem imprimir o conteúdo.

## Decisões deste plano (rulings sobre pontos que a spec deixa abertos)

- **Compatibilidade com a v0.5.0 sem depender do `core/db-env.sh`:** a Task 1 grava, com o próprio `core/db-env.sh`, sete arquivos de referência em `ctl/internal/dbconf/testdata/` (um por senha difícil da spec) e versiona. Os testes Go comparam byte a byte com eles e também conferem que o `sh` lê o que o Go grava. Assim a Task 9 pode apagar `core/db-env.sh` e `tests/db-env.test.js`; `tests/toolbox/check-recipe.sh` passa a fazer o escape YAML numa linha própria.
- **Preparo antes do primeiro release:** enquanto a tag `ctl-v0.6.0` não existir, o download falha. Com `CD2_CTL_LOCAL=1`, o preparo não baixa e usa `bin/ctl/<plataforma>/cd2-ctl` compilado por `sh ctl/build.sh`. Sem essa variável, se o `SHA256SUMS` do release não vier, ele usa o binário local que já estiver lá (com aviso); se não houver nenhum, para com erro. Nunca segue sem `cd2-ctl` em silêncio.
- **Falha sem conexão anterior:** a resposta vem com `estado: "sem_banco"` mais `erro` e `log`. `falhou` fica para quando existe conexão salva mas o toolbox dela não está de pé (arranque que falhou, rollback que falhou ou toolbox que morreu sozinho).
- **Corpo acima de 8 KB:** HTTP 413 com `{erro: "corpo: acima de 8 KB"}`. JSON inválido ou campo desconhecido: 400.
- **`log`:** lista de strings (até 15 linhas filtradas) e, se alguma linha foi omitida, mais uma no fim: `(N linha(s) omitida(s) por citar a senha)`, como a v0.5.0 fazia no terminal.
- **Campos:** o `cd2-ctl` apara espaços das pontas de todos os campos menos a senha; `porta` aceita número JSON ou texto com dígitos. Caractere de controle é conferido antes de aparar (um `\n` no fim do host é recusado, não aparado).
- **Arranque assíncrono:** o `cd2-ctl` responde `/status` logo depois de abrir a porta (estado `subindo`) e sobe o toolbox em segundo plano, segurando a vez dos `POST /config` até terminar. Sem isso, os 15 s do toolbox estourariam os 10 s que o launcher espera.
- **Prova de vida no launcher sem a chave:** o launcher espera `GET /status` responder **401** (sem mandar a chave), para a chave não aparecer na lista de processos via `curl`.
- **A chave vai sempre na URL**, mesmo se o `cd2-ctl` não subiu: o front então mostra "O controle do banco não está rodando...", que é o aviso certo.
- **Windows roda `cd2-ctl.exe` direto do pen drive**, como já faz com `llamafile.exe`; só Mac e Linux copiam para o cache (exFAT sem bit de execução). O toolbox é copiado para o cache pelo próprio `cd2-ctl` nos três sistemas, como a spec pede.
- **Porta ocupada = conexão aceita:** `busy()` no launcher Unix passa a considerar ocupada qualquer porta que aceite conexão (o `curl` só devolve 7 quando ninguém escuta). Antes, um serviço que não fala HTTP passava como livre.
- **Chave fora do toolbox:** o `cd2-ctl` apaga `CD2_CTL_KEY` do próprio ambiente ao subir e o supervisor filtra `CD2_CTL_KEY` e qualquer `CD2_DB_*` herdado antes de montar o ambiente do toolbox.
- **Prontidão do toolbox:** `GET /` 200, depois `initialize` e `tools/call db_connection_status` no `/mcp`. Conferido em 12/10 com o toolbox 1.14.0 real: responde JSON (não SSE), não exige sessão, e com senha errada o processo sai sozinho em menos de 1 s com `password authentication failed` no stderr.
- **Chave velha:** se `/status` responder 401 (janela de uma abertura anterior), o front avisa "Esta janela é de uma abertura anterior do harness. Feche e abra pelo atalho INICIAR."

## Global Constraints

- Go `1.23` ou mais novo, **só biblioteca padrão** (`go.mod` sem `require`). Módulo `github.com/cd2tec/cd2-harness-pocket/ctl`, binário `cd2-ctl` (`cd2-ctl.exe` no Windows).
- Plataformas: `windows-amd64`, `darwin-arm64`, `darwin-amd64`, `linux-amd64`. `CD2_TOOLBOX_PLATFORMS` limita toolbox e `cd2-ctl` juntos.
- Linha de comando: `cd2-ctl --root <raiz do pen drive> --cache <pasta de cache> --harness-port P`. Chave só em `CD2_CTL_KEY`: 64 caracteres hexadecimais. Sem ela, não sobe.
- Portas: trio P (harness), P+1000 (toolbox), P+2000 (`cd2-ctl`); padrão 8080, 9080, 10080; tudo em `127.0.0.1`. O launcher avança o trio junto.
- Porta de controle não abre: sai com código 2 e mensagem sem acento.
- Toolbox: `--config <root>/core/toolbox/<motor>.yaml --address 127.0.0.1 --port P+1000 --allowed-hosts 127.0.0.1:P+1000,localhost:P+1000 --allowed-origins http://127.0.0.1:P,http://localhost:P --disable-reload`; ambiente com `CD2_DB_*` e `CD2_DB_PASSWORD` escapada para YAML entre aspas duplas (`\` vira `\\`, `"` vira `\"`).
- Pronto quando `GET http://127.0.0.1:P+1000/` dá 200 e `db_connection_status` volta sem `isError`, em até 15 s. Ao trocar, espera a porta P+1000 liberar por até 5 s.
- Filtro de log: some toda linha com a senha (crua ou escapada, comparação literal) ou com `password` sem diferenciar caixa. A senha nunca chega ao disco fora do `db.env`.
- `db.env`: sete linhas `CD2_DB_<CAMPO>='<valor>'` na ordem ENGINE, HOST, PORT, NAME, USER, PASSWORD, SCHEMA; `'` vira `'\''`. Escrita atômica (temporário no mesmo diretório e `rename`). `0600` no Unix; no Windows ACL só do usuário atual aplicada na criação do temporário. `DELETE /config` apaga.
- API: `GET /status`, `POST /config`, `DELETE /config`, `OPTIONS` (preflight). Toda rota exige `Authorization: Bearer <chave>` (comparação em tempo constante; 401). `Origin` só `http://127.0.0.1:P` ou `http://localhost:P` (403); ausente só em `GET`. `Host` só `127.0.0.1:P+2000` ou `localhost:P+2000` (403). `POST` exige `Content-Type: application/json` (415). CORS: `Allow-Origin` só a origem do harness, `Allow-Headers: Authorization, Content-Type`, `Allow-Methods: GET, POST, DELETE`.
- `/status`: `{estado, motor, host, porta, base, usuario, schema, senha_salva, erro, log}`; `estado` em `sem_banco`, `subindo`, `rodando`, `falhou`. Senha nunca aparece em resposta nenhuma.
- Validação: motor em `postgres|oracle|mariadb|sqlserver`; host não vazio, até 253, sem espaço; porta 1 a 65535 ou vazia (5432, 1521, 3306, 1433); base e usuário não vazios; senha vazia mantém a salva; schema vazio usa o padrão (Postgres `public`, Oracle usuário em maiúsculas, MariaDB nome da base, SQL Server `dbo`); nenhum campo com quebra de linha ou caractere de controle; corpo até 8 KB. Erro: 400 `{erro: "<campo>: <motivo>"}`.
- Release: tag `ctl-vX.Y.Z`; assets `cd2-ctl-<os>-<arch>[.exe]` e `SHA256SUMS`; build `CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=X.Y.Z"`. URL: `https://github.com/cd2tec/cd2-harness-pocket/releases/download/ctl-v<versão>/cd2-ctl-<os>-<arch>[.exe]`. `CTL_VERSION` fixa `0.6.0`, sobrescrevível por `CD2_CTL_VERSION`, nunca "latest". Destino `bin/ctl/<os>-<arch>/cd2-ctl[.exe]`, incluído no `CHECKSUMS.sha256`.
- Nomes: front "Harness Pocket" (`config.json`, título, fallback, selo "IA local · CD2 Harness Pocket"); site "IA de Bolso". Repositório, arquivos, README (título) e banner do terminal não mudam.
- Texto: português do Brasil, sem emoji, sem travessão. Launchers e stderr do `cd2-ctl` sem acento.
- `.bat` e `.ps1`: CRLF, ASCII, sem BOM. `.sh` e `.command`: LF.
- CSS só com tokens do `:root`.
- Testes: `cd ctl && go test ./...`; `node --test` na raiz.
- `VERSION` 0.6.0.
- Commits em português sem acento, terminando com uma linha em branco e `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Senha difícil ponta a ponta** (`'abc`, `"abc`, `a: b`, `a #b`, `a\b"c`, `$x y'z#`, `{x}: [y]`): vai do navegador ao `db.env` (que o `sh` da v0.5.0 lê igual), ao toolbox escapada, e nunca volta em resposta nem em log. Testes nas Tasks 1, 3, 4 e 7.
2. **Duplo clique em "Salvar e conectar"** (dois `POST /config` seguidos): o segundo espera o primeiro, nunca há dois toolbox; o front desabilita o botão. Teste de concorrência na Task 5 e passo manual na Task 12.
3. **Recarregar a página (F5) depois que o `#k=` saiu do endereço:** a chave continua no `sessionStorage` e o formulário segue habilitado; hash vazio não apaga a chave guardada. Teste na Task 11 (`readKeyFromHash('')` é `null`) e passo manual na Task 12.
4. **Toolbox que morre depois de pronto** (banco reiniciado, processo morto por fora): `/status` passa a `falhou` com mensagem, em vez de mentir `rodando`. Teste na Task 5.
5. **Quem já tem `db.env` da v0.5.0 e atualiza o pen drive:** o `cd2-ctl` lê o arquivo antigo e sobe sozinho no arranque. Testes nas Tasks 1 (arquivos de referência) e 5 (arranque com um deles).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `ctl/go.mod` | Módulo Go, sem dependências. |
| `ctl/main.go`, `ctl/main_test.go` | Flags, chave, porta de controle, sinais, montagem dos pacotes. |
| `ctl/build.sh` | Compila para `bin/ctl/<plataforma>/` (teste local, sem release). |
| `ctl/internal/dbconf/dbconf.go` | `Config`, formato do `db.env` (`Format`, `Parse`, `Load`, `Save`, `Remove`). |
| `ctl/internal/dbconf/private_unix.go`, `private_windows.go` | Criação do arquivo temporário só do dono (0600 ou ACL). |
| `ctl/internal/dbconf/validate.go` | `Input`, `Validate`, `Check`, padrões por motor, `FieldError`. |
| `ctl/internal/dbconf/testdata/v050-1.env` a `v050-7.env` | Arquivos gravados pela v0.5.0, um por senha difícil. |
| `ctl/internal/secret/secret.go` | `YamlDQ` e `Scrubber` (filtro de log linha a linha). |
| `ctl/internal/faketoolbox/fake.go` | Toolbox falso para testes (o binário de teste vira toolbox). |
| `ctl/internal/toolbox/supervisor.go`, `mcp.go`, `binary.go`, `proc_unix.go`, `proc_windows.go` | Copiar, subir, conferir e derrubar o toolbox. |
| `ctl/internal/control/control.go` | Estado, arranque, troca com rollback, mutex. |
| `ctl/internal/api/api.go` | Rotas HTTP e checagens de segurança. |
| `tests/ctl/e2e.sh` | Ponta a ponta com toolbox real e Postgres do Docker. |
| `.github/workflows/ci.yml`, `ctl-release.yml` | Testes em PR/push e release por tag. |
| `core/prepare-unix.sh`, `core/prepare-windows.ps1` | Baixam e conferem o `cd2-ctl`. |
| `core/make-usb-unix.sh`, `core/make-usb-windows.ps1` | Listagem final e estimativa. |
| `core/start-unix.sh`, `core/start-windows.ps1` | Trio de portas, chave, `cd2-ctl`, URL com `#k=`. |
| `INICIAR-CD2-Mac.command`, `iniciar-cd2-linux.sh`, `INICIAR-CD2-Windows.bat` | Param de repassar argumentos. |
| `core/db-env.sh`, `tests/db-env.test.js` | Removidos. |
| `tests/toolbox/check-recipe.sh` | Escape YAML próprio (sem `db-env.sh`). |
| `web/toolbox.js`, `tests/toolbox.test.js` | `ctlUrlFor`, `readKeyFromHash`, `configPayload`, `defaultsFor`, `ctlStatusLines`. |
| `web/index.html`, `web/config.json`, `web/mcp.js` | Formulário, chave, chamadas ao `cd2-ctl`, nome Harness Pocket, versão do cliente MCP. |
| `docs/index.html`, `README.md`, `docs/criar-pendrive.md`, `VERSION` | IA de Bolso, documentação, 0.6.0. |

---

### Task 1: Go instalado, módulo `ctl/` e o `db.env` em Go

**Files:**
- Create: `ctl/go.mod`
- Create: `ctl/internal/dbconf/dbconf.go`
- Create: `ctl/internal/dbconf/private_unix.go`
- Create: `ctl/internal/dbconf/private_windows.go`
- Create: `ctl/internal/dbconf/testdata/v050-1.env` … `v050-7.env` (gerados)
- Test: `ctl/internal/dbconf/dbconf_test.go`

**Interfaces:**
- Consumes: nada.
- Produces (pacote `github.com/cd2tec/cd2-harness-pocket/ctl/internal/dbconf`):
  - `type Config struct { Engine, Host, Port, Name, User, Password, Schema string }` (comparável com `==`)
  - `func (c Config) Env() []string` → `["CD2_DB_ENGINE=...", ..., "CD2_DB_SCHEMA=..."]` sem aspas, na ordem do `db.env`
  - `func Format(c Config) []byte`
  - `func Parse(r io.Reader) (Config, error)`
  - `func Load(path string) (Config, error)` (arquivo ausente: `errors.Is(err, fs.ErrNotExist)`)
  - `func Save(path string, c Config) error` (atômico, só do dono)
  - `func Remove(path string) error` (ausente não é erro)

- [ ] **Step 1: Instalar o Go (perguntar ao usuário antes)**

Diga ao usuário: "Vou instalar o Go com `brew install go` (só quem mexe em `ctl/` precisa). Posso?" Só depois do sim:

```bash
brew install go
go version
```
Expected: `go version go1.2x.y darwin/arm64` (1.23 ou mais novo).

- [ ] **Step 2: Criar o módulo**

`ctl/go.mod`:

```
module github.com/cd2tec/cd2-harness-pocket/ctl

go 1.23
```

- [ ] **Step 3: Gerar os arquivos de referência da v0.5.0 com o próprio `core/db-env.sh`**

Run (na raiz):
```bash
mkdir -p ctl/internal/dbconf/testdata
i=0; for pw in "'abc" '"abc' 'a: b' 'a #b' 'a\b"c' "\$x y'z#" '{x}: [y]'; do i=$((i+1)); sh -c '. core/db-env.sh; db_env_write "$1" postgres db.local 5432 cd2 leitor "$2" public' _ "ctl/internal/dbconf/testdata/v050-$i.env" "$pw"; done
grep -h PASSWORD ctl/internal/dbconf/testdata/v050-*.env
```
Expected (exatamente, nesta ordem):
```
CD2_DB_PASSWORD=''\''abc'
CD2_DB_PASSWORD='"abc'
CD2_DB_PASSWORD='a: b'
CD2_DB_PASSWORD='a #b'
CD2_DB_PASSWORD='a\b"c'
CD2_DB_PASSWORD='$x y'\''z#'
CD2_DB_PASSWORD='{x}: [y]'
```
E `cat ctl/internal/dbconf/testdata/v050-1.env` mostra as sete linhas `CD2_DB_ENGINE='postgres'`, `CD2_DB_HOST='db.local'`, `CD2_DB_PORT='5432'`, `CD2_DB_NAME='cd2'`, `CD2_DB_USER='leitor'`, `CD2_DB_PASSWORD=''\''abc'`, `CD2_DB_SCHEMA='public'`.

- [ ] **Step 4: Escrever os testes**

`ctl/internal/dbconf/dbconf_test.go`:

```go
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
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `cd ctl && go test ./internal/dbconf/`
Expected: FAIL de compilação, `undefined: Config` (e `Format`, `Load`, `Save`...).

- [ ] **Step 6: Implementar**

`ctl/internal/dbconf/dbconf.go`:

```go
// Package dbconf guarda a conexão com o banco do cd2-ctl: o tipo Config, o arquivo db.env
// (mesmo formato da v0.5.0, gravado antes pelo core/db-env.sh) e a validação dos campos da tela.
package dbconf

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"strings"
	"time"
)

// Config é uma conexão completa. Port fica como texto, igual ao db.env.
type Config struct {
	Engine   string
	Host     string
	Port     string
	Name     string
	User     string
	Password string
	Schema   string
}

// envKeys na ordem em que a v0.5.0 grava o db.env (db_env_write).
var envKeys = []string{
	"CD2_DB_ENGINE", "CD2_DB_HOST", "CD2_DB_PORT", "CD2_DB_NAME",
	"CD2_DB_USER", "CD2_DB_PASSWORD", "CD2_DB_SCHEMA",
}

func (c Config) values() []string {
	return []string{c.Engine, c.Host, c.Port, c.Name, c.User, c.Password, c.Schema}
}

func (c *Config) set(key, v string) {
	switch key {
	case "CD2_DB_ENGINE":
		c.Engine = v
	case "CD2_DB_HOST":
		c.Host = v
	case "CD2_DB_PORT":
		c.Port = v
	case "CD2_DB_NAME":
		c.Name = v
	case "CD2_DB_USER":
		c.User = v
	case "CD2_DB_PASSWORD":
		c.Password = v
	case "CD2_DB_SCHEMA":
		c.Schema = v
	}
}

// Env devolve as sete variáveis CHAVE=valor, sem aspas, para o ambiente do toolbox.
func (c Config) Env() []string {
	vals := c.values()
	out := make([]string, len(envKeys))
	for i, k := range envKeys {
		out[i] = k + "=" + vals[i]
	}
	return out
}

// quote põe o valor entre aspas simples, com ' escrito como '\'' (o sh lê de volta igual).
func quote(v string) string { return "'" + strings.ReplaceAll(v, "'", `'\''`) + "'" }

// Format devolve o conteúdo do db.env: sete linhas CD2_DB_<CAMPO>='<valor>'.
func Format(c Config) []byte {
	var b bytes.Buffer
	vals := c.values()
	for i, k := range envKeys {
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(quote(vals[i]))
		b.WriteByte('\n')
	}
	return b.Bytes()
}

// unquote lê um valor do jeito do sh: trechos '...' literais, \x vira x, o resto como está.
func unquote(v string) (string, error) {
	var b strings.Builder
	for i := 0; i < len(v); {
		switch {
		case v[i] == '\'':
			j := strings.IndexByte(v[i+1:], '\'')
			if j < 0 {
				return "", errors.New("aspas sem fechar")
			}
			b.WriteString(v[i+1 : i+1+j])
			i += j + 2
		case v[i] == '\\' && i+1 < len(v):
			b.WriteByte(v[i+1])
			i += 2
		default:
			b.WriteByte(v[i])
			i++
		}
	}
	return b.String(), nil
}

// Parse lê um db.env. Aceita linhas em branco, comentários (#), CRLF, valores sem aspas e
// ignora chaves desconhecidas. Sem CD2_DB_ENGINE é erro.
func Parse(r io.Reader) (Config, error) {
	known := map[string]bool{}
	for _, k := range envKeys {
		known[k] = true
	}
	var c Config
	sc := bufio.NewScanner(r)
	n := 0
	for sc.Scan() {
		n++
		line := strings.TrimRight(sc.Text(), "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok || !known[key] {
			continue
		}
		v, err := unquote(val)
		if err != nil {
			return Config{}, fmt.Errorf("db.env linha %d: %v", n, err)
		}
		c.set(key, v)
	}
	if err := sc.Err(); err != nil {
		return Config{}, err
	}
	if c.Engine == "" {
		return Config{}, errors.New("db.env sem CD2_DB_ENGINE")
	}
	return c, nil
}

// Load lê o db.env do caminho. Arquivo ausente: errors.Is(err, fs.ErrNotExist).
func Load(path string) (Config, error) {
	f, err := os.Open(path)
	if err != nil {
		return Config{}, err
	}
	defer f.Close()
	return Parse(f)
}

// Save grava de forma atômica: temporário no mesmo diretório, criado já só do dono
// (createPrivate), depois rename por cima do db.env.
func Save(path string, c Config) error {
	tmp := fmt.Sprintf("%s.%d.tmp", path, time.Now().UnixNano())
	f, err := createPrivate(tmp)
	if err != nil {
		return err
	}
	_, werr := f.Write(Format(c))
	if werr == nil {
		werr = f.Sync()
	}
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		_ = os.Remove(tmp)
		return werr
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// Remove apaga o db.env. Arquivo ausente não é erro.
func Remove(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}
```

`ctl/internal/dbconf/private_unix.go`:

```go
//go:build !windows

package dbconf

import "os"

// createPrivate cria o arquivo novo (falha se já existir) com permissão 0600.
func createPrivate(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, err
	}
	// a umask só tira bits; o Chmod garante 0600 qualquer que seja ela
	if err := f.Chmod(0o600); err != nil {
		f.Close()
		_ = os.Remove(path)
		return nil, err
	}
	return f, nil
}
```

`ctl/internal/dbconf/private_windows.go`:

```go
//go:build windows

package dbconf

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

// advapi32 e kernel32 são KnownDLLs: o Windows carrega sempre a do System32.
var (
	advapi32          = syscall.NewLazyDLL("advapi32.dll")
	procConvertSDDLSD = advapi32.NewProc("ConvertStringSecurityDescriptorToSecurityDescriptorW")
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	procLocalFree     = kernel32.NewProc("LocalFree")
)

// createPrivate cria o arquivo novo já com a ACL só do usuário atual: DACL protegida
// (sem herança) com acesso total para o SID dele e mais ninguém. A ACL vale antes de
// qualquer byte ser escrito.
func createPrivate(path string) (*os.File, error) {
	tok, err := syscall.OpenCurrentProcessToken()
	if err != nil {
		return nil, err
	}
	defer tok.Close()
	tu, err := tok.GetTokenUser()
	if err != nil {
		return nil, err
	}
	sid, err := tu.User.Sid.String()
	if err != nil {
		return nil, err
	}
	sddl, err := syscall.UTF16PtrFromString("D:P(A;;FA;;;" + sid + ")")
	if err != nil {
		return nil, err
	}
	var sd uintptr
	r, _, e := procConvertSDDLSD.Call(uintptr(unsafe.Pointer(sddl)), 1, uintptr(unsafe.Pointer(&sd)), 0)
	if r == 0 {
		return nil, fmt.Errorf("descritor de segurança: %v", e)
	}
	defer procLocalFree.Call(sd)
	sa := syscall.SecurityAttributes{Length: uint32(unsafe.Sizeof(syscall.SecurityAttributes{})), SecurityDescriptor: sd}
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := syscall.CreateFile(p, syscall.GENERIC_WRITE, 0, &sa, syscall.CREATE_NEW, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(h), path), nil
}
```

- [ ] **Step 7: Formatar, rodar e ver passar (inclusive a compilação para Windows)**

Run:
```bash
cd ctl && gofmt -w . && go vet ./... && GOOS=windows go vet ./... && go test ./internal/dbconf/ -v
```
Expected: `gofmt` sem saída, os dois `go vet` sem saída, e `PASS` com os oito testes (`TestFormatIgualAoDaV050`, `TestLoadLeArquivoDaV050`, `TestSaveGravaSoDoDonoEVoltaIgual`, `TestShLeOQueOGoGrava`, `TestParseToleraCRLFComentarioESemAspas`, `TestParseRecusaArquivoQuebrado`, `TestRemove`, `TestEnvSemAspas`).

- [ ] **Step 8: Commit**

```bash
git add ctl/go.mod ctl/internal/dbconf
git commit -m "$(printf 'ctl: modulo Go e leitura e escrita do db.env no formato da v0.5.0\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 2: Validação dos campos e padrões por motor

**Files:**
- Create: `ctl/internal/dbconf/validate.go`
- Test: `ctl/internal/dbconf/validate_test.go`

**Interfaces:**
- Consumes: `Config` (Task 1).
- Produces (pacote `dbconf`):
  - `var Engines = []string{"postgres", "oracle", "mariadb", "sqlserver"}`
  - `func DefaultPort(engine string) int` (0 se desconhecido)
  - `func DefaultSchema(engine, user, name string) string`
  - `type Input struct { Motor string \`json:"motor"\`; Host string \`json:"host"\`; Porta json.RawMessage \`json:"porta"\`; Base string \`json:"base"\`; Usuario string \`json:"usuario"\`; Senha *string \`json:"senha"\`; Schema string \`json:"schema"\` }`
  - `type FieldError struct { Field, Reason string }` com `Error() string` = `"<Field>: <Reason>"`
  - `func Validate(in Input, saved *Config) (Config, error)` (erro sempre `*FieldError`)
  - `func (c Config) Check() error` (mesmas regras, para o `db.env` lido do disco)

- [ ] **Step 1: Escrever os testes**

`ctl/internal/dbconf/validate_test.go`:

```go
package dbconf

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func str(s string) *string { return &s }

func good() Input {
	return Input{Motor: "postgres", Host: "db.local", Porta: json.RawMessage(`5432`), Base: "cd2", Usuario: "leitor", Senha: str("x")}
}

func TestValidatePreencheOsPadroes(t *testing.T) {
	cases := []struct {
		in           Input
		port, schema string
	}{
		{Input{Motor: "postgres", Host: "h", Base: "cd2", Usuario: "u"}, "5432", "public"},
		{Input{Motor: "oracle", Host: "h", Base: "FREEPDB1", Usuario: "leitor"}, "1521", "LEITOR"},
		{Input{Motor: "mariadb", Host: "h", Base: "loja", Usuario: "u"}, "3306", "loja"},
		{Input{Motor: "sqlserver", Host: "h", Base: "d", Usuario: "u"}, "1433", "dbo"},
		{Input{Motor: "postgres", Host: "h", Porta: json.RawMessage(`"6543"`), Base: "d", Usuario: "u", Schema: "vendas"}, "6543", "vendas"},
		{Input{Motor: "postgres", Host: "h", Porta: json.RawMessage(`""`), Base: "d", Usuario: "u"}, "5432", "public"},
		{Input{Motor: "postgres", Host: "h", Porta: json.RawMessage(`null`), Base: "d", Usuario: "u"}, "5432", "public"},
	}
	for _, tc := range cases {
		c, err := Validate(tc.in, nil)
		if err != nil {
			t.Errorf("%s: %v", tc.in.Motor, err)
			continue
		}
		if c.Port != tc.port || c.Schema != tc.schema {
			t.Errorf("%s: porta %q schema %q, quero %q %q", tc.in.Motor, c.Port, c.Schema, tc.port, tc.schema)
		}
	}
}

func TestValidateAparaMenosASenha(t *testing.T) {
	in := good()
	in.Host, in.Usuario, in.Base, in.Schema, in.Senha = "  db.local ", " leitor", "cd2 ", " public ", str(" com espaço ")
	c, err := Validate(in, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := Config{Engine: "postgres", Host: "db.local", Port: "5432", Name: "cd2", User: "leitor", Password: " com espaço ", Schema: "public"}
	if c != want {
		t.Errorf("Validate = %+v", c)
	}
}

func TestValidateRecusaComMensagemPorCampo(t *testing.T) {
	cases := []struct {
		mut  func(*Input)
		want string
	}{
		{func(i *Input) { i.Motor = "mysql" }, "motor: use postgres, oracle, mariadb ou sqlserver"},
		{func(i *Input) { i.Host = "" }, "host: obrigatório"},
		{func(i *Input) { i.Host = strings.Repeat("a", 254) }, "host: até 253 caracteres"},
		{func(i *Input) { i.Host = "db local" }, "host: não pode ter espaço"},
		{func(i *Input) { i.Host = "db.local\n" }, "host: não pode ter quebra de linha nem caractere de controle"},
		{func(i *Input) { i.Porta = json.RawMessage(`0`) }, "porta: use um número de 1 a 65535"},
		{func(i *Input) { i.Porta = json.RawMessage(`65536`) }, "porta: use um número de 1 a 65535"},
		{func(i *Input) { i.Porta = json.RawMessage(`5432.5`) }, "porta: use um número de 1 a 65535"},
		{func(i *Input) { i.Porta = json.RawMessage(`-1`) }, "porta: use um número de 1 a 65535"},
		{func(i *Input) { i.Porta = json.RawMessage(`"abc"`) }, "porta: use um número de 1 a 65535"},
		{func(i *Input) { i.Porta = json.RawMessage(`"12 34"`) }, "porta: use um número de 1 a 65535"},
		{func(i *Input) { i.Base = "  " }, "base: obrigatório"},
		{func(i *Input) { i.Base = "cd2\x00" }, "base: não pode ter quebra de linha nem caractere de controle"},
		{func(i *Input) { i.Usuario = "" }, "usuario: obrigatório"},
		{func(i *Input) { i.Senha = str("a\nb") }, "senha: não pode ter quebra de linha nem caractere de controle"},
		{func(i *Input) { i.Schema = "pub\tlic" }, "schema: não pode ter quebra de linha nem caractere de controle"},
	}
	for _, tc := range cases {
		in := good()
		tc.mut(&in)
		_, err := Validate(in, nil)
		var fe *FieldError
		if !errors.As(err, &fe) {
			t.Errorf("quero %q, veio %v", tc.want, err)
			continue
		}
		if fe.Error() != tc.want {
			t.Errorf("veio %q, quero %q", fe.Error(), tc.want)
		}
	}
}

func TestValidateSenhaVaziaMantemASalva(t *testing.T) {
	saved := &Config{Password: "antiga"}
	for _, s := range []*string{nil, str("")} {
		in := good()
		in.Senha = s
		c, err := Validate(in, saved)
		if err != nil {
			t.Fatal(err)
		}
		if c.Password != "antiga" {
			t.Errorf("senha %v: ficou %q", s, c.Password)
		}
	}
	c, _ := Validate(good(), saved)
	if c.Password != "x" {
		t.Errorf("senha nova não valeu: %q", c.Password)
	}
	in := good()
	in.Senha = nil
	c, _ = Validate(in, nil)
	if c.Password != "" {
		t.Errorf("sem salva, vazia deveria ser vazia: %q", c.Password)
	}
}

func TestCheck(t *testing.T) {
	if err := sample("x").Check(); err != nil {
		t.Errorf("config boa recusada: %v", err)
	}
	if err := (Config{Engine: "postgres"}).Check(); err == nil || err.Error() != "host: obrigatório" {
		t.Errorf("host vazio: %v", err)
	}
	bad := sample("x")
	bad.Port = "abc"
	if err := bad.Check(); err == nil {
		t.Error("porta abc passou")
	}
	bad = sample("x")
	bad.Engine = "db2"
	if err := bad.Check(); err == nil {
		t.Error("motor desconhecido passou")
	}
}

func TestPadroes(t *testing.T) {
	if DefaultPort("oracle") != 1521 || DefaultPort("xpto") != 0 {
		t.Error("DefaultPort")
	}
	if DefaultSchema("oracle", "leitor", "") != "LEITOR" || DefaultSchema("mariadb", "u", "loja") != "loja" || DefaultSchema("sqlserver", "", "") != "dbo" {
		t.Error("DefaultSchema")
	}
	if len(Engines) != 4 {
		t.Error("Engines")
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ctl && go test ./internal/dbconf/`
Expected: FAIL de compilação, `undefined: Input` (e `Validate`, `FieldError`...).

- [ ] **Step 3: Implementar**

`ctl/internal/dbconf/validate.go`:

```go
package dbconf

import (
	"encoding/json"
	"strconv"
	"strings"
	"unicode"
)

// Engines aceitos, na ordem da tela.
var Engines = []string{"postgres", "oracle", "mariadb", "sqlserver"}

var defaultPorts = map[string]int{"postgres": 5432, "oracle": 1521, "mariadb": 3306, "sqlserver": 1433}

const (
	msgControl = "não pode ter quebra de linha nem caractere de controle"
	msgPort    = "use um número de 1 a 65535"
	msgEngine  = "use postgres, oracle, mariadb ou sqlserver"
)

// DefaultPort devolve a porta padrão do motor (0 se o motor não existe).
func DefaultPort(engine string) int { return defaultPorts[engine] }

// DefaultSchema segue as regras da v0.5.0 (core/db-env.sh): Postgres public, Oracle o usuário
// em maiúsculas, MariaDB o nome da base, SQL Server dbo.
func DefaultSchema(engine, user, name string) string {
	switch engine {
	case "postgres":
		return "public"
	case "oracle":
		return strings.ToUpper(user)
	case "mariadb":
		return name
	case "sqlserver":
		return "dbo"
	}
	return ""
}

// Input é o corpo JSON de POST /config. Porta aceita número ou texto; Senha ausente ou vazia
// mantém a senha salva.
type Input struct {
	Motor   string          `json:"motor"`
	Host    string          `json:"host"`
	Porta   json.RawMessage `json:"porta"`
	Base    string          `json:"base"`
	Usuario string          `json:"usuario"`
	Senha   *string         `json:"senha"`
	Schema  string          `json:"schema"`
}

// FieldError é um campo inválido; Error() segue "<campo>: <motivo>".
type FieldError struct{ Field, Reason string }

func (e *FieldError) Error() string { return e.Field + ": " + e.Reason }

func bad(field, reason string) error { return &FieldError{Field: field, Reason: reason} }

func hasControl(s string) bool {
	for _, r := range s {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

func digits(s string) bool {
	if s == "" || len(s) > 5 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// parsePort aceita 5432, "5432", "" e null. Devolve 0 quando é para usar o padrão.
func parsePort(raw json.RawMessage) (int, error) {
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" {
		return 0, nil
	}
	if strings.HasPrefix(s, `"`) {
		var txt string
		if err := json.Unmarshal(raw, &txt); err != nil {
			return 0, bad("porta", msgPort)
		}
		if hasControl(txt) {
			return 0, bad("porta", msgControl)
		}
		s = strings.TrimSpace(txt)
		if s == "" {
			return 0, nil
		}
	}
	if !digits(s) {
		return 0, bad("porta", msgPort)
	}
	n, _ := strconv.Atoi(s)
	if n < 1 || n > 65535 {
		return 0, bad("porta", msgPort)
	}
	return n, nil
}

// check confere uma Config já normalizada (porta como texto).
func check(c Config) error {
	if defaultPorts[c.Engine] == 0 {
		return bad("motor", msgEngine)
	}
	fields := []struct{ name, v string }{
		{"host", c.Host}, {"porta", c.Port}, {"base", c.Name}, {"usuario", c.User}, {"senha", c.Password}, {"schema", c.Schema},
	}
	for _, f := range fields {
		if hasControl(f.v) {
			return bad(f.name, msgControl)
		}
	}
	if c.Host == "" {
		return bad("host", "obrigatório")
	}
	if len(c.Host) > 253 {
		return bad("host", "até 253 caracteres")
	}
	if strings.IndexFunc(c.Host, unicode.IsSpace) >= 0 {
		return bad("host", "não pode ter espaço")
	}
	if !digits(c.Port) {
		return bad("porta", msgPort)
	}
	if n, _ := strconv.Atoi(c.Port); n < 1 || n > 65535 {
		return bad("porta", msgPort)
	}
	if c.Name == "" {
		return bad("base", "obrigatório")
	}
	if c.User == "" {
		return bad("usuario", "obrigatório")
	}
	return nil
}

// Check confere uma Config lida do disco, com as mesmas regras da tela.
func (c Config) Check() error { return check(c) }

// Validate monta a configuração candidata a partir da tela. saved é a configuração em vigor
// (nil se não há nenhuma): senha ausente ou vazia herda a dela. Erro é sempre *FieldError.
func Validate(in Input, saved *Config) (Config, error) {
	raw := []struct{ name, v string }{
		{"motor", in.Motor}, {"host", in.Host}, {"base", in.Base}, {"usuario", in.Usuario}, {"schema", in.Schema},
	}
	for _, f := range raw {
		if hasControl(f.v) {
			return Config{}, bad(f.name, msgControl)
		}
	}
	if in.Senha != nil && hasControl(*in.Senha) {
		return Config{}, bad("senha", msgControl)
	}
	engine := strings.TrimSpace(in.Motor)
	if defaultPorts[engine] == 0 {
		return Config{}, bad("motor", msgEngine)
	}
	port, err := parsePort(in.Porta)
	if err != nil {
		return Config{}, err
	}
	if port == 0 {
		port = defaultPorts[engine]
	}
	c := Config{
		Engine: engine,
		Host:   strings.TrimSpace(in.Host),
		Port:   strconv.Itoa(port),
		Name:   strings.TrimSpace(in.Base),
		User:   strings.TrimSpace(in.Usuario),
		Schema: strings.TrimSpace(in.Schema),
	}
	if in.Senha != nil && *in.Senha != "" {
		c.Password = *in.Senha
	} else if saved != nil {
		c.Password = saved.Password
	}
	if c.Schema == "" {
		c.Schema = DefaultSchema(c.Engine, c.User, c.Name)
	}
	if err := check(c); err != nil {
		return Config{}, err
	}
	return c, nil
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd ctl && gofmt -w . && go vet ./... && go test ./internal/dbconf/ -v`
Expected: `PASS` (os testes da Task 1 e os seis novos).

- [ ] **Step 5: Commit**

```bash
git add ctl/internal/dbconf/validate.go ctl/internal/dbconf/validate_test.go
git commit -m "$(printf 'ctl: validacao dos campos do banco e padroes por motor\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 3: Escape YAML e filtro de log

**Files:**
- Create: `ctl/internal/secret/secret.go`
- Test: `ctl/internal/secret/secret_test.go`

**Interfaces:**
- Consumes: nada.
- Produces (pacote `github.com/cd2tec/cd2-harness-pocket/ctl/internal/secret`):
  - `func YamlDQ(s string) string`
  - `type Scrubber struct` (implementa `io.Writer`; seguro para uso concorrente; escreve em `out` uma linha completa terminada em `\n` por chamada)
  - `func NewScrubber(out io.Writer, password string) *Scrubber`
  - `func (s *Scrubber) Close() error` (repassa a última linha sem `\n`)
  - `func (s *Scrubber) Dropped() int`

- [ ] **Step 1: Escrever os testes**

`ctl/internal/secret/secret_test.go`:

```go
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ctl && go test ./internal/secret/`
Expected: FAIL de compilação, `undefined: YamlDQ`.

- [ ] **Step 3: Implementar**

`ctl/internal/secret/secret.go`:

```go
// Package secret protege a senha do banco: escape para o YAML do toolbox e filtro do log.
package secret

import (
	"bytes"
	"io"
	"strings"
	"sync"
)

var dq = strings.NewReplacer(`\`, `\\`, `"`, `\"`)

// YamlDQ escapa o valor para um escalar YAML entre aspas duplas: \ vira \\ e " vira \".
// O toolbox troca ${CD2_DB_PASSWORD} pelo texto antes de ler o YAML, e as receitas usam
// password: "${CD2_DB_PASSWORD}".
func YamlDQ(s string) string { return dq.Replace(s) }

// maxLine é o maior pedaço sem quebra de linha que o filtro guarda. Acima disso, o pedaço
// inteiro é descartado até a próxima quebra: cortar no meio poderia partir a senha em dois.
const maxLine = 64 << 10

// Scrubber repassa a saída do toolbox para out linha a linha, descartando toda linha que
// contém a senha (crua ou escapada para YAML, comparação literal) ou a palavra password em
// qualquer caixa. Seguro para uso concorrente.
type Scrubber struct {
	mu      sync.Mutex
	out     io.Writer
	secrets []string
	buf     []byte
	big     bool
	dropped int
}

// NewScrubber cria o filtro. Senha vazia não vira segredo (senão toda linha casaria).
func NewScrubber(out io.Writer, password string) *Scrubber {
	s := &Scrubber{out: out}
	if password != "" {
		s.secrets = append(s.secrets, password)
		if e := YamlDQ(password); e != password {
			s.secrets = append(s.secrets, e)
		}
	}
	return s
}

func (s *Scrubber) keep(line string) bool {
	if strings.Contains(strings.ToLower(line), "password") {
		return false
	}
	for _, sec := range s.secrets {
		if strings.Contains(line, sec) {
			return false
		}
	}
	return true
}

func (s *Scrubber) emit(line []byte) error {
	line = bytes.TrimSuffix(line, []byte("\r"))
	if !s.keep(string(line)) {
		s.dropped++
		return nil
	}
	out := make([]byte, 0, len(line)+1)
	out = append(append(out, line...), '\n')
	_, err := s.out.Write(out)
	return err
}

// Write guarda o pedaço sem quebra e repassa cada linha completa que passa no filtro.
func (s *Scrubber) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rest := p
	for len(rest) > 0 {
		i := bytes.IndexByte(rest, '\n')
		if i < 0 {
			if !s.big {
				s.buf = append(s.buf, rest...)
				if len(s.buf) > maxLine {
					s.buf, s.big = s.buf[:0], true
					s.dropped++
				}
			}
			return len(p), nil
		}
		chunk := rest[:i]
		rest = rest[i+1:]
		if s.big {
			s.big = false
			continue
		}
		line := append(s.buf, chunk...)
		err := s.emit(line)
		s.buf = s.buf[:0]
		if err != nil {
			return 0, err
		}
	}
	return len(p), nil
}

// Close repassa a última linha sem quebra, se houver. Depois dele, não chame Write.
func (s *Scrubber) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.big || len(s.buf) == 0 {
		s.buf, s.big = nil, false
		return nil
	}
	line := s.buf
	s.buf = nil
	return s.emit(line)
}

// Dropped conta as linhas descartadas.
func (s *Scrubber) Dropped() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dropped
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd ctl && gofmt -w . && go vet ./... && go test ./internal/secret/ -v`
Expected: `PASS` com os cinco testes.

- [ ] **Step 5: Commit**

```bash
git add ctl/internal/secret
git commit -m "$(printf 'ctl: escape YAML da senha e filtro de log linha a linha\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 4: Supervisor do toolbox (com toolbox falso para os testes)

**Files:**
- Create: `ctl/internal/faketoolbox/fake.go`
- Create: `ctl/internal/toolbox/supervisor.go`
- Create: `ctl/internal/toolbox/mcp.go`
- Create: `ctl/internal/toolbox/binary.go`
- Create: `ctl/internal/toolbox/proc_unix.go`
- Create: `ctl/internal/toolbox/proc_windows.go`
- Test: `ctl/internal/toolbox/supervisor_test.go`

**Interfaces:**
- Consumes: `dbconf.Config`, `Config.Env()` (Task 1); `secret.YamlDQ`, `secret.NewScrubber`, `(*Scrubber).Close`, `(*Scrubber).Dropped` (Task 3).
- Produces:
  - Pacote `.../ctl/internal/faketoolbox`: `const EnvVar = "CD2_FAKE_TOOLBOX"`, `const ReportVar = "CD2_FAKE_TOOLBOX_REPORT"`, `type Report struct { Args []string; Engine, Host, Password string; HasKey bool }` (tags JSON `args`, `engine`, `host`, `password`, `has_key`), `func Main()`.
  - Pacote `.../ctl/internal/toolbox`:
    - `type Options struct { Source, CacheDir, RecipeDir string; Port, HarnessPort int; ReadyTimeout, StopTimeout time.Duration }`
    - `type StartError struct { Msg string; Log []string }` com `Error() string` = `Msg`
    - `const MsgDied`, `const MsgToolError` (textos para a tela)
    - `func New(opt Options) *Supervisor`
    - `func (s *Supervisor) Start(cfg dbconf.Config) error` (falha sempre `*StartError`; bloqueia até pronto ou falha)
    - `func (s *Supervisor) Stop() error` (derruba e espera a porta liberar)
    - `func (s *Supervisor) Running() bool`
    - `func (s *Supervisor) LogPath() string` (`<cache>/toolbox.log`)
    - `Start` e `Stop` não são concorrentes entre si: quem chama serializa (o `control.Controller` da Task 5). `Running` pode ser chamado a qualquer hora.

Como o toolbox falso funciona: o `TestMain` do pacote olha `CD2_FAKE_TOOLBOX=1`; se estiver ligado, o próprio binário de teste vira toolbox (`faketoolbox.Main()`) em vez de rodar os testes. Os testes apontam `Options.Source` para `os.Executable()` e ligam a variável com `t.Setenv`, que o processo filho herda. O comportamento vem da senha recebida.

- [ ] **Step 1: Escrever o toolbox falso**

`ctl/internal/faketoolbox/fake.go`:

```go
// Package faketoolbox imita o MCP Toolbox nos testes do cd2-ctl. O binário de teste vira o
// toolbox falso quando roda com CD2_FAKE_TOOLBOX=1 (ver o TestMain dos pacotes toolbox e control).
package faketoolbox

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

// EnvVar liga o modo toolbox falso.
const EnvVar = "CD2_FAKE_TOOLBOX"

// ReportVar, se definida, é o arquivo onde o falso grava os argumentos e o ambiente que recebeu.
const ReportVar = "CD2_FAKE_TOOLBOX_REPORT"

// Report é o que o falso recebeu do supervisor.
type Report struct {
	Args     []string `json:"args"`
	Engine   string   `json:"engine"`
	Host     string   `json:"host"`
	Password string   `json:"password"`
	HasKey   bool     `json:"has_key"`
}

// unescape desfaz o escape YAML (\\ e \"), para o falso imprimir também a senha crua.
var unescape = strings.NewReplacer(`\\`, `\`, `\"`, `"`)

// Main roda o toolbox falso e não volta. O comportamento vem da senha (já escapada, como o
// toolbox recebe em CD2_DB_PASSWORD):
//
//	morre...   imprime a senha crua, a escapada e uma linha com "Password", e sai com 1
//	lenta...   nunca abre a porta
//	iserror... sobe, mas db_connection_status devolve isError
//	outra      sobe e responde como o toolbox de verdade
func Main() {
	fs := flag.NewFlagSet("toolbox", flag.ExitOnError)
	port := fs.Int("port", 0, "")
	fs.String("config", "", "")
	fs.String("address", "", "")
	fs.String("allowed-hosts", "", "")
	fs.String("allowed-origins", "", "")
	fs.Bool("disable-reload", false, "")
	_ = fs.Parse(os.Args[1:])
	pw := os.Getenv("CD2_DB_PASSWORD")
	if f := os.Getenv(ReportVar); f != "" {
		b, _ := json.Marshal(Report{
			Args: os.Args[1:], Engine: os.Getenv("CD2_DB_ENGINE"), Host: os.Getenv("CD2_DB_HOST"),
			Password: pw, HasKey: os.Getenv("CD2_CTL_KEY") != "",
		})
		_ = os.WriteFile(f, b, 0o600)
	}
	fmt.Printf("INFO toolbox falso para %s\n", os.Getenv("CD2_DB_ENGINE"))
	switch {
	case strings.HasPrefix(pw, "morre"):
		fmt.Printf("ERROR conectando com a senha %s\n", unescape.Replace(pw))
		fmt.Printf("ERROR valor lido: %s\n", pw)
		fmt.Fprintln(os.Stderr, "Error: failed SASL auth: FATAL: Password authentication failed")
		fmt.Fprintln(os.Stderr, "Error: toolbox failed to initialize")
		os.Exit(1)
	case strings.HasPrefix(pw, "lenta"):
		time.Sleep(time.Hour)
		os.Exit(0)
	}
	isError := strings.HasPrefix(pw, "iserror")
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		fmt.Fprint(w, "ok")
	})
	mux.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		var result any = map[string]any{}
		switch req.Method {
		case "initialize":
			result = map[string]any{"protocolVersion": "2025-06-18", "capabilities": map[string]any{}, "serverInfo": map[string]any{"name": "falso"}}
		case "tools/call":
			result = map[string]any{"content": []any{map[string]any{"type": "text", "text": `{"engine":"postgres"}`}}, "isError": isError}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
	})
	err := http.ListenAndServe(fmt.Sprintf("127.0.0.1:%d", *port), mux)
	fmt.Fprintln(os.Stderr, "Error:", err)
	os.Exit(1)
}
```

- [ ] **Step 2: Escrever os testes do supervisor**

`ctl/internal/toolbox/supervisor_test.go`:

```go
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd ctl && go test ./internal/toolbox/`
Expected: FAIL de compilação, `undefined: Supervisor` (e `New`, `Options`, `StartError`...).

- [ ] **Step 4: Implementar o supervisor**

`ctl/internal/toolbox/supervisor.go`:

```go
// Package toolbox copia, sobe, confere e derruba o MCP Toolbox for Databases para o cd2-ctl.
package toolbox

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/dbconf"
	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/secret"
)

// Mensagens que vão para a tela (campo erro de /status).
const (
	MsgDied      = "O toolbox não conectou ao banco. Confira host, porta, base, usuário e senha."
	MsgToolError = "O banco respondeu com erro ao testar a conexão. Confira usuário, senha e permissões."
)

// Options diz onde está cada coisa e quanto esperar.
type Options struct {
	Source       string        // binário no pen drive: <root>/bin/toolbox/<os>-<arch>/toolbox[.exe]
	CacheDir     string        // cópia executável e toolbox.log
	RecipeDir    string        // <root>/core/toolbox
	Port         int           // P+1000
	HarnessPort  int           // P
	ReadyTimeout time.Duration // 15 s
	StopTimeout  time.Duration // 5 s para a porta liberar
}

// StartError é uma subida que falhou: Msg vai para a tela, Log são as últimas linhas já filtradas.
type StartError struct {
	Msg string
	Log []string
}

func (e *StartError) Error() string { return e.Msg }

// Supervisor cuida de um toolbox por vez. Start e Stop não são concorrentes entre si (quem chama
// serializa); Running pode ser chamado a qualquer hora.
type Supervisor struct {
	opt    Options
	copied bool

	mu   sync.Mutex
	cmd  *exec.Cmd
	done chan struct{}
}

// New aplica os prazos padrão (15 s e 5 s) quando vêm zerados.
func New(opt Options) *Supervisor {
	if opt.ReadyTimeout == 0 {
		opt.ReadyTimeout = 15 * time.Second
	}
	if opt.StopTimeout == 0 {
		opt.StopTimeout = 5 * time.Second
	}
	return &Supervisor{opt: opt}
}

// LogPath é o toolbox.log do cache (só linhas que passaram pelo filtro).
func (s *Supervisor) LogPath() string { return filepath.Join(s.opt.CacheDir, "toolbox.log") }

// Running diz se o toolbox da última subida continua vivo.
func (s *Supervisor) Running() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.done == nil {
		return false
	}
	select {
	case <-s.done:
		return false
	default:
		return true
	}
}

// Start sobe o toolbox com cfg e só volta quando ele está pronto (nil) ou falhou (*StartError,
// já com o processo derrubado).
func (s *Supervisor) Start(cfg dbconf.Config) error {
	if s.Running() {
		return &StartError{Msg: "O toolbox já está rodando."}
	}
	bin, err := s.prepareBinary()
	if err != nil {
		return &StartError{Msg: "Não consegui preparar o toolbox: " + err.Error()}
	}
	logf, err := os.OpenFile(s.LogPath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return &StartError{Msg: "Não consegui abrir o toolbox.log: " + err.Error()}
	}
	last := &tail{max: 15}
	scrub := secret.NewScrubber(io.MultiWriter(logf, last), cfg.Password)
	cmd := exec.Command(bin, s.args(cfg.Engine)...)
	cmd.Env = s.env(cfg)
	cmd.Stdout, cmd.Stderr = scrub, scrub
	cmd.WaitDelay = 2 * time.Second
	if err := cmd.Start(); err != nil {
		logf.Close()
		return &StartError{Msg: "Não consegui iniciar o toolbox: " + err.Error()}
	}
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		_ = scrub.Close()
		_ = logf.Close()
		close(done)
	}()
	s.mu.Lock()
	s.cmd, s.done = cmd, done
	s.mu.Unlock()
	if msg := s.waitReady(done); msg != "" {
		_ = s.Stop()
		lines := last.lines()
		if n := scrub.Dropped(); n > 0 {
			lines = append(lines, fmt.Sprintf("(%d linha(s) omitida(s) por citar a senha)", n))
		}
		return &StartError{Msg: msg, Log: lines}
	}
	return nil
}

// Stop derruba o toolbox (TERM no Unix, Kill no Windows; Kill depois de 3 s) e espera a porta
// liberar por até StopTimeout.
func (s *Supervisor) Stop() error {
	s.mu.Lock()
	cmd, done := s.cmd, s.done
	s.cmd, s.done = nil, nil
	s.mu.Unlock()
	if cmd == nil {
		return nil
	}
	select {
	case <-done:
	default:
		terminate(cmd.Process)
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			_ = cmd.Process.Kill()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
			}
		}
	}
	return waitPortFree(s.opt.Port, s.opt.StopTimeout)
}

func (s *Supervisor) args(engine string) []string {
	tb, h := strconv.Itoa(s.opt.Port), strconv.Itoa(s.opt.HarnessPort)
	return []string{
		"--config", filepath.Join(s.opt.RecipeDir, engine+".yaml"),
		"--address", "127.0.0.1", "--port", tb,
		"--allowed-hosts", "127.0.0.1:" + tb + ",localhost:" + tb,
		"--allowed-origins", "http://127.0.0.1:" + h + ",http://localhost:" + h,
		"--disable-reload",
	}
}

// env é o ambiente do cd2-ctl sem a chave da sessão e sem CD2_DB_* herdado, mais a conexão
// com a senha escapada para o escalar "..." das receitas.
func (s *Supervisor) env(cfg dbconf.Config) []string {
	var env []string
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "CD2_DB_") || strings.HasPrefix(kv, "CD2_CTL_KEY=") {
			continue
		}
		env = append(env, kv)
	}
	c := cfg
	c.Password = secret.YamlDQ(cfg.Password)
	return append(env, c.Env()...)
}

// waitReady devolve "" quando pronto, ou a mensagem para a tela.
func (s *Supervisor) waitReady(done <-chan struct{}) string {
	base := "http://127.0.0.1:" + strconv.Itoa(s.opt.Port)
	client := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(s.opt.ReadyTimeout)
	for {
		select {
		case <-done:
			return MsgDied
		default:
		}
		err := probe(client, base)
		if err == nil {
			return ""
		}
		if errors.Is(err, errToolError) {
			return MsgToolError
		}
		if time.Now().After(deadline) {
			return fmt.Sprintf("O banco não respondeu em %d segundos. Confira host, porta e firewall.", int(s.opt.ReadyTimeout/time.Second))
		}
		select {
		case <-done:
			return MsgDied
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func waitPortFree(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			l.Close()
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("a porta %d continua ocupada", port)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// tail guarda as últimas max linhas que passaram pelo filtro (o Scrubber escreve uma por vez).
type tail struct {
	mu  sync.Mutex
	max int
	buf []string
}

func (t *tail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, l := range strings.Split(strings.TrimRight(string(p), "\n"), "\n") {
		t.buf = append(t.buf, l)
		if len(t.buf) > t.max {
			t.buf = t.buf[1:]
		}
	}
	return len(p), nil
}

func (t *tail) lines() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]string(nil), t.buf...)
}
```

`ctl/internal/toolbox/mcp.go`:

```go
package toolbox

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const protocolVersion = "2025-06-18"

var errToolError = errors.New("db_connection_status voltou com isError")

// probe: GET / tem de dar 200 e db_connection_status tem de voltar sem isError.
func probe(c *http.Client, base string) error {
	resp, err := c.Get(base + "/")
	if err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET / respondeu %d", resp.StatusCode)
	}
	sid, _, err := rpc(c, base+"/mcp", "", 1, "initialize", map[string]any{
		"protocolVersion": protocolVersion, "capabilities": map[string]any{},
		"clientInfo": map[string]any{"name": "cd2-ctl", "version": "1"},
	})
	if err != nil {
		return err
	}
	_, res, err := rpc(c, base+"/mcp", sid, 2, "tools/call", map[string]any{"name": "db_connection_status", "arguments": map[string]any{}})
	if err != nil {
		return err
	}
	var out struct {
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(res, &out); err != nil {
		return err
	}
	if out.IsError {
		return errToolError
	}
	return nil
}

// rpc faz uma chamada JSON-RPC no MCP (Streamable HTTP; resposta em JSON ou SSE). Devolve o
// Mcp-Session-Id (se o servidor mandar) e o result.
func rpc(c *http.Client, url, sid string, id int, method string, params any) (string, json.RawMessage, error) {
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	if err != nil {
		return "", nil, err
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if method != "initialize" {
		req.Header.Set("MCP-Protocol-Version", protocolVersion)
	}
	if sid != "" {
		req.Header.Set("Mcp-Session-Id", sid)
	}
	resp, err := c.Do(req)
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("%s respondeu HTTP %d", method, resp.StatusCode)
	}
	if strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
		data = sseData(data)
	}
	var msg struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(data, &msg); err != nil {
		return "", nil, fmt.Errorf("%s: resposta inválida", method)
	}
	if msg.Error != nil {
		return "", nil, fmt.Errorf("%s: %s", method, msg.Error.Message)
	}
	if sid == "" {
		sid = resp.Header.Get("Mcp-Session-Id")
	}
	return sid, msg.Result, nil
}

// sseData junta as linhas data: do primeiro evento.
func sseData(b []byte) []byte {
	var out []string
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.HasPrefix(line, "data:") {
			out = append(out, strings.TrimSpace(line[5:]))
		} else if line == "" && len(out) > 0 {
			break
		}
	}
	return []byte(strings.Join(out, "\n"))
}
```

`ctl/internal/toolbox/binary.go`:

```go
package toolbox

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func exeName() string {
	if runtime.GOOS == "windows" {
		return "toolbox.exe"
	}
	return "toolbox"
}

// prepareBinary copia o toolbox do pen drive para o cache quando mudou (exFAT/FAT não guarda
// permissão de execução) e, no Mac, tira a quarentena. Confere uma vez por processo.
func (s *Supervisor) prepareBinary() (string, error) {
	dst := filepath.Join(s.opt.CacheDir, exeName())
	if s.copied {
		return dst, nil
	}
	if _, err := os.Stat(s.opt.Source); err != nil {
		return "", fmt.Errorf("binário não encontrado em %s", s.opt.Source)
	}
	same, err := sameContent(s.opt.Source, dst)
	if err != nil {
		return "", err
	}
	if !same {
		if err := copyFile(s.opt.Source, dst+".tmp"); err != nil {
			return "", err
		}
		if err := os.Rename(dst+".tmp", dst); err != nil {
			_ = os.Remove(dst + ".tmp")
			return "", err
		}
		if runtime.GOOS == "darwin" {
			_ = exec.Command("xattr", "-dr", "com.apple.quarantine", dst).Run()
		}
	}
	_ = os.Chmod(dst, 0o755)
	s.copied = true
	return dst, nil
}

func sameContent(a, b string) (bool, error) {
	sb, err := os.Stat(b)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	sa, err := os.Stat(a)
	if err != nil {
		return false, err
	}
	if sa.Size() != sb.Size() {
		return false, nil
	}
	ha, err := fileHash(a)
	if err != nil {
		return false, err
	}
	hb, err := fileHash(b)
	if err != nil {
		return false, err
	}
	return bytes.Equal(ha, hb), nil
}

func fileHash(p string) ([]byte, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return nil, err
	}
	return h.Sum(nil), nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		_ = os.Remove(dst)
		return err
	}
	return out.Close()
}
```

`ctl/internal/toolbox/proc_unix.go`:

```go
//go:build !windows

package toolbox

import (
	"os"
	"syscall"
)

// terminate pede para o toolbox sair (ele fecha as conexões com o banco).
func terminate(p *os.Process) { _ = p.Signal(syscall.SIGTERM) }
```

`ctl/internal/toolbox/proc_windows.go`:

```go
//go:build windows

package toolbox

import "os"

// terminate no Windows não tem TERM para processo sem console: encerra direto.
func terminate(p *os.Process) { _ = p.Kill() }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd ctl && gofmt -w . && go vet ./... && GOOS=windows go vet ./... && go test ./internal/toolbox/ -v`
Expected: `PASS` com os sete testes; `TestPrazoEstourado` leva uns 2 s.

- [ ] **Step 6: Commit**

```bash
git add ctl/internal/faketoolbox ctl/internal/toolbox
git commit -m "$(printf 'ctl: supervisor do toolbox com prontidao por MCP e log filtrado\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 5: Estado, arranque e troca com rollback

**Files:**
- Create: `ctl/internal/control/control.go`
- Test: `ctl/internal/control/control_test.go`

**Interfaces:**
- Consumes: `dbconf.Load`, `dbconf.Save`, `dbconf.Remove`, `dbconf.Validate`, `dbconf.Input`, `Config.Check` (Tasks 1 e 2); `toolbox.StartError`, `toolbox.New`, `toolbox.MsgDied` (Task 4); `faketoolbox.Main`, `faketoolbox.EnvVar` (Task 4).
- Produces (pacote `.../ctl/internal/control`):
  - `const SemBanco = "sem_banco"`, `Subindo = "subindo"`, `Rodando = "rodando"`, `Falhou = "falhou"`, `MsgStopped`
  - `type Runner interface { Start(dbconf.Config) error; Stop() error; Running() bool }` (`*toolbox.Supervisor` satisfaz)
  - `type Status struct { Estado string "estado"; Motor "motor"; Host "host"; Porta int "porta,omitempty"; Base "base"; Usuario "usuario"; Schema "schema"; SenhaSalva bool "senha_salva"; Erro string "erro,omitempty"; Log []string "log,omitempty" }` (tags JSON)
  - `func New(envPath string, run Runner) *Controller`
  - `func (c *Controller) BootAsync() <-chan struct{}`
  - `func (c *Controller) Status() Status`
  - `func (c *Controller) Apply(in dbconf.Input) (Status, error)` (erro só `*dbconf.FieldError`)
  - `func (c *Controller) Clear() Status`
  - `func (c *Controller) Shutdown()`

- [ ] **Step 1: Escrever os testes**

`ctl/internal/control/control_test.go`:

```go
package control

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/dbconf"
	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/faketoolbox"
	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/toolbox"
)

func TestMain(m *testing.M) {
	if os.Getenv(faketoolbox.EnvVar) == "1" {
		faketoolbox.Main()
		return
	}
	os.Exit(m.Run())
}

// fakeRunner falha pela senha e conta subidas simultâneas.
type fakeRunner struct {
	mu        sync.Mutex
	running   *dbconf.Config
	fail      map[string]error
	starts    []string
	stops     int
	active    int
	maxActive int
	delay     time.Duration
}

func (f *fakeRunner) Start(cfg dbconf.Config) error {
	f.mu.Lock()
	f.active++
	if f.active > f.maxActive {
		f.maxActive = f.active
	}
	f.starts = append(f.starts, cfg.Password)
	err, d := f.fail[cfg.Password], f.delay
	f.mu.Unlock()
	time.Sleep(d)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.active--
	if err != nil {
		return err
	}
	c := cfg
	f.running = &c
	return nil
}

func (f *fakeRunner) Stop() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.stops++
	f.running = nil
	return nil
}

func (f *fakeRunner) Running() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.running != nil
}

func (f *fakeRunner) kill() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.running = nil
}

func str(s string) *string { return &s }

func input(pw string) dbconf.Input {
	return dbconf.Input{Motor: "postgres", Host: "db.local", Porta: json.RawMessage(`5432`), Base: "cd2", Usuario: "leitor", Senha: str(pw)}
}

func saved(pw string) dbconf.Config {
	return dbconf.Config{Engine: "postgres", Host: "db.local", Port: "5432", Name: "cd2", User: "leitor", Password: pw, Schema: "public"}
}

var boom = &toolbox.StartError{Msg: toolbox.MsgDied, Log: []string{"Error: toolbox failed to initialize"}}

func newCtl(t *testing.T, run Runner) (*Controller, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "db.env")
	return New(path, run), path
}

func TestBootSemDbEnv(t *testing.T) {
	run := &fakeRunner{}
	c, _ := newCtl(t, run)
	<-c.BootAsync()
	st := c.Status()
	if st.Estado != SemBanco || st.Motor != "" || st.SenhaSalva || st.Erro != "" || len(run.starts) != 0 {
		t.Errorf("status %+v, subidas %v", st, run.starts)
	}
}

func TestBootComDbEnvDaV050(t *testing.T) {
	run := &fakeRunner{}
	c, path := newCtl(t, run)
	b, err := os.ReadFile(filepath.Join("..", "dbconf", "testdata", "v050-6.env"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatal(err)
	}
	<-c.BootAsync()
	st := c.Status()
	want := Status{Estado: Rodando, Motor: "postgres", Host: "db.local", Porta: 5432, Base: "cd2", Usuario: "leitor", Schema: "public", SenhaSalva: true}
	if !reflect.DeepEqual(st, want) {
		t.Errorf("status %+v", st)
	}
	if !reflect.DeepEqual(run.starts, []string{`$x y'z#`}) {
		t.Errorf("subiu com %q", run.starts)
	}
}

func TestBootQueFalhaFicaFalhou(t *testing.T) {
	run := &fakeRunner{fail: map[string]error{"ruim": boom}}
	c, path := newCtl(t, run)
	if err := dbconf.Save(path, saved("ruim")); err != nil {
		t.Fatal(err)
	}
	<-c.BootAsync()
	st := c.Status()
	if st.Estado != Falhou || st.Erro != toolbox.MsgDied || len(st.Log) != 1 || st.Motor != "postgres" {
		t.Errorf("status %+v", st)
	}
}

func TestBootComDbEnvInvalido(t *testing.T) {
	run := &fakeRunner{}
	c, path := newCtl(t, run)
	if err := os.WriteFile(path, []byte("lixo sem motor\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	<-c.BootAsync()
	st := c.Status()
	if st.Estado != SemBanco || !strings.Contains(st.Erro, "inválido") || len(run.starts) != 0 {
		t.Errorf("status %+v", st)
	}
}

func TestApplyPrimeiraVez(t *testing.T) {
	run := &fakeRunner{}
	c, path := newCtl(t, run)
	<-c.BootAsync()
	st, err := c.Apply(input("s1"))
	if err != nil {
		t.Fatal(err)
	}
	if st.Estado != Rodando || st.Schema != "public" || st.Porta != 5432 || st.Erro != "" || !st.SenhaSalva {
		t.Errorf("status %+v", st)
	}
	got, err := dbconf.Load(path)
	if err != nil || got != saved("s1") {
		t.Errorf("db.env %+v, %v", got, err)
	}
}

func TestApplyRuimVoltaParaAnteriorENaoGrava(t *testing.T) {
	run := &fakeRunner{fail: map[string]error{"ruim": boom}}
	c, path := newCtl(t, run)
	if err := dbconf.Save(path, saved("s1")); err != nil {
		t.Fatal(err)
	}
	<-c.BootAsync()
	before, _ := os.ReadFile(path)
	st, err := c.Apply(input("ruim"))
	if err != nil {
		t.Fatal(err)
	}
	if st.Estado != Rodando || st.Erro != toolbox.MsgDied || !reflect.DeepEqual(st.Log, boom.Log) {
		t.Errorf("status %+v", st)
	}
	if !reflect.DeepEqual(run.starts, []string{"s1", "ruim", "s1"}) {
		t.Errorf("subidas %q", run.starts)
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(before) {
		t.Error("db.env mudou depois da falha")
	}
	if !run.Running() || run.running.Password != "s1" {
		t.Error("a conexão anterior não voltou")
	}
}

func TestApplyRuimSemAnterior(t *testing.T) {
	run := &fakeRunner{fail: map[string]error{"ruim": boom}}
	c, path := newCtl(t, run)
	<-c.BootAsync()
	st, err := c.Apply(input("ruim"))
	if err != nil {
		t.Fatal(err)
	}
	if st.Estado != SemBanco || st.Erro != toolbox.MsgDied || st.Motor != "" {
		t.Errorf("status %+v", st)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("gravou db.env de uma conexão que falhou")
	}
}

func TestApplySenhaVaziaMantemASalva(t *testing.T) {
	run := &fakeRunner{}
	c, path := newCtl(t, run)
	if err := dbconf.Save(path, saved("s1")); err != nil {
		t.Fatal(err)
	}
	<-c.BootAsync()
	for _, s := range []*string{nil, str("")} {
		in := input("")
		in.Senha = s
		if _, err := c.Apply(in); err != nil {
			t.Fatal(err)
		}
		got, _ := dbconf.Load(path)
		if got.Password != "s1" {
			t.Errorf("senha virou %q", got.Password)
		}
	}
}

func TestApplyCampoInvalidoNaoMexeEmNada(t *testing.T) {
	run := &fakeRunner{}
	c, path := newCtl(t, run)
	if err := dbconf.Save(path, saved("s1")); err != nil {
		t.Fatal(err)
	}
	<-c.BootAsync()
	in := input("x")
	in.Host = ""
	_, err := c.Apply(in)
	var fe *dbconf.FieldError
	if !errors.As(err, &fe) || err.Error() != "host: obrigatório" {
		t.Fatalf("erro %v", err)
	}
	if run.stops != 0 || len(run.starts) != 1 || c.Status().Estado != Rodando {
		t.Errorf("mexeu: stops %d starts %v", run.stops, run.starts)
	}
}

func TestClear(t *testing.T) {
	run := &fakeRunner{}
	c, path := newCtl(t, run)
	if err := dbconf.Save(path, saved("s1")); err != nil {
		t.Fatal(err)
	}
	<-c.BootAsync()
	st := c.Clear()
	if st.Estado != SemBanco || st.Motor != "" || st.SenhaSalva {
		t.Errorf("status %+v", st)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("db.env continua lá")
	}
	if run.Running() {
		t.Error("toolbox continua de pé")
	}
}

func TestToolboxQueMorreViraFalhou(t *testing.T) {
	run := &fakeRunner{}
	c, _ := newCtl(t, run)
	<-c.BootAsync()
	if _, err := c.Apply(input("s1")); err != nil {
		t.Fatal(err)
	}
	run.kill()
	st := c.Status()
	if st.Estado != Falhou || st.Erro != MsgStopped {
		t.Errorf("status %+v", st)
	}
}

func TestPedidosUmDeCadaVez(t *testing.T) {
	run := &fakeRunner{delay: 50 * time.Millisecond}
	c, _ := newCtl(t, run)
	<-c.BootAsync()
	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _ = c.Apply(input(fmt.Sprint("s", i)))
		}(i)
	}
	wg.Wait()
	if run.maxActive != 1 {
		t.Errorf("%d subidas ao mesmo tempo", run.maxActive)
	}
}

func TestArranqueSeguraOPrimeiroPedido(t *testing.T) {
	run := &fakeRunner{delay: 100 * time.Millisecond}
	c, path := newCtl(t, run)
	if err := dbconf.Save(path, saved("s1")); err != nil {
		t.Fatal(err)
	}
	done := c.BootAsync()
	if _, err := c.Apply(input("s2")); err != nil {
		t.Fatal(err)
	}
	<-done
	if !reflect.DeepEqual(run.starts, []string{"s1", "s2"}) || run.running.Password != "s2" {
		t.Errorf("subidas %q", run.starts)
	}
}

func TestStatusNuncaTemSenha(t *testing.T) {
	run := &fakeRunner{fail: map[string]error{"senha-ruim": boom}}
	c, _ := newCtl(t, run)
	<-c.BootAsync()
	st1, _ := c.Apply(input("senha-boa"))
	st2, _ := c.Apply(input("senha-ruim"))
	for _, st := range []Status{st1, st2, c.Status()} {
		b, _ := json.Marshal(st)
		if strings.Contains(string(b), "senha-boa") || strings.Contains(string(b), "senha-ruim") {
			t.Errorf("senha no JSON: %s", b)
		}
	}
}

// Rollback com o supervisor de verdade e o toolbox falso.
func TestRollbackComToolboxFalso(t *testing.T) {
	t.Setenv(faketoolbox.EnvVar, "1")
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	sup := toolbox.New(toolbox.Options{Source: self, CacheDir: t.TempDir(), RecipeDir: "receitas", Port: port, HarnessPort: 18080, ReadyTimeout: 10 * time.Second})
	c, path := newCtl(t, sup)
	t.Cleanup(c.Shutdown)
	<-c.BootAsync()
	if st, _ := c.Apply(input("boa1")); st.Estado != Rodando {
		t.Fatalf("primeira: %+v", st)
	}
	st, err := c.Apply(input("morre-x"))
	if err != nil {
		t.Fatal(err)
	}
	if st.Estado != Rodando || st.Erro != toolbox.MsgDied || len(st.Log) == 0 {
		t.Errorf("status %+v", st)
	}
	got, _ := dbconf.Load(path)
	if got.Password != "boa1" {
		t.Errorf("db.env ficou com %q", got.Password)
	}
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/", port))
	if err != nil {
		t.Fatalf("toolbox anterior não voltou: %v", err)
	}
	resp.Body.Close()
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ctl && go test ./internal/control/`
Expected: FAIL de compilação, `undefined: Controller` (e `New`, `Status`, `SemBanco`...).

- [ ] **Step 3: Implementar**

`ctl/internal/control/control.go`:

```go
// Package control é o estado do cd2-ctl: qual conexão vale, se o toolbox está de pé e a troca
// com rollback pedida pela tela.
package control

import (
	"errors"
	"io/fs"
	"strconv"
	"sync"

	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/dbconf"
	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/toolbox"
)

// Estados de /status.
const (
	SemBanco = "sem_banco"
	Subindo  = "subindo"
	Rodando  = "rodando"
	Falhou   = "falhou"
)

// MsgStopped aparece quando o toolbox morre sozinho depois de pronto.
const MsgStopped = "O toolbox parou sozinho. Clique em Salvar e conectar para tentar de novo."

// Runner sobe e derruba o toolbox (*toolbox.Supervisor; nos testes, um falso).
type Runner interface {
	Start(dbconf.Config) error
	Stop() error
	Running() bool
}

// Status é a resposta de GET /status (e de POST e DELETE /config). Nunca leva a senha.
type Status struct {
	Estado     string   `json:"estado"`
	Motor      string   `json:"motor"`
	Host       string   `json:"host"`
	Porta      int      `json:"porta,omitempty"`
	Base       string   `json:"base"`
	Usuario    string   `json:"usuario"`
	Schema     string   `json:"schema"`
	SenhaSalva bool     `json:"senha_salva"`
	Erro       string   `json:"erro,omitempty"`
	Log        []string `json:"log,omitempty"`
}

// Controller guarda a conexão em vigor e atende um pedido de configuração por vez.
type Controller struct {
	envPath string
	run     Runner

	op sync.Mutex // um pedido de configuração (ou o arranque) por vez

	mu     sync.Mutex // protege os campos abaixo
	cur    *dbconf.Config
	estado string
	erro   string
	log    []string
}

// New começa em sem_banco; chame BootAsync para ler o db.env.
func New(envPath string, run Runner) *Controller {
	return &Controller{envPath: envPath, run: run, estado: SemBanco}
}

func (c *Controller) set(cur *dbconf.Config, estado, erro string, log []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cur, c.estado, c.erro, c.log = cur, estado, erro, log
}

func (c *Controller) current() *dbconf.Config {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cur
}

// Status monta a resposta. Se o toolbox morreu depois de pronto, diz falhou.
func (c *Controller) Status() Status {
	c.mu.Lock()
	cur, estado, erro, log := c.cur, c.estado, c.erro, c.log
	c.mu.Unlock()
	if estado == Rodando && !c.run.Running() {
		estado, erro, log = Falhou, MsgStopped, nil
	}
	st := Status{Estado: estado, Erro: erro, Log: log}
	if cur != nil {
		st.Motor, st.Host, st.Base, st.Usuario, st.Schema = cur.Engine, cur.Host, cur.Name, cur.User, cur.Schema
		st.Porta, _ = strconv.Atoi(cur.Port)
		st.SenhaSalva = cur.Password != ""
	}
	return st
}

// BootAsync lê o db.env e, se válido, sobe o toolbox em segundo plano. Pega a vez dos pedidos
// antes de voltar, para um POST /config não atropelar a subida. O canal fecha no fim.
func (c *Controller) BootAsync() <-chan struct{} {
	c.op.Lock()
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer c.op.Unlock()
		c.boot()
	}()
	return done
}

func (c *Controller) boot() {
	cfg, err := dbconf.Load(c.envPath)
	if errors.Is(err, fs.ErrNotExist) {
		return
	}
	if err == nil {
		err = cfg.Check()
	}
	if err != nil {
		c.set(nil, SemBanco, "O db.env deste computador está inválido ("+err.Error()+"). Configure o banco de novo.", nil)
		return
	}
	c.set(&cfg, Subindo, "", nil)
	if err := c.run.Start(cfg); err != nil {
		msg, log := describe(err)
		c.set(&cfg, Falhou, msg, log)
		return
	}
	c.set(&cfg, Rodando, "", nil)
}

func describe(err error) (string, []string) {
	var se *toolbox.StartError
	if errors.As(err, &se) {
		return se.Msg, se.Log
	}
	return err.Error(), nil
}

// Apply valida e troca a conexão. Campo inválido devolve *dbconf.FieldError sem mexer em nada.
// Falha na subida não grava nada e volta para a conexão anterior, se havia.
func (c *Controller) Apply(in dbconf.Input) (Status, error) {
	c.op.Lock()
	defer c.op.Unlock()
	prev := c.current()
	cand, err := dbconf.Validate(in, prev)
	if err != nil {
		return Status{}, err
	}
	c.set(prev, Subindo, "", nil)
	if err := c.run.Stop(); err != nil {
		c.rollback(prev, err)
		return c.Status(), nil
	}
	if err := c.run.Start(cand); err != nil {
		c.rollback(prev, err)
		return c.Status(), nil
	}
	if err := dbconf.Save(c.envPath, cand); err != nil {
		_ = c.run.Stop()
		c.rollback(prev, errors.New("Não consegui gravar a conexão neste computador: "+err.Error()))
		return c.Status(), nil
	}
	c.set(&cand, Rodando, "", nil)
	return c.Status(), nil
}

// rollback sobe de novo a conexão anterior e guarda erro e log da tentativa que falhou.
func (c *Controller) rollback(prev *dbconf.Config, failure error) {
	msg, log := describe(failure)
	if prev == nil {
		c.set(nil, SemBanco, msg, log)
		return
	}
	if err := c.run.Start(*prev); err != nil {
		c.set(prev, Falhou, msg, log)
		return
	}
	c.set(prev, Rodando, msg, log)
}

// Clear derruba o toolbox e apaga o db.env.
func (c *Controller) Clear() Status {
	c.op.Lock()
	defer c.op.Unlock()
	_ = c.run.Stop()
	if err := dbconf.Remove(c.envPath); err != nil {
		c.set(c.current(), Falhou, "Não consegui apagar o db.env: "+err.Error(), nil)
		return c.Status()
	}
	c.set(nil, SemBanco, "", nil)
	return c.Status()
}

// Shutdown derruba o toolbox no encerramento (espera um pedido em andamento terminar).
func (c *Controller) Shutdown() {
	c.op.Lock()
	defer c.op.Unlock()
	_ = c.run.Stop()
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd ctl && gofmt -w . && go vet ./... && go test ./internal/control/ -v -race`
Expected: `PASS` com os quinze testes, sem aviso do `-race` (se o `-race` reclamar de cgo, rode sem ele).

- [ ] **Step 5: Commit**

```bash
git add ctl/internal/control
git commit -m "$(printf 'ctl: estado da conexao, arranque pelo db.env e troca com rollback\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 6: API HTTP com as checagens de segurança, `main.go` e `ctl/build.sh`

**Files:**
- Create: `ctl/internal/api/api.go`
- Test: `ctl/internal/api/api_test.go`
- Create: `ctl/main.go`
- Test: `ctl/main_test.go`
- Create: `ctl/build.sh`

**Interfaces:**
- Consumes: `control.Status`, `control.SemBanco`, `control.Rodando`, `control.New`, `(*Controller).BootAsync/Status/Apply/Clear/Shutdown` (Task 5); `dbconf.Input`, `dbconf.FieldError` (Task 2); `toolbox.New`, `toolbox.Options`, `(*Supervisor).LogPath` (Task 4).
- Produces:
  - Pacote `.../ctl/internal/api`: `const MaxBody = 8 << 10`; `type Options struct { Key string; HarnessPort, CtlPort int }`; `type Backend interface { Status() control.Status; Apply(dbconf.Input) (control.Status, error); Clear() control.Status }`; `func Handler(opt Options, b Backend) http.Handler`.
  - Binário `cd2-ctl`: `--root`, `--cache`, `--harness-port`, `--version`; chave em `CD2_CTL_KEY`; código 2 em erro de arranque; escreve `cd2-ctl <versão> em 127.0.0.1:<P+2000> (toolbox em 127.0.0.1:<P+1000>)` no stdout ao subir.
  - `sh ctl/build.sh ["plat1 plat2"]` → `bin/ctl/<plat>/cd2-ctl[.exe]` (padrão: plataforma do computador).

- [ ] **Step 1: Escrever os testes da API**

`ctl/internal/api/api_test.go`:

```go
package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/control"
	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/dbconf"
)

const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

type fakeBackend struct {
	applied  []dbconf.Input
	applyErr error
	cleared  int
}

func (f *fakeBackend) Status() control.Status { return control.Status{Estado: control.SemBanco} }

func (f *fakeBackend) Apply(in dbconf.Input) (control.Status, error) {
	f.applied = append(f.applied, in)
	if f.applyErr != nil {
		return control.Status{}, f.applyErr
	}
	return control.Status{Estado: control.Rodando, Motor: in.Motor}, nil
}

func (f *fakeBackend) Clear() control.Status {
	f.cleared++
	return control.Status{Estado: control.SemBanco}
}

func newH() (http.Handler, *fakeBackend) {
	b := &fakeBackend{}
	return Handler(Options{Key: key, HarnessPort: 8080, CtlPort: 10080}, b), b
}

// do monta um pedido válido (Host, Origin, chave e Content-Type certos); mod estraga o que o teste quer.
func do(h http.Handler, method, path, body string, mod func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://127.0.0.1:10080"+path, strings.NewReader(body))
	r.Host = "127.0.0.1:10080"
	r.Header.Set("Origin", "http://127.0.0.1:8080")
	r.Header.Set("Authorization", "Bearer "+key)
	if method == http.MethodPost {
		r.Header.Set("Content-Type", "application/json")
	}
	if mod != nil {
		mod(r)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func erro(w *httptest.ResponseRecorder) string {
	var m map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	return m["erro"]
}

const okBody = `{"motor":"postgres","host":"h","porta":5432,"base":"d","usuario":"u","senha":"s"}`

func TestStatusComChave(t *testing.T) {
	h, _ := newH()
	w := do(h, "GET", "/status", "", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"estado":"sem_banco"`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "http://127.0.0.1:8080" || w.Header().Get("Vary") != "Origin" {
		t.Errorf("CORS: %v", w.Header())
	}
}

func TestGetSemOriginPassaParaCurl(t *testing.T) {
	h, _ := newH()
	w := do(h, "GET", "/status", "", func(r *http.Request) { r.Header.Del("Origin") })
	if w.Code != 200 || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("%d %v", w.Code, w.Header())
	}
}

func TestChaveAusenteOuErrada(t *testing.T) {
	h, _ := newH()
	for _, auth := range []string{"", "Bearer " + strings.Repeat("0", 64), "bearer " + key, key, "Bearer " + key + "0"} {
		w := do(h, "GET", "/status", "", func(r *http.Request) { r.Header.Set("Authorization", auth) })
		if w.Code != 401 || erro(w) != "chave da sessão ausente ou errada" {
			t.Errorf("auth %q: %d %s", auth, w.Code, w.Body)
		}
		if w.Header().Get("Access-Control-Allow-Origin") == "" {
			t.Errorf("auth %q: 401 sem CORS (o front não leria o erro)", auth)
		}
	}
}

func TestOriginErrada(t *testing.T) {
	h, b := newH()
	for _, o := range []string{"http://evil.example", "http://127.0.0.1:8081", "null", "https://127.0.0.1:8080"} {
		w := do(h, "POST", "/config", okBody, func(r *http.Request) { r.Header.Set("Origin", o) })
		if w.Code != 403 {
			t.Errorf("origin %q: %d", o, w.Code)
		}
	}
	if len(b.applied) != 0 {
		t.Error("backend chamado com origem errada")
	}
}

func TestOriginAusenteEmPostEDelete(t *testing.T) {
	h, b := newH()
	noOrigin := func(r *http.Request) { r.Header.Del("Origin") }
	if w := do(h, "POST", "/config", okBody, noOrigin); w.Code != 403 || erro(w) != "origem ausente" {
		t.Errorf("POST: %d %s", w.Code, w.Body)
	}
	if w := do(h, "DELETE", "/config", "", noOrigin); w.Code != 403 {
		t.Errorf("DELETE: %d", w.Code)
	}
	if len(b.applied) != 0 || b.cleared != 0 {
		t.Error("backend chamado sem Origin")
	}
}

func TestOriginLocalhost(t *testing.T) {
	h, _ := newH()
	w := do(h, "GET", "/status", "", func(r *http.Request) { r.Header.Set("Origin", "http://localhost:8080") })
	if w.Code != 200 || w.Header().Get("Access-Control-Allow-Origin") != "http://localhost:8080" {
		t.Errorf("%d %v", w.Code, w.Header())
	}
}

func TestHost(t *testing.T) {
	h, _ := newH()
	for host, want := range map[string]int{"evil.example:10080": 403, "127.0.0.1:8080": 403, "127.0.0.1": 403, "localhost:10080": 200} {
		w := do(h, "GET", "/status", "", func(r *http.Request) { r.Host = host })
		if w.Code != want {
			t.Errorf("host %q: %d, quero %d", host, w.Code, want)
		}
	}
}

func TestContentType(t *testing.T) {
	h, _ := newH()
	for ct, want := range map[string]int{"text/plain": 415, "": 415, "application/x-www-form-urlencoded": 415, "application/json; charset=utf-8": 200} {
		w := do(h, "POST", "/config", okBody, func(r *http.Request) { r.Header.Set("Content-Type", ct) })
		if w.Code != want {
			t.Errorf("Content-Type %q: %d, quero %d", ct, w.Code, want)
		}
	}
}

func TestCorpoAcimaDe8KB(t *testing.T) {
	h, b := newH()
	w := do(h, "POST", "/config", `{"senha":"`+strings.Repeat("x", MaxBody)+`"}`, nil)
	if w.Code != 413 || erro(w) != "corpo: acima de 8 KB" {
		t.Errorf("%d %s", w.Code, w.Body)
	}
	if len(b.applied) != 0 {
		t.Error("backend chamado com corpo grande")
	}
}

func TestJSONInvalido(t *testing.T) {
	h, _ := newH()
	for _, body := range []string{"{", `{"x":1}`, `[]`} {
		w := do(h, "POST", "/config", body, nil)
		if w.Code != 400 || erro(w) != "corpo: JSON inválido" {
			t.Errorf("%q: %d %s", body, w.Code, w.Body)
		}
	}
}

func TestCampoInvalido(t *testing.T) {
	h, b := newH()
	b.applyErr = &dbconf.FieldError{Field: "host", Reason: "obrigatório"}
	w := do(h, "POST", "/config", okBody, nil)
	if w.Code != 400 || erro(w) != "host: obrigatório" {
		t.Errorf("%d %s", w.Code, w.Body)
	}
}

func TestPostEDelete(t *testing.T) {
	h, b := newH()
	w := do(h, "POST", "/config", okBody, nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"estado":"rodando"`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if len(b.applied) != 1 || b.applied[0].Motor != "postgres" || b.applied[0].Senha == nil || *b.applied[0].Senha != "s" {
		t.Errorf("Apply recebeu %+v", b.applied)
	}
	if w := do(h, "DELETE", "/config", "", nil); w.Code != 200 || b.cleared != 1 {
		t.Errorf("DELETE: %d", w.Code)
	}
}

func TestPreflight(t *testing.T) {
	h, _ := newH()
	w := do(h, "OPTIONS", "/config", "", func(r *http.Request) {
		r.Header.Del("Authorization")
		r.Header.Set("Access-Control-Request-Method", "POST")
	})
	if w.Code != 204 {
		t.Fatalf("%d", w.Code)
	}
	hd := w.Header()
	if hd.Get("Access-Control-Allow-Origin") != "http://127.0.0.1:8080" ||
		hd.Get("Access-Control-Allow-Headers") != "Authorization, Content-Type" ||
		hd.Get("Access-Control-Allow-Methods") != "GET, POST, DELETE" {
		t.Errorf("headers %v", hd)
	}
	w = do(h, "OPTIONS", "/config", "", func(r *http.Request) { r.Header.Set("Origin", "http://evil.example") })
	if w.Code != 403 {
		t.Errorf("preflight de origem errada: %d", w.Code)
	}
}

func TestRotasEMetodos(t *testing.T) {
	h, _ := newH()
	if w := do(h, "GET", "/nada", "", nil); w.Code != 404 {
		t.Errorf("rota desconhecida: %d", w.Code)
	}
	if w := do(h, "PUT", "/config", okBody, nil); w.Code != 405 {
		t.Errorf("PUT /config: %d", w.Code)
	}
	if w := do(h, "POST", "/status", okBody, nil); w.Code != 405 {
		t.Errorf("POST /status: %d", w.Code)
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ctl && go test ./internal/api/`
Expected: FAIL de compilação, `undefined: Handler` (e `Options`, `MaxBody`).

- [ ] **Step 3: Implementar a API**

`ctl/internal/api/api.go`:

```go
// Package api é a porta de controle do cd2-ctl: GET /status, POST e DELETE /config. Host,
// Origin, chave da sessão e Content-Type são conferidos antes de qualquer coisa.
package api

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"strconv"

	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/control"
	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/dbconf"
)

// MaxBody é o maior corpo aceito em POST /config.
const MaxBody = 8 << 10

// Options: chave da sessão (64 hex), porta do harness (P) e porta de controle (P+2000).
type Options struct {
	Key         string
	HarnessPort int
	CtlPort     int
}

// Backend é o que a API controla (*control.Controller).
type Backend interface {
	Status() control.Status
	Apply(dbconf.Input) (control.Status, error)
	Clear() control.Status
}

type server struct {
	b       Backend
	auth    []byte
	origins map[string]bool
	hosts   map[string]bool
}

// Handler monta o http.Handler da porta de controle.
func Handler(opt Options, b Backend) http.Handler {
	h, c := strconv.Itoa(opt.HarnessPort), strconv.Itoa(opt.CtlPort)
	return &server{
		b:       b,
		auth:    []byte("Bearer " + opt.Key),
		origins: map[string]bool{"http://127.0.0.1:" + h: true, "http://localhost:" + h: true},
		hosts:   map[string]bool{"127.0.0.1:" + c: true, "localhost:" + c: true},
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"erro": msg})
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Host: contra DNS rebinding
	if !s.hosts[r.Host] {
		fail(w, http.StatusForbidden, "host não permitido")
		return
	}
	// Origin: só a do harness; ausente só em GET (testes com curl)
	origin := r.Header.Get("Origin")
	if origin != "" {
		if !s.origins[origin] {
			fail(w, http.StatusForbidden, "origem não permitida")
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	} else if r.Method != http.MethodGet {
		fail(w, http.StatusForbidden, "origem ausente")
		return
	}
	// preflight do CORS: o navegador não manda a chave nele
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE")
		w.Header().Set("Access-Control-Max-Age", "600")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), s.auth) != 1 {
		fail(w, http.StatusUnauthorized, "chave da sessão ausente ou errada")
		return
	}
	switch r.URL.Path {
	case "/status":
		if r.Method != http.MethodGet {
			notAllowed(w, "GET")
			return
		}
		writeJSON(w, http.StatusOK, s.b.Status())
	case "/config":
		switch r.Method {
		case http.MethodPost:
			s.post(w, r)
		case http.MethodDelete:
			writeJSON(w, http.StatusOK, s.b.Clear())
		default:
			notAllowed(w, "POST, DELETE")
		}
	default:
		fail(w, http.StatusNotFound, "rota não encontrada")
	}
}

func notAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	fail(w, http.StatusMethodNotAllowed, "método não permitido")
}

func (s *server) post(w http.ResponseWriter, r *http.Request) {
	mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mt != "application/json" {
		fail(w, http.StatusUnsupportedMediaType, "use Content-Type: application/json")
		return
	}
	var in dbconf.Input
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, MaxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			fail(w, http.StatusRequestEntityTooLarge, "corpo: acima de 8 KB")
			return
		}
		fail(w, http.StatusBadRequest, "corpo: JSON inválido")
		return
	}
	st, err := s.b.Apply(in)
	var fe *dbconf.FieldError
	if errors.As(err, &fe) {
		fail(w, http.StatusBadRequest, fe.Error())
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}
```

- [ ] **Step 4: Rodar os testes da API e ver passar**

Run: `cd ctl && gofmt -w . && go vet ./... && go test ./internal/api/ -v`
Expected: `PASS` com os quatorze testes.

- [ ] **Step 5: Escrever os testes do `main`**

`ctl/main_test.go`:

```go
package main

import (
	"bytes"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

const testKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func TestVersao(t *testing.T) {
	var out bytes.Buffer
	if code := run([]string{"--version"}, "", nil, &out, io.Discard); code != 0 || out.String() != "cd2-ctl dev\n" {
		t.Errorf("code %d, saída %q", code, out.String())
	}
}

func TestChaveInvalida(t *testing.T) {
	for _, k := range []string{"", "curta", strings.Repeat("z", 64)} {
		var errb bytes.Buffer
		code := run([]string{"--root", "r", "--cache", t.TempDir(), "--harness-port", "18080"}, k, nil, io.Discard, &errb)
		if code != 2 || !strings.Contains(errb.String(), "CD2_CTL_KEY") {
			t.Errorf("chave %q: code %d, %q", k, code, errb.String())
		}
	}
}

func TestArgumentosFaltando(t *testing.T) {
	var errb bytes.Buffer
	if code := run(nil, testKey, nil, io.Discard, &errb); code != 2 || !strings.Contains(errb.String(), "uso:") {
		t.Errorf("code %d, %q", code, errb.String())
	}
}

func TestPortaDeControleOcupada(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	p := l.Addr().(*net.TCPAddr).Port
	if p <= 2001 {
		t.Skip("porta efêmera baixa demais")
	}
	var errb bytes.Buffer
	code := run([]string{"--root", t.TempDir(), "--cache", t.TempDir(), "--harness-port", strconv.Itoa(p - 2000)}, testKey, nil, io.Discard, &errb)
	if code != 2 || !strings.Contains(errb.String(), "nao consegui escutar") {
		t.Errorf("code %d, %q", code, errb.String())
	}
}

func TestSobeRespondeEEncerra(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	p := l.Addr().(*net.TCPAddr).Port
	l.Close()
	if p <= 2001 {
		t.Skip("porta efêmera baixa demais")
	}
	stop := make(chan os.Signal, 1)
	done := make(chan int, 1)
	go func() {
		done <- run([]string{"--root", t.TempDir(), "--cache", t.TempDir(), "--harness-port", strconv.Itoa(p - 2000)}, testKey, stop, io.Discard, io.Discard)
	}()
	url := fmt.Sprintf("http://127.0.0.1:%d/status", p)
	var code int
	for i := 0; i < 50; i++ {
		if resp, err := http.Get(url); err == nil {
			code = resp.StatusCode
			resp.Body.Close()
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if code != 401 {
		t.Fatalf("sem chave: %d, quero 401", code)
	}
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+testKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(string(body), `"estado":"sem_banco"`) {
		t.Errorf("com chave: %d %s", resp.StatusCode, body)
	}
	stop <- os.Interrupt
	select {
	case c := <-done:
		if c != 0 {
			t.Errorf("saiu com %d", c)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("não encerrou com o sinal")
	}
}
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `cd ctl && go test .`
Expected: FAIL de compilação, `undefined: run`.

- [ ] **Step 7: Implementar o `main`**

`ctl/main.go`:

```go
// cd2-ctl: controle do banco de dados do CD2 Harness Pocket. Escuta só em 127.0.0.1:P+2000,
// é o único dono do MCP Toolbox (127.0.0.1:P+1000) e grava a conexão no db.env do cache.
//
// Uso: CD2_CTL_KEY=<64 hex> cd2-ctl --root <pen drive> --cache <pasta> --harness-port P
package main

import (
	"context"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/api"
	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/control"
	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/toolbox"
)

// version vem do -ldflags "-X main.version=X.Y.Z" no release.
var version = "dev"

func main() {
	key := os.Getenv("CD2_CTL_KEY")
	_ = os.Unsetenv("CD2_CTL_KEY") // o toolbox (processo filho) não precisa dela
	stop := make(chan os.Signal, 1)
	// SIGHUP: terminal fechado no Mac/Linux. No Windows, fechar o console chega como SIGTERM.
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	os.Exit(run(os.Args[1:], key, stop, os.Stdout, os.Stderr))
}

func validKey(k string) bool {
	if len(k) != 64 {
		return false
	}
	_, err := hex.DecodeString(k)
	return err == nil
}

// run devolve o código de saída: 0 encerrou por sinal (ou --version), 2 erro de arranque.
// Mensagens de erro sem acento (vão para o terminal e para o ctl.log do launcher).
func run(args []string, key string, stop <-chan os.Signal, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("cd2-ctl", flag.ContinueOnError)
	fs.SetOutput(stderr)
	root := fs.String("root", "", "raiz do pen drive")
	cache := fs.String("cache", "", "pasta de cache deste computador (db.env e toolbox.log)")
	hport := fs.Int("harness-port", 0, "porta do harness (P); toolbox em P+1000, controle em P+2000")
	showVersion := fs.Bool("version", false, "mostra a versao e sai")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *showVersion {
		fmt.Fprintln(stdout, "cd2-ctl", version)
		return 0
	}
	if !validKey(key) {
		fmt.Fprintln(stderr, "cd2-ctl: CD2_CTL_KEY ausente ou invalida (64 caracteres hexadecimais)")
		return 2
	}
	if *root == "" || *cache == "" || *hport < 1 || *hport+2000 > 65535 {
		fmt.Fprintln(stderr, "uso: CD2_CTL_KEY=<chave> cd2-ctl --root <pen drive> --cache <pasta> --harness-port P")
		return 2
	}
	if err := os.MkdirAll(*cache, 0o700); err != nil {
		fmt.Fprintf(stderr, "cd2-ctl: nao consegui criar %s: %v\n", *cache, err)
		return 2
	}
	ctlPort, tbPort := *hport+2000, *hport+1000
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", ctlPort))
	if err != nil {
		fmt.Fprintf(stderr, "cd2-ctl: nao consegui escutar em 127.0.0.1:%d: %v\n", ctlPort, err)
		return 2
	}
	exe := ""
	if runtime.GOOS == "windows" {
		exe = ".exe"
	}
	sup := toolbox.New(toolbox.Options{
		Source:       filepath.Join(*root, "bin", "toolbox", runtime.GOOS+"-"+runtime.GOARCH, "toolbox"+exe),
		CacheDir:     *cache,
		RecipeDir:    filepath.Join(*root, "core", "toolbox"),
		Port:         tbPort,
		HarnessPort:  *hport,
		ReadyTimeout: 15 * time.Second,
		StopTimeout:  5 * time.Second,
	})
	// toolbox.log começa vazio a cada abertura do harness
	if f, err := os.OpenFile(sup.LogPath(), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600); err == nil {
		f.Close()
	}
	ctl := control.New(filepath.Join(*cache, "db.env"), sup)
	ctl.BootAsync()
	srv := &http.Server{
		Handler:           api.Handler(api.Options{Key: key, HarnessPort: *hport, CtlPort: ctlPort}, ctl),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() { _ = srv.Serve(ln) }()
	fmt.Fprintf(stdout, "cd2-ctl %s em 127.0.0.1:%d (toolbox em 127.0.0.1:%d)\n", version, ctlPort, tbPort)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	ctl.Shutdown()
	fmt.Fprintln(stdout, "cd2-ctl encerrado")
	return 0
}
```

- [ ] **Step 8: Escrever `ctl/build.sh`**

```sh
#!/usr/bin/env sh
# Compila o cd2-ctl para bin/ctl/<os>-<arch>/ (desenvolvimento e teste local; o release
# oficial sai do GitHub Actions, workflow ctl-release.yml).
# Uso: sh ctl/build.sh                         (plataforma deste computador)
#      sh ctl/build.sh "darwin-arm64 linux-amd64"
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
PLATS="${1:-$(go env GOOS)-$(go env GOARCH)}"
VERSION="$(tr -d ' \n' < "$ROOT/VERSION")-local"
cd "$HERE"
for p in $PLATS; do
  os="${p%-*}"; arch="${p#*-}"; ext=""; [ "$os" = windows ] && ext=".exe"
  mkdir -p "$ROOT/bin/ctl/$p"
  CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o "$ROOT/bin/ctl/$p/cd2-ctl$ext" .
  echo "bin/ctl/$p/cd2-ctl$ext"
done
```

- [ ] **Step 9: Rodar tudo e conferir o binário**

Run:
```bash
cd ctl && gofmt -l . ; go vet ./... && GOOS=windows go vet ./... && go test ./... && cd .. && sh ctl/build.sh "darwin-arm64 windows-amd64" && bin/ctl/darwin-arm64/cd2-ctl --version && ls -lh bin/ctl/*/
```
Expected: `gofmt -l` sem saída; `ok` para `.`, `internal/api`, `internal/control`, `internal/dbconf`, `internal/secret`, `internal/toolbox` (e `internal/faketoolbox` com `[no test files]`); `bin/ctl/darwin-arm64/cd2-ctl` e `bin/ctl/windows-amd64/cd2-ctl.exe`; `cd2-ctl 0.5.0-local` (a `VERSION` só vira 0.6.0 na Task 13); binários de uns 5 a 8 MB.

- [ ] **Step 10: Commit**

```bash
git add ctl/internal/api ctl/main.go ctl/main_test.go ctl/build.sh
git commit -m "$(printf 'ctl: porta de controle com chave, Origin, Host e Content-Type, e o binario cd2-ctl\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 7: Ponta a ponta com o toolbox real e o Postgres do Docker

**Files:**
- Create: `tests/ctl/e2e.sh`

**Interfaces:**
- Consumes: binário `cd2-ctl` (Task 6), `core/toolbox/postgres.yaml`, `bin/toolbox/<plat>/toolbox`, serviço `postgres` de `tests/toolbox/docker-compose.yml` (porta 55432, usuário `cd2`, base `cd2`, senha `cd2 s3nh@'x`).
- Produces: `sh tests/ctl/e2e.sh` termina com `OK: e2e do cd2-ctl` (código 0) ou `[FALHOU] ...` (código 1).

- [ ] **Step 1: Escrever o script**

`tests/ctl/e2e.sh`:

```sh
#!/usr/bin/env sh
# tests/ctl/e2e.sh - cd2-ctl de ponta a ponta com o toolbox de verdade e o Postgres do Docker.
# Precisa de: go, curl, jq, o servico postgres no ar
#   (docker compose -f tests/toolbox/docker-compose.yml up -d postgres)
# e bin/toolbox/<plataforma>/toolbox (rode o preparo ou copie de um pen drive preparado).
# Uso: sh tests/ctl/e2e.sh        (CD2_E2E_PORT muda a porta P; padrao 18080)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
WORK=""; CTL_PID=""
fail() {
  printf '[FALHOU] %s\n' "$*" >&2
  [ -n "$WORK" ] && [ -f "$WORK/ctl.log" ] && sed 's/^/   ctl: /' "$WORK/ctl.log" >&2
  exit 1
}
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLAT=darwin-arm64 ;; Darwin-*) PLAT=darwin-amd64 ;;
  Linux-aarch64|Linux-arm64) PLAT=linux-arm64 ;; *) PLAT=linux-amd64 ;;
esac
TB="$ROOT/bin/toolbox/$PLAT/toolbox"
[ -x "$TB" ] || fail "sem $TB (rode o preparo ou copie de um pen drive preparado)"
command -v jq >/dev/null 2>&1 || fail "precisa do jq"
HP="${CD2_E2E_PORT:-18080}"; TP=$((HP + 1000)); CP=$((HP + 2000))
GOOD_PW="cd2 s3nh@'x"               # senha do postgres de tests/toolbox/docker-compose.yml
BAD_PW="errada \"e2e\" \\ \$x'y"    # aspas, barra e cifrao: tem de sumir da resposta e do log
BAD_DQ="$(printf '%s' "$BAD_PW" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/cd2-e2e.XXXXXX")"
cleanup() {
  if [ -n "$CTL_PID" ]; then kill "$CTL_PID" 2>/dev/null; wait "$CTL_PID" 2>/dev/null; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
# raiz de mentira: o cd2-ctl so le bin/toolbox/<plataforma>/toolbox e core/toolbox/
mkdir -p "$WORK/root/bin/toolbox/$PLAT" "$WORK/root/core" "$WORK/cache"
ln -s "$TB" "$WORK/root/bin/toolbox/$PLAT/toolbox"
ln -s "$ROOT/core/toolbox" "$WORK/root/core/toolbox"
( cd "$ROOT/ctl" && go build -o "$WORK/cd2-ctl" . ) || fail "go build"
KEY="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
start_ctl() {
  CD2_CTL_KEY="$KEY" "$WORK/cd2-ctl" --root "$WORK/root" --cache "$WORK/cache" --harness-port "$HP" >> "$WORK/ctl.log" 2>&1 &
  CTL_PID=$!
}
CTL="http://127.0.0.1:$CP"
api()  { curl -s --max-time 40 -H "Authorization: Bearer $KEY" -H "Origin: http://127.0.0.1:$HP" "$@"; }
post() { api -X POST -H 'Content-Type: application/json' --data-binary "$1" "$CTL/config"; }
body() { jq -nc --arg s "$1" '{motor:"postgres", host:"127.0.0.1", porta:55432, base:"cd2", usuario:"cd2", senha:$s, schema:""}'; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
field() { printf '%s' "$1" | jq -r "$2"; }
mcp_engine() {
  curl -s --max-time 5 -X POST "http://127.0.0.1:$TP/mcp" -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' -H 'MCP-Protocol-Version: 2025-06-18' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"db_connection_status","arguments":{}}}' \
    | jq -r '.result.content[0].text' | jq -r '.engine'
}

echo "== arranque sem db.env"
start_ctl
i=0; while [ "$(code "$CTL/status")" != 401 ]; do i=$((i + 1)); [ "$i" -lt 50 ] || fail "cd2-ctl nao subiu"; sleep 0.2; done
[ "$(field "$(api "$CTL/status")" .estado)" = sem_banco ] || fail "estado inicial"

echo "== seguranca"
[ "$(code -H "Authorization: Bearer 0$KEY" "$CTL/status")" = 401 ] || fail "chave errada deveria dar 401"
[ "$(code -H "Authorization: Bearer $KEY" -H 'Origin: http://evil.example' "$CTL/status")" = 403 ] || fail "Origin errada deveria dar 403"
[ "$(code -H "Authorization: Bearer $KEY" -H 'Host: evil.example' "$CTL/status")" = 403 ] || fail "Host errado deveria dar 403"
[ "$(code -X POST -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' --data-binary '{}' "$CTL/config")" = 403 ] || fail "POST sem Origin deveria dar 403"

echo "== configura certo"
R="$(post "$(body "$GOOD_PW")")"
[ "$(field "$R" .estado)" = rodando ] || fail "esperava rodando: $R"
[ "$(field "$R" .schema)" = public ] || fail "schema padrao: $R"
[ "$(field "$R" .senha_salva)" = true ] || fail "senha_salva: $R"
printf '%s' "$R" | grep -qF 's3nh' && fail "senha na resposta"
[ "$(mcp_engine)" = postgres ] || fail "toolbox nao responde db_connection_status"
case "$(uname -s)" in Darwin) PERM="$(stat -f %Lp "$WORK/cache/db.env")" ;; *) PERM="$(stat -c %a "$WORK/cache/db.env")" ;; esac
[ "$PERM" = 600 ] || fail "db.env com permissao $PERM"
cp "$WORK/cache/db.env" "$WORK/db.env.antes"

echo "== senha errada: rollback"
R="$(post "$(body "$BAD_PW")")"
[ "$(field "$R" .estado)" = rodando ] || fail "a conexao anterior deveria seguir rodando: $R"
[ -n "$(field "$R" '.erro // empty')" ] || fail "sem erro na resposta: $R"
[ "$(field "$R" '.log | length')" -ge 1 ] || fail "sem log na resposta: $R"
# o JSON escapa " e \ do mesmo jeito que o YAML: procurar BAD_DQ pega a senha dentro do JSON
for s in "$BAD_PW" "$BAD_DQ" "$GOOD_PW"; do
  printf '%s' "$R" | grep -qF -- "$s" && fail "senha na resposta"
  grep -qF -- "$s" "$WORK/cache/toolbox.log" && fail "senha no toolbox.log"
done
grep -qi password "$WORK/cache/toolbox.log" && fail "linha com password no toolbox.log"
cmp -s "$WORK/cache/db.env" "$WORK/db.env.antes" || fail "db.env mudou depois da falha"
[ "$(mcp_engine)" = postgres ] || fail "o toolbox anterior nao voltou"

echo "== senha em branco mantem a salva"
R="$(post '{"motor":"postgres","host":"127.0.0.1","porta":55432,"base":"cd2","usuario":"cd2","schema":"public"}')"
[ "$(field "$R" .estado)" = rodando ] && [ -z "$(field "$R" '.erro // empty')" ] || fail "senha herdada: $R"

echo "== desconectar"
R="$(api -X DELETE "$CTL/config")"
[ "$(field "$R" .estado)" = sem_banco ] || fail "DELETE: $R"
[ ! -e "$WORK/cache/db.env" ] || fail "db.env continua la"
[ "$(code --max-time 2 "http://127.0.0.1:$TP/")" = 000 ] || fail "toolbox continua de pe"

echo "== encerra sem sobrar processo"
post "$(body "$GOOD_PW")" >/dev/null
kill "$CTL_PID"; wait "$CTL_PID" 2>/dev/null; CTL_PID=""
[ "$(code --max-time 2 "http://127.0.0.1:$TP/")" = 000 ] || fail "toolbox sobrou depois do TERM"
pgrep -f "$WORK/cache/toolbox" >/dev/null && fail "processo do toolbox sobrou"

echo "== reabre com o db.env salvo"
start_ctl
i=0; until [ "$(field "$(api "$CTL/status")" .estado 2>/dev/null)" = rodando ]; do
  i=$((i + 1)); [ "$i" -lt 100 ] || fail "nao subiu com o db.env salvo"; sleep 0.2
done
[ "$(mcp_engine)" = postgres ] || fail "toolbox do arranque nao responde"
echo "OK: e2e do cd2-ctl"
```

- [ ] **Step 2: Rodar**

Run:
```bash
docker compose -f tests/toolbox/docker-compose.yml up -d postgres && sh tests/ctl/e2e.sh
```
Expected: as linhas `== arranque sem db.env`, `== seguranca`, `== configura certo`, `== senha errada: rollback`, `== senha em branco mantem a salva`, `== desconectar`, `== encerra sem sobrar processo`, `== reabre com o db.env salvo` e, no fim, `OK: e2e do cd2-ctl`. Leva uns 20 s (a cópia de 150 MB do toolbox para o cache temporário e as subidas).

Se falhar, o script imprime o `ctl.log`. Corrija o código Go da task responsável (não o teste), rode `cd ctl && go test ./...` de novo e repita.

- [ ] **Step 3: Commit**

```bash
git add tests/ctl/e2e.sh
git commit -m "$(printf 'testes: cd2-ctl de ponta a ponta com toolbox real e Postgres do Docker\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 8: CI, release por tag, preparo e gravadores

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/ctl-release.yml`
- Modify: `core/prepare-unix.sh` (variáveis no topo; seção nova antes de "== Checksums"; linha do checksum)
- Modify: `core/prepare-windows.ps1` (variáveis no topo; seção nova antes de "== Checksums"; linhas do checksum)
- Modify: `core/make-usb-unix.sh` (texto da estimativa; listagem final)
- Modify: `core/make-usb-windows.ps1` (texto da estimativa; listagem final)

**Interfaces:**
- Consumes: `ctl/` (Tasks 1 a 6), `sh ctl/build.sh` (Task 6).
- Produces: `bin/ctl/<plat>/cd2-ctl[.exe]` no pen drive e no `CHECKSUMS.sha256`; variáveis `CD2_CTL_VERSION` e `CD2_CTL_LOCAL`; release `ctl-vX.Y.Z` com `cd2-ctl-<os>-<arch>[.exe]` e `SHA256SUMS`.

- [ ] **Step 1: Workflow de CI**

`.github/workflows/ci.yml`:

```yaml
# Testes do cd2-ctl (Go) e do front (node --test) em todo pull request e push na main.
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version-file: ctl/go.mod
          cache: false
      - name: go vet e go test (ctl/)
        working-directory: ctl
        run: |
          test -z "$(gofmt -l .)"
          go vet ./...
          GOOS=windows go vet ./...
          go test ./...
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: node --test
        run: node --test
```

- [ ] **Step 2: Workflow de release**

`.github/workflows/ctl-release.yml`:

```yaml
# Release do cd2-ctl: a tag ctl-vX.Y.Z compila as quatro plataformas e anexa os binários e o
# SHA256SUMS ao release. O preparo do pen drive baixa a versão fixada em CTL_VERSION.
name: ctl release
on:
  push:
    tags: ['ctl-v*']
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version-file: ctl/go.mod
          cache: false
      - name: Testes
        working-directory: ctl
        run: go test ./...
      - name: Compilar
        working-directory: ctl
        run: |
          VERSION="${GITHUB_REF_NAME#ctl-v}"
          case "$VERSION" in ''|*[!0-9.]*) echo "tag invalida: $GITHUB_REF_NAME"; exit 1 ;; esac
          mkdir -p ../dist
          for p in windows-amd64 darwin-arm64 darwin-amd64 linux-amd64; do
            os="${p%-*}"; arch="${p#*-}"; ext=""; [ "$os" = windows ] && ext=".exe"
            CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o "../dist/cd2-ctl-$p$ext" .
          done
          cd ../dist && sha256sum cd2-ctl-* > SHA256SUMS && cat SHA256SUMS
      - name: Publicar
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release create "$GITHUB_REF_NAME" dist/* --title "$GITHUB_REF_NAME" --notes "cd2-ctl ${GITHUB_REF_NAME#ctl-v}: controle do banco de dados do Harness Pocket." -R "$GITHUB_REPOSITORY"
```

- [ ] **Step 3: Conferir a sintaxe dos dois YAML**

Run: `ruby -ryaml -e 'YAML.load_file(".github/workflows/ci.yml"); YAML.load_file(".github/workflows/ctl-release.yml"); puts "ok"'`
Expected: `ok`

- [ ] **Step 4: Preparo no Mac/Linux**

Em `core/prepare-unix.sh`, troque:

```sh
TOOLBOX_BASE="https://storage.googleapis.com/mcp-toolbox-for-databases/v$TOOLBOX_VERSION"
```

por:

```sh
TOOLBOX_BASE="https://storage.googleapis.com/mcp-toolbox-for-databases/v$TOOLBOX_VERSION"
# cd2-ctl (controle do banco pela tela): versao fixa, baixada do release deste repositorio.
# CD2_CTL_LOCAL=1 pula o download e usa o compilado por "sh ctl/build.sh" (antes do 1o release).
CTL_VERSION="${CD2_CTL_VERSION:-0.6.0}"
CTL_BASE="https://github.com/cd2tec/cd2-harness-pocket/releases/download/ctl-v$CTL_VERSION"
if command -v shasum >/dev/null 2>&1; then SUM="shasum -a 256"; else SUM="sha256sum"; fi
```

E troque:

```sh
echo ""
echo "== Checksums (anote para conferir depois)"
if command -v shasum >/dev/null 2>&1; then SUM="shasum -a 256"; else SUM="sha256sum"; fi
( cd "$ROOT" && $SUM bin/llamafile "models/$MODEL_FILE" $(ls bin/toolbox/*/toolbox bin/toolbox/*/toolbox.exe 2>/dev/null) | tee CHECKSUMS.sha256 )
```

por:

```sh
echo ""
echo "== Controle do banco (cd2-ctl v$CTL_VERSION)"
mkdir -p "$ROOT/bin/ctl"
CTL_SUMS=""
if [ "${CD2_CTL_LOCAL:-}" = "1" ]; then
  echo "CD2_CTL_LOCAL=1: usando o cd2-ctl compilado localmente (sh ctl/build.sh)."
else
  CTL_SUMS="$(mktemp "${TMPDIR:-/tmp}/cd2-ctl-sums.XXXXXX")"
  if ! curl -fsSL -H 'User-Agent: cd2-harness' -o "$CTL_SUMS" "$CTL_BASE/SHA256SUMS"; then
    echo "[AVISO] Release ctl-v$CTL_VERSION indisponivel; vou usar o cd2-ctl local, se existir."
    rm -f "$CTL_SUMS"; CTL_SUMS=""
  fi
fi
for plat in $TOOLBOX_PLATFORMS; do
  os="${plat%-*}"; ext=""; [ "$os" = "windows" ] && ext=".exe"
  asset="cd2-ctl-$plat$ext"; dest="$ROOT/bin/ctl/$plat/cd2-ctl$ext"
  mkdir -p "$ROOT/bin/ctl/$plat"
  if [ -n "$CTL_SUMS" ]; then
    echo "Origem: $CTL_BASE/$asset"
    fetch "$CTL_BASE/$asset" "$dest"
    want="$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$CTL_SUMS")"
    got="$($SUM "$dest" | cut -d' ' -f1)"
    if [ -z "$want" ] || [ "$want" != "$got" ]; then
      rm -f "$dest" "$CTL_SUMS"
      echo "[ERRO] cd2-ctl $plat nao confere com o SHA256SUMS do release. Rode de novo."; exit 1
    fi
  elif [ -s "$dest" ]; then
    echo "Usando o cd2-ctl local: bin/ctl/$plat/cd2-ctl$ext"
  else
    echo "[ERRO] Sem cd2-ctl para $plat. Publique a tag ctl-v$CTL_VERSION ou compile com: sh ctl/build.sh \"$plat\" e rode com CD2_CTL_LOCAL=1."
    exit 1
  fi
  chmod +x "$dest" 2>/dev/null || true
done
if [ -n "$CTL_SUMS" ]; then rm -f "$CTL_SUMS"; fi

echo ""
echo "== Checksums (anote para conferir depois)"
( cd "$ROOT" && $SUM bin/llamafile "models/$MODEL_FILE" $(ls bin/toolbox/*/toolbox bin/toolbox/*/toolbox.exe bin/ctl/*/cd2-ctl bin/ctl/*/cd2-ctl.exe 2>/dev/null) | tee CHECKSUMS.sha256 )
```

- [ ] **Step 5: Rodar o preparo no Mac (sem release publicado ainda)**

Run:
```bash
sh -n core/prepare-unix.sh && sh ctl/build.sh && CD2_TOOLBOX_PLATFORMS=darwin-arm64 sh core/prepare-unix.sh 2>&1 | tail -n 12
```
Expected: as seções anteriores dizem "Ja baixado, pulando" (se o llamafile ou o modelo começarem a baixar de novo porque saiu versão nova, interrompa com Ctrl+C: o que importa aqui é a seção nova); depois `[AVISO] Release ctl-v0.6.0 indisponivel; vou usar o cd2-ctl local, se existir.`, `Usando o cd2-ctl local: bin/ctl/darwin-arm64/cd2-ctl`, e o `CHECKSUMS.sha256` impresso com uma linha `bin/ctl/darwin-arm64/cd2-ctl`.

Run (caminho de erro, plataforma sem binário local):
```bash
CD2_CTL_LOCAL=1 CD2_TOOLBOX_PLATFORMS=linux-amd64 sh core/prepare-unix.sh 2>&1 | tail -n 2; echo "codigo: $?"
```
Expected: `[ERRO] Sem cd2-ctl para linux-amd64. Publique a tag ctl-v0.6.0 ou compile com: sh ctl/build.sh "linux-amd64" e rode com CD2_CTL_LOCAL=1.` (o `codigo` do `echo` é o do `tail`; confirme o erro pela mensagem).

- [ ] **Step 6: Preparo no Windows**

Em `core/prepare-windows.ps1`, troque:

```powershell
$ToolboxBase = "https://storage.googleapis.com/mcp-toolbox-for-databases/v$ToolboxVersion"
```

por:

```powershell
$ToolboxBase = "https://storage.googleapis.com/mcp-toolbox-for-databases/v$ToolboxVersion"
# cd2-ctl (controle do banco pela tela): versao fixa, baixada do release deste repositorio.
# CD2_CTL_LOCAL=1 pula o download e usa o binario que ja estiver em bin\ctl (antes do 1o release).
$CtlVersion = if ($env:CD2_CTL_VERSION) { $env:CD2_CTL_VERSION } else { '0.6.0' }
$CtlBase = "https://github.com/cd2tec/cd2-harness-pocket/releases/download/ctl-v$CtlVersion"
```

Troque:

```powershell
Write-Host ''
Write-Host '== Checksums (anote para conferir depois)'
```

por:

```powershell
Write-Host ''
Write-Host "== Controle do banco (cd2-ctl v$CtlVersion)"
$ctlSums = $null
if ($env:CD2_CTL_LOCAL -eq '1') {
    Write-Host 'CD2_CTL_LOCAL=1: usando o cd2-ctl que ja esta em bin\ctl.'
} else {
    try {
        $ctlSums = (Invoke-WebRequest -UseBasicParsing -Uri "$CtlBase/SHA256SUMS" -Headers @{ 'User-Agent' = 'cd2-harness' }).Content
        if ($ctlSums -is [byte[]]) { $ctlSums = [Text.Encoding]::ASCII.GetString($ctlSums) }
    } catch {
        Write-Host "[AVISO] Release ctl-v$CtlVersion indisponivel; vou usar o cd2-ctl local, se existir."
        $ctlSums = $null
    }
}
$ctlFiles = @()
foreach ($plat in $ToolboxPlatforms) {
    $os, $arch = $plat -split '-', 2
    $ext = if ($os -eq 'windows') { '.exe' } else { '' }
    $dir = Join-Path $Root "bin\ctl\$plat"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $dest = Join-Path $dir "cd2-ctl$ext"
    $asset = "cd2-ctl-$plat$ext"
    if ($ctlSums) {
        Write-Host "Origem: $CtlBase/$asset"
        Fetch "$CtlBase/$asset" $dest
        $want = $null
        foreach ($l in ($ctlSums -split "`n")) {
            if ($l -match '^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$' -and $Matches[2] -eq $asset) { $want = $Matches[1].ToLower() }
        }
        $got = (Get-FileHash -Algorithm SHA256 $dest).Hash.ToLower()
        if (-not $want -or $want -ne $got) { Remove-Item -Force $dest; throw "cd2-ctl $plat nao confere com o SHA256SUMS do release. Rode de novo." }
    } elseif ((Test-Path $dest) -and (Get-Item $dest).Length -gt 0) {
        Write-Host "Usando o cd2-ctl local: bin/ctl/$plat/cd2-ctl$ext"
    } else {
        throw "Sem cd2-ctl para $plat. Publique a tag ctl-v$CtlVersion ou compile o cd2-ctl (sh ctl/build.sh) e rode com CD2_CTL_LOCAL=1."
    }
    $ctlFiles += @{ Path = $dest; Rel = "bin/ctl/$plat/cd2-ctl$ext" }
}

Write-Host ''
Write-Host '== Checksums (anote para conferir depois)'
```

E troque:

```powershell
foreach ($f in $toolboxFiles) { $lines += "$((Get-FileHash -Algorithm SHA256 $f.Path).Hash.ToLower())  $($f.Rel)" }
```

por:

```powershell
foreach ($f in $toolboxFiles) { $lines += "$((Get-FileHash -Algorithm SHA256 $f.Path).Hash.ToLower())  $($f.Rel)" }
foreach ($f in $ctlFiles) { $lines += "$((Get-FileHash -Algorithm SHA256 $f.Path).Hash.ToLower())  $($f.Rel)" }
```

- [ ] **Step 7: Gravadores (estimativa e listagem)**

Em `core/make-usb-unix.sh`, troque:

```sh
say "Baixando motor e modelo (uns 3,9 GB na primeira vez (motor, modelo e toolbox); depois fica em cache)..."
```

por:

```sh
say "Baixando motor e modelo (uns 3,9 GB na primeira vez: motor, modelo, toolbox e cd2-ctl; depois fica em cache)..."
```

e troque:

```sh
( cd "$MNT/CD2-HARNESS" && ls -lh bin bin/toolbox/* models CHECKSUMS.sha256 | sed 's/^/  /' )
```

por:

```sh
( cd "$MNT/CD2-HARNESS" && ls -lh bin bin/toolbox/* bin/ctl/* models CHECKSUMS.sha256 | sed 's/^/  /' )
```

Em `core/make-usb-windows.ps1`, troque:

```powershell
Write-Host 'Baixando motor e modelo (uns 3,9 GB na primeira vez (motor, modelo e toolbox); depois fica em cache)...'
```

por:

```powershell
Write-Host 'Baixando motor e modelo (uns 3,9 GB na primeira vez: motor, modelo, toolbox e cd2-ctl; depois fica em cache)...'
```

e troque:

```powershell
Get-ChildItem -Recurse (Join-Path $Dest 'bin\toolbox') -File | ForEach-Object { Write-Host ('  {0,10:N0} KB  toolbox\{1}\{2}' -f ($_.Length / 1KB), $_.Directory.Name, $_.Name) }
```

por:

```powershell
Get-ChildItem -Recurse (Join-Path $Dest 'bin\toolbox') -File | ForEach-Object { Write-Host ('  {0,10:N0} KB  toolbox\{1}\{2}' -f ($_.Length / 1KB), $_.Directory.Name, $_.Name) }
Get-ChildItem -Recurse (Join-Path $Dest 'bin\ctl') -File | ForEach-Object { Write-Host ('  {0,10:N0} KB  ctl\{1}\{2}' -f ($_.Length / 1KB), $_.Directory.Name, $_.Name) }
```

- [ ] **Step 8: Conferir fim de linha e sintaxe**

Run:
```bash
perl -pi -e 's/\r?\n/\r\n/' core/prepare-windows.ps1 core/make-usb-windows.ps1
file core/prepare-windows.ps1 core/make-usb-windows.ps1
LC_ALL=C grep -n '[^[:print:][:space:]]' core/prepare-windows.ps1 core/make-usb-windows.ps1; echo "nao-ascii: $?"
sh -n core/prepare-unix.sh && sh -n core/make-usb-unix.sh && echo sintaxe-ok
```
Expected: os dois `.ps1` como `ASCII text, with CRLF line terminators`; `nao-ascii: 1` (nenhuma linha); `sintaxe-ok`. Sem PowerShell no Mac, releia as três trocas do `.ps1` com atenção (aspas, `$Matches`, `throw`) antes do commit.

- [ ] **Step 9: Commit**

```bash
git add .github/workflows core/prepare-unix.sh core/prepare-windows.ps1 core/make-usb-unix.sh core/make-usb-windows.ps1
git commit -m "$(printf 'cd2-ctl: CI, release por tag ctl-v e download conferido no preparo\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 9: Launcher Mac/Linux com o `cd2-ctl` (e o fim do `db-env.sh`)

**Files:**
- Modify (reescrita completa): `core/start-unix.sh`
- Modify: `INICIAR-CD2-Mac.command`, `iniciar-cd2-linux.sh`
- Modify: `tests/toolbox/check-recipe.sh:10-11`
- Delete: `core/db-env.sh`, `tests/db-env.test.js`

**Interfaces:**
- Consumes: `bin/ctl/<plat>/cd2-ctl` (Tasks 6 e 8) com `--root`, `--cache`, `--harness-port` e `CD2_CTL_KEY`; `GET /status` responde 401 sem chave quando está no ar.
- Produces: janela aberta em `http://127.0.0.1:P/#k=<64 hex>`; `$CACHE/ctl.log`; trio de portas P, P+1000, P+2000.

- [ ] **Step 1: Reescrever `core/start-unix.sh`**

Conteúdo completo:

```sh
#!/usr/bin/env sh
# CD2 Harness - launcher para macOS e Linux (POSIX sh)
# Uso: sh core/start-unix.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT_START="${CD2_PORT:-8080}"
CTX="${CD2_CTX:-8192}"
OS="$(uname -s)"

say()  { printf '%s\n' "$*"; }
die()  { printf '\n[ERRO] %s\n' "$*" >&2; printf 'Pressione ENTER para sair.'; read -r _ || true; exit 1; }

banner() {
  printf '\n'
  printf '  \033[38;5;179m+-----------------------------+\033[0m\n'
  printf '  \033[38;5;179m|\033[0m   \033[1mCD2 Retail Tech\033[0m  Harness    \033[38;5;179m|\033[0m\n'
  printf '  \033[38;5;179m+-----------------------------+\033[0m\n'
  printf '  IA local, sem nuvem.\n\n'
}
banner

# --- localizar binario e modelo -------------------------------------------
SRC_BIN="$ROOT/bin/llamafile"
[ -f "$SRC_BIN" ] || die "bin/llamafile nao encontrado. Rode a preparacao do pen drive (core/prepare-unix.sh)."

MODEL="$(ls "$ROOT"/models/*.gguf 2>/dev/null | head -n 1)"
[ -n "$MODEL" ] || die "Nenhum modelo .gguf em models/. Rode a preparacao do pen drive."

# --- pen drives exFAT/FAT nao guardam permissao de execucao (e muitos sao noexec):
# --- por isso o binario roda de uma copia local.
if [ "$OS" = "Darwin" ]; then CACHE="$HOME/Library/Caches/cd2-harness"; else CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/cd2-harness"; fi
mkdir -p "$CACHE" || die "Nao consegui criar $CACHE"
RUN_BIN="$CACHE/llamafile"
if [ ! -x "$RUN_BIN" ] || ! cmp -s "$SRC_BIN" "$RUN_BIN"; then
  say "Preparando o motor de IA (primeira execucao neste computador)..."
  cp "$SRC_BIN" "$RUN_BIN.tmp" && chmod +x "$RUN_BIN.tmp" && mv "$RUN_BIN.tmp" "$RUN_BIN" || die "Falha ao copiar o motor para $CACHE"
  [ "$OS" = "Darwin" ] && xattr -dr com.apple.quarantine "$RUN_BIN" 2>/dev/null
fi

# --- trio de portas livre: P (harness), P+1000 (toolbox) e P+2000 (cd2-ctl) -----
# ocupada = alguem aceitou a conexao; o curl so devolve 7 quando ninguem escuta
busy() { curl -s --max-time 1 -o /dev/null "http://127.0.0.1:$1/" 2>/dev/null; [ "$?" -ne 7 ]; }
PORT="$PORT_START"; tries=0
while { busy "$PORT" || busy "$((PORT + 1000))" || busy "$((PORT + 2000))"; } && [ "$tries" -lt 20 ]; do PORT=$((PORT + 1)); tries=$((tries + 1)); done
URL="http://127.0.0.1:$PORT"
CTL_PORT=$((PORT + 2000))
# chave da sessao: 32 bytes aleatorios em hexadecimal. Vai so para o ambiente do cd2-ctl e para a
# janela (#k=). Nao e exportada: o navegador aberto depois nao a herda pelo ambiente.
CTL_KEY="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"

LOG="$CACHE/server.log"
PID=""
CTL_PID=""
# idempotente: Ctrl+C roda cleanup e sai; o EXIT roda de novo sem efeito.
# O cd2-ctl recebe TERM e derruba o toolbox antes de sair.
cleanup() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null; PID=""
  [ -n "$CTL_PID" ] && kill "$CTL_PID" 2>/dev/null; CTL_PID=""
  return 0
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

start_server() {  # $@ = flags extras (GPU)
  : > "$LOG"
  if [ "$#" -gt 0 ]; then
    "$RUN_BIN" -m "$MODEL" --server --host 127.0.0.1 --port "$PORT" --jinja -c "$CTX" --path "$ROOT/web" "$@" >> "$LOG" 2>&1 &
  else
    "$RUN_BIN" -m "$MODEL" --server --host 127.0.0.1 --port "$PORT" --jinja -c "$CTX" --path "$ROOT/web" >> "$LOG" 2>&1 &
  fi
  PID=$!
}

wait_ready() {  # espera ate 240s; retorna 1 se o processo morrer
  i=0
  while [ "$i" -lt 240 ]; do
    kill -0 "$PID" 2>/dev/null || return 1
    curl -sf --max-time 2 "$URL/health" >/dev/null 2>&1 && return 0
    i=$((i + 1)); sleep 1
  done
  return 1
}

say "Carregando o modelo: $(basename "$MODEL")"
say "(na primeira vez pode levar de 20 a 90 segundos)"
start_server -ngl 999
if ! wait_ready; then
  say "Aceleracao por GPU indisponivel, tentando so com CPU..."
  kill "$PID" 2>/dev/null; sleep 1
  start_server --gpu disable -ngl 0
  wait_ready || { tail -n 25 "$LOG"; die "O servidor nao iniciou. Log completo: $LOG"; }
fi

say ""
say "Pronto: $URL"

# --- controle do banco (cd2-ctl): sobe, troca e derruba o MCP Toolbox pela tela Ferramentas ---
case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; *) ARCH=amd64 ;; esac
if [ "$OS" = "Darwin" ]; then PLAT="darwin-$ARCH"; else PLAT="linux-$ARCH"; fi
CTL_SRC="$ROOT/bin/ctl/$PLAT/cd2-ctl"
start_ctl() {
  if [ ! -f "$CTL_SRC" ]; then say "bin/ctl/$PLAT nao encontrado: banco de dados indisponivel neste pen drive"; return 1; fi
  CTL_RUN="$CACHE/cd2-ctl"
  if [ ! -x "$CTL_RUN" ] || ! cmp -s "$CTL_SRC" "$CTL_RUN"; then
    cp "$CTL_SRC" "$CTL_RUN.tmp" && chmod +x "$CTL_RUN.tmp" && mv "$CTL_RUN.tmp" "$CTL_RUN" || { say "Falha ao copiar o cd2-ctl para $CACHE"; return 1; }
    [ "$OS" = "Darwin" ] && xattr -dr com.apple.quarantine "$CTL_RUN" 2>/dev/null
  fi
  CTL_LOG="$CACHE/ctl.log"; : > "$CTL_LOG"
  CD2_CTL_KEY="$CTL_KEY" "$CTL_RUN" --root "$ROOT" --cache "$CACHE" --harness-port "$PORT" >> "$CTL_LOG" 2>&1 &
  CTL_PID=$!
  i=0
  while [ "$i" -lt 10 ]; do
    kill -0 "$CTL_PID" 2>/dev/null || break
    # 401 = esta no ar. O teste vai sem a chave, para ela nao aparecer na lista de processos.
    code="$(curl -s --max-time 1 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$CTL_PORT/status" 2>/dev/null)"
    [ "$code" = 401 ] && return 0
    i=$((i + 1)); sleep 1
  done
  kill "$CTL_PID" 2>/dev/null; CTL_PID=""
  say "[AVISO] O controle do banco (cd2-ctl) nao subiu. Ultimas linhas de $CTL_LOG:"
  tail -n 5 "$CTL_LOG" | sed 's/^/   /'
  say "Seguindo sem banco de dados (Demonstracao e Archeo continuam)."
  return 1
}
start_ctl && say "Controle do banco em 127.0.0.1:$CTL_PORT. Configure o banco pela tela Ferramentas."
APP_URL="$URL/#k=$CTL_KEY"

# --- abrir como janela de aplicativo quando houver Chrome/Edge ---------------
open_app() {
  if [ "$OS" = "Darwin" ]; then
    for app in "Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium"; do
      if [ -d "/Applications/$app.app" ]; then open -na "$app" --args "--app=$APP_URL" "--window-size=1280,860"; return; fi
    done
    open "$APP_URL"
  else
    for b in google-chrome google-chrome-stable microsoft-edge chromium chromium-browser brave-browser; do
      if command -v "$b" >/dev/null 2>&1; then "$b" "--app=$APP_URL" "--window-size=1280,860" >/dev/null 2>&1 & return; fi
    done
    command -v xdg-open >/dev/null 2>&1 && xdg-open "$APP_URL" >/dev/null 2>&1 || say "Abra no navegador: $APP_URL"
  fi
}
open_app

say ""
say "O harness esta rodando. Para encerrar: feche esta janela ou pressione Ctrl+C."
# mantem o script vivo enquanto o servidor viver
while kill -0 "$PID" 2>/dev/null; do sleep 2; done
say "O servidor foi encerrado."
```

- [ ] **Step 2: Wrappers sem repassar argumentos**

`INICIAR-CD2-Mac.command` (conteúdo completo):

```sh
#!/bin/sh
cd "$(dirname "$0")" || exit 1
exec sh core/start-unix.sh
```

`iniciar-cd2-linux.sh` (conteúdo completo):

```sh
#!/bin/sh
# Uso: sh iniciar-cd2-linux.sh   (chamar via "sh" evita problemas de pen drive montado como noexec)
cd "$(dirname "$0")" || exit 1
exec sh core/start-unix.sh
```

- [ ] **Step 3: `check-recipe.sh` sem `db-env.sh`**

Em `tests/toolbox/check-recipe.sh`, troque:

```sh
# mesmo caminho do launcher: a receita usa password: "${CD2_DB_PASSWORD}", entao a senha vai escapada
. "$ROOT/core/db-env.sh"; CD2_DB_PASSWORD="$(db_yaml_dq "$CD2_DB_PASSWORD")"
```

por:

```sh
# mesmo caminho do cd2-ctl: a receita usa password: "${CD2_DB_PASSWORD}", entao a senha vai
# escapada para YAML entre aspas duplas (\ vira \\, " vira \")
CD2_DB_PASSWORD="$(printf '%s' "$CD2_DB_PASSWORD" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
```

- [ ] **Step 4: Apagar o `db-env.sh` e o teste dele**

```bash
git rm core/db-env.sh tests/db-env.test.js
```

- [ ] **Step 5: Conferências rápidas**

Run:
```bash
sh -n core/start-unix.sh && echo sintaxe-ok
grep -rn -e 'db-env' -e '--banco' -e 'TB_PID' -e 'db_env' -e 'db_yaml_dq' core INICIAR-CD2-Mac.command iniciar-cd2-linux.sh tests; echo "restos: $?"
node --test 2>&1 | tail -n 8
sh tests/toolbox/check-recipe.sh postgres | tail -n 1
```
Expected: `sintaxe-ok`; `restos: 1` (nada; o `INICIAR-CD2-Windows.bat` e o `.ps1` são da Task 10 e o `web/` da Task 12, por isso ficam fora deste grep); `node --test` com `# fail 0`; `OK: postgres`.

- [ ] **Step 6: Teste do launcher no Mac (com porta P+2000 ocupada por algo que não fala HTTP)**

Faça backup do `db.env` real (não abra o conteúdo) e compile o `cd2-ctl`:
```bash
sh ctl/build.sh
DBENV="$HOME/Library/Caches/cd2-harness/db.env"; [ -f "$DBENV" ] && mv "$DBENV" "$DBENV.bak-v050"
```
Ocupe a 10380 e suba o launcher em segundo plano a partir da 8380:
```bash
nc -lk 10380 >/dev/null 2>&1 & echo "nc=$!"
CD2_PORT=8380 sh core/start-unix.sh </dev/null > "${TMPDIR:-/tmp}/cd2-launcher.log" 2>&1 & echo "launcher=$!"
```
Espere (até uns 90 s) o log ter `O harness esta rodando` e confira:
```bash
cat "${TMPDIR:-/tmp}/cd2-launcher.log"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:10381/status
ps -Ao args | grep -c '[c]d2-ctl --root'
ps -Ao args | grep '[c]d2-ctl --root' | grep -Ec '[0-9a-f]{64}'
```
Expected: o log tem `Pronto: http://127.0.0.1:8381` (a 8380 foi pulada porque a 10380 aceitou conexão), `Controle do banco em 127.0.0.1:10381. Configure o banco pela tela Ferramentas.` e `O harness esta rodando...`; o `curl` dá `401`; um processo `cd2-ctl --root`; `0` linhas com 64 hexadecimais na linha de comando dele. Uma janela do Chrome abre: feche.

Encerre e confira que nada sobrou:
```bash
kill -TERM <launcher>; sleep 6
pgrep -fl 'cd2-harness/(cd2-ctl|llamafile|toolbox)'; echo "sobrou: $?"
curl -s -o /dev/null -w '%{http_code}\n' --max-time 2 http://127.0.0.1:10381/status
kill <nc>
[ -f "$DBENV.bak-v050" ] && mv "$DBENV.bak-v050" "$DBENV"
```
Expected: `sobrou: 1` (nenhum processo), `000`, e o `db.env` original de volta.

Teste também o aviso de binário ausente: `mv bin/ctl bin/ctl.off`, rode `CD2_PORT=8480 sh core/start-unix.sh` no terminal, confira a linha `bin/ctl/darwin-arm64 nao encontrado: banco de dados indisponivel neste pen drive` e que a janela abre mesmo assim; Ctrl+C; `mv bin/ctl.off bin/ctl`.

- [ ] **Step 7: Commit**

```bash
git add core/start-unix.sh INICIAR-CD2-Mac.command iniciar-cd2-linux.sh tests/toolbox/check-recipe.sh
git commit -m "$(printf 'launcher Unix: trio de portas, chave da sessao e cd2-ctl no lugar da pergunta do banco\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 10: Launcher Windows com o `cd2-ctl`

**Files:**
- Modify (reescrita completa): `core/start-windows.ps1`
- Modify (reescrita completa): `INICIAR-CD2-Windows.bat`

**Interfaces:**
- Consumes: `bin\ctl\windows-amd64\cd2-ctl.exe` (Task 8), mesmas flags e `CD2_CTL_KEY`.
- Produces: janela em `http://127.0.0.1:P/#k=<64 hex>`; logs `%TEMP%\cd2-harness\ctl.log` e `ctl.err.log`.

- [ ] **Step 1: Reescrever `core/start-windows.ps1`**

Conteúdo completo (ASCII puro, sem acento):

```powershell
# CD2 Harness - launcher para Windows (PowerShell 5.1+)
$ErrorActionPreference = 'Stop'
$Root   = Split-Path -Parent $PSScriptRoot
$Ctx    = if ($env:CD2_CTX) { $env:CD2_CTX } else { '8192' }
$PortFrom = if ($env:CD2_PORT) { [int]$env:CD2_PORT } else { 8080 }
$LogDir = Join-Path $env:TEMP 'cd2-harness'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log    = Join-Path $LogDir 'server.log'
$LogErr = Join-Path $LogDir 'server.err.log'
$script:Proc = $null
$script:CtlProc = $null

function Fail($msg) {
    Write-Host ""
    Write-Host "[ERRO] $msg" -ForegroundColor Red
    Read-Host "Pressione ENTER para sair"
    exit 1
}
function PortFree([int]$p) {
    try {
        $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
        $l.Start(); $l.Stop(); return $true
    } catch { return $false }
}
function Stop-Server {
    if ($script:Proc -and -not $script:Proc.HasExited) {
        & taskkill.exe /PID $script:Proc.Id /T /F 2>&1 | Out-Null
    }
}
function Start-Server([string[]]$extra) {
    Stop-Server
    Set-Content -Path $Log -Value '' ; Set-Content -Path $LogErr -Value ''
    $args = @('-m', "`"$Model`"", '--server', '--host', '127.0.0.1', '--port', "$Port",
              '--jinja', '-c', $Ctx, '--path', "`"$(Join-Path $Root 'web')`"") + $extra
    $script:Proc = Start-Process -FilePath $Exe -ArgumentList $args -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $Log -RedirectStandardError $LogErr
}
function Wait-Ready {
    for ($i = 0; $i -lt 240; $i++) {
        if ($script:Proc.HasExited) { return $false }
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri "$Url/health" -TimeoutSec 2
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Seconds 1
    }
    return $false
}

# chave da sessao: 32 bytes aleatorios em hexadecimal (vai so para o cd2-ctl e para a janela)
function New-SessionKey {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}
# caminho entre aspas para a linha de comando; "E:\" terminaria em \" e quebraria o argumento
function Quote-Path([string]$p) { if ($p.EndsWith('\')) { $p = $p + '.' }; return '"' + $p + '"' }
# taskkill /T derruba o cd2-ctl e o toolbox que ele subiu
function Stop-Ctl {
    if ($script:CtlProc -and -not $script:CtlProc.HasExited) {
        & taskkill.exe /PID $script:CtlProc.Id /T /F 2>&1 | Out-Null
    }
}
function Start-Ctl {
    # roda direto do pen drive, como o llamafile.exe (no Windows nao falta bit de execucao)
    $src = Join-Path $Root 'bin\ctl\windows-amd64\cd2-ctl.exe'
    if (-not (Test-Path $src)) {
        Write-Host 'bin\ctl\windows-amd64 nao encontrado: banco de dados indisponivel neste pen drive' -ForegroundColor DarkYellow
        return $false
    }
    $ctlLog = Join-Path $LogDir 'ctl.log'; $ctlErr = Join-Path $LogDir 'ctl.err.log'
    $ctlArgs = @('--root', (Quote-Path $Root), '--cache', (Quote-Path $Cache), '--harness-port', "$Port")
    # a chave vai so no ambiente do cd2-ctl: sai daqui assim que ele sobe, antes de abrir o navegador
    $env:CD2_CTL_KEY = $CtlKey
    try {
        $script:CtlProc = Start-Process -FilePath $src -ArgumentList $ctlArgs -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $ctlLog -RedirectStandardError $ctlErr
    } finally {
        Remove-Item Env:CD2_CTL_KEY -ErrorAction SilentlyContinue
    }
    for ($i = 0; $i -lt 10; $i++) {
        if ($script:CtlProc.HasExited) { break }
        # 401 = esta no ar (o teste vai sem a chave)
        try { $null = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$CtlPort/status" -TimeoutSec 2; return $true }
        catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { return $true } }
        Start-Sleep -Seconds 1
    }
    Stop-Ctl
    Write-Host "[AVISO] O controle do banco (cd2-ctl) nao subiu. Ultimas linhas de ${ctlErr}:" -ForegroundColor DarkYellow
    if (Test-Path $ctlErr) { Get-Content $ctlErr -Tail 5 | ForEach-Object { Write-Host "   $_" } }
    Write-Host 'Seguindo sem banco de dados (Demonstracao e Archeo continuam).' -ForegroundColor DarkYellow
    return $false
}

Clear-Host
Write-Host ""
Write-Host "  +-----------------------------+" -ForegroundColor DarkYellow
Write-Host "  |   CD2 Retail Tech  Harness  |" -ForegroundColor Yellow
Write-Host "  +-----------------------------+" -ForegroundColor DarkYellow
Write-Host "  IA local, sem nuvem." -ForegroundColor Gray
Write-Host ""

$Exe = Join-Path $Root 'bin\llamafile.exe'
if (-not (Test-Path $Exe)) { Fail "bin\llamafile.exe nao encontrado. Rode a preparacao do pen drive (core\prepare-windows.bat)." }
$ModelFile = Get-ChildItem -Path (Join-Path $Root 'models') -Filter *.gguf -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ModelFile) { Fail "Nenhum modelo .gguf em models\. Rode a preparacao do pen drive." }
$Model = $ModelFile.FullName

# trio de portas livre: P (harness), P+1000 (toolbox) e P+2000 (cd2-ctl), avancando juntas
$Port = $PortFrom
while ((-not (PortFree $Port) -or -not (PortFree ($Port + 1000)) -or -not (PortFree ($Port + 2000))) -and $Port -lt ($PortFrom + 20)) { $Port++ }
$Url = "http://127.0.0.1:$Port"
$CtlPort = $Port + 2000
$Cache = Join-Path $env:LOCALAPPDATA 'cd2-harness'
New-Item -ItemType Directory -Force -Path $Cache | Out-Null
$CtlKey = New-SessionKey

try {
    Write-Host "Carregando o modelo: $($ModelFile.Name)" -ForegroundColor Gray
    Write-Host "(na primeira vez pode levar de 20 a 90 segundos)" -ForegroundColor DarkGray
    Start-Server @('-ngl', '999')
    if (-not (Wait-Ready)) {
        Write-Host "Aceleracao por GPU indisponivel, tentando so com CPU..." -ForegroundColor DarkYellow
        Start-Server @('--gpu', 'disable', '-ngl', '0')
        if (-not (Wait-Ready)) {
            if (Test-Path $LogErr) { Get-Content $LogErr -Tail 25 }
            Fail "O servidor nao iniciou. Logs em $LogDir"
        }
    }

    Write-Host ""
    Write-Host "Pronto: $Url" -ForegroundColor Green

    if (Start-Ctl) { Write-Host "Controle do banco em 127.0.0.1:$CtlPort. Configure o banco pela tela Ferramentas." -ForegroundColor Gray }
    $AppUrl = "$Url/#k=$CtlKey"

    # abre como janela de aplicativo (Edge vem com o Windows; Chrome como alternativa)
    $cands = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    $browser = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($browser) { Start-Process -FilePath $browser -ArgumentList @("--app=$AppUrl", '--window-size=1280,860') }
    else { Start-Process $AppUrl }

    Write-Host ""
    Write-Host "O harness esta rodando. Para encerrar, pressione ENTER nesta janela." -ForegroundColor Gray
    while (-not $script:Proc.HasExited) {
        if ([Console]::KeyAvailable) { $k = [Console]::ReadKey($true); if ($k.Key -eq 'Enter') { break } }
        Start-Sleep -Milliseconds 400
    }
}
finally {
    try { Stop-Ctl } catch { }
    try { Stop-Server } catch { }
}
```

- [ ] **Step 2: Reescrever `INICIAR-CD2-Windows.bat`**

Conteúdo completo:

```bat
@echo off
chcp 65001 >nul
title CD2 Harness
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0core\start-windows.ps1"
if errorlevel 1 pause
```

- [ ] **Step 3: CRLF, ASCII, sem BOM, sem restos**

Run:
```bash
perl -pi -e 's/\r?\n/\r\n/' core/start-windows.ps1 INICIAR-CD2-Windows.bat
file core/start-windows.ps1 INICIAR-CD2-Windows.bat
LC_ALL=C grep -n '[^[:print:][:space:]]' core/start-windows.ps1 INICIAR-CD2-Windows.bat; echo "nao-ascii: $?"
head -c 3 core/start-windows.ps1 | od -An -tx1
grep -n -e 'Banco' -e 'DbEnv' -e 'Toolbox' -e 'TbPort' -e 'Escape-YamlDq' -e 'Scrubbed' core/start-windows.ps1 INICIAR-CD2-Windows.bat; echo "restos: $?"
```
Expected: `ASCII text, with CRLF line terminators` (o `.bat` como `DOS batch file text, ASCII text, with CRLF line terminators`); `nao-ascii: 1`; os três primeiros bytes `23 20 43` (`# C`, sem BOM); `restos: 1`.

Sem PowerShell no Mac: releia o arquivo inteiro procurando `$args` x `$ctlArgs`, variável seguida de `:` dentro de aspas (tem de ser `${ctlErr}:`, porque `$ctlErr:` é erro de sintaxe no PowerShell), chaves e `try/catch` balanceados, e que `$CtlKey`, `$CtlPort` e `$Cache` são definidos antes do `try` que chama `Start-Ctl`. O teste de verdade vai no checklist do PR (Task 13).

- [ ] **Step 4: Commit**

```bash
git add core/start-windows.ps1 INICIAR-CD2-Windows.bat
git commit -m "$(printf 'launcher Windows: trio de portas, chave da sessao e cd2-ctl\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 11: Lógica pura do front para o `cd2-ctl` (`web/toolbox.js`)

**Files:**
- Modify: `web/toolbox.js` (funções novas e o objeto exportado, no fim do arquivo)
- Test: `tests/toolbox.test.js` (testes novos no fim)

**Interfaces:**
- Consumes: `ENGINES`, `engineLabel` (já existem em `web/toolbox.js`).
- Produces (global `CD2Toolbox` no navegador, `module.exports` no Node):
  - `ctlUrlFor(loc: {port}): string` → `http://127.0.0.1:<port+2000>` (porta vazia conta como 80; sem barra no fim)
  - `readKeyFromHash(hash: string|null|undefined): string|null` → a chave de 64 hexadecimais de `k=` no hash, ou `null`
  - `defaultsFor(motor, usuario, base): { porta: number|'', schema: string }`
  - `configPayload(form: {motor, host, porta, base, usuario, senha, schema}): object` → campos aparados (menos senha), `porta` numérica quando só dígitos, ausente quando vazia; `senha` só se não vazia
  - `ctlStatusLines(cs): Array<[label, value]>` → Motor, Host, Porta, Base, Usuário, Schema (nunca senha)

- [ ] **Step 1: Escrever os testes**

Acrescente ao fim de `tests/toolbox.test.js`:

```js
/* ---------- cd2-ctl (controle do banco pela tela) ---------- */
const K = 'a'.repeat(32) + '0123456789abcdef0123456789ABCDEF';

test('ctlUrlFor: porta do harness + 2000, sempre 127.0.0.1, sem barra no fim', () => {
  assert.equal(T.ctlUrlFor({ port:'8080' }), 'http://127.0.0.1:10080');
  assert.equal(T.ctlUrlFor({ hostname:'localhost', port:'8093' }), 'http://127.0.0.1:10093');
  assert.equal(T.ctlUrlFor({ port:'' }), 'http://127.0.0.1:2080');
});

test('readKeyFromHash: só k= com 64 hexadecimais; hash vazio não é chave', () => {
  assert.equal(K.length, 64);
  assert.equal(T.readKeyFromHash('#k=' + K), K);
  assert.equal(T.readKeyFromHash('#x=1&k=' + K), K);
  assert.equal(T.readKeyFromHash('#k=' + K + '&y=2'), K);
  for(const h of ['', '#', '#k=', '#k=' + K.slice(1), '#k=' + K + 'f', '#k=' + K.slice(1) + 'g', '#kk=' + K, '?k=' + K, null, undefined]){
    assert.equal(T.readKeyFromHash(h), null, String(h));
  }
});

test('defaultsFor: porta e schema padrão por motor (mesmas regras do cd2-ctl)', () => {
  assert.deepEqual(T.defaultsFor('postgres', 'u', 'b'), { porta:5432, schema:'public' });
  assert.deepEqual(T.defaultsFor('oracle', 'leitor', 'FREEPDB1'), { porta:1521, schema:'LEITOR' });
  assert.deepEqual(T.defaultsFor('mariadb', 'u', 'loja'), { porta:3306, schema:'loja' });
  assert.deepEqual(T.defaultsFor('sqlserver', 'u', 'b'), { porta:1433, schema:'dbo' });
  assert.deepEqual(T.defaultsFor('oracle', '', ''), { porta:1521, schema:'' });
  assert.deepEqual(T.defaultsFor('xpto', 'u', 'b'), { porta:'', schema:'' });
});

test('configPayload: apara, porta numérica, porta vazia e senha vazia somem', () => {
  assert.deepEqual(
    T.configPayload({ motor:'postgres', host:' db.local ', porta:' 5432 ', base:' cd2', usuario:'leitor ', senha:'', schema:'' }),
    { motor:'postgres', host:'db.local', porta:5432, base:'cd2', usuario:'leitor', schema:'' });
  assert.deepEqual(
    T.configPayload({ motor:'oracle', host:'h', porta:'', base:'s', usuario:'u', senha:' com espaço ', schema:'X' }),
    { motor:'oracle', host:'h', base:'s', usuario:'u', schema:'X', senha:' com espaço ' });
  assert.equal(T.configPayload({ motor:'postgres', porta:'54a' }).porta, '54a');
  assert.equal('senha' in T.configPayload({ motor:'postgres' }), false);
  assert.equal(T.configPayload({ motor:'postgres', senha:"cd2 s3nh@'x" }).senha, "cd2 s3nh@'x");
});

test('ctlStatusLines: campos do /status, sem senha', () => {
  const l = T.ctlStatusLines({ estado:'rodando', motor:'oracle', host:'h', porta:1521, base:'FREEPDB1', usuario:'leitor', schema:'LEITOR', senha_salva:true });
  assert.deepEqual(l, [['Motor','Oracle'],['Host','h'],['Porta','1521'],['Base','FREEPDB1'],['Usuário','leitor'],['Schema','LEITOR']]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/toolbox.test.js`
Expected: FAIL nos cinco testes novos com `T.ctlUrlFor is not a function` (e equivalentes); os antigos passam.

- [ ] **Step 3: Implementar**

Em `web/toolbox.js`, troque:

```js
const api = { ENGINES, TOOL_DESCRIPTIONS, engineLabel, urlFor, guardSql, parseStatus, statusLines };
```

por:

```js
/* ---------- cd2-ctl: controle do banco na porta do harness + 2000 ---------- */
function ctlUrlFor(loc){ const p = parseInt(loc.port, 10) || 80; return 'http://127.0.0.1:' + (p + 2000); }
// A chave da sessão chega uma vez no endereço (#k=<64 hex>), posta pelo launcher.
function readKeyFromHash(hash){
  const m = /(?:^#|&)k=([0-9a-fA-F]{64})(?=&|$)/.exec(String(hash || ''));
  return m ? m[1] : null;
}
// Mesmas regras do cd2-ctl (e da v0.5.0): Oracle usa o usuário em maiúsculas, MariaDB a base.
function defaultsFor(motor, usuario, base){
  const e = ENGINES[motor];
  if(!e) return { porta:'', schema:'' };
  const schema = { postgres:'public', oracle:String(usuario || '').toUpperCase(), mariadb:String(base || ''), sqlserver:'dbo' }[motor];
  return { porta:e.port, schema };
}
// Corpo de POST /config. A senha não é aparada (espaço pode fazer parte dela) e só vai se
// foi digitada: vazia significa "manter a salva".
function configPayload(form){
  const t = v => String(v == null ? '' : v).trim();
  const out = { motor:t(form.motor), host:t(form.host), base:t(form.base), usuario:t(form.usuario), schema:t(form.schema) };
  const p = t(form.porta);
  if(p) out.porta = /^\d+$/.test(p) ? Number(p) : p;
  const s = form.senha == null ? '' : String(form.senha);
  if(s) out.senha = s;
  return out;
}
function ctlStatusLines(cs){
  const v = x => (x == null ? '' : String(x));
  return [
    ['Motor', engineLabel(cs.motor)], ['Host', v(cs.host)], ['Porta', v(cs.porta)],
    ['Base', v(cs.base)], ['Usuário', v(cs.usuario)], ['Schema', v(cs.schema)]
  ];
}

const api = { ENGINES, TOOL_DESCRIPTIONS, engineLabel, urlFor, guardSql, parseStatus, statusLines,
  ctlUrlFor, readKeyFromHash, defaultsFor, configPayload, ctlStatusLines };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: `# fail 0`; os cinco testes novos aparecem como `ok`.

- [ ] **Step 5: Commit**

```bash
git add web/toolbox.js tests/toolbox.test.js
git commit -m "$(printf 'front: URL do cd2-ctl, chave do endereco, padroes por motor e corpo do POST\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 12: Tela Ferramentas com o formulário do banco e o nome Harness Pocket

**Files:**
- Modify: `web/index.html` (título; CSS; marca; bloco `#tbBox`; `st`; dica do `connectTools`; `renderHero`; `renderToolbox`/`openCfg`; `saveCfg`; funções novas; `boot`; ligações de eventos)
- Modify: `web/config.json` (`product`)

**Interfaces:**
- Consumes: `CD2Toolbox.ctlUrlFor`, `readKeyFromHash`, `defaultsFor`, `configPayload`, `ctlStatusLines`, `statusLines`, `engineLabel`, `TOOL_DESCRIPTIONS` (Task 11 e já existentes); API do `cd2-ctl` (Task 6): `GET /status`, `POST /config`, `DELETE /config` com `Authorization: Bearer <chave>`.
- Produces: `sessionStorage['cd2.ctlKey']`; funções de página `loadCtlKey`, `ctlRequest`, `refreshCtl`, `fillDbForm`, `readDbForm`, `syncDbForm`, `saveDb`, `disconnectDb`.

- [ ] **Step 1: Nome do produto**

`web/config.json`: troque `"product": "Harness",` por `"product": "Harness Pocket",`.

Em `web/index.html`:
- troque `<title>CD2 Harness</title>` por `<title>CD2 Tech · Harness Pocket</title>`;
- troque `<div class="product"><b id="brand">Harness</b>` por `<div class="product"><b id="brand">Harness Pocket</b>`;
- troque `h.innerHTML = '<span class="eyebrow">IA local · CD2 Harness</span>` por `h.innerHTML = '<span class="eyebrow">IA local · CD2 Harness Pocket</span>`;
- em `boot()`, troque:

```js
  $('#brand').textContent = st.cfg.product || 'Harness';
  document.title = (st.cfg.brand || 'CD2 Tech') + ' · ' + (st.cfg.product || 'Harness');
```

por:

```js
  $('#brand').textContent = st.cfg.product || 'Harness Pocket';
  document.title = (st.cfg.brand || 'CD2 Tech') + ' · ' + (st.cfg.product || 'Harness Pocket');
```

- [ ] **Step 2: CSS do formulário (só tokens)**

Troque:

```css
.status{margin-right:auto}
.status:empty{display:none}
```

por:

```css
.status{margin-right:auto}
.status:empty{display:none}
/* formulário do banco (cd2-ctl) */
.dbf{display:grid;grid-template-columns:1fr 1fr;gap:0 var(--space-4)}
.dbf .wide{grid-column:1 / -1}
.dbf label{margin:var(--space-4) 0 var(--space-2)}
select{width:100%;height:44px;background:var(--surface-raised);color:var(--ink);border:1px solid var(--border-field);border-radius:var(--radius-sm);padding:0 var(--space-3);font:400 15px/24px var(--font-sans)}
input:disabled,select:disabled{background:var(--surface-100);color:var(--ink-muted);cursor:not-allowed}
.lnk{font:600 13px/20px var(--font-sans);color:var(--ink-brand)}
#tbLog{margin:var(--space-3) 0 0}
```

E no bloco `@media (max-width:640px)`, troque:

```css
  .product span{display:none}
  .wrap{padding:0 var(--space-4)}
```

por:

```css
  .product span{display:none}
  .wrap{padding:0 var(--space-4)}
  .dbf{grid-template-columns:1fr}
```

- [ ] **Step 3: Bloco do modo banco no diálogo**

Troque:

```html
  <div id="tbBox">
    <dl class="kv" id="tbStatus"></dl>
    <div class="hint" id="tbHint"></div>
    <span class="eyebrow" style="margin-top:var(--space-6)">Exploração</span>
    <div class="hint">Publicadas automaticamente pelo sistema. Já disponíveis e não editáveis.</div>
    <ul class="tools" id="tbTools"></ul>
    <div class="hint">Para trocar de banco, feche o harness e abra com INICIAR --banco.</div>
  </div>
```

por:

```html
  <div id="tbBox">
    <form class="dbf" id="dbForm" autocomplete="off" onsubmit="return false">
      <div class="wide"><label for="dbMotor">Motor</label>
        <select id="dbMotor">
          <option value="postgres">PostgreSQL</option>
          <option value="oracle">Oracle</option>
          <option value="mariadb">MariaDB / MySQL</option>
          <option value="sqlserver">SQL Server</option>
        </select></div>
      <div><label for="dbHost">Host</label><input type="text" id="dbHost" spellcheck="false"></div>
      <div><label for="dbPorta">Porta</label><input type="text" id="dbPorta" inputmode="numeric"></div>
      <div><label for="dbBase" id="dbBaseLabel">Base de dados</label><input type="text" id="dbBase" spellcheck="false"></div>
      <div><label for="dbUsuario">Usuário</label><input type="text" id="dbUsuario" spellcheck="false"></div>
      <div><label for="dbSenha">Senha</label><input type="password" id="dbSenha" autocomplete="off"></div>
      <div><label for="dbSchema">Schema</label><input type="text" id="dbSchema" spellcheck="false"></div>
    </form>
    <div class="hint">Use uma conta somente leitura. A senha fica só neste computador e nunca volta para a tela.</div>
    <dl class="kv" id="tbStatus"></dl>
    <div class="hint" id="tbHint"></div>
    <details class="tool" id="tbLog" style="display:none"><summary>Log do toolbox</summary><div class="inner"></div></details>
    <div class="hint"><a href="#" class="lnk" id="bDbOff" style="display:none">Desconectar do banco</a></div>
    <span class="eyebrow" style="margin-top:var(--space-6)">Exploração</span>
    <div class="hint">Publicadas automaticamente pelo sistema. Já disponíveis e não editáveis.</div>
    <ul class="tools" id="tbTools"></ul>
  </div>
```

- [ ] **Step 4: Estado e dica de erro**

Troque:

```js
const st = { cfg:{}, messages:[], provider:null, tools:[], busy:false, ctl:null, dbStatus:null };
```

por:

```js
const st = { cfg:{}, messages:[], provider:null, tools:[], busy:false, ctl:null, dbStatus:null,
  ctlKey:null, ctlUp:false, ctlStale:false, ctlStatus:null, ctlBusy:false };
```

(`st.ctl` continua sendo o `AbortController` da conversa; tudo do `cd2-ctl` usa o prefixo `ctl` com outro nome.)

E troque:

```js
'. O launcher deve ter avisado no terminal; feche o harness e abra com INICIAR --banco para configurar, ou use a Demonstração.'
```

por:

```js
'. Configure o banco em Ferramentas, modo MCP Nativo para Banco de dados, ou use a Demonstração.'
```

- [ ] **Step 5: `renderToolbox` e `openCfg` com o `cd2-ctl`**

Troque o trecho inteiro que vai de `function renderToolbox(){` até o fim de `function openCfg(){ ... }` (as duas funções, exatamente como estão hoje) por:

```js
/* ---------- controle do banco (cd2-ctl, porta do harness + 2000) ---------- */
const DB_FIELDS = { motor:'#dbMotor', host:'#dbHost', porta:'#dbPorta', base:'#dbBase', usuario:'#dbUsuario', senha:'#dbSenha', schema:'#dbSchema' };
// A chave chega uma vez no endereço (#k=), vai para o sessionStorage desta aba e some do endereço.
// Recarregar a página (hash já vazio) mantém a chave guardada.
function loadCtlKey(){
  const k = CD2Toolbox.readKeyFromHash(location.hash);
  if(k){
    store.set('cd2.ctlKey', k, true);
    try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){}
  }
  st.ctlKey = store.get('cd2.ctlKey', true) || k || null;
}
async function ctlRequest(method, path, body){
  const headers = { Authorization:'Bearer ' + st.ctlKey };
  if(body) headers['Content-Type'] = 'application/json';
  const r = await fetch(CD2Toolbox.ctlUrlFor(location) + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache:'no-store' });
  let data = {};
  try{ data = (await r.json()) || {}; }catch(e){}
  return { status:r.status, data };
}
async function refreshCtl(){
  st.ctlUp = false; st.ctlStale = false; st.ctlStatus = null;
  if(!st.ctlKey) return;
  try{
    const r = await ctlRequest('GET', '/status');
    if(r.status === 200){ st.ctlUp = true; st.ctlStatus = r.data; }
    else if(r.status === 401) st.ctlStale = true;
  }catch(e){}
}
function readDbForm(){ const f = {}; for(const k in DB_FIELDS) f[k] = $(DB_FIELDS[k]).value; return f; }
function syncDbForm(){
  const m = $('#dbMotor').value;
  const d = CD2Toolbox.defaultsFor(m, $('#dbUsuario').value.trim(), $('#dbBase').value.trim());
  $('#dbPorta').placeholder = String(d.porta); $('#dbSchema').placeholder = d.schema;
  $('#dbBaseLabel').textContent = (m === 'oracle') ? 'Service name' : 'Base de dados';
}
// Preenche com o /status (ou limpa, com s nulo). A senha nunca vem: só o aviso de que há uma salva.
function fillDbForm(s){
  s = s || {};
  $('#dbMotor').value = s.motor || 'postgres';
  $('#dbHost').value = s.host || ''; $('#dbPorta').value = s.porta ? String(s.porta) : '';
  $('#dbBase').value = s.base || ''; $('#dbUsuario').value = s.usuario || ''; $('#dbSchema').value = s.schema || '';
  $('#dbSenha').value = '';
  $('#dbSenha').placeholder = s.senha_salva ? 'Senha salva. Deixe em branco para manter.' : '';
  syncDbForm();
}
function renderToolbox(){
  const cs = st.ctlStatus, hint = $('#tbHint'), dl = $('#tbStatus'), logBox = $('#tbLog');
  dl.innerHTML = ''; hint.innerHTML = ''; logBox.style.display = 'none';
  const warn = t => { hint.innerHTML = '<span class="tag tag--atencao">Atenção</span> '; hint.appendChild(document.createTextNode(t)); };
  const lines = rows => {
    for(const [k, v] of rows){
      const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.appendChild(dt); dl.appendChild(dd);
    }
  };
  if(!st.ctlKey) warn('Para configurar o banco, abra o harness pelo atalho INICIAR.');
  else if(st.ctlStale) warn('Esta janela é de uma abertura anterior do harness. Feche e abra pelo atalho INICIAR.');
  else if(!st.ctlUp) warn('O controle do banco não está rodando. Feche e abra o harness pelo atalho INICIAR.');
  else if(st.ctlBusy || cs.estado === 'subindo') hint.textContent = 'Conectando ao banco...';
  else{
    if(cs.estado === 'rodando') lines(st.dbStatus ? CD2Toolbox.statusLines(st.dbStatus) : CD2Toolbox.ctlStatusLines(cs));
    if(cs.erro){
      warn(cs.erro);
      if(cs.log && cs.log.length){ logBox.style.display = ''; logBox.querySelector('.inner').textContent = cs.log.join('\n'); }
    }else if(cs.estado === 'sem_banco') hint.textContent = 'Nenhum banco configurado. Preencha os campos e clique em Salvar e conectar.';
  }
  const on = st.ctlUp && !st.ctlBusy;
  for(const k in DB_FIELDS) $(DB_FIELDS[k]).disabled = !on;
  $('#bDbOff').style.display = (on && cs && cs.motor) ? '' : 'none';
  const ul = $('#tbTools'); ul.innerHTML = '';
  for(const name of Object.keys(CD2Toolbox.TOOL_DESCRIPTIONS)){
    const li = document.createElement('li'); const b = document.createElement('b'); b.textContent = name;
    const sp = document.createElement('span'); sp.textContent = CD2Toolbox.TOOL_DESCRIPTIONS[name];
    li.appendChild(b); li.appendChild(sp); ul.appendChild(li);
  }
}
function openCfg(){
  const mode = store.get('cd2.mode') || (st.cfg.mcp && st.cfg.mcp.mode) || 'demo';
  document.querySelectorAll('input[name=mode]').forEach(r => r.checked = (r.value === mode));
  $('#mcpUrl').value = store.get('cd2.url') || (st.cfg.mcp && st.cfg.mcp.url) || '';
  $('#mcpTok').value = store.get('cd2.tok', true) || '';
  $('#cfgStatus').textContent = ''; $('#cfgStatus').className = 'status';
  refreshAuthBox();
  renderToolbox(); syncCfgBoxes();
  $('#dlg').showModal();
  refreshCtl().then(() => { if(!st.ctlBusy) fillDbForm(st.ctlStatus); renderToolbox(); });
}
```

- [ ] **Step 6: Salvar e desconectar pelo `cd2-ctl`**

Troque:

```js
async function saveCfg(){
  const mode = document.querySelector('input[name=mode]:checked').value;
  store.set('cd2.mode', mode); store.set('cd2.url', $('#mcpUrl').value.trim()); store.set('cd2.tok', $('#mcpTok').value, true);
```

por:

```js
async function saveCfg(){
  const mode = document.querySelector('input[name=mode]:checked').value;
  store.set('cd2.mode', mode); store.set('cd2.url', $('#mcpUrl').value.trim()); store.set('cd2.tok', $('#mcpTok').value, true);
  if(mode === 'toolbox' && st.ctlUp) return saveDb();
```

E logo antes de `async function loginArcheo(){`, acrescente:

```js
// POST /config: o cd2-ctl reinicia o toolbox com a conexão nova; se ela falhar, a anterior volta.
async function saveDb(){
  if(st.ctlBusy) return;
  const s = $('#cfgStatus');
  st.ctlBusy = true; $('#cfgSave').disabled = true; renderToolbox();
  s.className = 'status tag tag--backlog'; s.textContent = 'Conectando ao banco...';
  let r = null;
  try{ r = await ctlRequest('POST', '/config', CD2Toolbox.configPayload(readDbForm())); }
  catch(e){ st.ctlUp = false; }
  finally{ st.ctlBusy = false; $('#cfgSave').disabled = false; }
  if(!r){ renderToolbox(); showCfgError('O controle do banco não respondeu. Feche e abra o harness pelo atalho INICIAR.'); return; }
  if(r.status !== 200){ renderToolbox(); showCfgError(r.data.erro || ('O controle do banco respondeu HTTP ' + r.status + '.')); return; }
  st.ctlStatus = r.data;
  if(!r.data.erro) fillDbForm(r.data);  // na falha, o que a pessoa digitou fica no formulário
  let c = null;
  if(r.data.estado === 'rodando') c = await connectTools();
  else{ st.dbStatus = null; st.tools = []; st.provider = null; setPill('#pMcp', 'err', 'sem banco'); }
  renderToolbox();
  if(r.data.erro) showCfgError(r.data.estado === 'rodando' ? 'A conexão nova falhou. A anterior continua valendo.' : 'A conexão falhou.');
  else if(c && c.ok){ s.className = 'status tag tag--concluido'; s.textContent = st.tools.length + ' ferramentas disponíveis'; }
  else showCfgError(c ? c.error : 'Nenhum banco conectado.');
}
// DELETE /config: derruba o toolbox e apaga o db.env deste computador.
async function disconnectDb(ev){
  ev.preventDefault();
  if(!st.ctlUp || st.ctlBusy) return;
  st.ctlBusy = true; renderToolbox();
  let r = null;
  try{ r = await ctlRequest('DELETE', '/config'); }catch(e){ st.ctlUp = false; }
  st.ctlBusy = false;
  if(r && r.status === 200) st.ctlStatus = r.data;
  st.dbStatus = null;
  if((store.get('cd2.mode') || (st.cfg.mcp && st.cfg.mcp.mode)) === 'toolbox'){ st.tools = []; st.provider = null; setPill('#pMcp', 'err', 'sem banco'); }
  fillDbForm(null); renderToolbox();
  const s = $('#cfgStatus');
  if(r && r.status === 200){ s.className = 'status tag tag--backlog'; s.textContent = 'Banco desconectado.'; }
  else showCfgError('Não consegui desconectar: o controle do banco não respondeu.');
}
```

- [ ] **Step 7: Chave no boot e eventos**

Troque:

```js
async function boot(){
  try{ st.cfg = await (await fetch('config.json', { cache:'no-store' })).json(); }catch(e){ st.cfg = {}; }
```

por:

```js
async function boot(){
  loadCtlKey();
  try{ st.cfg = await (await fetch('config.json', { cache:'no-store' })).json(); }catch(e){ st.cfg = {}; }
```

E troque:

```js
$('#bLogout').onclick = logoutArcheo;
```

por:

```js
$('#bLogout').onclick = logoutArcheo;
$('#dbMotor').onchange = syncDbForm;
$('#dbUsuario').addEventListener('input', syncDbForm);
$('#dbBase').addEventListener('input', syncDbForm);
$('#bDbOff').onclick = disconnectDb;
```

- [ ] **Step 8: Conferências automáticas**

Run:
```bash
node --test 2>&1 | tail -n 3
grep -n -e '--banco' -e 'INICIAR --' web/index.html; echo "restos: $?"
node -e "const h=require('fs').readFileSync('web/index.html','utf8'); const s=h.slice(h.lastIndexOf('<script>')+8, h.lastIndexOf('</script>')); new Function(s); console.log('js-ok')"
grep -c 'Harness Pocket' web/index.html web/config.json
```
Expected: `# fail 0`; `restos: 1`; `js-ok` (o script da página compila); `web/index.html:5` (título, `<b id="brand">`, selo do `renderHero` e as duas linhas de fallback do `boot`) e `web/config.json:1`.

- [ ] **Step 9: Teste manual no Mac (spec, seção 6)**

Preparação (o `db.env` real volta no fim; não abra o conteúdo):
```bash
sh ctl/build.sh
docker compose -f tests/toolbox/docker-compose.yml up -d postgres mariadb
DBENV="$HOME/Library/Caches/cd2-harness/db.env"; [ -f "$DBENV" ] && mv "$DBENV" "$DBENV.bak-v050"
sh core/start-unix.sh
```
Na janela que abrir (se o executor não puder clicar, peça ao usuário para fazer estes passos e contar o resultado):

1. A barra de endereço (se visível) não mostra `#k=`. Topo: "Harness Pocket". Hero: "IA LOCAL · CD2 HARNESS POCKET".
2. Ferramentas, modo **MCP Nativo para Banco de dados**: hint "Nenhum banco configurado...", formulário habilitado, Porta com placeholder `5432`, Schema com `public`. Trocar o Motor para Oracle muda o rótulo para "Service name" e a porta para `1521`; digitar Usuário `leitor` mostra Schema `LEITOR`. Volte para PostgreSQL.
3. Preencha Host `127.0.0.1`, Porta `55432`, Base `cd2`, Usuário `cd2`, Senha `cd2 s3nh@'x`, Schema vazio. **Salvar e conectar** (clique duas vezes seguidas de propósito): aparece "Conectando ao banco...", campos e botão desabilitados; depois a lista Motor PostgreSQL, Versão, Host, Base, Usuário, Schema `public`, Tabelas visíveis `2`, a tag verde "6 ferramentas disponíveis" e a pílula "PostgreSQL: 6 ferramentas". `pgrep -fl 'cd2-harness/toolbox'` mostra **um** processo.
4. Feche e reabra Ferramentas: campos preenchidos, Senha vazia com o placeholder "Senha salva. Deixe em branco para manter."
5. Troque a Senha para `errada` e salve: tag Atenção "A conexão nova falhou. A anterior continua valendo.", o motivo no hint, "Log do toolbox" recolhível com linhas (sem nenhuma com a senha). A pílula continua verde; feche o diálogo e pergunte "Quais tabelas existem aqui?": a IA responde com `produto` e `venda`.
6. Troque o Motor para MariaDB / MySQL, Porta `53306`, Base `cd2`, Usuário `cd2`, Senha `cd2 s3nh@'x`, Schema vazio (placeholder `cd2`): conecta, Motor "MariaDB / MySQL", pílula "MariaDB / MySQL: 6 ferramentas".
7. Aperte F5. Reabra Ferramentas: o formulário continua habilitado (a chave veio do `sessionStorage`).
8. Clique em **Desconectar do banco**: "Banco desconectado.", hint "Nenhum banco configurado...", pílula "sem banco", e `ls ~/Library/Caches/cd2-harness/db.env` dá "No such file".
9. Sem a senha em lugar nenhum: `grep -F 's3nh' ~/Library/Caches/cd2-harness/toolbox.log ~/Library/Caches/cd2-harness/ctl.log; echo $?` dá `1`.
10. Ctrl+C no terminal. `pgrep -fl 'cd2-harness/(cd2-ctl|toolbox|llamafile)'; echo $?` dá `1`.

Devolva o `db.env` real:
```bash
[ -f "$DBENV.bak-v050" ] && mv "$DBENV.bak-v050" "$DBENV"
```

- [ ] **Step 10: Commit**

```bash
git add web/index.html web/config.json
git commit -m "$(printf 'front: banco configurado pela tela Ferramentas via cd2-ctl e nome Harness Pocket\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 13: Site IA de Bolso, documentação e versão 0.6.0

**Files:**
- Modify: `docs/index.html` (título, menu, CTA, tabela, seção do banco, rodapé)
- Modify: `README.md` (árvore; seção 3 inteira; seção 8 com a parte de quem desenvolve; checklist da seção 7; seção 9)
- Modify: `docs/criar-pendrive.md` (árvore e tamanho; teste de fumaça; aviso do banco)
- Modify: `VERSION`, `web/mcp.js:13`

**Interfaces:**
- Consumes: tudo das tasks anteriores (nomes de arquivos, variáveis e comandos citados na documentação).
- Produces: documentação e versão 0.6.0.

- [ ] **Step 1: Site (`docs/index.html`)**

Troque, um por um:
- `<title>CD2 Harness · IA local em pen drive</title>` por `<title>IA de Bolso · IA local em pen drive</title>`
- `<a class="product" href="#">Harness <span>em pen drive</span></a>` por `<a class="product" href="#">IA de Bolso <span>em pen drive</span></a>`
- `Baixar o harness <span class="btn__arrow" aria-hidden="true">↓</span>` por `Baixar a IA de Bolso <span class="btn__arrow" aria-hidden="true">↓</span>`
- `<th>Abrir o harness</th>` por `<th>Abrir a IA de Bolso</th>`
- `<p>A interface abre como aplicativo. Banco de dados pelo MCP Toolbox, Demonstração offline ou Archeo MCP.</p>` por `<p>A interface abre como aplicativo. Banco de dados configurado na própria tela, Demonstração offline ou Archeo MCP.</p>`
- `<p class="lead">O launcher pergunta a conexão uma vez (PostgreSQL, Oracle, MariaDB ou SQL Server) e guarda só no computador. Seis ferramentas de exploração, todas somente leitura, publicadas pelo sistema.</p>` por `<p class="lead">A conexão com o banco (PostgreSQL, Oracle, MariaDB ou SQL Server) é feita pela tela Ferramentas e fica guardada só no computador. Se a conexão nova falhar, a anterior continua valendo. Seis ferramentas de exploração, todas somente leitura, publicadas pelo sistema.</p>`
- `<span class="eyebrow">CD2 Harness</span>` por `<span class="eyebrow">IA de Bolso</span>`

Run: `grep -n -i -e 'CD2 Harness' -e 'o harness' -e 'pergunta a conex' docs/index.html; echo "restos: $?"`
Expected: `restos: 1`.

- [ ] **Step 2: README, árvore**

Em `README.md`, troque:

```
  bin/toolbox/ (criado no preparo) <- MCP Toolbox, um por sistema
  core/toolbox/               <- receitas SQL por motor
```

por:

```
  bin/toolbox/ (criado no preparo) <- MCP Toolbox, um por sistema
  bin/ctl/ (criado no preparo) <- cd2-ctl, o controle do banco, um por sistema
  core/toolbox/               <- receitas SQL por motor
```

e troque:

```
  docs/index.html             <- o site do projeto (GitHub Pages)
```

por:

```
  docs/index.html             <- o site do projeto (GitHub Pages)
  ctl/                        <- código do cd2-ctl (Go), compilado pelo GitHub Actions
```

- [ ] **Step 3: README, seção 3 reescrita**

Troque o texto da seção 3 desde `O pen drive leva o [MCP Toolbox for Databases]` até a linha `- O launcher precisa da variante certa em \`bin/toolbox/\` ...` (inclusive), mantendo o título `## 3. Conectar a um banco de dados` e terminando antes de `## 3b. Conectar ao Archeo MCP`, por:

```markdown
O pen drive leva o [MCP Toolbox for Databases](https://github.com/googleapis/mcp-toolbox) (v1.14.0, um binário por sistema em `bin/toolbox/`) e o `cd2-ctl`, um controle pequeno feito aqui (código em `ctl/`, um binário por sistema em `bin/ctl/`). A conexão é feita pela tela: botão **Ferramentas**, modo **MCP Nativo para Banco de dados**, preencha motor, host, porta, base (ou service name no Oracle), usuário, senha e schema, e clique em **Salvar e conectar**. O toolbox reinicia sozinho com a conexão nova. Se ela falhar, a anterior continua valendo e a tela mostra o motivo e o fim do log. **Desconectar do banco** apaga a conexão deste computador.

| Motor | Porta padrão | Schema padrão | Conta de leitura recomendada |
|---|---|---|---|
| PostgreSQL | 5432 | `public` | membro de `pg_read_all_data`, sem GRANT de escrita |
| Oracle | 1521 | usuário em maiúsculas | `CREATE SESSION` + `SELECT` nas tabelas (ou `SELECT ANY TABLE`) |
| MariaDB / MySQL | 3306 | nome da base | `GRANT SELECT ON base.* TO ...` |
| SQL Server | 1433 | `dbo` | membro só de `db_datareader` |

A IA ganha seis ferramentas somente leitura: `db_connection_status`, `db_list_tables`, `db_describe_table`, `db_search_columns`, `db_sample_table` (até 20 linhas) e `db_read_only_query` (SELECT avulso, até 200 linhas). O botão **Ferramentas** mostra a conexão ativa e a lista.

- **A conexão fica no computador, não no pen drive.** Arquivo `db.env` em `~/Library/Caches/cd2-harness` (Mac), `${XDG_CACHE_HOME:-~/.cache}/cd2-harness` (Linux) ou `%LOCALAPPDATA%\cd2-harness` (Windows), legível só pelo usuário. O formato é o mesmo da v0.5.0: quem já tinha uma conexão continua conectado.
- **A senha passa pelo navegador só para ser gravada**, sempre em `127.0.0.1`, protegida pela chave da sessão. Ela nunca volta para a tela (o campo mostra "Senha salva") e nunca vai para log: o `cd2-ctl` tira do `toolbox.log` toda linha que cita a senha ou a palavra password.
- **Chave da sessão.** A cada abertura o launcher sorteia 32 bytes, entrega ao `cd2-ctl` pelo ambiente e à janela pelo endereço (`#k=`). A página guarda a chave só naquela aba e limpa o endereço. Sem a chave certa, o `cd2-ctl` responde 401; ele também recusa outra origem, outro `Host` e corpo acima de 8 KB. Risco aceito: a chave aparece na linha de comando do navegador, visível para outros usuários do mesmo computador. O pen drive é pensado para notebook de uma pessoa, e a chave muda a cada abertura.
- **Use uma conta de leitura.** O toolbox não valida SQL. O harness recusa qualquer coisa que não seja um único SELECT (no front e no próprio toolbox, com lista de palavras e funções proibidas por motor), e no PostgreSQL a sessão do toolbox já abre com `default_transaction_read_only=on`. Mesmo assim, a garantia de verdade é a permissão da conta.
- **Portas.** O launcher usa um trio que avança junto: P para o harness, P+1000 para o toolbox e P+2000 para o `cd2-ctl` (8080, 9080 e 10080 por padrão). Todos escutam só em `127.0.0.1`.
- Se o banco não responder em 15 segundos (senha errada, firewall), a tela mostra Atenção com o motivo e as últimas linhas do log, já filtradas.
- É preciso a variante certa em `bin/toolbox/` e `bin/ctl/` (`windows-amd64`, `darwin-arm64`, `darwin-amd64`, `linux-amd64`). O preparo baixa as quatro; `CD2_TOOLBOX_PLATFORMS` limita as duas pastas. Sem o `cd2-ctl` da plataforma, o launcher avisa e segue sem banco (Demonstração e Archeo continuam).
```

- [ ] **Step 4: README, checklist, seção 8 e seção 9**

Troque:

```
- [ ] Conta de leitura do banco criada e testada com `INICIAR --banco` num notebook que não é o seu
```

por:

```
- [ ] Conta de leitura do banco criada e testada pela tela Ferramentas num notebook que não é o seu
```

Troque:

```
2. Num pen drive já preparado, copie por cima só o que mudou. Normalmente basta a pasta `web/` e a pasta `core/`; `bin/` (incluindo `bin/toolbox/`) e `models/` ficam.
```

por:

```
2. Num pen drive já preparado, copie por cima só o que mudou. Normalmente basta a pasta `web/` e a pasta `core/`; `bin/` (incluindo `bin/toolbox/` e `bin/ctl/`) e `models/` ficam. Se o `cd2-ctl` mudou de versão, rode o preparo de novo: ele baixa só o que mudou.
```

Logo antes de `## 9. Licenças e origem dos componentes`, acrescente:

```markdown
### Para quem mexe no `cd2-ctl`

Só quem altera a pasta `ctl/` precisa de Go (1.23 ou mais novo; no Mac, `brew install go`). O resto do projeto continua sem build.

- Testes: `cd ctl && go test ./...` e, com o Postgres do Docker no ar (`docker compose -f tests/toolbox/docker-compose.yml up -d postgres`), `sh tests/ctl/e2e.sh`. A CI (`.github/workflows/ci.yml`) roda `go test` e `node --test` em todo pull request e push na `main`.
- Teste local sem release: `sh ctl/build.sh` compila para `bin/ctl/<plataforma>/`, e `CD2_CTL_LOCAL=1 sh core/prepare-unix.sh` usa esse binário em vez de baixar.
- Publicar uma versão: suba `CTL_VERSION` em `core/prepare-unix.sh` e `core/prepare-windows.ps1`, faça o merge e crie a tag, por exemplo `git tag ctl-v0.6.1 && git push origin ctl-v0.6.1`. O workflow `.github/workflows/ctl-release.yml` compila as quatro plataformas e anexa `cd2-ctl-<os>-<arch>` e `SHA256SUMS` ao release; o preparo confere o checksum antes de usar. `CD2_CTL_VERSION` escolhe outra versão no preparo, nunca "latest".

```

E em `## 9. Licenças e origem dos componentes`, troque:

```
- **MCP Toolbox for Databases** (Google, Apache 2.0), de https://github.com/googleapis/mcp-toolbox
```

por:

```
- **MCP Toolbox for Databases** (Google, Apache 2.0), de https://github.com/googleapis/mcp-toolbox
- **cd2-ctl** (código deste repositório, Apache 2.0, pasta `ctl/`), compilado pelo GitHub Actions e baixado do release `ctl-v<versão>` deste repositório
```

Run: `grep -n -e '--banco' -e 'pergunta no terminal' README.md; echo "restos: $?"`
Expected: `restos: 1`.

- [ ] **Step 5: `docs/criar-pendrive.md`**

Troque:

```
  bin/toolbox/linux-amd64/toolbox         ~316 MB
```

por:

```
  bin/toolbox/linux-amd64/toolbox         ~316 MB
  bin/ctl/windows-amd64/cd2-ctl.exe       ~7 MB
  bin/ctl/darwin-arm64/cd2-ctl            ~7 MB
  bin/ctl/darwin-amd64/cd2-ctl            ~7 MB
  bin/ctl/linux-amd64/cd2-ctl             ~7 MB
```

Troque:

```
4. Conferir: `bin/llamafile` e `bin/llamafile.exe` com uns 350 MB cada, modelo com uns 2,4 GB, os quatro `bin/toolbox/*/toolbox` (ou só os da variável `CD2_TOOLBOX_PLATFORMS`) e `CHECKSUMS.sha256` gerado. Guardar uma cópia do checksum fora do pen drive.
```

por:

```
4. Conferir: `bin/llamafile` e `bin/llamafile.exe` com uns 350 MB cada, modelo com uns 2,4 GB, os quatro `bin/toolbox/*/toolbox` e os quatro `bin/ctl/*/cd2-ctl` (ou só os da variável `CD2_TOOLBOX_PLATFORMS`) e `CHECKSUMS.sha256` gerado. Guardar uma cópia do checksum fora do pen drive.
```

Troque:

```
3. Espere a janela abrir e mande uma pergunta qualquer. Na primeira vez, o modelo leva de 20 a 90 segundos para carregar.
```

por:

```
3. Espere a janela abrir e mande uma pergunta qualquer. Na primeira vez, o modelo leva de 20 a 90 segundos para carregar.
4. Se for usar banco: Ferramentas, modo MCP Nativo para Banco de dados, preencha a conexão e clique em Salvar e conectar. A lista com motor, versão e tabelas tem de aparecer.
```

e renumere o item seguinte (`4. Feche e ejete com segurança.`) para `5. Feche e ejete com segurança.`

Troque:

```
- A conexão com o banco não vai no pen drive: cada computador pergunta na primeira abertura. Leve a conta de leitura pronta.
```

por:

```
- A conexão com o banco não vai no pen drive: em cada computador ela é feita pela tela Ferramentas e fica guardada só nele. Leve a conta de leitura pronta.
```

- [ ] **Step 6: Versão**

`VERSION`: troque `0.5.0` por `0.6.0`.
`web/mcp.js`: troque `const CLIENT_INFO = { name:'cd2-harness', version:'0.5.0' };` por `const CLIENT_INFO = { name:'cd2-harness', version:'0.6.0' };`.

- [ ] **Step 7: Conferência final do branch**

Run:
```bash
cd ctl && test -z "$(gofmt -l .)" && go vet ./... && GOOS=windows go vet ./... && go test ./... && cd ..
node --test 2>&1 | tail -n 3
sh tests/ctl/e2e.sh | tail -n 1
grep -rn -e '--banco' -e 'db-env' README.md docs/index.html docs/criar-pendrive.md web core INICIAR-CD2-Windows.bat INICIAR-CD2-Mac.command iniciar-cd2-linux.sh tests; echo "restos: $?"
LC_ALL=C grep -rn $'\xe2\x80\x94' README.md docs/index.html docs/criar-pendrive.md web/index.html; echo "travessoes: $?"
```
Expected: `ok` em todos os pacotes Go; `# fail 0`; `OK: e2e do cd2-ctl`; `restos: 1`; `travessoes: 1` (nenhum travessão).

- [ ] **Step 8: Commit**

```bash
git add docs/index.html README.md docs/criar-pendrive.md VERSION web/mcp.js
git commit -m "$(printf 'site IA de Bolso, documentacao do banco pela tela e versao 0.6.0\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

- [ ] **Step 9: Checklist do PR (o que não dá para testar aqui)**

Coloque no corpo do PR (quem abrir o PR; este plano não abre nem faz push):

```markdown
## Fora do alcance do Mac de desenvolvimento
- [ ] Windows: INICIAR-CD2-Windows.bat abre, cd2-ctl.exe sobe (ctl.err.log vazio), Ferramentas conecta no banco, ENTER encerra sem sobrar cd2-ctl.exe nem toolbox.exe (Gerenciador de Tarefas)
- [ ] Windows: db.env em %LOCALAPPDATA%\cd2-harness com ACL só do usuário (icacls db.env)
- [ ] Linux: sh iniciar-cd2-linux.sh de ponta a ponta
- [ ] Release: tag ctl-v0.6.0 publicada depois do merge e preparo (sem CD2_CTL_LOCAL) baixando e conferindo os quatro binários
```

Depois do merge, publicar o release (`git tag ctl-v0.6.0 && git push origin ctl-v0.6.0`) é ação do usuário ou com o aval explícito dele: é publicação num repositório público.

---

## Self-review (feito ao escrever o plano)

**Cobertura da spec:**
- Objetivo e decisões: Tasks 1 a 13. Arquitetura (launcher, cd2-ctl dono do toolbox, front fala com os dois): Tasks 5, 6, 9, 10, 12.
- §1 Entrada, derivações, cópia do toolbox e quarentena: Tasks 4 e 6. Arranque (porta, código 2, db.env válido, sem_banco): Tasks 5 e 6. API e respostas: Tasks 5 e 6. Validação: Task 2 (+ 8 KB na Task 6). Subir o toolbox (flags, ambiente, escape, filtro, prontidão 15 s): Tasks 3 e 4. Troca com rollback e mutex: Task 5. Formato e permissões do db.env, DELETE: Tasks 1 e 5. Segurança da porta: Task 6. Encerramento (sinais, cleanup): Tasks 6, 9, 10.
- §2 CI, release, preparo, gravadores: Task 8.
- §3 Launchers (remoções, trio, chave, cd2-ctl no cache, aviso de binário ausente, espera de 10 s, cleanup, wrappers): Tasks 9 e 10.
- §4 Front (config.json, título, fallback, selo, chave no sessionStorage, formulário, Salvar e conectar, status, log recolhível, reconectar o McpClient, Desconectar, cd2-ctl fora do ar, frases do --banco, funções puras): Tasks 11 e 12.
- §5 Site: Task 13. §6 Testes: Tasks 1 a 7, 11, 12 (manual). §7 Documentação e VERSION: Task 13.

**Placeholders:** nenhum "TBD"/"TODO"; todo passo de código traz o código inteiro; trocas em arquivos existentes mostram o texto antigo e o novo.

**Consistência de nomes:** `Config`, `Input`, `FieldError`, `Validate`, `Check`, `Save`, `Load`, `Remove`, `Format`, `Parse`, `Env` (Task 1 e 2) usados igual nas Tasks 4 e 5; `StartError`, `MsgDied`, `MsgToolError`, `Options`, `New`, `Start`, `Stop`, `Running`, `LogPath` (Task 4) usados igual nas Tasks 5 e 6; `Status`, `SemBanco`, `Rodando`, `BootAsync`, `Apply`, `Clear`, `Shutdown` (Task 5) usados na Task 6; `ctlUrlFor`, `readKeyFromHash`, `defaultsFor`, `configPayload`, `ctlStatusLines` (Task 11) usados na Task 12. JSON: `estado`, `motor`, `host`, `porta`, `base`, `usuario`, `schema`, `senha`, `senha_salva`, `erro`, `log` iguais no Go, no e2e e no front.

**Review Focus:** os cinco itens têm teste na task dona (senha difícil: Tasks 1, 3, 4, 7; duplo clique: Task 5 `TestPedidosUmDeCadaVez` e Task 12 passo 3; F5: Task 11 `readKeyFromHash` e Task 12 passo 7; toolbox que morre: Task 5 `TestToolboxQueMorreViraFalhou`; db.env da v0.5.0: Tasks 1 e 5 `TestBootComDbEnvDaV050`).
