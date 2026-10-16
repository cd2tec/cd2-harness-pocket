# Harness Pocket: configuração do banco pela tela, com o controlador `cd2-ctl`

Data: 2026-10-13. Versão alvo: 0.6.0. Continua a v0.5.0 (MCP Toolbox embutido, spec
`2026-10-12-toolbox-banco-de-dados-design.md`).

## Objetivo

Quem usa o pen drive configura o banco de dados só pela tela **Ferramentas**, sem nunca ver o
terminal. A pessoa preenche motor, host, porta, base (ou service name), usuário, senha e schema,
clica em **Salvar e conectar**, e o MCP Toolbox reinicia sozinho com a conexão nova. Se a conexão
nova falhar, a anterior continua funcionando.

Junto, os nomes do produto mudam: no site ele passa a ser **IA de Bolso** e no front
**Harness Pocket**.

## Decisões já tomadas

| Tema | Decisão |
|---|---|
| Quem configura | Só a tela. A pergunta no terminal e a flag `--banco` saem dos launchers. |
| Peça nova | `cd2-ctl`, binário próprio em Go (pasta `ctl/`), um por plataforma: `windows-amd64`, `darwin-arm64`, `darwin-amd64`, `linux-amd64`. |
| Por que Go | Mesmo código nos três sistemas, sem depender de nada instalado no computador do cliente. `sh` puro não serve HTTP com segurança e o Mac não traz `python3`. |
| Distribuição | GitHub Actions compila a cada tag `ctl-vX.Y.Z` e anexa ao release do repositório (público). O preparo baixa a versão fixada, como faz com o toolbox. Só quem mexe em `ctl/` precisa de Go. |
| Portas | Trio que avança junto: P (harness), P+1000 (toolbox), P+3000 (`cd2-ctl`). Padrão 8080, 9080, 11080. P+2000 foi descartado: 10080 está na lista de portas bloqueadas pelos navegadores. |
| Onde mora a conexão | Continua no `db.env` do cache do computador, mesmo formato e mesmas permissões da v0.5.0. |
| Senha | Passa pelo navegador só para gravar, só em `127.0.0.1`. Nunca volta para a tela, nunca vai para log. |
| Falha ao trocar | Rollback: nada é gravado e o toolbox anterior volta. |
| Nomes | Site: "IA de Bolso". Front: "Harness Pocket". Repositório, arquivos, README e banner do terminal ficam como estão. |

## Arquitetura

```
launcher (sh / ps1)
  ├─ llamafile          127.0.0.1:P        página + modelo
  ├─ cd2-ctl            127.0.0.1:P+3000   controle (chave da sessão)
  │    └─ toolbox       127.0.0.1:P+1000   MCP, ferramentas somente leitura
  └─ navegador          http://127.0.0.1:P/#k=<chave>
```

O launcher sobe o llamafile e o `cd2-ctl` e abre a janela. O `cd2-ctl` é o único dono do
toolbox: sobe, reinicia e derruba. O front fala com o toolbox (MCP) como hoje e com o `cd2-ctl`
(configuração). Ao sair, o launcher derruba o llamafile e o `cd2-ctl`, e o `cd2-ctl` derruba o
toolbox antes de terminar.

## 1. `cd2-ctl` (pasta `ctl/`)

Go, só biblioteca padrão. Módulo `ctl/`, binário `cd2-ctl` (`cd2-ctl.exe` no Windows).

### Entrada

Linha de comando (nada sensível nela):

```
cd2-ctl --root <raiz do pen drive> --cache <pasta de cache> --harness-port P --parent-pid <PID do launcher>
```

Variável de ambiente `CD2_CTL_KEY`: a chave da sessão, 64 caracteres hexadecimais (32 bytes
aleatórios gerados pelo launcher). Sem ela, o `cd2-ctl` não sobe.

O `cd2-ctl` deriva: toolbox em P+1000, controle em P+3000, binário do toolbox em
`<root>/bin/toolbox/<os>-<arch>/toolbox[.exe]`, receitas em `<root>/core/toolbox/<motor>.yaml`,
`db.env` e `toolbox.log` em `<cache>`. Ele copia o toolbox para o cache antes de executar
(pen drive exFAT/FAT não guarda permissão de execução), como o launcher faz hoje, e no Mac tira a
quarentena (`xattr -dr com.apple.quarantine`).

### Arranque

1. Escuta em `127.0.0.1:P+3000`. Se não conseguir, sai com código 2 e mensagem sem acento.
2. Se `db.env` existe e é válido, sobe o toolbox com ele (mesmo fluxo do item "Subir o toolbox").
3. Se não existe, fica em estado `sem_banco` e espera a tela.

### API

Todas as rotas, inclusive `GET`, exigem a chave. Respostas em JSON, mensagens em português sem
emoji e sem travessão.

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /status` | nenhum | `{estado, motor, host, porta, base, usuario, schema, senha_salva, erro, log}` |
| `POST /config` | `{motor, host, porta, base, usuario, senha, schema}` | o mesmo de `/status`, depois da tentativa |
| `DELETE /config` | nenhum | `/status` com `estado: "sem_banco"` |
| `OPTIONS *` | nenhum | preflight de CORS |

`estado` é `sem_banco`, `subindo`, `rodando` ou `falhou`. `senha_salva` é booleano. `erro` e
`log` só vêm quando a última tentativa falhou: `erro` é uma frase curta e `log` são as últimas
15 linhas do log do toolbox, já filtradas. A senha nunca aparece em nenhuma resposta.

### Validação de `POST /config`

- `motor` em `postgres`, `oracle`, `mariadb`, `sqlserver`.
- `host` não vazio, até 253 caracteres, sem espaço.
- `porta` inteiro de 1 a 65535; vazio usa o padrão do motor (5432, 1521, 3306, 1433).
- `base` não vazio (é o service name no Oracle).
- `usuario` não vazio.
- `senha` vazia significa "manter a atual"; se não há senha salva, vazia é aceita como senha vazia.
- `schema` vazio usa o padrão do motor (Postgres `public`, Oracle o usuário em maiúsculas,
  MariaDB o nome da base, SQL Server `dbo`), as mesmas regras de `core/db-env.sh`.
- Nenhum campo pode ter quebra de linha ou caractere de controle. Corpo até 8 KB.

Campo inválido: HTTP 400 com `{erro: "<campo>: <motivo>"}`, sem mexer em nada.

### Subir o toolbox

Igual ao launcher da v0.5.0, agora em Go:

- `--config <root>/core/toolbox/<motor>.yaml --address 127.0.0.1 --port P+1000
  --allowed-hosts 127.0.0.1:P+1000,localhost:P+1000
  --allowed-origins http://127.0.0.1:P,http://localhost:P --disable-reload`.
- Ambiente do toolbox: o do `cd2-ctl` mais `CD2_DB_*`, com `CD2_DB_PASSWORD` escapada para YAML
  entre aspas duplas (`\` vira `\\`, `"` vira `\"`). As receitas já usam `password: "${CD2_DB_PASSWORD}"`.
- Saída do toolbox passa por um filtro antes de ir para `toolbox.log`: some toda linha que contém a
  senha (crua, escapada para YAML ou escapada para URL com `QueryEscape`/`PathEscape`, comparação literal) ou que casa `password` sem diferenciar maiúsculas.
  Diferente da v0.5.0, a senha nunca chega ao disco, nem por um instante.
- Pronto quando `GET http://127.0.0.1:P+1000/` responde 200 e uma chamada MCP a
  `db_connection_status` devolve resultado sem `isError`. Prazo: 15 s no total. O `GET /` tem
  limite próprio de 2 s por tentativa; o `initialize` e o `db_connection_status` podem usar o
  prazo inteiro (um banco atrás de VPN pode levar vários segundos no primeiro teste).

### Troca com rollback (`POST /config`)

1. Valida. Monta a configuração candidata (senha vazia herda a salva).
2. Se há toolbox rodando, guarda a configuração atual e derruba o processo; espera a porta P+1000
   liberar (até 5 s).
3. Sobe o toolbox com a candidata.
4. Deu certo: grava `db.env` de forma atômica (arquivo temporário no mesmo diretório, permissão só do
   dono, depois `rename`), estado `rodando`.
5. Falhou: não grava nada. Se havia configuração anterior, sobe de novo com ela. Responde com
   `estado` da configuração que ficou valendo, mais `erro` e `log` da tentativa que falhou.

Pedidos de configuração são atendidos um de cada vez (mutex). Um segundo `POST` enquanto o
primeiro roda espera.

### Formato do `db.env`

O mesmo da v0.5.0, para quem já tem um continuar funcionando: sete linhas
`CD2_DB_<CAMPO>='<valor>'`, aspas simples, `'` escrito como `'\''`. O `cd2-ctl` lê e escreve esse
formato. Permissão: `0600` no Mac e Linux; no Windows, ACL só do usuário atual, aplicada no arquivo
temporário antes de escrever o conteúdo. `DELETE /config` apaga o arquivo.

### Segurança da porta de controle

- Escuta só em `127.0.0.1`.
- `Authorization: Bearer <chave>` obrigatório, comparação em tempo constante. Errado ou ausente: 401.
- `Origin` precisa ser `http://127.0.0.1:P` ou `http://localhost:P`. Outra: 403. Ausente: aceito
  só em `GET` (para testes com curl), recusado em `POST` e `DELETE`.
- `Host` precisa ser `127.0.0.1:P+3000` ou `localhost:P+3000` (contra DNS rebinding). Outro: 403.
- `POST` exige `Content-Type: application/json` (força preflight no navegador). Outro: 415.
- CORS: `Access-Control-Allow-Origin` só com a origem do harness; `Allow-Headers` com
  `Authorization, Content-Type`; `Allow-Methods` com `GET, POST, DELETE`.
- Risco aceito: a chave aparece na linha de comando do navegador (`--app=...#k=`), visível para
  outros usuários do mesmo computador. O pen drive é pensado para notebook de uma pessoa, a chave
  muda a cada abertura e a porta só escuta localmente.

### Encerramento

Em `SIGINT`, `SIGTERM` (e fechamento do console no Windows), derruba o toolbox e sai. O launcher
também derruba o `cd2-ctl` no `cleanup`.

Se o launcher morre sem rodar o `cleanup` (console do Windows fechado no X, `kill -9` no Unix), o
`--parent-pid` evita órfãos: o `cd2-ctl` confere a cada 2 s se aquele processo ainda existe
(`kill(pid, 0)` no Unix, onde `EPERM` conta como vivo; `OpenProcess` com `SYNCHRONIZE` e
`WaitForSingleObject` de 0 ms no Windows) e, quando ele some, encerra exatamente como no
`SIGTERM`: para o HTTP, derruba o toolbox e sai com 0. O `start-unix.sh` passa `$$` e o
`start-windows.ps1` passa `$PID`.

## 2. Distribuição e preparo

- `.github/workflows/ci.yml`: em pull request e push na `main`, roda `go test ./...` em `ctl/` e
  `node --test` na raiz.
- `.github/workflows/ctl-release.yml`: em tag `ctl-vX.Y.Z`, compila com `CGO_ENABLED=0` as quatro
  plataformas (`-trimpath -ldflags "-s -w -X main.version=X.Y.Z"`) e anexa ao release
  `cd2-ctl-<os>-<arch>[.exe]` mais `SHA256SUMS`.
- Preparo (`core/prepare-unix.sh` e `core/prepare-windows.ps1`): `CTL_VERSION` fixa (sobrescrevível
  por `CD2_CTL_VERSION`, nunca "latest"), baixa de
  `https://github.com/cd2tec/cd2-ia-de-bolso/releases/download/ctl-v<versão>/cd2-ctl-<os>-<arch>[.exe]`
  para `bin/ctl/<os>-<arch>/cd2-ctl[.exe]`, confere com o `SHA256SUMS` do release e inclui no
  `CHECKSUMS.sha256`. Se o arquivo local já tem o SHA-256 esperado, pula; senão apaga e baixa
  inteiro (sem retomar: emendar em cima do binário de outra versão quebraria o checksum). Mesmas plataformas do toolbox (`CD2_TOOLBOX_PLATFORMS` vale para os dois).
- Gravadores: já copiam `bin/` inteiro; só a listagem final e a estimativa de tamanho mudam.

## 3. Launchers

`core/start-unix.sh` e `core/start-windows.ps1`:

- Saem: `db-env.sh` (o arquivo é removido), a pergunta, `--banco`, `start_toolbox`, o filtro de log
  e a variável `TB_PID`. Os wrappers deixam de repassar argumentos.
- Portas: o laço testa P, P+1000 e P+3000 e avança o trio junto.
- Chave: 32 bytes aleatórios em hexadecimal (`od -An -tx1 -N32 /dev/urandom | tr -d ' \n'` no
  Unix, `RandomNumberGenerator` no Windows). Passada ao `cd2-ctl` só pela variável `CD2_CTL_KEY`
  no ambiente dele, e à janela pela URL `http://127.0.0.1:P/#k=<chave>`.
- Sobe o `cd2-ctl` (cópia no cache, como o llamafile) depois do llamafile ficar pronto. Se o binário
  não existir para a plataforma, avisa "bin/ctl/<plataforma> nao encontrado: banco de dados
  indisponivel neste pen drive" e segue sem ele (Demonstração e Archeo continuam).
- Espera `GET /status` responder (até 10 s) antes de abrir a janela. Se o `cd2-ctl` morrer, avisa e
  segue sem banco.
- `cleanup` derruba llamafile e `cd2-ctl`. Mantém `trap cleanup EXIT` e
  `trap 'cleanup; exit 130' INT TERM` no Unix e o `finally` com chamadas independentes no Windows.

## 4. Front (`web/`)

- `web/config.json`: `product` vira `"Harness Pocket"`. `index.html`: título, fallback de
  `st.cfg.product` e o selo "IA local · CD2 Harness Pocket".
- Chave: no boot, se `location.hash` tem `k=<64 hex>`, guarda em `sessionStorage` (`cd2.ctlKey`) e
  limpa o endereço com `history.replaceState`. Sem chave guardada, o formulário fica desabilitado
  com o aviso "Para configurar o banco, abra o harness pelo atalho INICIAR."
- Bloco do modo **MCP Nativo para Banco de dados** no diálogo Ferramentas:
  - Formulário: Motor (select com os quatro), Host, Porta (placeholder com o padrão do motor),
    Base de dados (rótulo "Service name" quando Oracle), Usuário, Senha (`type=password`,
    `autocomplete=off`; com senha salva, placeholder "Senha salva. Deixe em branco para manter."),
    Schema (placeholder com o padrão). Os campos vêm preenchidos com o `/status`.
  - Botão "Salvar e conectar" do diálogo, no modo banco, chama `POST /config`, mostra
    "Conectando ao banco..." e desabilita o formulário até a resposta. Depois: status
    (Motor, Versão, Host, Base, Usuário, Schema, Tabelas, como hoje) ou tag Atenção com `erro` e o
    `log` num bloco recolhível. Em seguida reconecta o `McpClient` ao toolbox e atualiza a pílula.
  - Link "Desconectar do banco" chama `DELETE /config`.
  - Lista das seis ferramentas fica como está.
  - Saem as frases que mandam usar `INICIAR --banco`.
- `cd2-ctl` fora do ar (sem binário, morreu): o bloco mostra Atenção "O controle do banco não está
  rodando. Feche e abra o harness pelo atalho INICIAR." e o formulário fica desabilitado.
- Lógica pura nova em `web/toolbox.js` (testável com `node --test`): `ctlUrlFor(location)`
  (porta + 3000), `readKeyFromHash(hash)`, `configPayload(form)` (trim, porta numérica, senha vazia
  omitida) e `defaultsFor(motor, usuario, base)`.

## 5. Site (`docs/index.html`)

O produto passa a se chamar **IA de Bolso**: `<title>`, nome no menu, selo do rodapé e textos que
falam do produto pelo nome ("Baixar o harness" vira "Baixar a IA de Bolso"). Links do GitHub e nomes
de arquivo não mudam. A seção do banco passa a dizer que a conexão é feita pela tela.

## 6. Testes

- `ctl/` (`go test ./...`):
  - validação de cada campo e mensagens;
  - `db.env`: escreve e lê de volta, e lê arquivo escrito pela v0.5.0 (`core/db-env.sh`), com as
    senhas `'abc`, `"abc`, `a: b`, `a #b`, `a\b"c`, `$x y'z#`, `{x}: [y]`;
  - escape YAML e filtro de log com as mesmas senhas;
  - segurança: sem chave, chave errada, `Origin` errada, `Host` errado, `Content-Type` errado,
    corpo acima de 8 KB;
  - rollback com toolbox falso (script de teste que sobe um HTTP e responde ou falha conforme
    variável): candidata ruim mantém a anterior rodando e não grava `db.env`.
- `tests/ctl/e2e.sh` contra o Postgres do Docker (`tests/toolbox/docker-compose.yml`), com o
  `cd2-ctl` compilado localmente: configura certo e fica `rodando`; manda senha errada, recebe `erro`,
  o anterior segue `rodando`, e nem a resposta nem `toolbox.log` contêm a senha.
- `node --test`: funções novas de `web/toolbox.js`.
- Manual no Mac: abre sem `db.env`, configura pela tela, troca para senha errada (rollback), troca de
  motor, desconecta, fecha e confere que não sobrou processo.
- Não testável aqui: Windows (sem PowerShell) e Linux de ponta a ponta. Vão no checklist do PR.

## 7. Documentação

- README seção 3 reescrita: a conexão é feita pela tela Ferramentas; tira `--banco`; trio de portas;
  `cd2-ctl` na árvore e na seção 9 (código próprio). Nota de segurança: a senha passa pelo navegador
  só em `127.0.0.1`, protegida pela chave da sessão, e nunca volta para a tela nem vai para log.
- README, seção para quem desenvolve: Go só para mexer em `ctl/`; como gerar uma tag `ctl-vX.Y.Z`.
- `docs/criar-pendrive.md`: `bin/ctl/` na árvore e no tamanho.
- `VERSION` 0.6.0.

## Fora de escopo

- Várias conexões salvas e troca rápida entre elas.
- Configurar o Archeo MCP pelo `cd2-ctl`.
- Assinatura de código dos binários (Gatekeeper, SmartScreen).
- Mudar o nome do repositório, dos arquivos ou do banner do terminal.
