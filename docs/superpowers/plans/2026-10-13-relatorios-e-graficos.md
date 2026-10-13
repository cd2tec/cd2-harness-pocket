# Relatórios e gráficos a partir de qualquer banco Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No modo Banco de dados, a pessoa faz uma pergunta livre sobre qualquer banco plugado e recebe tabela ou gráfico (barra, linha, pizza, número) com uma frase de resumo cujos números nunca passaram pelo modelo, mais CSV e um relatório imprimível com a marca e o contato da CD2.

**Architecture:** Um roteiro fixo conduzido pelo front substitui o laço de agente no modo Banco de dados: o mapa do banco é lido uma vez (`db_catalog`, ferramenta nova nas quatro receitas), `web/catalog.js` escolhe as tabelas que combinam com a pergunta, `web/ask.js` faz uma chamada ao modelo pedindo um JSON (SQL + visual + eixos + título), executa no toolbox, tenta de novo uma vez se falhar e escolhe o visual pelo resultado; `web/chart.js` desenha em SVG e `web/report.js` gera CSV e o HTML de impressão. Modelo padrão passa a ser o Qwen3-4B-Instruct-2507.

**Tech Stack:** JavaScript sem framework (módulos no padrão de `web/toolbox.js`: global no navegador, `module.exports` no Node), `node:test` (Node 22), YAML do MCP Toolbox v1.14.0, llamafile v0.10.x (API compatível com OpenAI), POSIX sh, PowerShell 5.1, Docker (bancos de teste), `jq`.

**Spec:** `docs/superpowers/specs/2026-10-13-relatorios-e-graficos-design.md`

## Pré-condições

1. Trabalhar num worktree a partir de `main` (`superpowers:using-git-worktrees`, branch `feat/relatorios`). Todos os caminhos são relativos à raiz desse worktree.
2. `bin/` e `models/` são ignorados pelo Git. Copie do cache do gravador (clone APFS, instantâneo):
   ```bash
   cp -Rc ~/Library/Caches/cd2-harness/usb/CD2-HARNESS/bin .
   mkdir -p models
   ls bin/llamafile bin/toolbox/darwin-arm64/toolbox
   ```
3. Docker Desktop rodando (Rosetta ligado para o SQL Server). `jq` instalado.
4. `node --test` verde em `main` antes de começar.

## Desvios da spec (decididos ao ler o código)

| Spec | Plano | Motivo |
|---|---|---|
| `applyLimit` no front | Não existe. | As quatro receitas já fazem `SELECT * FROM (<sql>) q LIMIT 200` (ou `TOP (200)` / `FETCH FIRST 200`) no próprio `db_read_only_query`. O teto já é do servidor, que é mais forte. No lugar entra `prepareSql`, que só corrige o `ORDER BY` sem `TOP` no SQL Server (que quebraria dentro da subconsulta). |
| Timeout do MariaDB/MySQL por prefixo `SET STATEMENT` | `queryTimeout: 15s` na fonte da receita. | A receita MariaDB já usa `queryTimeout: 60s`; basta baixar. |
| `ask({ dialeto })` | `ask({ motor, versao })` | O motor vem de `db_connection_status.engine` e a versão de `db_version`. |
| Seed de avaliação nos quatro motores | Só PostgreSQL. | O portão da spec é no PostgreSQL; os outros motores continuam cobertos pela verificação das receitas. |
| Tabela com nota > 0 entra no ranking | Só entra quem tem ao menos uma palavra da pergunta no nome da tabela ou de uma coluna. | Sem isso, toda tabela com data e número ganharia 2 pontos e entraria sem ter nada a ver com a pergunta. |
| Views com peso de tabela média | Views entram pela estimativa do dicionário (em geral 0), depois das tabelas. | Simples e previsível; o teto de 300 objetos sobra para ERP real. |
| Frase "Total: ..." sempre | Sem "Total" quando `y` é média, percentual ou taxa. | Somar médias engana o cliente. |
| (não previsto) | O preparo remove outros `.gguf` de `models/`. | O launcher usa o primeiro `.gguf` que achar; com o modelo antigo junto, a escolha seria ambígua. |

## Global Constraints

- Português do Brasil em toda interface, mensagem, comentário de documentação e texto de site/README; frases curtas; **sem emoji e sem travessão** (regra do README, seção 5).
- Tudo funciona offline: nenhum script, fonte ou biblioteca de CDN; nada novo em `web/` além de JS próprio.
- Nada é gravado no pen drive pelo front. Relatório é só impressão/PDF e CSV baixado pelo navegador.
- Nenhum número exibido (frase, gráfico, tabela, CSV, relatório) vem do texto do modelo; o modelo só fornece SQL, visual, nomes de colunas e título.
- Cores só pelos tokens do `:root` de `web/index.html`; nos SVGs, por classe CSS (exceção: a paleta da pizza em `chart.js`, que usa os mesmos hex dos tokens).
- Movimento: nenhuma animação nova.
- Timeout de consulta: 15 s. Teto de linhas no servidor: 200 (já existente). Linhas pedidas ao modelo: até 50.
- `db_catalog`: no máximo 300 tabelas/views e 60 colunas por tabela. Para o modelo: até 5 tabelas e 25 colunas por tabela.
- Visual aceito: `barra`, `linha`, `pizza`, `tabela`, `numero`.
- Uma nova tentativa por pergunta, no máximo (duas chamadas ao modelo).
- Modelo padrão: `https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf`, SHA-256 `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597`, 2.497.281.120 bytes. (O GGUF oficial da Qwen para este modelo não é público: HTTP 401.)
- Modelo de reserva: `https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf`, SHA-256 `509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c`.
- Portão de qualidade: 70% de acerto no PostgreSQL com o modelo padrão, llamafile só em CPU (`-ngl 0`).
- Versão final: `0.7.0` (`VERSION` e `CLIENT_INFO` em `web/mcp.js`).
- Rodar testes: `node --test` na raiz.

## Review Focus

1. **Oracle devolve aliases em maiúsculas** (`MES`, `TOTAL`) quando o modelo não usa aspas: `x`/`y` do JSON têm que casar com as colunas sem diferenciar caixa, senão tudo vira tabela. Teste em Task 5 (`pickVisual: casa x e y sem diferenciar caixa`).
2. **Números chegam como texto** (o `numeric` do PostgreSQL vem como `"1234.50"`): gráfico, frase e escolha de visual tratam texto numérico como número. Testes em Task 4 (`num`) e Task 5 (`pickVisual: y numérico em texto`).
3. **Nulos em x ou y** (venda sem cliente, loja sem nome): rótulo `(vazio)`, valor tratado como 0, nunca `NaN` no SVG. Testes em Task 4 (`render barra com nulo`) e Task 5 (`frase com nulo`).
4. **Média somada vira "Total"** ("ticket médio por loja"): a frase não soma quando `y` parece média, percentual ou taxa. Teste em Task 5 (`frase: sem Total para média`).
5. **Célula de CSV começando com `=`, `+`, `@` ou `-texto`** abre como fórmula no Excel do cliente: prefixar com apóstrofo. Teste em Task 7 (`toCsv neutraliza fórmula`).

Também verificado à mão na Task 8: pergunta enviada antes de o mapa do banco terminar de carregar (espera), e mapa indisponível (cai no laço de agente antigo).

---

### Task 1: Confirmar `response_format` no llamafile e o timeout por motor no toolbox

Investigação. Não muda código do produto; o resultado vira a seção "Resultados da Task 1" no fim deste arquivo e define dois detalhes das Tasks 2, 5 e 8.

**Files:**
- Modify: `docs/superpowers/plans/2026-10-13-relatorios-e-graficos.md` (seção "Resultados da Task 1")

**Interfaces:**
- Produces: `USE_SCHEMA` (true/false) para a Task 8; para cada motor, "timeout no servidor: sim/não" e o texto exato do erro de timeout, para as Tasks 2 e 5.

- [ ] **Step 1: Baixar o modelo novo e conferir o SHA-256**

```bash
curl -L --fail -C - -o models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf \
  https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf
shasum -a 256 models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf
```
Expected: `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597`.

- [ ] **Step 2: Subir o llamafile e testar `response_format` com schema**

```bash
chmod +x bin/llamafile
bin/llamafile -m models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf --server --host 127.0.0.1 --port 8080 --jinja -c 8192 > /tmp/cd2-llama.log 2>&1 &
until curl -sf http://127.0.0.1:8080/health >/dev/null; do sleep 1; done
curl -s http://127.0.0.1:8080/v1/chat/completions -H 'Content-Type: application/json' -d @- <<'EOF' | jq -r '.choices[0].message.content'
{"model":"cd2","temperature":0,"max_tokens":200,
 "messages":[{"role":"user","content":"Explique em texto livre, com calma, como contar os pedidos da tabela pedido."}],
 "response_format":{"type":"json_schema","json_schema":{"name":"consulta","strict":true,"schema":{"type":"object","properties":{"sql":{"type":"string"},"visual":{"type":"string","enum":["barra","linha","pizza","tabela","numero"]},"x":{"type":"string"},"y":{"type":"string"},"titulo":{"type":"string"}},"required":["sql","visual","titulo"]}}}}
EOF
```
Expected (caso A): um objeto JSON válido com `sql`, `visual` dentro da lista e `titulo`, mesmo com o pedido de "texto livre". Confirme com `| jq .` no lugar do `jq -r` final.
Caso B: HTTP 4xx, ou texto livre. Então `USE_SCHEMA = false` (o parse tolerante da Task 5 cobre).

Se `bin/llamafile` não executar direto no macOS ("exec format error"), rode como `sh bin/llamafile ...`.

- [ ] **Step 3: Testar o timeout do PostgreSQL**

```bash
docker compose -f tests/toolbox/docker-compose.yml up -d postgres
T=$(mktemp -d); cp core/toolbox/postgres.yaml "$T/pg.yaml"
awk '{print} /default_transaction_read_only: "on"/{print "  statement_timeout: \"1000\""}' core/toolbox/postgres.yaml > "$T/pg.yaml"
set -a; . tests/toolbox/postgres.env; set +a
CD2_DB_PASSWORD="$(printf '%s' "$CD2_DB_PASSWORD" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
time bin/toolbox/darwin-arm64/toolbox invoke db_read_only_query '{"sql":"select count(*) as n from generate_series(1,300000000) g"}' --config "$T/pg.yaml" 2>&1 | tail -n 2
```
Expected: falha em cerca de 1 s com mensagem contendo `canceling statement due to statement timeout`. Anote a mensagem.

- [ ] **Step 4: Testar o timeout do MariaDB**

```bash
docker compose -f tests/toolbox/docker-compose.yml up -d mariadb
sed 's/queryTimeout: 60s/queryTimeout: 1s/' core/toolbox/mariadb.yaml > "$T/my.yaml"
set -a; . tests/toolbox/mariadb.env; set +a
CD2_DB_PASSWORD="$(printf '%s' "$CD2_DB_PASSWORD" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
time bin/toolbox/darwin-arm64/toolbox invoke db_read_only_query '{"sql":"select count(*) as n from information_schema.columns a, information_schema.columns b, information_schema.columns c"}' --config "$T/my.yaml" 2>&1 | tail -n 2
```
Expected: falha em cerca de 1 s. Anote a mensagem (algo como `context deadline exceeded` ou `Query execution was interrupted`).

- [ ] **Step 5: Testar `queryTimeout` no SQL Server e no Oracle**

```bash
docker compose -f tests/toolbox/docker-compose.yml up -d sqlserver oracle
for e in sqlserver oracle; do
  awk '{print} /^password: "\$\{CD2_DB_PASSWORD\}"/{print "queryTimeout: 1s"}' core/toolbox/$e.yaml > "$T/$e.yaml"
done
set -a; . tests/toolbox/sqlserver.env; set +a
CD2_DB_PASSWORD="$(printf '%s' "$CD2_DB_PASSWORD" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
time bin/toolbox/darwin-arm64/toolbox invoke db_read_only_query '{"sql":"select count_big(*) as n from sys.all_objects a cross join sys.all_objects b cross join sys.all_objects c"}' --config "$T/sqlserver.yaml" 2>&1 | tail -n 2
set -a; . tests/toolbox/oracle.env; set +a
CD2_DB_PASSWORD="$(printf '%s' "$CD2_DB_PASSWORD" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
time bin/toolbox/darwin-arm64/toolbox invoke db_read_only_query '{"sql":"select count(*) as n from all_objects a, all_objects b, all_objects c"}' --config "$T/oracle.yaml" 2>&1 | tail -n 2
```
Para cada motor, um de três resultados: (a) o toolbox recusa carregar a receita (campo desconhecido) → "não suportado"; (b) carrega mas a consulta passa de 1 s → "aceito e ignorado" (trate como não suportado); (c) falha em cerca de 1 s → "suportado", anote a mensagem. Se o SQL Server não subir (o seed do check-recipe cria as tabelas por fora), qualquer consulta pesada serve: o objetivo é só o timeout.

- [ ] **Step 6: Registrar e derrubar**

Preencha a seção "Resultados da Task 1" no fim deste arquivo no formato dela. Depois:
```bash
kill %1 2>/dev/null; pkill -f "bin/llamafile -m models/Qwen3" ; docker compose -f tests/toolbox/docker-compose.yml down
```

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-10-13-relatorios-e-graficos.md
git commit -m "Plano de relatorios: resultado da verificacao de response_format e timeout por motor"
```

---

### Task 2: `db_catalog`, timeout nas receitas e `prepareSql`

**Files:**
- Modify: `core/toolbox/postgres.yaml`, `core/toolbox/mariadb.yaml`, `core/toolbox/sqlserver.yaml`, `core/toolbox/oracle.yaml`
- Modify: `tests/toolbox/check-recipe.sh`
- Modify: `web/toolbox.js` (`TOOL_DESCRIPTIONS`, `prepareSql`, exportação)
- Test: `tests/toolbox.test.js`

**Interfaces:**
- Consumes: resultados da Task 1 (timeout por motor).
- Produces: ferramenta MCP `db_catalog` (sem parâmetros) que devolve linhas `{ table_name, table_type: 'TABLE'|'VIEW', num_rows, column_name, data_type, ordinal }`; `CD2Toolbox.prepareSql(sql: string, motor: string) => string`; `TOOL_DESCRIPTIONS.db_catalog`.

- [ ] **Step 1: Escrever os testes de `prepareSql` e da lista de ferramentas**

Em `tests/toolbox.test.js`, troque o teste `TOOL_DESCRIPTIONS cobre as seis ferramentas` por:

```js
test('TOOL_DESCRIPTIONS cobre as sete ferramentas', () => {
  assert.deepEqual(Object.keys(T.TOOL_DESCRIPTIONS).sort(), ['db_catalog','db_connection_status','db_describe_table','db_list_tables','db_read_only_query','db_sample_table','db_search_columns']);
});
```

E acrescente no fim do arquivo:

```js
test('prepareSql: SQL Server ganha OFFSET 0 ROWS quando tem ORDER BY sem TOP nem OFFSET', () => {
  assert.equal(T.prepareSql('SELECT mes, SUM(v) AS total FROM venda GROUP BY mes ORDER BY mes', 'sqlserver'),
    'SELECT mes, SUM(v) AS total FROM venda GROUP BY mes ORDER BY mes OFFSET 0 ROWS');
  assert.equal(T.prepareSql('SELECT TOP (10) nome FROM p ORDER BY nome', 'sqlserver'), 'SELECT TOP (10) nome FROM p ORDER BY nome');
  assert.equal(T.prepareSql('SELECT nome FROM p ORDER BY nome OFFSET 5 ROWS', 'sqlserver'), 'SELECT nome FROM p ORDER BY nome OFFSET 5 ROWS');
  assert.equal(T.prepareSql('SELECT count(*) AS n FROM p', 'sqlserver'), 'SELECT count(*) AS n FROM p');
});

test('prepareSql: outros motores passam intactos', () => {
  for(const m of ['postgres', 'mariadb', 'oracle', undefined])
    assert.equal(T.prepareSql('SELECT a FROM t ORDER BY a', m), 'SELECT a FROM t ORDER BY a');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/toolbox.test.js`
Expected: FAIL (`T.prepareSql is not a function` e a lista de sete).

- [ ] **Step 3: Implementar em `web/toolbox.js`**

Em `TOOL_DESCRIPTIONS`, acrescente a primeira linha:
```js
  db_catalog:           'Lê o mapa do banco (tabelas e colunas) para o roteiro de relatórios.',
```

Depois de `guardSql`, acrescente:
```js
// O toolbox envolve a consulta numa subconsulta (TOP (200) no SQL Server), e o SQL Server
// não aceita ORDER BY em subconsulta sem TOP ou OFFSET. Os outros motores passam intactos.
function prepareSql(sql, motor){
  if(motor === 'sqlserver' && /\border\s+by\b/i.test(sql) && !/\b(top|offset)\b/i.test(sql)) return sql + ' OFFSET 0 ROWS';
  return sql;
}
```

Na `const api = { ... }`, acrescente `prepareSql` logo depois de `guardSql`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/toolbox.test.js`
Expected: PASS.

- [ ] **Step 5: `db_catalog` e timeout no PostgreSQL**

Em `core/toolbox/postgres.yaml`, no bloco `queryParams` da fonte, deixe:
```yaml
queryParams:
  default_transaction_read_only: "on"
  statement_timeout: "15000"
```
Atualize o comentário do topo: acrescente "Cada consulta tem 15 s (statement_timeout)." no fim do parágrafo.

Antes do bloco `kind: tool` de `db_read_only_query`, acrescente:
```yaml
---
kind: tool
name: db_catalog
type: postgres-sql
source: cd2-db
description: Mapa do banco para o roteiro de relatórios. Uma linha por coluna das 300 tabelas e views com mais linhas estimadas do schema ${CD2_DB_SCHEMA}, até 60 colunas por tabela.
annotations: { readOnlyHint: true }
statement: |
  WITH t AS (
    SELECT c.oid, c.relname,
           CASE WHEN c.relkind IN ('v','m') THEN 'VIEW' ELSE 'TABLE' END AS table_type,
           GREATEST(c.reltuples, 0)::bigint AS num_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = '${CD2_DB_SCHEMA}'
       AND c.relkind IN ('r','p','v','m')
     ORDER BY GREATEST(c.reltuples, 0) DESC, c.relname
     LIMIT 300)
  SELECT t.relname AS table_name, t.table_type, t.num_rows,
         a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type, a.attnum AS ordinal
    FROM t
    JOIN pg_attribute a ON a.attrelid = t.oid
   WHERE a.attnum > 0 AND a.attnum <= 60 AND NOT a.attisdropped
   ORDER BY t.num_rows DESC, t.relname, a.attnum
```

- [ ] **Step 6: `db_catalog` e timeout no MariaDB/MySQL**

Em `core/toolbox/mariadb.yaml`, troque `queryTimeout: 60s` por `queryTimeout: 15s`. Antes de `db_read_only_query`:
```yaml
---
kind: tool
name: db_catalog
type: mysql-sql
source: cd2-db
description: Mapa do banco para o roteiro de relatórios. Uma linha por coluna das 300 tabelas e views com mais linhas estimadas da base ${CD2_DB_SCHEMA}, até 60 colunas por tabela.
annotations: { readOnlyHint: true }
statement: |
  SELECT c.TABLE_NAME AS table_name,
         CASE WHEN t.TABLE_TYPE = 'VIEW' THEN 'VIEW' ELSE 'TABLE' END AS table_type,
         t.num_rows AS num_rows,
         c.COLUMN_NAME AS column_name, c.COLUMN_TYPE AS data_type, c.ORDINAL_POSITION AS ordinal
    FROM information_schema.COLUMNS c
    JOIN (SELECT TABLE_NAME, TABLE_TYPE, COALESCE(TABLE_ROWS, 0) AS num_rows
            FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = '${CD2_DB_SCHEMA}'
           ORDER BY COALESCE(TABLE_ROWS, 0) DESC, TABLE_NAME
           LIMIT 300) t ON t.TABLE_NAME = c.TABLE_NAME
   WHERE c.TABLE_SCHEMA = '${CD2_DB_SCHEMA}' AND c.ORDINAL_POSITION <= 60
   ORDER BY t.num_rows DESC, c.TABLE_NAME, c.ORDINAL_POSITION
```
Use o mesmo `type:` que as outras ferramentas do arquivo usam (confira com `grep -m1 '^type:' -n core/toolbox/mariadb.yaml` depois do bloco `source`; se for diferente de `mysql-sql`, use o do arquivo).

- [ ] **Step 7: `db_catalog` no SQL Server**

Em `core/toolbox/sqlserver.yaml`, se a Task 1 marcou o SQL Server como "suportado", acrescente `queryTimeout: 15s` na fonte, logo depois de `password:`. Antes de `db_read_only_query` (confira o `type:` usado no arquivo, provavelmente `mssql-sql`):
```yaml
---
kind: tool
name: db_catalog
type: mssql-sql
source: cd2-db
description: Mapa do banco para o roteiro de relatórios. Uma linha por coluna das 300 tabelas e views com mais linhas do schema ${CD2_DB_SCHEMA}, até 60 colunas por tabela.
annotations: { readOnlyHint: true }
statement: |
  WITH t AS (
    SELECT TOP (300) o.object_id, o.name,
           CASE WHEN o.type = 'V' THEN 'VIEW' ELSE 'TABLE' END AS table_type,
           COALESCE((SELECT SUM(p.rows) FROM sys.partitions p
                      WHERE p.object_id = o.object_id AND p.index_id IN (0, 1)), 0) AS num_rows
      FROM sys.objects o
      JOIN sys.schemas s ON s.schema_id = o.schema_id
     WHERE s.name = '${CD2_DB_SCHEMA}' AND o.type IN ('U', 'V')
     ORDER BY num_rows DESC, o.name)
  SELECT t.name AS table_name, t.table_type, t.num_rows,
         c.name AS column_name, ty.name AS data_type, c.column_id AS ordinal
    FROM t
    JOIN sys.columns c ON c.object_id = t.object_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
   WHERE c.column_id <= 60
   ORDER BY t.num_rows DESC, t.name, c.column_id
```

- [ ] **Step 8: `db_catalog` no Oracle**

Em `core/toolbox/oracle.yaml`, se a Task 1 marcou o Oracle como "suportado", acrescente `queryTimeout: 15s` na fonte, depois de `password:`. Antes de `db_read_only_query` (confira o `type:` do arquivo, provavelmente `oracle-sql`). Aliases entre aspas para sair em minúsculas, como no `db_connection_status`:
```yaml
---
kind: tool
name: db_catalog
type: oracle-sql
source: cd2-db
description: Mapa do banco para o roteiro de relatórios. Uma linha por coluna das 300 tabelas e views com mais linhas estimadas do schema ${CD2_DB_SCHEMA}, até 60 colunas por tabela.
annotations: { readOnlyHint: true }
statement: |
  SELECT c.TABLE_NAME AS "table_name", t.table_type AS "table_type", t.num_rows AS "num_rows",
         c.COLUMN_NAME AS "column_name", c.DATA_TYPE AS "data_type", c.COLUMN_ID AS "ordinal"
    FROM ALL_TAB_COLUMNS c
    JOIN (SELECT object_name, table_type, num_rows FROM (
            SELECT o.OBJECT_NAME AS object_name,
                   CASE WHEN o.OBJECT_TYPE = 'VIEW' THEN 'VIEW' ELSE 'TABLE' END AS table_type,
                   NVL(tb.NUM_ROWS, 0) AS num_rows
              FROM ALL_OBJECTS o
              LEFT JOIN ALL_TABLES tb ON tb.OWNER = o.OWNER AND tb.TABLE_NAME = o.OBJECT_NAME
             WHERE o.OWNER = '${CD2_DB_SCHEMA}' AND o.OBJECT_TYPE IN ('TABLE', 'VIEW')
             ORDER BY num_rows DESC, o.OBJECT_NAME)
           WHERE ROWNUM <= 300) t ON t.object_name = c.TABLE_NAME
   WHERE c.OWNER = '${CD2_DB_SCHEMA}' AND c.COLUMN_ID <= 60
   ORDER BY t.num_rows DESC, c.TABLE_NAME, c.COLUMN_ID
```

- [ ] **Step 9: Cobrir `db_catalog` e o timeout no `check-recipe.sh`**

Em `tests/toolbox/check-recipe.sh`, antes da linha `echo "== $ENGINE: db_read_only_query"`, acrescente:
```sh
echo "== $ENGINE: db_catalog"
K="$(invoke db_catalog '{}')"
[ "$(printf '%s' "$K" | keys)" = "column_name,data_type,num_rows,ordinal,table_name,table_type" ] || fail "catalog: colunas $(printf '%s' "$K" | keys)"
printf '%s' "$K" | jq -e --arg t "$TBL" '.[] | select(.table_name == $t and .table_type == "TABLE" and (.column_name|ascii_downcase) == "nome")' >/dev/null || fail "catalog: $TBL.nome"
printf '%s' "$K" | jq -e --arg v "$VW" '.[] | select(.table_name == $v and .table_type == "VIEW")' >/dev/null || fail "catalog: $VW como VIEW"
[ "$(printf '%s' "$K" | jq '[.[] | .ordinal | tonumber] | max')" -le 60 ] || fail "catalog: ordinal acima de 60"
```
E dentro do bloco `if [ "$ENGINE" = postgres ]; then`, acrescente:
```sh
  [ "$(invoke db_read_only_query '{"sql":"select current_setting($$statement_timeout$$) as t"}' | jq -r '.[0].t')" = 15s ] || fail "query: statement_timeout da sessao nao e 15s"
```

- [ ] **Step 10: Rodar a verificação nas quatro receitas**

```bash
docker compose -f tests/toolbox/docker-compose.yml up -d
# o SQL Server não tem seed automático: aplique com sqlcmd depois que o container aceitar conexão
docker compose -f tests/toolbox/docker-compose.yml exec -T sqlserver /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P 'Cd2S3nh@Forte!' -i /dev/stdin < tests/toolbox/seed/sqlserver.sql
for e in postgres mariadb sqlserver oracle; do sh tests/toolbox/check-recipe.sh $e || break; done
docker compose -f tests/toolbox/docker-compose.yml down
```
Expected: `OK: postgres`, `OK: mariadb`, `OK: sqlserver`, `OK: oracle`.

- [ ] **Step 11: Commit**

```bash
git add core/toolbox tests/toolbox web/toolbox.js tests/toolbox.test.js
git commit -m "Receitas ganham db_catalog e tempo maximo de 15 s; prepareSql corrige ORDER BY no SQL Server"
```

---

### Task 3: Catálogo, ranqueamento e sugestões (`web/catalog.js`)

**Files:**
- Create: `web/catalog.js`
- Test: `tests/catalog.test.js`

**Interfaces:**
- Consumes: linhas do `db_catalog` (Task 2).
- Produces (global `CD2Catalog` no navegador, `module.exports` no Node):
  - `tokens(nome: string) => string[]`
  - `kindOf(tipo: string) => 'data'|'numero'|'texto'|'outro'`
  - `buildCatalog(rows: object[]) => { tables: Table[] }`, com `Table = { name, type: 'TABLE'|'VIEW', rows: number, tokens: string[], columns: { name, type, kind, tokens }[] }`
  - `rankTables(catalog, pergunta: string, opts?: { max?: number, maxCols?: number }) => { name, type, rows, score, columns: { name, type, kind }[] }[]`
  - `suggest(catalog) => string[]` (até 4)
  - `humanize(nome: string) => string`

- [ ] **Step 1: Escrever os testes**

`tests/catalog.test.js`:
```js
'use strict';
// Testes do mapa do banco (web/catalog.js). Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../web/catalog.js');

const ROWS = [
  ['mov_venda','TABLE',6000,'nr_cupom','integer',1], ['mov_venda','TABLE',6000,'cd_loja','integer',2],
  ['mov_venda','TABLE',6000,'cd_cli','integer',3], ['mov_venda','TABLE',6000,'dt_mov','date',4],
  ['mov_venda','TABLE',6000,'vlr_tot','numeric(12,2)',5],
  ['mov_venda_item','TABLE',18000,'nr_cupom','integer',1], ['mov_venda_item','TABLE',18000,'seq','integer',2],
  ['mov_venda_item','TABLE',18000,'cd_prod','integer',3], ['mov_venda_item','TABLE',18000,'qtd_it','integer',4],
  ['mov_venda_item','TABLE',18000,'vlr_tot_it','numeric(12,2)',5],
  ['produto','TABLE',120,'cd_prod','integer',1], ['produto','TABLE',120,'ds_prod','varchar(80)',2],
  ['produto','TABLE',120,'cd_depto','integer',3], ['produto','TABLE',120,'vlr_custo','numeric(10,2)',4],
  ['loja','TABLE',4,'cd_loja','integer',1], ['loja','TABLE',4,'nm_loja','varchar(40)',2], ['loja','TABLE',4,'uf','char(2)',3],
  ['cliente','TABLE',300,'cd_cli','integer',1], ['cliente','TABLE',300,'nm_cli','varchar(80)',2],
  ['cliente','TABLE',300,'uf','char(2)',3], ['cliente','TABLE',300,'dt_cad','date',4],
  ['log_integracao','TABLE',50000,'id','bigint',1], ['log_integracao','TABLE',50000,'dt_log','timestamp without time zone',2],
  ['log_integracao','TABLE',50000,'msg','text',3],
  ['v_resumo','VIEW',0,'mes','text',1]
].map(([table_name, table_type, num_rows, column_name, data_type, ordinal]) => ({ table_name, table_type, num_rows, column_name, data_type, ordinal }));
const CAT = C.buildCatalog(ROWS);

test('tokens: separa _, camelCase e prefixos de ERP, tira acento e plural', () => {
  assert.deepEqual(C.tokens('VLR_TOT_IT'), ['vlr', 'tot', 'it']);
  assert.deepEqual(C.tokens('DtMov'), ['dt', 'mov']);
  assert.deepEqual(C.tokens('dtmov'), ['dt', 'mov']);
  assert.deepEqual(C.tokens('codprod'), ['cod', 'prod']);
  assert.deepEqual(C.tokens('produtoid'), ['produto', 'id']);
  assert.deepEqual(C.tokens('Vendas Ação'), ['venda', 'acao']);
  assert.deepEqual(C.tokens('total'), ['total']);
  assert.deepEqual(C.tokens(null), []);
});

test('kindOf: tipos dos quatro motores', () => {
  const casos = { 'numeric(12,2)':'numero', 'NUMBER':'numero', 'bigint':'numero', 'decimal':'numero', 'money':'numero', 'float':'numero',
    'date':'data', 'DATE':'data', 'timestamp without time zone':'data', 'datetime2':'data', 'TIMESTAMP(6)':'data',
    'varchar(80)':'texto', 'nvarchar':'texto', 'text':'texto', 'CLOB':'texto', 'char(2)':'texto',
    'interval':'outro', 'bit':'outro', 'boolean':'outro', 'bytea':'outro', '':'outro' };
  for(const [t, k] of Object.entries(casos)) assert.equal(C.kindOf(t), k, t);
});

test('buildCatalog agrupa por tabela, marca view, converte num_rows e aceita chaves em maiúsculas', () => {
  assert.equal(CAT.tables.length, 7);
  const v = CAT.tables.find(t => t.name === 'mov_venda');
  assert.equal(v.rows, 6000); assert.equal(v.type, 'TABLE');
  assert.deepEqual(v.columns.map(c => c.kind), ['numero', 'numero', 'numero', 'data', 'numero']);
  assert.equal(CAT.tables.find(t => t.name === 'v_resumo').type, 'VIEW');
  const up = C.buildCatalog([{ TABLE_NAME:'PEDIDO', TABLE_TYPE:'TABLE', NUM_ROWS:'42', COLUMN_NAME:'VALOR', DATA_TYPE:'NUMBER', ORDINAL:1 }]);
  assert.equal(up.tables[0].name, 'PEDIDO'); assert.equal(up.tables[0].rows, 42); assert.equal(up.tables[0].columns[0].kind, 'numero');
  assert.equal(C.buildCatalog(null).tables.length, 0);
});

test('buildCatalog corta em 60 colunas por tabela', () => {
  const rows = Array.from({ length:70 }, (_, i) => ({ table_name:'larga', table_type:'TABLE', num_rows:1, column_name:'c' + i, data_type:'int', ordinal:i + 1 }));
  assert.equal(C.buildCatalog(rows).tables[0].columns.length, 60);
});

test('rankTables: faturamento por mês escolhe a tabela de vendas com data', () => {
  const r = C.rankTables(CAT, 'Qual o faturamento por mês?');
  assert.equal(r[0].name, 'mov_venda');
  assert.ok(r.findIndex(t => t.name === 'log_integracao') !== 0);
  assert.ok(r.length <= 5);
  assert.deepEqual(Object.keys(r[0]).sort(), ['columns', 'name', 'rows', 'score', 'type']);
});

test('rankTables: produtos mais vendidos traz produto e itens de venda', () => {
  const nomes = C.rankTables(CAT, 'produtos mais vendidos').slice(0, 3).map(t => t.name);
  assert.ok(nomes.includes('produto'), nomes.join());
  assert.ok(nomes.includes('mov_venda_item'), nomes.join());
});

test('rankTables: sem nenhuma palavra em comum devolve lista vazia', () => {
  assert.deepEqual(C.rankTables(CAT, 'quantos funcionários'), []);
  assert.deepEqual(C.rankTables({ tables:[] }, 'vendas'), []);
});

test('rankTables: até 25 colunas, priorizando a que bateu com a pergunta, na ordem original', () => {
  const rows = Array.from({ length:40 }, (_, i) => ({ table_name:'pedido', table_type:'TABLE', num_rows:10, column_name:i === 38 ? 'vlr_frete' : 'campo' + i, data_type:'varchar(10)', ordinal:i + 1 }));
  const r = C.rankTables(C.buildCatalog(rows), 'frete dos pedidos');
  assert.equal(r[0].columns.length, 25);
  assert.ok(r[0].columns.some(c => c.name === 'vlr_frete'));
  assert.equal(r[0].columns[r[0].columns.length - 1].name, 'vlr_frete');
});

test('suggest: quatro perguntas tiradas do esquema, sem tabela de log', () => {
  assert.deepEqual(C.suggest(CAT), [
    'Total por mês em mov venda',
    'Top 10 de produto por vlr custo',
    'Quantos registros tem mov venda item',
    'Quantos registros tem cliente'
  ]);
  assert.deepEqual(C.suggest({ tables:[] }), []);
  assert.deepEqual(C.suggest(null), []);
});

test('humanize', () => {
  assert.equal(C.humanize('MOV_VENDA'), 'mov venda');
  assert.equal(C.humanize('cd_prod'), 'cd prod');
  assert.equal(C.humanize('id'), 'id');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/catalog.test.js`
Expected: FAIL (`Cannot find module '../web/catalog.js'`).

- [ ] **Step 3: Implementar `web/catalog.js`**

```js
/* Mapa do banco para o roteiro de relatórios do Harness Pocket: monta o catálogo a partir
   do db_catalog, escolhe as tabelas que combinam com a pergunta e sugere perguntas tiradas
   do próprio esquema. Lógica pura, sem modelo e sem DOM. */
(function(root){
"use strict";
const MAX_COLS_TABLE = 60;
// Prefixos comuns de coluna em ERP. Separados só quando o resto tem 3 letras ou mais.
const PREFIXES = ['vlr', 'qtd', 'dt', 'cod', 'cd', 'tot', 'nr', 'ds', 'nm'];
const STOP = new Set(['de','da','do','das','dos','por','e','o','a','os','as','em','no','na','nos','nas','qual','quai','quanto',
  'quantos','quanta','quantas','mostre','mostra','me','um','uma','com','para','pelo','pela','cada','todo','todos','the','of','by',
  'per','what','how','many','show','list','liste','foram','tem','temo','ha','sao','que','mai','menos','maior','menor','meu','minha']);
const SYN = [
  ['venda','sale','pedido','order','cupom','movimento','mov','vend','vendido','vendida','faturamento','fatura','receita'],
  ['produto','product','item','sku','mercadoria','prod','artigo'],
  ['cliente','customer','client','cli','consumidor'],
  ['data','date','dt','dia','mes','ano','periodo','day','month','year','time','semana'],
  ['valor','vlr','total','tot','amount','price','preco','faturamento','receita','custo'],
  ['quantidade','qtd','qty','quant'],
  ['loja','store','filial','branch','unidade'],
  ['departamento','depto','dept','department','secao','categoria','category'],
  ['estado','uf','state']
];
const NOISE = new Set(['log','tmp','temp','aux','bkp','backup','audit','auditoria','old','hist']);

function stem(t){ return t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t; }
function tokens(s){
  const base = String(s == null ? '' : s).replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out = [];
  for(let t of base){
    let p;
    while((p = PREFIXES.find(x => t.length >= x.length + 3 && t.startsWith(x)))){ out.push(p); t = t.slice(p.length); }
    if(t.length > 4 && t.endsWith('id')){ out.push(stem(t.slice(0, -2)), 'id'); continue; }
    out.push(stem(t));
  }
  return out;
}
const SYN_INDEX = new Map();
for(const g of SYN){ const set = g.map(stem); for(const w of set){ const cur = SYN_INDEX.get(w) || new Set(); set.forEach(x => cur.add(x)); SYN_INDEX.set(w, cur); } }
function syn(q){ return SYN_INDEX.get(q) || new Set([q]); }
function match(q, x){
  if(q === x || syn(q).has(x)) return true;
  return q.length >= 4 && x.length >= 4 && (x.startsWith(q) || q.startsWith(x));
}
function questionTokens(p){ return [...new Set(tokens(p).filter(t => t.length >= 2 && !STOP.has(t)))]; }

function kindOf(type){
  const t = String(type || '').toLowerCase();
  if(/interval/.test(t)) return 'outro';
  if(/date|time/.test(t)) return 'data';
  if(/^(bit|bool)/.test(t)) return 'outro';
  if(/int|num|dec|float|double|real|money/.test(t)) return 'numero';
  if(/char|text|clob|string|enum/.test(t)) return 'texto';
  return 'outro';
}
function lowerKeys(r){ const o = {}; for(const k in r) o[k.toLowerCase()] = r[k]; return o; }

function buildCatalog(rows){
  const by = new Map();
  for(const raw of rows || []){
    if(!raw || typeof raw !== 'object') continue;
    const r = lowerKeys(raw);
    if(r.table_name == null || r.column_name == null) continue;
    const name = String(r.table_name);
    let t = by.get(name);
    if(!t){
      t = { name, type:String(r.table_type).toUpperCase() === 'VIEW' ? 'VIEW' : 'TABLE', rows:Math.max(0, Number(r.num_rows) || 0), tokens:tokens(name), columns:[] };
      by.set(name, t);
    }
    if(t.columns.length >= MAX_COLS_TABLE) continue;
    t.columns.push({ name:String(r.column_name), type:String(r.data_type == null ? '' : r.data_type), kind:kindOf(r.data_type), tokens:tokens(r.column_name) });
  }
  return { tables:[...by.values()] };
}

function pickColumns(cols, hit, n){
  const rank = c => hit.has(c.name) ? 0 : c.kind === 'data' ? 1 : c.kind === 'numero' ? 2 : 3;
  return cols.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).slice(0, n)
    .sort((a, b) => a.i - b.i).map(({ c }) => ({ name:c.name, type:c.type, kind:c.kind }));
}
// Nota: +3 por palavra no nome da tabela, +1 por palavra em coluna (até 5), +1 com data, +1 com
// número, desempate pelo volume. Só entra quem tem ao menos uma palavra em comum com a pergunta.
function rankTables(catalog, pergunta, opts){
  opts = opts || {};
  const max = opts.max || 5, maxCols = opts.maxCols || 25, qs = questionTokens(pergunta), scored = [];
  for(const t of (catalog && catalog.tables) || []){
    let tableHits = 0, colHits = 0; const hitCols = new Set();
    for(const q of qs){
      if(t.tokens.some(x => match(q, x))) tableHits++;
      let hit = false;
      for(const c of t.columns) if(c.tokens.some(x => match(q, x))){ hitCols.add(c.name); hit = true; }
      if(hit) colHits++;
    }
    if(!tableHits && !colHits) continue;
    const hasData = t.columns.some(c => c.kind === 'data'), hasNum = t.columns.some(c => c.kind === 'numero');
    const score = 3 * tableHits + Math.min(5, colHits) + (hasData ? 1 : 0) + (hasNum ? 1 : 0) + Math.log10(t.rows + 1) / 100;
    scored.push({ t, score, hitCols });
  }
  scored.sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name));
  return scored.slice(0, max).map(({ t, score, hitCols }) => ({ name:t.name, type:t.type, rows:t.rows, score, columns:pickColumns(t.columns, hitCols, maxCols) }));
}

function humanize(name){ const t = tokens(name).filter(x => x !== 'id'); return t.length ? t.join(' ') : String(name == null ? '' : name).toLowerCase(); }
function isKey(c){ return c.tokens.includes('id') || ['cod', 'cd', 'nr'].includes(c.tokens[0]); }
function suggest(catalog){
  const tables = ((catalog && catalog.tables) || []).filter(t => t.type === 'TABLE' && !t.tokens.some(x => NOISE.has(x)))
    .slice().sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
  const out = [], used = new Set();
  const add = (s, t) => { if(out.length < 4 && !out.includes(s)){ out.push(s); used.add(t.name); } };
  const val = t => t.columns.find(c => c.kind === 'numero' && !isKey(c));
  const txt = t => t.columns.find(c => c.kind === 'texto' && !isKey(c));
  const fato = tables.find(t => t.columns.some(c => c.kind === 'data') && val(t));
  if(fato) add('Total por mês em ' + humanize(fato.name), fato);
  const top = tables.find(t => t !== fato && val(t) && txt(t));
  if(top) add('Top 10 de ' + humanize(top.name) + ' por ' + humanize(val(top).name), top);
  if(fato && txt(fato)) add('Distribuição de ' + humanize(fato.name) + ' por ' + humanize(txt(fato).name), fato);
  for(const t of tables){ if(out.length >= 4) break; if(!used.has(t.name)) add('Quantos registros tem ' + humanize(t.name), t); }
  return out;
}

const api = { tokens, kindOf, buildCatalog, rankTables, suggest, humanize };
if(typeof module !== 'undefined' && module.exports) module.exports = api; else root.CD2Catalog = api;
})(typeof window !== 'undefined' ? window : globalThis);
```
Observação: `STOP` guarda as palavras já sem o "s" final (`quai`, `mai`, `temo`), porque `tokens` aplica o mesmo corte antes do filtro.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/catalog.test.js`
Expected: PASS. Se o ranqueamento divergir dos testes, ajuste `SYN`/`STOP`, não os testes: eles descrevem o comportamento da spec.

- [ ] **Step 5: Commit**

```bash
git add web/catalog.js tests/catalog.test.js
git commit -m "Adiciona o mapa do banco (catalog.js): ranqueamento de tabelas e perguntas sugeridas"
```

---

### Task 4: Gráficos e tabela em SVG/HTML (`web/chart.js`)

**Files:**
- Create: `web/chart.js`
- Test: `tests/chart.test.js`

**Interfaces:**
- Produces (global `CD2Chart` / `module.exports`):
  - `num(v) => number|null` (número ou texto numérico; senão `null`)
  - `fmt(v) => string` (pt-BR, até 2 casas)
  - `labelsOf(valores: any[]) => string[]` (datas ISO viram `mmm/aaaa` se todas forem dia 01, senão `dd/mm/aaaa`; `AAAA-MM` vira `mmm/aaaa`; nulo vira `(vazio)`)
  - `render(visual, colunas: string[], linhas: object[], opts?: { x?: string, y?: string }) => string` (HTML/SVG com todo texto escapado)

- [ ] **Step 1: Escrever os testes**

`tests/chart.test.js`:
```js
'use strict';
// Testes dos gráficos (web/chart.js). Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../web/chart.js');
const count = (s, sub) => s.split(sub).length - 1;

test('num aceita número e texto numérico, recusa o resto', () => {
  assert.equal(G.num(12), 12); assert.equal(G.num('1234.50'), 1234.5); assert.equal(G.num(' -3 '), -3); assert.equal(G.num('1e3'), 1000);
  for(const v of ['abc', '', null, undefined, NaN, Infinity, '1.2.3', '12,5']) assert.equal(G.num(v), null, String(v));
});

test('fmt em pt-BR', () => {
  assert.equal(G.fmt(1234.5), '1.234,5'); assert.equal(G.fmt('58900'), '58.900'); assert.equal(G.fmt(0.123), '0,12'); assert.equal(G.fmt('Bebidas'), 'Bebidas');
});

test('labelsOf: meses, datas, nulos e o resto', () => {
  assert.deepEqual(G.labelsOf(['2026-01-01', '2026-02-01T00:00:00Z']), ['jan/2026', 'fev/2026']);
  assert.deepEqual(G.labelsOf(['2026-01-15', '2026-02-01']), ['15/01/2026', '01/02/2026']);
  assert.deepEqual(G.labelsOf(['2026-03', '2026-12']), ['mar/2026', 'dez/2026']);
  assert.deepEqual(G.labelsOf([null, 'Bebidas', '']), ['(vazio)', 'Bebidas', '(vazio)']);
  assert.deepEqual(G.labelsOf([3, 'x']), ['3', 'x']);
});

test('render barra: uma barra por linha, rótulos escapados, sem NaN', () => {
  const s = G.render('barra', ['loja', 'total'], [{ loja:'A', total:10 }, { loja:'<b>&"', total:'5.5' }], { x:'loja', y:'total' });
  assert.ok(s.startsWith('<svg')); assert.equal(count(s, '<rect class="bar'), 2);
  assert.ok(s.includes('&lt;b&gt;&amp;&quot;')); assert.ok(!s.includes('<b>&"')); assert.ok(!/NaN/.test(s));
  assert.ok(s.includes('5,5'));
});

test('render barra com nulo e negativo', () => {
  const s = G.render('barra', ['loja', 'total'], [{ loja:null, total:null }, { loja:'B', total:-5 }, { loja:'C', total:0 }], { x:'loja', y:'total' });
  assert.ok(s.includes('(vazio)')); assert.ok(s.includes('bar neg')); assert.ok(!/NaN/.test(s));
});

test('render linha: um ponto por linha, sem NaN com um ponto ou tudo zero', () => {
  const l = [{ mes:'2026-01-01', v:1 }, { mes:'2026-02-01', v:3 }, { mes:'2026-03-01', v:2 }];
  const s = G.render('linha', ['mes', 'v'], l, { x:'mes', y:'v' });
  assert.equal(count(s, '<circle class="pt"'), 3); assert.ok(s.includes('jan/2026')); assert.ok(!/NaN/.test(s));
  assert.ok(!/NaN/.test(G.render('linha', ['mes', 'v'], [{ mes:'2026-01-01', v:5 }], { x:'mes', y:'v' })));
  assert.ok(!/NaN/.test(G.render('linha', ['mes', 'v'], [{ mes:'a', v:0 }, { mes:'b', v:0 }], { x:'mes', y:'v' })));
});

test('render pizza: fatias, legenda, fatia única vira círculo, total zero sem NaN', () => {
  const s = G.render('pizza', ['d', 'v'], [{ d:'A', v:1 }, { d:'B', v:1 }, { d:'C', v:2 }], { x:'d', y:'v' });
  assert.equal(count(s, '<path'), 3); assert.equal(count(s, '<li>'), 3);
  assert.ok(G.render('pizza', ['d', 'v'], [{ d:'A', v:9 }], { x:'d', y:'v' }).includes('<circle'));
  assert.ok(!/NaN/.test(G.render('pizza', ['d', 'v'], [{ d:'A', v:0 }, { d:'B', v:0 }], { x:'d', y:'v' })));
});

test('render numero: valor formatado e rótulo escapado', () => {
  const s = G.render('numero', ['<total>'], [{ '<total>':'1234' }], { y:'<total>' });
  assert.ok(s.includes('1.234')); assert.ok(s.includes('&lt;total&gt;')); assert.ok(s.includes('class="kpi"'));
});

test('render tabela: cabeçalho, células escapadas, número alinhado, código sem formatação', () => {
  const s = G.render('tabela', ['nome', 'cnpj', 'valor'], [{ nome:'<x>', cnpj:'12345678000199', valor:'12.5' }, { nome:'y', cnpj:null, valor:3 }]);
  assert.equal(count(s, '<th>'), 3); assert.equal(count(s, '<tr>'), 3);
  assert.ok(s.includes('&lt;x&gt;')); assert.ok(s.includes('12345678000199')); assert.ok(s.includes('12,5')); assert.ok(s.includes('class="n"'));
  assert.ok(G.render('qualquer', ['a'], [{ a:1 }]).includes('<table>'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/chart.test.js`
Expected: FAIL (`Cannot find module '../web/chart.js'`).

- [ ] **Step 3: Implementar `web/chart.js`**

```js
/* Gráficos do roteiro de relatórios: barra, linha, pizza, número e tabela, em SVG/HTML feito à
   mão (sem biblioteca, funciona offline). Cores por classe CSS (tokens em index.html); a pizza usa
   os hex dos mesmos tokens. Todo texto que vem do banco é escapado aqui. Sem animação. */
(function(root){
"use strict";
const PALETA = ['#0000ff', '#011e80', '#019eff', '#0333f7', '#a1a6ae', '#dbff2a'];
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const W = 640;
const NF = new Intl.NumberFormat('pt-BR', { maximumFractionDigits:2 });

function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function num(v){
  if(typeof v === 'number') return isFinite(v) ? v : null;
  if(typeof v === 'string' && /^\s*-?\d+(\.\d+)?([eE][+-]?\d+)?\s*$/.test(v)) return Number(v);
  return null;
}
function fmt(v){ const n = num(v); return n == null ? String(v == null ? '' : v) : NF.format(n); }
// Na tabela, só formata o que é claramente número: inteiro em texto pode ser código (CNPJ, EAN).
function fmtCell(v){ return (typeof v === 'number' || (typeof v === 'string' && /^\s*-?\d+\.\d+\s*$/.test(v))) ? fmt(v) : String(v == null ? '' : v); }
function cut(s, n){ s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function labelsOf(vals){
  const empty = v => v == null || v === '';
  const iso = vals.map(v => empty(v) ? null : /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(v)));
  const mensal = iso.some(Boolean) && iso.every((m, i) => empty(vals[i]) || (m && (!m[3] || m[3] === '01')));
  return vals.map((v, i) => {
    if(empty(v)) return '(vazio)';
    const m = iso[i];
    if(m && mensal && MESES[Number(m[2]) - 1]) return MESES[Number(m[2]) - 1] + '/' + m[1];
    if(m && m[3]) return m[3] + '/' + m[2] + '/' + m[1];
    return String(v);
  });
}
const svgOpen = (h, label) => '<svg class="chart" viewBox="0 0 ' + W + ' ' + h + '" role="img" aria-label="' + esc(label) + '">';

function barra(linhas, x, y){
  const vals = linhas.map(r => num(r[y]) || 0), max = Math.max(0, ...vals.map(Math.abs)) || 1;
  const labs = labelsOf(linhas.map(r => r[x])), L = 200, R = 90, H = 28, bw = W - L - R;
  let s = svgOpen(linhas.length * H + 8, 'Gráfico de barras: ' + y + ' por ' + x);
  linhas.forEach((r, i) => {
    const v = vals[i], w = Math.round(Math.abs(v) / max * bw), yy = 4 + i * H;
    s += '<g><title>' + esc(labs[i] + ': ' + fmt(v)) + '</title>'
      + '<text class="lbl" x="' + (L - 8) + '" y="' + (yy + 18) + '" text-anchor="end">' + esc(cut(labs[i], 26)) + '</text>'
      + '<rect class="bar' + (v < 0 ? ' neg' : '') + '" x="' + L + '" y="' + (yy + 4) + '" width="' + w + '" height="' + (H - 8) + '" rx="3"/>'
      + '<text class="val" x="' + (L + w + 6) + '" y="' + (yy + 18) + '">' + esc(fmt(v)) + '</text></g>';
  });
  return s + '</svg>';
}
function linha(linhas, x, y){
  const vals = linhas.map(r => num(r[y]) || 0), labs = labelsOf(linhas.map(r => r[x]));
  const L = 70, R = 20, T = 16, B = 40, h = 280, pw = W - L - R, ph = h - T - B, n = linhas.length;
  const mn = Math.min(0, ...vals), mx = Math.max(0, ...vals), span = (mx - mn) || 1;
  const px = i => (L + (n === 1 ? pw / 2 : i * pw / (n - 1))).toFixed(1);
  const py = v => (T + ph - (v - mn) / span * ph).toFixed(1);
  let s = svgOpen(h, 'Gráfico de linha: ' + y + ' por ' + x);
  s += '<line class="axis" x1="' + L + '" y1="' + py(0) + '" x2="' + (W - R) + '" y2="' + py(0) + '"/>';
  s += '<text class="lbl" x="' + (L - 8) + '" y="' + (T + 4) + '" text-anchor="end">' + esc(fmt(mx)) + '</text>';
  s += '<text class="lbl" x="' + (L - 8) + '" y="' + (T + ph + 4) + '" text-anchor="end">' + esc(fmt(mn)) + '</text>';
  s += '<polyline class="line" points="' + vals.map((v, i) => px(i) + ',' + py(v)).join(' ') + '"/>';
  const step = Math.max(1, Math.ceil(n / 8));
  vals.forEach((v, i) => {
    s += '<circle class="pt" cx="' + px(i) + '" cy="' + py(v) + '" r="4"><title>' + esc(labs[i] + ': ' + fmt(v)) + '</title></circle>';
    if(i % step === 0 || i === n - 1) s += '<text class="lbl" x="' + px(i) + '" y="' + (h - 16) + '" text-anchor="middle">' + esc(cut(labs[i], 12)) + '</text>';
  });
  return s + '</svg>';
}
function pizza(linhas, x, y){
  const vals = linhas.map(r => Math.max(0, num(r[y]) || 0)), tot = vals.reduce((a, b) => a + b, 0);
  const labs = labelsOf(linhas.map(r => r[x])), cx = 140, cy = 140, rr = 120;
  let a0 = -Math.PI / 2;
  let s = '<div class="pie"><svg class="chart" viewBox="0 0 280 280" role="img" aria-label="' + esc('Gráfico de pizza: ' + y + ' por ' + x) + '">';
  vals.forEach((v, i) => {
    const frac = tot ? v / tot : 0, a1 = a0 + frac * 2 * Math.PI, cor = PALETA[i % PALETA.length];
    const t = '<title>' + esc(labs[i] + ': ' + fmt(v)) + '</title>';
    const p = a => (cx + rr * Math.cos(a)).toFixed(2) + ' ' + (cy + rr * Math.sin(a)).toFixed(2);
    if(frac >= 0.9999) s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + rr + '" fill="' + cor + '">' + t + '</circle>';
    else if(frac > 0) s += '<path d="M' + cx + ' ' + cy + ' L' + p(a0) + ' A' + rr + ' ' + rr + ' 0 ' + (frac > 0.5 ? 1 : 0) + ' 1 ' + p(a1) + ' Z" fill="' + cor + '">' + t + '</path>';
    a0 = a1;
  });
  s += '</svg><ul class="legend">';
  vals.forEach((v, i) => { s += '<li><i style="background:' + PALETA[i % PALETA.length] + '"></i>' + esc(labs[i]) + ' <b>' + esc(fmt(v)) + '</b></li>'; });
  return s + '</ul></div>';
}
function numero(colunas, linhas, y){
  const r = linhas[0] || {}, c = (y && colunas.includes(y)) ? y : (colunas.find(k => num(r[k]) != null) || colunas[0]);
  return '<div class="kpi"><span class="kpi-v">' + esc(fmt(r[c])) + '</span><span class="kpi-l">' + esc(c) + '</span></div>';
}
function tabela(colunas, linhas){
  const head = colunas.map(c => '<th>' + esc(c) + '</th>').join('');
  const body = linhas.map(r => '<tr>' + colunas.map(c => '<td' + (num(r[c]) != null ? ' class="n"' : '') + '>' + esc(fmtCell(r[c])) + '</td>').join('') + '</tr>').join('');
  return '<div class="tbl"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}
function render(visual, colunas, linhas, opts){
  opts = opts || {};
  if(visual === 'numero') return numero(colunas, linhas, opts.y);
  if(visual === 'barra') return barra(linhas, opts.x, opts.y);
  if(visual === 'linha') return linha(linhas, opts.x, opts.y);
  if(visual === 'pizza') return pizza(linhas, opts.x, opts.y);
  return tabela(colunas, linhas);
}

const api = { num, fmt, labelsOf, render, esc };
if(typeof module !== 'undefined' && module.exports) module.exports = api; else root.CD2Chart = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/chart.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/chart.js tests/chart.test.js
git commit -m "Adiciona gráficos em SVG sem biblioteca (chart.js): barra, linha, pizza, número e tabela"
```

---

### Task 5: Peças puras do roteiro (`web/ask.js`, parte 1)

**Files:**
- Create: `web/ask.js`
- Test: `tests/ask.test.js`

**Interfaces:**
- Consumes: `CD2Chart.num`, `CD2Chart.fmt`, `CD2Chart.labelsOf` (Task 4).
- Produces (global `CD2Ask` / `module.exports`), usados pela Task 6 e pela Task 8:
  - `VISUALS: string[]`, `MENSAGENS: { sem_tabelas, sql, timeout, vazio, modelo }`
  - `parseRows(texto) => { ok:true, rows: object[] } | { ok:false, error: string }`
  - `parseModelJson(texto) => { sql, visual, x, y, titulo } | null`
  - `isTimeout(msg) => boolean`
  - `pickVisual(req, colunas, linhas) => { visual, x: string|null, y: string|null, linhas, aviso: string|null }`
  - `frase({ visual, x, y, linhas, todas }) => string`

- [ ] **Step 1: Escrever os testes**

`tests/ask.test.js`:
```js
'use strict';
// Testes do roteiro de relatórios (web/ask.js). Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../web/ask.js');

test('parseRows: array, objeto, uma linha por objeto, vazio, erro e lixo', () => {
  assert.deepEqual(A.parseRows('[{"a":1},{"a":2}]'), { ok:true, rows:[{ a:1 }, { a:2 }] });
  assert.deepEqual(A.parseRows('{"a":1}'), { ok:true, rows:[{ a:1 }] });
  assert.deepEqual(A.parseRows('{"a":1}\n{"a":2}'), { ok:true, rows:[{ a:1 }, { a:2 }] });
  assert.deepEqual(A.parseRows(''), { ok:true, rows:[] });
  assert.deepEqual(A.parseRows('null'), { ok:true, rows:[] });
  assert.deepEqual(A.parseRows('ERRO: boom'), { ok:false, error:'boom' });
  const r = A.parseRows('texto qualquer'); assert.equal(r.ok, false); assert.match(r.error, /inesperada/);
});

test('parseModelJson: JSON puro, com cerca de código, com raciocínio, e recusas', () => {
  const j = '{"sql":" SELECT 1 ","visual":"numero","x":"","y":"n","titulo":"Total"}';
  assert.deepEqual(A.parseModelJson(j), { sql:'SELECT 1', visual:'numero', x:'', y:'n', titulo:'Total' });
  assert.equal(A.parseModelJson('```json\n' + j + '\n```').sql, 'SELECT 1');
  assert.equal(A.parseModelJson('<think>hmm {x}</think>\n' + j).visual, 'numero');
  assert.deepEqual(A.parseModelJson('{"sql":"SELECT 1","visual":"barra"}'), { sql:'SELECT 1', visual:'barra', x:'', y:'', titulo:'' });
  assert.equal(A.parseModelJson('{"sql":"SELECT 1","visual":"radar"}'), null);
  assert.equal(A.parseModelJson('{"visual":"barra"}'), null);
  assert.equal(A.parseModelJson('não sei'), null);
  assert.equal(A.parseModelJson(undefined), null);
});

test('isTimeout reconhece as mensagens dos motores', () => {
  for(const m of ['ERROR: canceling statement due to statement timeout (SQLSTATE 57014)', 'context deadline exceeded',
    'Query execution was interrupted (max_statement_time exceeded)', 'Query execution was interrupted, maximum statement execution time exceeded',
    'ORA-01013: user requested cancel of current operation', 'tempo esgotado'])
    assert.equal(A.isTimeout(m), true, m);
  assert.equal(A.isTimeout('column "x" does not exist'), false);
  assert.equal(A.isTimeout(undefined), false);
});

const L = (n, f) => Array.from({ length:n }, (_, i) => f(i));

test('pickVisual: x ou y fora do resultado, ou y não numérico, vira tabela', () => {
  const linhas = [{ loja:'A', total:1 }, { loja:'B', total:2 }];
  assert.equal(A.pickVisual({ visual:'barra', x:'nada', y:'total' }, ['loja', 'total'], linhas).visual, 'tabela');
  assert.equal(A.pickVisual({ visual:'barra', x:'total', y:'loja' }, ['loja', 'total'], linhas).visual, 'tabela');
  assert.equal(A.pickVisual({ visual:'tabela', x:'loja', y:'total' }, ['loja', 'total'], linhas).visual, 'tabela');
});

test('pickVisual: casa x e y sem diferenciar caixa (Oracle devolve MES, TOTAL)', () => {
  const r = A.pickVisual({ visual:'linha', x:'mes', y:'total' }, ['MES', 'TOTAL'], [{ MES:'2026-01', TOTAL:'5' }, { MES:'2026-02', TOTAL:'7' }]);
  assert.deepEqual([r.visual, r.x, r.y], ['linha', 'MES', 'TOTAL']);
});

test('pickVisual: y numérico em texto é número', () => {
  const r = A.pickVisual({ visual:'barra', x:'d', y:'v' }, ['d', 'v'], [{ d:'A', v:'10.50' }, { d:'B', v:'20.25' }]);
  assert.equal(r.visual, 'barra'); assert.deepEqual(r.linhas.map(l => l.d), ['B', 'A']);
});

test('pickVisual: uma linha de uma coluna numérica vira número; número com várias linhas vira tabela', () => {
  assert.deepEqual(A.pickVisual({ visual:'barra', x:'', y:'' }, ['n'], [{ n:'42' }]).visual, 'numero');
  const r = A.pickVisual({ visual:'numero', x:'', y:'total' }, ['loja', 'total'], [{ loja:'A', total:3 }]);
  assert.deepEqual([r.visual, r.y], ['numero', 'total']);
  assert.equal(A.pickVisual({ visual:'numero', x:'', y:'n' }, ['n'], [{ n:1 }, { n:2 }]).visual, 'tabela');
});

test('pickVisual: pizza com mais de 6 fatias ou valor negativo vira barra', () => {
  assert.equal(A.pickVisual({ visual:'pizza', x:'d', y:'v' }, ['d', 'v'], L(7, i => ({ d:'d' + i, v:i + 1 }))).visual, 'barra');
  assert.equal(A.pickVisual({ visual:'pizza', x:'d', y:'v' }, ['d', 'v'], [{ d:'a', v:5 }, { d:'b', v:-1 }]).visual, 'barra');
  assert.equal(A.pickVisual({ visual:'pizza', x:'d', y:'v' }, ['d', 'v'], L(6, i => ({ d:'d' + i, v:i + 1 }))).visual, 'pizza');
});

test('pickVisual: linha sem eixo de tempo vira barra; com tempo, ordena pelo tempo', () => {
  assert.equal(A.pickVisual({ visual:'linha', x:'loja', y:'v' }, ['loja', 'v'], [{ loja:'A', v:1 }, { loja:'B', v:2 }]).visual, 'barra');
  const r = A.pickVisual({ visual:'linha', x:'mes', y:'v' }, ['mes', 'v'], [{ mes:'2026-03', v:1 }, { mes:'2026-01', v:2 }, { mes:'2026-02', v:3 }]);
  assert.equal(r.visual, 'linha'); assert.deepEqual(r.linhas.map(l => l.mes), ['2026-01', '2026-02', '2026-03']);
  const n = A.pickVisual({ visual:'linha', x:'mes', y:'v' }, ['mes', 'v'], [{ mes:3, v:1 }, { mes:1, v:2 }]);
  assert.equal(n.visual, 'linha'); assert.deepEqual(n.linhas.map(l => l.mes), [1, 3]);
});

test('pickVisual: barra com mais de 20 mostra as 20 maiores e avisa; barra no tempo fica em ordem de tempo', () => {
  const r = A.pickVisual({ visual:'barra', x:'d', y:'v' }, ['d', 'v'], L(25, i => ({ d:'d' + i, v:i })));
  assert.equal(r.linhas.length, 20); assert.equal(r.linhas[0].v, 24); assert.equal(r.aviso, 'Mostrando os 20 maiores de 25.');
  const t = A.pickVisual({ visual:'barra', x:'mes', y:'v' }, ['mes', 'v'], [{ mes:'2026-02', v:9 }, { mes:'2026-01', v:1 }]);
  assert.deepEqual(t.linhas.map(l => l.mes), ['2026-01', '2026-02']); assert.equal(t.aviso, null);
});

test('frase: número, barra, linha e tabela', () => {
  assert.equal(A.frase({ visual:'numero', y:'n', linhas:[{ n:'1234' }], todas:[{ n:'1234' }] }), 'Resultado: 1.234.');
  const b = [{ d:'B', v:30 }, { d:'A', v:20 }, { d:'C', v:10 }];
  assert.equal(A.frase({ visual:'barra', x:'d', y:'v', linhas:b, todas:b }), 'Maior: B, 30. Total: 60 em 3 categorias.');
  const l = [{ m:'2026-01-01', v:10 }, { m:'2026-02-01', v:30 }, { m:'2026-03-01', v:20 }];
  assert.equal(A.frase({ visual:'linha', x:'m', y:'v', linhas:l, todas:l }), 'De jan/2026 a mar/2026. Maior valor em fev/2026: 30.');
  assert.equal(A.frase({ visual:'tabela', linhas:L(12, () => ({})), todas:L(12, () => ({})) }), '12 linhas.');
  assert.equal(A.frase({ visual:'tabela', linhas:[{}], todas:[{}] }), '1 linha.');
});

test('frase: barra cortada em 20 soma todas as linhas', () => {
  const todas = L(25, i => ({ d:'d' + i, v:1 })), linhas = todas.slice(0, 20);
  assert.equal(A.frase({ visual:'barra', x:'d', y:'v', linhas, todas }), 'Maior: d0, 1. Total: 25 em 25 categorias.');
});

test('frase: sem Total para média, percentual ou taxa', () => {
  const b = [{ loja:'A', ticket_medio:'50.5' }, { loja:'B', ticket_medio:'40' }];
  assert.equal(A.frase({ visual:'barra', x:'loja', y:'ticket_medio', linhas:b, todas:b }), 'Maior: A, 50,5. 2 categorias.');
});

test('frase com nulo: rótulo (vazio) e valor tratado como zero', () => {
  const b = [{ d:null, v:'7' }, { d:'B', v:null }];
  assert.equal(A.frase({ visual:'barra', x:'d', y:'v', linhas:b, todas:b }), 'Maior: (vazio), 7. Total: 7 em 2 categorias.');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/ask.test.js`
Expected: FAIL (`Cannot find module '../web/ask.js'`).

- [ ] **Step 3: Implementar a parte pura de `web/ask.js`**

```js
/* Roteiro de relatórios do Harness Pocket (modo Banco de dados): pergunta -> tabelas candidatas
   -> uma chamada ao modelo pedindo JSON -> consulta no toolbox -> visual e frase de molde.
   O modelo nunca vê o resultado: todo número na tela vem do banco. Sem DOM. */
(function(root){
"use strict";
const isNode = typeof module !== 'undefined' && module.exports;
const Chart = isNode ? require('./chart.js') : root.CD2Chart;

const VISUALS = ['barra', 'linha', 'pizza', 'tabela', 'numero'];
const MENSAGENS = {
  sem_tabelas:'Não achei tabelas sobre isso neste banco.',
  sql:'Não consegui montar essa consulta.',
  timeout:'A consulta demorou demais e foi cancelada para proteger o banco.',
  vazio:'A consulta não trouxe nenhuma linha.',
  modelo:'O modelo não respondeu.'
};
// Textos de timeout por motor (PostgreSQL, MariaDB/MySQL, driver Go, Oracle) e o do próprio front.
const TIMEOUT_RE = /statement timeout|max_statement_time|maximum statement execution time|context deadline exceeded|query timeout|ORA-01013|tempo esgotado/i;
const MEDIA_RE = /medi[ao]|avg|average|ticket|percent|pct|taxa|margem|rate/i;
const TEMPO_NOME_RE = /^(mes|month|ano|year|dia|day|data|date|periodo|semana|week|trimestre)/i;
const TEMPO_VALOR_RE = /^\d{4}-\d{2}(-\d{2})?([ T].*)?$|^\d{1,2}\/\d{4}$|^(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*[\/ -]?\d{2,4}$/i;

function parseRows(text){
  const s = String(text == null ? '' : text);
  if(s.startsWith('ERRO: ')) return { ok:false, error:s.slice(6) || 'erro sem mensagem' };
  const t = s.trim();
  if(!t || t === 'null') return { ok:true, rows:[] };
  const obj = v => v && typeof v === 'object' && !Array.isArray(v);
  const bad = { ok:false, error:'Resposta inesperada do banco: ' + t.slice(0, 200) };
  try{
    const j = JSON.parse(t);
    if(Array.isArray(j)) return { ok:true, rows:j.filter(obj) };
    return obj(j) ? { ok:true, rows:[j] } : bad;
  }catch(e){}
  const rows = [];
  for(const line of t.split(/\r?\n/)){
    if(!line.trim()) continue;
    try{ const j = JSON.parse(line); if(!obj(j)) return bad; rows.push(j); }catch(e){ return bad; }
  }
  return { ok:true, rows };
}
function parseModelJson(text){
  let s = String(text == null ? '' : text);
  const k = s.lastIndexOf('</think>'); if(k >= 0) s = s.slice(k + 8);
  let o = null;
  try{ o = JSON.parse(s.trim()); }catch(e){
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if(a >= 0 && b > a){ try{ o = JSON.parse(s.slice(a, b + 1)); }catch(e2){ o = null; } }
  }
  if(!o || typeof o !== 'object' || typeof o.sql !== 'string' || !o.sql.trim() || !VISUALS.includes(o.visual)) return null;
  const str = v => typeof v === 'string' ? v.trim() : '';
  return { sql:o.sql.trim(), visual:o.visual, x:str(o.x), y:str(o.y), titulo:str(o.titulo) };
}
function isTimeout(msg){ return TIMEOUT_RE.test(String(msg == null ? '' : msg)); }

function findCol(colunas, name){ if(!name) return null; const n = name.toLowerCase(); return colunas.find(c => c.toLowerCase() === n) || null; }
function isNumCol(linhas, c){
  let any = false;
  for(const r of linhas){ const v = r[c]; if(v == null || v === '') continue; if(Chart.num(v) == null) return false; any = true; }
  return any;
}
function isTimeCol(linhas, c){
  const vs = linhas.map(r => r[c]).filter(v => v != null && v !== '');
  if(!vs.length) return false;
  if(vs.every(v => TEMPO_VALOR_RE.test(String(v)))) return true;
  return TEMPO_NOME_RE.test(c) && vs.every(v => Chart.num(v) != null);
}
function byTime(linhas, x){
  const out = linhas.slice();
  if(out.every(r => Chart.num(r[x]) != null)) return out.sort((a, b) => Chart.num(a[x]) - Chart.num(b[x]));
  if(out.every(r => /^\d{4}-\d{2}/.test(String(r[x])))) return out.sort((a, b) => String(a[x]).localeCompare(String(b[x])));
  return out;
}
// O pedido do modelo é ajustado pelo dado que voltou (regras da seção 3, passo 5, da spec).
function pickVisual(req, colunas, linhas){
  const tabela = () => ({ visual:'tabela', x:null, y:null, linhas, aviso:null });
  const x = findCol(colunas, req.x), y = findCol(colunas, req.y);
  const numCols = colunas.filter(c => isNumCol(linhas, c));
  if(linhas.length === 1 && colunas.length === 1 && numCols.length === 1) return { visual:'numero', x:null, y:numCols[0], linhas, aviso:null };
  let v = req.visual;
  if(v === 'numero') return (linhas.length === 1 && numCols.length) ? { visual:'numero', x:null, y:(y && numCols.includes(y)) ? y : numCols[0], linhas, aviso:null } : tabela();
  if(v === 'tabela' || !x || !y || !numCols.includes(y)) return tabela();
  if(v === 'pizza' && (linhas.length > 6 || linhas.some(r => (Chart.num(r[y]) || 0) < 0))) v = 'barra';
  const tempo = isTimeCol(linhas, x);
  if(v === 'linha' && !tempo) v = 'barra';
  let out = (v === 'linha' || (v === 'barra' && tempo)) ? byTime(linhas, x)
    : linhas.slice().sort((a, b) => (Chart.num(b[y]) || 0) - (Chart.num(a[y]) || 0));
  let aviso = null;
  if(v === 'barra' && out.length > 20){ aviso = 'Mostrando os 20 maiores de ' + out.length + '.'; out = byValue(out, y).slice(0, 20); if(tempo) out = byTime(out, x); }
  return { visual:v, x, y, linhas:out, aviso };
}
function byValue(linhas, y){ return linhas.slice().sort((a, b) => (Chart.num(b[y]) || 0) - (Chart.num(a[y]) || 0)); }
// Frase de molde: montada daqui, nunca pelo modelo.
function frase(r){
  const L = r.linhas || [], T = r.todas || L;
  if(r.visual === 'numero') return 'Resultado: ' + Chart.fmt(L[0] && L[0][r.y]) + '.';
  if(r.visual === 'tabela') return T.length === 1 ? '1 linha.' : T.length + ' linhas.';
  const vals = L.map(l => Chart.num(l[r.y]) || 0), labs = Chart.labelsOf(L.map(l => l[r.x]));
  let iMax = 0; vals.forEach((v, i) => { if(v > vals[iMax]) iMax = i; });
  if(r.visual === 'linha') return 'De ' + labs[0] + ' a ' + labs[labs.length - 1] + '. Maior valor em ' + labs[iMax] + ': ' + Chart.fmt(vals[iMax]) + '.';
  const n = T.length + (T.length === 1 ? ' categoria.' : ' categorias.');
  const maior = 'Maior: ' + labs[iMax] + ', ' + Chart.fmt(vals[iMax]) + '. ';
  if(MEDIA_RE.test(r.y)) return maior + n;
  const tot = T.reduce((a, l) => a + (Chart.num(l[r.y]) || 0), 0);
  return maior + 'Total: ' + Chart.fmt(tot) + ' em ' + n;
}

const api = { VISUALS, MENSAGENS, parseRows, parseModelJson, isTimeout, pickVisual, frase };
if(isNode) module.exports = api; else root.CD2Ask = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

Se a Task 1 registrou uma mensagem de timeout que o `TIMEOUT_RE` não reconhece, acrescente o trecho dela ao `TIMEOUT_RE` e ao teste `isTimeout reconhece as mensagens dos motores`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/ask.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/ask.js tests/ask.test.js
git commit -m "Roteiro de relatórios (ask.js): leitura do resultado, JSON do modelo, escolha do visual e frase de molde"
```

---

### Task 6: O roteiro completo (`web/ask.js`, parte 2)

**Files:**
- Modify: `web/ask.js`
- Test: `tests/ask.test.js`

**Interfaces:**
- Consumes: `CD2Catalog.rankTables` (Task 3), `CD2Toolbox.guardSql` e `CD2Toolbox.prepareSql` (Task 2), as peças da Task 5.
- Produces (acrescentados a `CD2Ask`), usados pela Task 8 e pela Task 10:
  - `SCHEMA` (JSON Schema da resposta do modelo)
  - `buildMessages({ pergunta, tabelas, motor, versao, anterior }) => { role, content }[]`
  - `ask({ pergunta, catalog, motor, versao, callModel, runSql, signal }) => Promise<Resultado>` com
    `Resultado = { ok:true, visual, x, y, titulo, frase, colunas, linhas, todas, sql, aviso? } | { ok:false, motivo:'sem_tabelas'|'sql'|'timeout'|'vazio'|'modelo', sql? }`;
    `callModel(messages, signal) => Promise<string>`; `runSql(sql, signal) => Promise<{ ok:true, rows } | { ok:false, error, timeout? }>`
  - `modelCaller({ fetch, url, useSchema }) => callModel`
  - `toolRunner(client: { call(name, args) => Promise<string> }, { timeoutMs }) => runSql`

- [ ] **Step 1: Escrever os testes**

Acrescente ao fim de `tests/ask.test.js`:
```js
const Cat = require('../web/catalog.js');
const CAT2 = Cat.buildCatalog([
  { table_name:'venda', table_type:'TABLE', num_rows:100, column_name:'dt_venda', data_type:'date', ordinal:1 },
  { table_name:'venda', table_type:'TABLE', num_rows:100, column_name:'valor', data_type:'numeric', ordinal:2 },
  { table_name:'venda', table_type:'TABLE', num_rows:100, column_name:'loja', data_type:'varchar(20)', ordinal:3 },
  { table_name:'config', table_type:'TABLE', num_rows:5, column_name:'chave', data_type:'text', ordinal:1 }
]);
function fila(respostas){
  const calls = [];
  const fn = async (...args) => { calls.push(args); const r = respostas.shift(); if(r instanceof Error) throw r; return r; };
  fn.calls = calls; return fn;
}
const J = o => JSON.stringify(o);
const BARRA = J({ sql:'SELECT loja, SUM(valor) AS total FROM venda GROUP BY loja', visual:'barra', x:'loja', y:'total', titulo:'Vendas por loja' });
const LINHAS = [{ loja:'A', total:'10' }, { loja:'B', total:'30' }];
const base = o => Object.assign({ pergunta:'vendas por loja', catalog:CAT2, motor:'postgres', versao:'PostgreSQL 16' }, o);

test('ask: caminho feliz com uma chamada ao modelo', async () => {
  const callModel = fila([BARRA]), runSql = fila([{ ok:true, rows:LINHAS }]);
  const r = await A.ask(base({ callModel, runSql }));
  assert.equal(r.ok, true); assert.equal(r.visual, 'barra'); assert.equal(r.titulo, 'Vendas por loja');
  assert.equal(r.frase, 'Maior: B, 30. Total: 40 em 2 categorias.');
  assert.deepEqual(r.colunas, ['loja', 'total']); assert.equal(r.todas.length, 2);
  assert.equal(callModel.calls.length, 1); assert.equal(runSql.calls[0][0], 'SELECT loja, SUM(valor) AS total FROM venda GROUP BY loja');
  const prompt = callModel.calls[0][0].map(m => m.content).join('\n');
  assert.match(prompt, /venda/); assert.doesNotMatch(prompt, /config/);
});

test('ask: sem tabelas não chama o modelo', async () => {
  const callModel = fila([]);
  assert.deepEqual(await A.ask(base({ pergunta:'funcionários admitidos', callModel, runSql:fila([]) })), { ok:false, motivo:'sem_tabelas' });
  assert.equal(callModel.calls.length, 0);
});

test('ask: JSON inválido usa a nova tentativa; duas vezes inválido é motivo modelo', async () => {
  const callModel = fila(['não sei', BARRA]);
  const r = await A.ask(base({ callModel, runSql:fila([{ ok:true, rows:LINHAS }]) }));
  assert.equal(r.ok, true); assert.equal(callModel.calls.length, 2);
  assert.match(callModel.calls[1][0][1].content, /tentativa anterior falhou/);
  assert.deepEqual(await A.ask(base({ callModel:fila(['x', 'y']), runSql:fila([]) })), { ok:false, motivo:'modelo' });
});

test('ask: erro de SQL volta ao modelo com o erro; segundo erro é motivo sql', async () => {
  const callModel = fila([BARRA, BARRA]);
  const r = await A.ask(base({ callModel, runSql:fila([{ ok:false, error:'column "lojaa" does not exist' }, { ok:true, rows:LINHAS }]) }));
  assert.equal(r.ok, true);
  assert.match(callModel.calls[1][0][1].content, /column "lojaa" does not exist/);
  assert.match(callModel.calls[1][0][1].content, /SUM\(valor\)/);
  const r2 = await A.ask(base({ callModel:fila([BARRA, BARRA]), runSql:fila([{ ok:false, error:'e1' }, { ok:false, error:'e2' }]) }));
  assert.deepEqual(r2, { ok:false, motivo:'sql', sql:'SELECT loja, SUM(valor) AS total FROM venda GROUP BY loja' });
});

test('ask: SQL recusado pela guarda conta como erro de SQL e não vai ao banco', async () => {
  const runSql = fila([{ ok:true, rows:LINHAS }]);
  const r = await A.ask(base({ callModel:fila([J({ sql:'DELETE FROM venda', visual:'tabela' }), BARRA]), runSql }));
  assert.equal(r.ok, true); assert.equal(runSql.calls.length, 1);
});

test('ask: timeout não tenta de novo; vazio é motivo vazio', async () => {
  const callModel = fila([BARRA]);
  assert.deepEqual(await A.ask(base({ callModel, runSql:fila([{ ok:false, timeout:true, error:'tempo esgotado' }]) })),
    { ok:false, motivo:'timeout', sql:'SELECT loja, SUM(valor) AS total FROM venda GROUP BY loja' });
  assert.equal(callModel.calls.length, 1);
  assert.equal((await A.ask(base({ callModel:fila([BARRA]), runSql:fila([{ ok:true, rows:[] }]) }))).motivo, 'vazio');
});

test('ask: modelo fora do ar é motivo modelo; Parar propaga o AbortError', async () => {
  assert.deepEqual(await A.ask(base({ callModel:fila([new Error('HTTP 500')]), runSql:fila([]) })), { ok:false, motivo:'modelo' });
  const ab = new Error('parou'); ab.name = 'AbortError';
  await assert.rejects(A.ask(base({ callModel:fila([ab]), runSql:fila([]) })), { name:'AbortError' });
});

test('ask: no SQL Server o ORDER BY sem TOP ganha OFFSET 0 ROWS', async () => {
  const runSql = fila([{ ok:true, rows:LINHAS }]);
  await A.ask(base({ motor:'sqlserver', callModel:fila([J({ sql:'SELECT loja, SUM(valor) AS total FROM venda GROUP BY loja ORDER BY total DESC', visual:'barra', x:'loja', y:'total', titulo:'t' })]), runSql }));
  assert.match(runSql.calls[0][0], /OFFSET 0 ROWS$/);
});

test('buildMessages: dialeto e exemplos por motor, tabelas listadas, tentativa anterior', () => {
  const tabelas = Cat.rankTables(CAT2, 'vendas');
  const sys = m => A.buildMessages({ pergunta:'p', tabelas, motor:m })[0].content;
  assert.match(sys('postgres'), /LIMIT 10/); assert.match(sys('sqlserver'), /TOP \(10\)/); assert.match(sys('oracle'), /FETCH FIRST 10 ROWS ONLY/);
  assert.match(sys('mariadb'), /DATE_FORMAT/); assert.match(sys('postgres'), /venda \(cerca de 100 linhas\): dt_venda date, valor numeric, loja varchar\(20\)/);
  const u = A.buildMessages({ pergunta:'p', tabelas, motor:'postgres', anterior:{ sql:'SELECT x', erro:'boom' } })[1].content;
  assert.match(u, /SQL anterior: SELECT x/); assert.match(u, /Erro: boom/);
});

test('modelCaller: temperatura zero, schema opcional, conteúdo da resposta e erro HTTP', async () => {
  let pedido;
  const ok = async (url, init) => { pedido = { url, init }; return { ok:true, status:200, json:async () => ({ choices:[{ message:{ content:'{"a":1}' } }] }) }; };
  const c = A.modelCaller({ fetch:ok, url:'/v1/chat/completions', useSchema:true });
  assert.equal(await c([{ role:'user', content:'oi' }]), '{"a":1}');
  const body = JSON.parse(pedido.init.body);
  assert.equal(pedido.url, '/v1/chat/completions'); assert.equal(body.temperature, 0); assert.equal(body.stream, false);
  assert.equal(body.response_format.type, 'json_schema'); assert.deepEqual(body.response_format.json_schema.schema, A.SCHEMA);
  await A.modelCaller({ fetch:ok, url:'/x', useSchema:false })([]);
  assert.equal(JSON.parse(pedido.init.body).response_format, undefined);
  const falha = A.modelCaller({ fetch:async () => ({ ok:false, status:500, json:async () => ({}) }), url:'/x' });
  await assert.rejects(falha([]), /HTTP 500/);
});

test('toolRunner: linhas, erro de timeout do banco e prazo do front', async () => {
  const cli = t => ({ call:async (name, args) => { assert.equal(name, 'db_read_only_query'); assert.equal(args.sql, 'SELECT 1'); return t; } });
  assert.deepEqual(await A.toolRunner(cli('[{"n":1}]'), { timeoutMs:1000 })('SELECT 1'), { ok:true, rows:[{ n:1 }] });
  const t = await A.toolRunner(cli('ERRO: canceling statement due to statement timeout'), { timeoutMs:1000 })('SELECT 1');
  assert.equal(t.ok, false); assert.equal(t.timeout, true);
  const lento = await A.toolRunner({ call:() => new Promise(() => {}) }, { timeoutMs:20 })('SELECT 1');
  assert.equal(lento.timeout, true);
  const caiu = await A.toolRunner({ call:async () => { throw new Error('MCP respondeu HTTP 502'); } }, { timeoutMs:1000 })('SELECT 1');
  assert.deepEqual(caiu, { ok:false, error:'MCP respondeu HTTP 502' });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/ask.test.js`
Expected: FAIL (`A.ask is not a function` e afins).

- [ ] **Step 3: Implementar**

Em `web/ask.js`, logo depois da linha `const Chart = ...`, acrescente:
```js
const Cat = isNode ? require('./catalog.js') : root.CD2Catalog;
const Tb = isNode ? require('./toolbox.js') : root.CD2Toolbox;
```

Antes de `const api = ...`, acrescente:
```js
const SCHEMA = { type:'object', properties:{ sql:{ type:'string' }, visual:{ type:'string', enum:VISUALS }, x:{ type:'string' }, y:{ type:'string' }, titulo:{ type:'string' } }, required:['sql', 'visual', 'titulo'] };
const DIALETO = {
  postgres:  { nome:'PostgreSQL', mes:c => "to_char(" + c + ", 'YYYY-MM')", top:(s, o) => s + ' ' + o + ' LIMIT 10' },
  mariadb:   { nome:'MariaDB/MySQL (crases em nomes reservados)', mes:c => "DATE_FORMAT(" + c + ", '%Y-%m')", top:(s, o) => s + ' ' + o + ' LIMIT 10' },
  sqlserver: { nome:'SQL Server (TOP em vez de LIMIT)', mes:c => "FORMAT(" + c + ", 'yyyy-MM')", top:(s, o) => s.replace(/^SELECT /, 'SELECT TOP (10) ') + ' ' + o },
  oracle:    { nome:'Oracle (sem LIMIT; nomes sem aspas)', mes:c => "TO_CHAR(" + c + ", 'YYYY-MM')", top:(s, o) => s + ' ' + o + ' FETCH FIRST 10 ROWS ONLY' }
};
function exemplos(motor){
  const d = DIALETO[motor] || DIALETO.postgres, m = d.mes('data_venda');
  return [
    'Pergunta: quantos pedidos existem? -> ' + JSON.stringify({ sql:'SELECT COUNT(*) AS pedidos FROM pedido', visual:'numero', x:'', y:'pedidos', titulo:'Total de pedidos' }),
    'Pergunta: total vendido por mês -> ' + JSON.stringify({ sql:'SELECT ' + m + ' AS mes, SUM(valor) AS total FROM venda GROUP BY ' + m + ' ORDER BY mes', visual:'linha', x:'mes', y:'total', titulo:'Vendas por mês' }),
    'Pergunta: 10 clientes que mais compraram -> ' + JSON.stringify({ sql:d.top('SELECT c.nome AS cliente, SUM(p.valor) AS total FROM pedido p JOIN cliente c ON c.id = p.cliente_id GROUP BY c.nome', 'ORDER BY total DESC'), visual:'barra', x:'cliente', y:'total', titulo:'Clientes que mais compraram' })
  ].join('\n');
}
function buildMessages(o){
  const d = DIALETO[o.motor] || DIALETO.postgres;
  const tabs = o.tabelas.map(t => '- ' + t.name + ' (' + (t.type === 'VIEW' ? 'view, ' : '') + 'cerca de ' + t.rows + ' linhas): '
    + t.columns.map(c => c.name + ' ' + c.type).join(', ')).join('\n');
  const sys = [
    'Você transforma uma pergunta em uma consulta SQL de leitura e diz como mostrar o resultado.',
    'Banco: ' + d.nome + (o.versao ? '. Versão: ' + o.versao : '') + '.',
    'Tabelas disponíveis (use só estas tabelas e colunas, com os nomes exatamente como estão):',
    tabs,
    'Regras:',
    '- Um único SELECT (ou WITH), sem ponto e vírgula.',
    '- Agregue no banco com GROUP BY e devolva no máximo 50 linhas.',
    '- Dê a cada coluna do resultado um alias curto em português, sem espaço nem acento (ex.: total, mes, loja).',
    '- visual: numero (um valor só), barra (comparar categorias), linha (evolução no tempo), pizza (até 6 partes de um todo), tabela (lista).',
    '- x é o alias da coluna de categoria ou de tempo; y é o alias da coluna numérica. Em numero e tabela, x pode ficar vazio.',
    '- titulo: curto, em português, sem números.',
    'Responda só com um objeto JSON no formato {"sql": "...", "visual": "...", "x": "...", "y": "...", "titulo": "..."}.',
    'Exemplos:',
    exemplos(o.motor)
  ].join('\n');
  let user = 'Pergunta: ' + o.pergunta;
  if(o.anterior) user += '\n\nA tentativa anterior falhou.\nSQL anterior: ' + (o.anterior.sql || '(nenhum)') + '\nErro: ' + o.anterior.erro + '\nCorrija e responda de novo só com o JSON.';
  return [{ role:'system', content:sys }, { role:'user', content:user }];
}

async function ask(o){
  const tabelas = Cat.rankTables(o.catalog, o.pergunta);
  if(!tabelas.length) return { ok:false, motivo:'sem_tabelas' };
  let anterior = null, falha = 'modelo', ultimoSql = '';
  for(let tentativa = 0; tentativa < 2; tentativa++){
    let texto;
    try{ texto = await o.callModel(buildMessages({ pergunta:o.pergunta, tabelas, motor:o.motor, versao:o.versao, anterior }), o.signal); }
    catch(e){ if(e && e.name === 'AbortError') throw e; return { ok:false, motivo:'modelo' }; }
    const req = parseModelJson(texto);
    if(!req){ falha = 'modelo'; anterior = { sql:'', erro:'A resposta não era o objeto JSON pedido, com sql e um visual da lista.' }; continue; }
    const g = Tb.guardSql(req.sql);
    if(!g.ok){ falha = 'sql'; ultimoSql = req.sql; anterior = { sql:req.sql, erro:g.error }; continue; }
    const sql = Tb.prepareSql(g.sql, o.motor);
    ultimoSql = sql;
    const r = await o.runSql(sql, o.signal);
    if(!r.ok){
      if(r.timeout) return { ok:false, motivo:'timeout', sql };
      falha = 'sql'; anterior = { sql, erro:r.error }; continue;
    }
    if(!r.rows.length) return { ok:false, motivo:'vazio', sql };
    const colunas = Object.keys(r.rows[0]);
    const v = pickVisual(req, colunas, r.rows);
    const out = { ok:true, visual:v.visual, x:v.x, y:v.y, titulo:req.titulo || o.pergunta,
      frase:frase({ visual:v.visual, x:v.x, y:v.y, linhas:v.linhas, todas:r.rows }), colunas, linhas:v.linhas, todas:r.rows, sql };
    if(v.aviso) out.aviso = v.aviso;
    return out;
  }
  return falha === 'sql' ? { ok:false, motivo:'sql', sql:ultimoSql } : { ok:false, motivo:'modelo' };
}

function modelCaller(o){
  return async function(messages, signal){
    const body = { model:'cd2', messages, stream:false, temperature:0, max_tokens:512 };
    if(o.useSchema) body.response_format = { type:'json_schema', json_schema:{ name:'consulta', strict:true, schema:SCHEMA } };
    const r = await o.fetch(o.url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body), signal });
    if(!r.ok) throw new Error('Modelo respondeu HTTP ' + r.status);
    const j = await r.json();
    const m = j && j.choices && j.choices[0] && j.choices[0].message;
    return (m && m.content) || '';
  };
}
// Prazo do front: vale para todo motor, inclusive os que não cortam a consulta no servidor.
function toolRunner(client, o){
  const ms = (o && o.timeoutMs) || 15000;
  return async function(sql){
    let timer;
    const prazo = new Promise(res => { timer = setTimeout(() => res({ ok:false, timeout:true, error:'tempo esgotado' }), ms); });
    try{
      const r = await Promise.race([
        Promise.resolve().then(() => client.call('db_read_only_query', { sql })).then(parseRows, e => ({ ok:false, error:String((e && e.message) || e) })),
        prazo
      ]);
      if(!r.ok && !r.timeout && isTimeout(r.error)) r.timeout = true;
      return r;
    }finally{ clearTimeout(timer); }
  };
}
```

Troque a linha `const api = ...` por:
```js
const api = { VISUALS, MENSAGENS, SCHEMA, parseRows, parseModelJson, isTimeout, pickVisual, frase, buildMessages, ask, modelCaller, toolRunner };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: PASS em todos os arquivos.

- [ ] **Step 5: Commit**

```bash
git add web/ask.js tests/ask.test.js
git commit -m "Roteiro de relatórios completo: prompt por dialeto, uma nova tentativa, chamada ao modelo e prazo de 15 s"
```

---

### Task 7: CSV e HTML do relatório impresso (`web/report.js`)

**Files:**
- Create: `web/report.js`
- Test: `tests/report.test.js`

**Interfaces:**
- Produces (global `CD2Report` / `module.exports`), usados pela Task 8:
  - `toCsv(colunas: string[], linhas: object[]) => string` (BOM UTF-8, `;`, CRLF, decimal com vírgula, fórmulas neutralizadas)
  - `fileName(d: Date) => string` (`cd2-relatorio-AAAAMMDD-HHMM.csv`)
  - `printHtml({ pergunta, titulo, frase, aviso?, visualHtml, tabelaHtml, sql, quando, motor, base, contato, logoSvg }) => string` (texto escapado; `visualHtml`, `tabelaHtml` e `logoSvg` entram como HTML confiável, gerados por `chart.js` e pela própria página)

- [ ] **Step 1: Escrever os testes**

`tests/report.test.js`:
```js
'use strict';
// Testes do CSV e do relatório impresso (web/report.js). Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../web/report.js');

test('toCsv: BOM, ponto e vírgula, CRLF, aspas e decimal com vírgula', () => {
  const s = R.toCsv(['loja', 'total', 'obs'], [{ loja:'A;B', total:'12.5', obs:'diz "oi"' }, { loja:'C', total:3, obs:null }]);
  assert.ok(s.startsWith('﻿'));
  assert.equal(s.slice(1), 'loja;total;obs\r\n"A;B";12,5;"diz ""oi"""\r\nC;3;\r\n');
});

test('toCsv neutraliza fórmula do Excel e preserva número negativo e código', () => {
  const s = R.toCsv(['a'], [{ a:'=HYPERLINK("x")' }, { a:'+1' }, { a:'@SUM' }, { a:'-texto' }, { a:'-5' }, { a:-2.5 }, { a:'0012345' }]);
  assert.deepEqual(s.slice(1).split('\r\n').slice(1, 8), ['"\'=HYPERLINK(""x"")"', "'+1", "'@SUM", "'-texto", '-5', '-2,5', '0012345']);
});

test('fileName com data e hora', () => {
  assert.equal(R.fileName(new Date(2026, 9, 13, 9, 5)), 'cd2-relatorio-20261013-0905.csv');
});

test('printHtml escapa o texto, mantém o HTML do gráfico e mostra o contato', () => {
  const h = R.printHtml({ pergunta:'<script>x</script>', titulo:'Vendas & cia', frase:'Maior: A.', aviso:'Mostrando 20.', visualHtml:'<svg class="chart"></svg>',
    tabelaHtml:'<div class="tbl"></div>', sql:'SELECT a < b', quando:'13/10/2026 09:05', motor:'PostgreSQL', base:'erp', contato:'cd2.com.br · (11) 0000-0000', logoSvg:'<svg class="logo"></svg>' });
  assert.ok(!h.includes('<script>')); assert.ok(h.includes('&lt;script&gt;')); assert.ok(h.includes('Vendas &amp; cia'));
  assert.ok(h.includes('<svg class="chart"></svg>')); assert.ok(h.includes('SELECT a &lt; b'));
  assert.ok(h.includes('cd2.com.br · (11) 0000-0000')); assert.ok(h.includes('Mostrando 20.'));
  assert.ok(h.includes('PostgreSQL')); assert.ok(h.includes('erp'));
  const sem = R.printHtml({ pergunta:'p', titulo:'t', frase:'f', visualHtml:'', tabelaHtml:'', sql:'s', quando:'q', motor:'m', base:'', contato:'', logoSvg:'' });
  assert.ok(sem.includes('CD2 Tech</footer>') || /CD2 Tech\s*<\/span>\s*<\/footer>/.test(sem));
  assert.ok(!sem.includes('undefined'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/report.test.js`
Expected: FAIL (`Cannot find module '../web/report.js'`).

- [ ] **Step 3: Implementar `web/report.js`**

```js
/* Saídas do roteiro de relatórios: CSV para o Excel em pt-BR e o HTML do relatório impresso
   (Imprimir/PDF do navegador), com logo e contato da CD2 no rodapé. Nada vai para o pen drive. */
(function(root){
"use strict";
function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
// Decimal com vírgula para o Excel em português; texto que começa como fórmula ganha apóstrofo.
function cell(v){
  if(v == null) return '';
  let s;
  if(typeof v === 'number') s = String(v).replace('.', ',');
  else if(/^\s*-?\d+\.\d+\s*$/.test(String(v))) s = String(v).trim().replace('.', ',');
  else s = String(v);
  if(/^[=+@]/.test(s) || /^-(?!\d)/.test(s)) s = "'" + s;
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(colunas, linhas){
  const out = [colunas.map(cell).join(';')];
  for(const r of linhas) out.push(colunas.map(c => cell(r[c])).join(';'));
  return '﻿' + out.join('\r\n') + '\r\n';
}
function fileName(d){
  const p = n => String(n).padStart(2, '0');
  return 'cd2-relatorio-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.csv';
}
function printHtml(o){
  return '<div class="pr">'
    + '<header class="pr-head">' + (o.logoSvg || '') + '<span>Relatório gerado pelo Harness Pocket</span></header>'
    + '<p class="pr-q">Pergunta: ' + esc(o.pergunta) + '</p>'
    + '<h1>' + esc(o.titulo) + '</h1><p>' + esc(o.frase) + '</p>'
    + (o.aviso ? '<p>' + esc(o.aviso) + '</p>' : '')
    + '<div class="pr-viz">' + (o.visualHtml || '') + '</div>'
    + '<h2>Dados</h2>' + (o.tabelaHtml || '')
    + '<h2>Consulta usada</h2><pre>' + esc(o.sql) + '</pre>'
    + '<p class="pr-meta">' + esc(o.quando) + ' · ' + esc(o.motor) + (o.base ? ' · base ' + esc(o.base) : '') + '</p>'
    + '<footer class="pr-foot">' + (o.logoSvg || '') + '<span>CD2 Tech' + (o.contato ? ' · ' + esc(o.contato) : '') + '</span></footer>'
    + '</div>';
}

const api = { toCsv, fileName, printHtml };
if(typeof module !== 'undefined' && module.exports) module.exports = api; else root.CD2Report = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/report.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/report.js tests/report.test.js
git commit -m "Adiciona CSV para Excel e HTML do relatório impresso com o contato da CD2 (report.js)"
```

---

### Task 8: Ligar o roteiro na tela (`web/index.html`, `web/config.json`)

**Files:**
- Modify: `web/index.html`
- Modify: `web/config.json`

**Interfaces:**
- Consumes: `CD2Catalog.buildCatalog`, `CD2Catalog.suggest`, `CD2Ask.parseRows`, `CD2Ask.ask`, `CD2Ask.modelCaller`, `CD2Ask.toolRunner`, `CD2Ask.MENSAGENS`, `CD2Chart.render`, `CD2Report.toCsv`, `CD2Report.fileName`, `CD2Report.printHtml`, `CD2Toolbox.engineLabel`; `USE_SCHEMA` da Task 1.
- Produces: comportamento na tela (sem API nova).

- [ ] **Step 1: Carregar os módulos**

Em `web/index.html`, troque:
```html
<script src="toolbox.js"></script>
```
por:
```html
<script src="toolbox.js"></script>
<script src="chart.js"></script>
<script src="catalog.js"></script>
<script src="ask.js"></script>
<script src="report.js"></script>
```
E logo antes de `<script src="mcp.js"></script>`, acrescente a área de impressão (filha direta do `body`):
```html
<div id="printArea" aria-hidden="true"></div>
```

- [ ] **Step 2: Estado e constante**

Troque:
```js
const st = { cfg:{}, messages:[], provider:null, tools:[], busy:false, ctl:null, dbStatus:null };
```
por:
```js
const st = { cfg:{}, messages:[], provider:null, tools:[], busy:false, ctl:null, dbStatus:null,
  catalog:null, catalogPromise:null, catalogGen:0, suggestions:null };
```
E troque `const MAX_TOOL_CHARS = 4000, MAX_STEPS = 6;` por:
```js
const MAX_TOOL_CHARS = 4000, MAX_STEPS = 6;
// Task 1 do plano de relatórios: o llamafile embarcado aceita (true) ou não (false) response_format com json_schema.
const USE_SCHEMA = true;
```
(Use o valor registrado em "Resultados da Task 1".)

- [ ] **Step 3: Ler o mapa do banco ao conectar**

Em `connectTools`, troque a linha `  setPill('#pMcp', '', 'ferramentas…');` por:
```js
  st.catalog = null; st.suggestions = null; st.catalogPromise = null; st.catalogGen++;
  setPill('#pMcp', '', 'ferramentas…');
```
E troque `      setPill('#pMcp', 'ok', eng + ': ' + st.tools.length + ' ferramentas');` por:
```js
      setPill('#pMcp', 'ok', eng + ': ' + st.tools.length + ' ferramentas');
      st.catalogPromise = loadCatalog(c, st.catalogGen);
```

- [ ] **Step 4: Funções do roteiro na tela**

Logo antes de `function addNote(t, err){`, acrescente:
```js
/* ---------- roteiro de relatórios (modo Banco de dados) ---------- */
// O mapa do banco é lido uma vez por conexão. Sem ele, a pergunta segue pelo laço de agente.
async function loadCatalog(client, gen){
  let cat = null, sug = null;
  try{
    const r = CD2Ask.parseRows(await client.call('db_catalog', {}));
    if(r.ok && r.rows.length){ cat = CD2Catalog.buildCatalog(r.rows); sug = CD2Catalog.suggest(cat); }
  }catch(e){}
  if(gen !== st.catalogGen) return;
  st.catalog = cat; st.suggestions = sug;
  if($('#hero')) renderHero();
}
async function runAsk(pergunta){
  st.busy = true; st.ctl = new AbortController(); toggleBusy();
  const el = addMsg('assistant'), body = document.createElement('div'); body.className = 'body';
  body.innerHTML = '<span class="spin"></span> Lendo o mapa do banco…'; el.appendChild(body); scrollDown();
  let fallback = false;
  try{
    await st.catalogPromise;
    if(!st.catalog){ el.remove(); fallback = true; return; }
    body.innerHTML = '<span class="spin"></span> Montando a consulta…';
    const s = st.dbStatus || {};
    const r = await CD2Ask.ask({ pergunta, catalog:st.catalog, motor:s.engine || 'postgres', versao:String(s.db_version || '').split('\n')[0].trim(),
      callModel:CD2Ask.modelCaller({ fetch:(...a) => fetch(...a), url:'/v1/chat/completions', useSchema:USE_SCHEMA }),
      runSql:CD2Ask.toolRunner(st.provider, { timeoutMs:15000 }), signal:st.ctl.signal });
    renderAnswer(body, pergunta, r);
  }catch(e){
    el.remove();
    if(e.name !== 'AbortError') addNote('Erro: ' + (e.message || e), true); else addNote('Interrompido.');
  }finally{
    st.busy = false; st.ctl = null; toggleBusy();
    if(fallback){ st.messages.push({ role:'user', content:pergunta }); runTurn(); }
  }
}
function sqlBox(sql){
  const d = document.createElement('details'); d.className = 'tool';
  d.innerHTML = '<summary>Consulta usada</summary><div class="inner"></div>';
  d.querySelector('.inner').textContent = sql; return d;
}
function suggestionChips(){
  const c = document.createElement('div'); c.className = 'chips';
  for(const s of st.suggestions || []){ const b = document.createElement('button'); b.className = 'chip'; b.textContent = s; b.onclick = () => send(s); c.appendChild(b); }
  return c;
}
function renderAnswer(body, pergunta, r){
  body.innerHTML = '';
  if(!r.ok){
    const p = document.createElement('p'); p.textContent = CD2Ask.MENSAGENS[r.motivo] || CD2Ask.MENSAGENS.modelo; body.appendChild(p);
    if(r.sql) body.appendChild(sqlBox(r.sql));
    if(st.suggestions && st.suggestions.length) body.appendChild(suggestionChips());
    scrollDown(); return;
  }
  const card = document.createElement('div'); card.className = 'answer';
  const h = document.createElement('h3'); h.textContent = r.titulo; card.appendChild(h);
  const f = document.createElement('p'); f.className = 'frase'; f.textContent = r.frase; card.appendChild(f);
  const viz = document.createElement('div'); viz.className = 'viz';
  viz.innerHTML = CD2Chart.render(r.visual, r.colunas, r.linhas, { x:r.x, y:r.y }); card.appendChild(viz);
  if(r.aviso){ const a = document.createElement('p'); a.className = 'hint'; a.textContent = r.aviso; card.appendChild(a); }
  card.appendChild(sqlBox(r.sql));
  const acts = document.createElement('div'); acts.className = 'acts';
  const bCsv = document.createElement('button'); bCsv.className = 'sm'; bCsv.textContent = 'CSV'; bCsv.onclick = () => downloadCsv(r);
  const bPdf = document.createElement('button'); bPdf.className = 'sm primary'; bPdf.textContent = 'Imprimir/PDF'; bPdf.onclick = () => printAnswer(pergunta, r);
  acts.appendChild(bCsv); acts.appendChild(bPdf); card.appendChild(acts);
  body.appendChild(card); scrollDown();
}
function downloadCsv(r){
  const url = URL.createObjectURL(new Blob([CD2Report.toCsv(r.colunas, r.todas)], { type:'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = CD2Report.fileName(new Date());
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function printAnswer(pergunta, r){
  const s = st.dbStatus || {};
  $('#printArea').innerHTML = CD2Report.printHtml({ pergunta, titulo:r.titulo, frase:r.frase, aviso:r.aviso,
    visualHtml:CD2Chart.render(r.visual, r.colunas, r.linhas, { x:r.x, y:r.y }), tabelaHtml:CD2Chart.render('tabela', r.colunas, r.todas),
    sql:r.sql, quando:new Date().toLocaleString('pt-BR'), motor:CD2Toolbox.engineLabel(s.engine), base:s.database || '',
    contato:(st.cfg.report && st.cfg.report.contact) || '', logoSvg:$('.topbar .logo').outerHTML });
  window.print();
}
```

- [ ] **Step 5: Mandar a pergunta para o roteiro no modo Banco de dados**

Em `send`, troque:
```js
  addUser(text); st.messages.push({ role:'user', content:text }); runTurn();
```
por:
```js
  addUser(text);
  const mode = store.get('cd2.mode') || (st.cfg.mcp && st.cfg.mcp.mode) || 'demo';
  if(mode === 'toolbox' && st.catalogPromise) runAsk(text);
  else{ st.messages.push({ role:'user', content:text }); runTurn(); }
```

Em `renderHero`, troque:
```js
  const sug = Array.isArray(st.cfg.suggestions) ? st.cfg.suggestions : ((st.cfg.suggestions || {})[mode] || []);
```
por:
```js
  const sug = (mode === 'toolbox' && st.suggestions && st.suggestions.length) ? st.suggestions
    : Array.isArray(st.cfg.suggestions) ? st.cfg.suggestions : ((st.cfg.suggestions || {})[mode] || []);
```

- [ ] **Step 6: CSS da resposta e da impressão**

Logo antes de `</style>`, acrescente:
```css
/* ---------- respostas do roteiro de relatórios ---------- */
.answer{background:var(--surface-raised);border:1px solid rgba(13,18,51,.12);border-radius:var(--radius-md);padding:var(--space-4);box-shadow:var(--shadow-card)}
.answer h3{margin:0 0 var(--space-1);font:700 17px/24px var(--font-sans)}
.answer .frase{margin:0 0 var(--space-3);color:var(--ink-muted)}
.answer .acts{display:flex;gap:var(--space-2);margin-top:var(--space-3)}
.viz svg.chart{width:100%;height:auto;display:block}
.chart .bar{fill:var(--brand)} .chart .bar.neg{fill:var(--status-atencao)}
.chart .lbl{fill:var(--ink-muted);font:500 12px var(--font-sans)} .chart .val{fill:var(--ink);font:700 12px var(--font-sans)}
.chart .line{fill:none;stroke:var(--brand);stroke-width:2.5} .chart .pt{fill:var(--brand)} .chart .axis{stroke:var(--border)}
.pie{display:flex;flex-wrap:wrap;gap:var(--space-4);align-items:center} .pie svg.chart{max-width:240px}
.legend{list-style:none;margin:0;padding:0} .legend li{display:flex;align-items:center;gap:var(--space-2)} .legend i{width:12px;height:12px;border-radius:3px;flex:none}
.kpi{display:flex;flex-direction:column} .kpi-v{font:800 40px/48px var(--font-sans);color:var(--ink-brand)} .kpi-l{color:var(--ink-muted)}
.tbl{max-height:360px;overflow:auto} .tbl table{border-collapse:collapse;width:100%;font-size:13px}
.tbl th{position:sticky;top:0;background:var(--surface-100);text-align:left}
.tbl th,.tbl td{padding:4px 8px;border-bottom:1px solid rgba(13,18,51,.08)} .tbl td.n{text-align:right;font-variant-numeric:tabular-nums}
.msg .chips{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-3)}
#printArea{display:none}
@media print{
  body > *:not(#printArea){display:none !important}
  body{display:block;background:#fff}
  #printArea{display:block;color:var(--ink);font:400 12px/18px var(--font-sans)}
  .pr-head,.pr-foot{display:flex;align-items:center;gap:12px} .pr-head .logo,.pr-foot .logo{height:22px}
  .pr-foot{margin-top:24px;padding-top:8px;border-top:1px solid var(--border)}
  .pr h1{font:700 20px/26px var(--font-sans);margin:16px 0 4px} .pr h2{font:700 14px/20px var(--font-sans);margin:16px 0 6px}
  .pr pre{white-space:pre-wrap;font:11px/16px var(--font-mono)}
  .pr .tbl{max-height:none;overflow:visible} .pr svg.chart{width:100%;height:auto;max-height:420px}
}
```

- [ ] **Step 7: Contato do relatório no `config.json`**

Em `web/config.json`, depois do bloco `"mcp": { ... },` acrescente:
```json
  "report": {
    "contact": ""
  },
```
(O valor é preenchido pela equipe antes do evento; entra no checklist do README na Task 11.)

- [ ] **Step 8: Rodar os testes**

Run: `node --test`
Expected: PASS (nada de DOM é testado aqui; garante que nada quebrou).

- [ ] **Step 9: Verificar na tela, com banco e modelo de verdade**

Suba o banco de avaliação da Task 10 se já existir, ou o de receitas:
```bash
docker compose -f tests/toolbox/docker-compose.yml up -d postgres
ls bin/ctl/darwin-arm64/cd2-ctl   # veio do cache na pré-condição 2; se faltar: sh ctl/build.sh (exige Go)
sh core/start-unix.sh
```
Na janela que abrir: **Ferramentas** → MCP Nativo para Banco de dados → PostgreSQL, host `127.0.0.1`, porta `55432`, base `cd2`, usuário `cd2`, senha do `tests/toolbox/postgres.env`, schema `public` → **Salvar e conectar**. Feche o diálogo. Confira, com o painel do navegador do app (`mcp__Claude_Browser__*`) ou à mão:
1. As sugestões da tela inicial mudam para perguntas do esquema (ex.: "Quantos registros tem produto").
2. "Quantos produtos existem?" → cartão com número 25 e frase "Resultado: 25.".
3. "Preço por produto" → barra com no máximo 20 itens e o aviso "Mostrando os 20 maiores de 25.".
4. "funcionários admitidos" → "Não achei tabelas sobre isso neste banco." com as sugestões abaixo.
5. **CSV** baixa `cd2-relatorio-*.csv`; abre no Excel/Numbers com acentos e decimais certos.
6. **Imprimir/PDF** mostra só o relatório (logo, pergunta, gráfico, dados, SQL, rodapé "CD2 Tech").
7. Pergunta enviada logo depois de "Salvar e conectar" (antes de o mapa carregar) espera e responde, sem erro.
8. Sem mapa do banco (receita antiga, conta sem tabelas), a pergunta cai no laço de agente. Para simular, no console do navegador: `st.catalog = null; st.catalogPromise = Promise.resolve();` e pergunte de novo: deve aparecer o cartão de ferramenta do laço antigo, sem erro.
9. **Parar** durante "Montando a consulta…" mostra "Interrompido.".
Tire um screenshot do item 3 e do item 6 (pré-visualização de impressão) como prova.

- [ ] **Step 10: Commit**

```bash
git add web/index.html web/config.json
git commit -m "Tela: modo Banco de dados responde com gráfico, frase de molde, CSV e relatório impresso"
```

---

### Task 9: Modelo padrão Instruct no preparo

**Files:**
- Modify: `core/prepare-unix.sh:8-9` e depois da checagem de tamanho do modelo
- Modify: `core/prepare-windows.ps1:7-8` e depois da checagem de tamanho do modelo
- Modify: `docs/criar-pendrive.md:55`

**Interfaces:**
- Produces: `models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf` conferido por SHA-256; nenhum outro `.gguf` em `models/`. Variáveis novas: `CD2_MODEL_SHA256`.

- [ ] **Step 1: Unix**

Em `core/prepare-unix.sh`, troque as linhas 8 e 9 por:
```sh
MODEL_URL="${CD2_MODEL_URL:-https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf}"
MODEL_FILE="${CD2_MODEL_FILE:-Qwen3-4B-Instruct-2507-Q4_K_M.gguf}"
# SHA-256 do modelo padrao. Com CD2_MODEL_URL proprio, so confere se CD2_MODEL_SHA256 vier junto.
if [ -n "${CD2_MODEL_URL:-}" ]; then MODEL_SHA256="${CD2_MODEL_SHA256:-}"
else MODEL_SHA256="${CD2_MODEL_SHA256:-3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597}"; fi
```
Depois da linha `if [ "$SIZE" -lt 1000000000 ]; then ...; fi`, acrescente:
```sh
if [ -n "$MODEL_SHA256" ]; then
  GOT="$($SUM "$ROOT/models/$MODEL_FILE" | cut -d' ' -f1)"
  if [ "$GOT" != "$MODEL_SHA256" ]; then echo "[ERRO] SHA-256 do modelo nao confere ($GOT). Apague models/$MODEL_FILE e rode de novo."; exit 1; fi
  echo "SHA-256 do modelo conferido."
fi
# O launcher usa o primeiro .gguf que encontrar: fica so o modelo atual em models/.
for f in "$ROOT"/models/*.gguf; do
  [ -e "$f" ] || continue
  [ "$(basename "$f")" = "$MODEL_FILE" ] && continue
  echo "Removendo modelo antigo: $(basename "$f")"; rm -f "$f"
done
```

- [ ] **Step 2: Windows**

Em `core/prepare-windows.ps1`, troque as linhas 7 e 8 por:
```powershell
$ModelUrl  = if ($env:CD2_MODEL_URL)  { $env:CD2_MODEL_URL }  else { 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf' }
$ModelFile = if ($env:CD2_MODEL_FILE) { $env:CD2_MODEL_FILE } else { 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf' }
# SHA-256 do modelo padrao. Com CD2_MODEL_URL proprio, so confere se CD2_MODEL_SHA256 vier junto.
$ModelSha  = if ($env:CD2_MODEL_SHA256) { $env:CD2_MODEL_SHA256.ToLower() } elseif ($env:CD2_MODEL_URL) { '' } else { '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597' }
```
Depois da linha `if ((Get-Item $model).Length -lt 1GB) { throw ... }`, acrescente:
```powershell
if ($ModelSha) {
    $got = (Get-FileHash -Algorithm SHA256 $model).Hash.ToLower()
    if ($got -ne $ModelSha) { throw "SHA-256 do modelo nao confere ($got). Apague $model e rode de novo." }
    Write-Host 'SHA-256 do modelo conferido.'
}
# O launcher usa o primeiro .gguf que encontrar: fica so o modelo atual em models\.
Get-ChildItem (Join-Path $Root 'models') -Filter *.gguf | Where-Object { $_.Name -ne $ModelFile } | ForEach-Object {
    Write-Host "Removendo modelo antigo: $($_.Name)"; Remove-Item -Force $_.FullName
}
```

- [ ] **Step 3: Documento do pen drive**

Em `docs/criar-pendrive.md`, troque `  models/qwen3-4b-thinking-2507.Q4_K_M.gguf   ~2,4 GB` por `  models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf   ~2,5 GB`.

- [ ] **Step 4: Verificar o preparo de ponta a ponta no Mac**

```bash
sh -n core/prepare-unix.sh
touch models/modelo-velho.gguf
CD2_TOOLBOX_PLATFORMS=darwin-arm64 CD2_CTL_LOCAL=1 sh core/prepare-unix.sh 2>&1 | tail -n 20
ls models
```
Expected: "Ja baixado, pulando: Qwen3-4B-Instruct-2507-Q4_K_M.gguf", "SHA-256 do modelo conferido.", "Removendo modelo antigo: modelo-velho.gguf", e `models/` só com o arquivo novo. Para o Windows, se não houver máquina à mão, confira a sintaxe com `pwsh -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('core/prepare-windows.ps1',[ref]\$null,[ref]\$e) | Out-Null; \$e"` (saída vazia = sem erro) se o `pwsh` estiver instalado; senão registre que o teste no Windows fica para o checklist do evento.

- [ ] **Step 5: Commit**

```bash
git add core/prepare-unix.sh core/prepare-windows.ps1 docs/criar-pendrive.md
git commit -m "Preparo baixa o Qwen3-4B-Instruct-2507 conferido por SHA-256 e remove modelos antigos"
```

---

### Task 10: Avaliação com banco de cara de ERP (`tests/eval/`)

**Files:**
- Create: `tests/eval/docker-compose.yml`, `tests/eval/erp.env`, `tests/eval/seed/postgres-erp.sql`, `tests/eval/perguntas.json`, `tests/eval/compare.js`, `tests/eval/compare.test.js`, `tests/eval/run-eval.mjs`, `tests/eval/rodar.sh`

**Interfaces:**
- Consumes: `McpClient` (`web/mcp.js`), `CD2Catalog.buildCatalog`, `CD2Ask.ask`, `CD2Ask.modelCaller`, `CD2Ask.toolRunner`, `CD2Ask.parseRows`, `CD2Toolbox.parseStatus`, `CD2Chart.num`.
- Produces: `sameResult(esperado: object[], obtido: object[]) => boolean`; o comando `sh tests/eval/rodar.sh` que imprime acerto, tempo e o veredito do portão (sai com 1 se não passar).

- [ ] **Step 1: Testes da comparação**

`tests/eval/compare.test.js`:
```js
'use strict';
// Testes da comparação de resultados da avaliação. Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { sameResult } = require('./compare.js');

test('sameResult: mesmos números, rótulos e nomes de coluna livres, ordem livre', () => {
  assert.equal(sameResult([{ mes:'2026-01', total:'10.00' }, { mes:'2026-02', total:'20.50' }],
    [{ MES:'fev/2026', TOTAL:20.5 }, { MES:'jan/2026', TOTAL:10 }]), true);
});
test('sameResult: tolera arredondamento em 2 casas e coluna numérica a mais', () => {
  assert.equal(sameResult([{ media:'49.98765' }], [{ ticket_medio:49.99 }]), true);
  assert.equal(sameResult([{ loja:'A', total:5 }], [{ cd:1, loja:'A', total:5 }]), true);
});
test('sameResult: recusa número diferente, linha a mais e resultado ausente', () => {
  assert.equal(sameResult([{ total:10 }], [{ total:11 }]), false);
  assert.equal(sameResult([{ total:10 }], [{ total:10 }, { total:10 }]), false);
  assert.equal(sameResult([{ total:10 }], undefined), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/eval/compare.test.js`
Expected: FAIL (`Cannot find module './compare.js'`).

- [ ] **Step 3: Implementar `tests/eval/compare.js`**

```js
'use strict';
// Compara o resultado do roteiro com o SQL de referência só pelos números de cada linha:
// rótulos e nomes de coluna variam (to_char x extract, alias), os números não podem variar.
const { num } = require('../../web/chart.js');
const nums = row => Object.values(row || {}).map(num).filter(v => v != null);
const near = (a, b) => Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 1e-6);
function contains(pool, expected){
  pool = pool.slice();
  return expected.every(e => { const i = pool.findIndex(a => near(a, e)); if(i < 0) return false; pool.splice(i, 1); return true; });
}
function sameResult(expected, actual){
  if(!Array.isArray(actual) || expected.length !== actual.length) return false;
  const used = new Set();
  return expected.every(er => {
    const en = nums(er);
    const i = actual.findIndex((ar, k) => !used.has(k) && contains(nums(ar), en));
    if(i < 0) return false;
    used.add(i); return true;
  });
}
module.exports = { sameResult };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/eval/compare.test.js`
Expected: PASS.

- [ ] **Step 5: Banco de avaliação**

`tests/eval/docker-compose.yml`:
```yaml
# Banco descartável com cara de ERP de varejo para a avaliação do roteiro de relatórios.
#   docker compose -f tests/eval/docker-compose.yml up -d --wait
services:
  erp:
    image: postgres:16
    environment: { POSTGRES_USER: erp, POSTGRES_PASSWORD: erp, POSTGRES_DB: erp }
    ports: ["55433:5432"]
    volumes: ["./seed/postgres-erp.sql:/docker-entrypoint-initdb.d/seed.sql:ro"]
    healthcheck: { test: ["CMD", "pg_isready", "-U", "erp"], interval: 2s, retries: 30 }
```

`tests/eval/erp.env`:
```sh
# Conexao do banco descartavel de avaliacao (tests/eval/docker-compose.yml). Nao e segredo.
CD2_DB_ENGINE=postgres
CD2_DB_HOST=127.0.0.1
CD2_DB_PORT=55433
CD2_DB_NAME=erp
CD2_DB_USER=erp
CD2_DB_PASSWORD=erp
CD2_DB_SCHEMA=public
```

`tests/eval/seed/postgres-erp.sql`:
```sql
-- ERP de varejo de mentira para a avaliacao (tests/eval). Dados deterministicos, jan a set de 2026.
CREATE TABLE loja (cd_loja integer PRIMARY KEY, nm_loja varchar(40) NOT NULL, uf char(2));
CREATE TABLE departamento (cd_depto integer PRIMARY KEY, ds_depto varchar(40) NOT NULL);
CREATE TABLE produto (cd_prod integer PRIMARY KEY, ds_prod varchar(80) NOT NULL, cd_depto integer REFERENCES departamento, vlr_custo numeric(10,2));
CREATE TABLE cliente (cd_cli integer PRIMARY KEY, nm_cli varchar(80), uf char(2), dt_cad date);
CREATE TABLE mov_venda (nr_cupom integer PRIMARY KEY, cd_loja integer REFERENCES loja, cd_cli integer REFERENCES cliente, dt_mov date NOT NULL, vlr_tot numeric(12,2));
CREATE TABLE mov_venda_item (nr_cupom integer REFERENCES mov_venda, seq integer, cd_prod integer REFERENCES produto, qtd_it integer, vlr_tot_it numeric(12,2), PRIMARY KEY (nr_cupom, seq));
-- tabelas de ruido, que nao deveriam ser escolhidas
CREATE TABLE log_integracao (id bigserial PRIMARY KEY, dt_log timestamp, msg text);
CREATE TABLE cfg_parametro (chave varchar(40) PRIMARY KEY, valor text);
CREATE TABLE aux_tmp_import (linha integer, conteudo text);
CREATE TABLE usuario_sistema (cd_usu integer PRIMARY KEY, nm_usu varchar(40), dt_ult_acesso timestamp);

INSERT INTO loja VALUES (1,'Loja Centro','SP'),(2,'Loja Norte','SP'),(3,'Loja Praia','RJ'),(4,'Loja Serra','MG');
INSERT INTO departamento VALUES (1,'Mercearia'),(2,'Bebidas'),(3,'Hortifruti'),(4,'Acougue'),(5,'Padaria'),(6,'Limpeza');
INSERT INTO produto SELECT g, 'Produto ' || g, ((g - 1) % 6) + 1, round((2 + (g % 17) * 1.35 + g * 0.01)::numeric, 2) FROM generate_series(1, 120) g;
INSERT INTO cliente SELECT g, 'Cliente ' || g, (ARRAY['SP','RJ','MG','PR'])[(g % 4) + 1], DATE '2025-01-01' + (g % 500) FROM generate_series(1, 300) g;
INSERT INTO mov_venda SELECT g, ((g * 7) % 4) + 1, CASE WHEN g % 5 = 0 THEN NULL ELSE ((g * 13) % 300) + 1 END, DATE '2026-01-01' + ((g * 11) % 273), 0 FROM generate_series(1, 6000) g;
INSERT INTO mov_venda_item SELECT c.nr_cupom, s, ((c.nr_cupom * 31 + s * 17) % 120) + 1, ((c.nr_cupom + s) % 5) + 1, 0 FROM mov_venda c CROSS JOIN generate_series(1, 3) s;
UPDATE mov_venda_item i SET vlr_tot_it = round(i.qtd_it * p.vlr_custo * 1.3, 2) FROM produto p WHERE p.cd_prod = i.cd_prod;
UPDATE mov_venda v SET vlr_tot = s.t FROM (SELECT nr_cupom, sum(vlr_tot_it) AS t FROM mov_venda_item GROUP BY nr_cupom) s WHERE s.nr_cupom = v.nr_cupom;
INSERT INTO log_integracao (dt_log, msg) SELECT TIMESTAMP '2026-01-01' + g * INTERVAL '7 minutes', 'evento ' || g FROM generate_series(1, 20000) g;
INSERT INTO cfg_parametro VALUES ('versao','1.0'),('moeda','BRL');
INSERT INTO usuario_sistema VALUES (1,'admin',now()),(2,'caixa01',now());
ANALYZE;
```
(O `+ g * 0.01` no custo evita produtos com o mesmo custo, o que deixaria rankings com empate.)

- [ ] **Step 6: As 20 perguntas**

`tests/eval/perguntas.json` (cada `sql` é a referência; `visual` lista os visuais aceitáveis):
```json
[
  { "pergunta": "Quantas vendas foram feitas?", "sql": "SELECT count(*) AS n FROM mov_venda", "visual": ["numero"] },
  { "pergunta": "Qual o faturamento total?", "sql": "SELECT sum(vlr_tot) AS total FROM mov_venda", "visual": ["numero"] },
  { "pergunta": "Faturamento por mês", "sql": "SELECT to_char(dt_mov, 'YYYY-MM') AS mes, sum(vlr_tot) AS total FROM mov_venda GROUP BY 1", "visual": ["linha", "barra"] },
  { "pergunta": "Faturamento por loja", "sql": "SELECT l.nm_loja AS loja, sum(v.vlr_tot) AS total FROM mov_venda v JOIN loja l ON l.cd_loja = v.cd_loja GROUP BY 1", "visual": ["barra", "pizza"] },
  { "pergunta": "Quantidade de vendas por loja", "sql": "SELECT l.nm_loja AS loja, count(*) AS n FROM mov_venda v JOIN loja l ON l.cd_loja = v.cd_loja GROUP BY 1", "visual": ["barra", "pizza"] },
  { "pergunta": "Top 5 produtos por faturamento", "sql": "SELECT p.ds_prod AS produto, sum(i.vlr_tot_it) AS total FROM mov_venda_item i JOIN produto p ON p.cd_prod = i.cd_prod GROUP BY 1 ORDER BY 2 DESC LIMIT 5", "visual": ["barra", "tabela"] },
  { "pergunta": "Faturamento por departamento", "sql": "SELECT d.ds_depto AS departamento, sum(i.vlr_tot_it) AS total FROM mov_venda_item i JOIN produto p ON p.cd_prod = i.cd_prod JOIN departamento d ON d.cd_depto = p.cd_depto GROUP BY 1", "visual": ["barra", "pizza"] },
  { "pergunta": "Qual o ticket médio?", "sql": "SELECT avg(vlr_tot) AS ticket_medio FROM mov_venda", "visual": ["numero"] },
  { "pergunta": "Ticket médio por loja", "sql": "SELECT l.nm_loja AS loja, avg(v.vlr_tot) AS ticket_medio FROM mov_venda v JOIN loja l ON l.cd_loja = v.cd_loja GROUP BY 1", "visual": ["barra", "tabela"] },
  { "pergunta": "Quantos clientes temos?", "sql": "SELECT count(*) AS n FROM cliente", "visual": ["numero"] },
  { "pergunta": "Clientes por estado", "sql": "SELECT uf, count(*) AS n FROM cliente GROUP BY 1", "visual": ["barra", "pizza"] },
  { "pergunta": "Quantos produtos tem cada departamento?", "sql": "SELECT d.ds_depto AS departamento, count(*) AS n FROM produto p JOIN departamento d ON d.cd_depto = p.cd_depto GROUP BY 1", "visual": ["barra", "pizza", "tabela"] },
  { "pergunta": "Faturamento por mês da Loja Centro", "sql": "SELECT to_char(v.dt_mov, 'YYYY-MM') AS mes, sum(v.vlr_tot) AS total FROM mov_venda v JOIN loja l ON l.cd_loja = v.cd_loja WHERE l.nm_loja = 'Loja Centro' GROUP BY 1", "visual": ["linha", "barra"] },
  { "pergunta": "Quanto vendemos em março de 2026?", "sql": "SELECT sum(vlr_tot) AS total FROM mov_venda WHERE dt_mov >= DATE '2026-03-01' AND dt_mov < DATE '2026-04-01'", "visual": ["numero"] },
  { "pergunta": "Quantidade de itens vendidos por mês", "sql": "SELECT to_char(v.dt_mov, 'YYYY-MM') AS mes, sum(i.qtd_it) AS itens FROM mov_venda_item i JOIN mov_venda v ON v.nr_cupom = i.nr_cupom GROUP BY 1", "visual": ["linha", "barra"] },
  { "pergunta": "Faturamento por estado da loja", "sql": "SELECT l.uf, sum(v.vlr_tot) AS total FROM mov_venda v JOIN loja l ON l.cd_loja = v.cd_loja GROUP BY 1", "visual": ["barra", "pizza"] },
  { "pergunta": "Qual loja vendeu mais?", "sql": "SELECT l.nm_loja AS loja, sum(v.vlr_tot) AS total FROM mov_venda v JOIN loja l ON l.cd_loja = v.cd_loja GROUP BY 1 ORDER BY 2 DESC LIMIT 1", "visual": ["barra", "tabela", "numero"] },
  { "pergunta": "Qual o custo médio dos produtos?", "sql": "SELECT avg(vlr_custo) AS custo_medio FROM produto", "visual": ["numero"] },
  { "pergunta": "Quantas vendas não têm cliente identificado?", "sql": "SELECT count(*) AS n FROM mov_venda WHERE cd_cli IS NULL", "visual": ["numero"] },
  { "pergunta": "Média de itens por cupom", "sql": "SELECT avg(n) AS media_itens FROM (SELECT count(*) AS n FROM mov_venda_item GROUP BY nr_cupom) q", "visual": ["numero"] }
]
```

- [ ] **Step 7: Script da avaliação**

`tests/eval/run-eval.mjs`:
```js
// Avaliação do roteiro de relatórios contra o llamafile e o toolbox locais (rode por tests/eval/rodar.sh).
// Para cada pergunta: roda o SQL de referência, roda o roteiro de verdade e compara os números.
// Variáveis: CD2_EVAL_MODEL_URL, CD2_EVAL_TOOLBOX_URL, CD2_EVAL_SCHEMA (0 desliga response_format), CD2_EVAL_META (padrão 70).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { McpClient } = require('../../web/mcp.js');
const Cat = require('../../web/catalog.js');
const Ask = require('../../web/ask.js');
const Tb = require('../../web/toolbox.js');
const { sameResult } = require('./compare.js');
const perguntas = require('./perguntas.json');

const MODEL_URL = process.env.CD2_EVAL_MODEL_URL || 'http://127.0.0.1:8080/v1/chat/completions';
const TOOLBOX_URL = process.env.CD2_EVAL_TOOLBOX_URL || 'http://127.0.0.1:9080/mcp';
const META = Number(process.env.CD2_EVAL_META || 70);

const client = new McpClient(TOOLBOX_URL, { fetch:(...a) => fetch(...a), origin:'http://127.0.0.1:8080' });
await client.init();
const status = Tb.parseStatus(await client.call('db_connection_status', {}));
const cat = Ask.parseRows(await client.call('db_catalog', {}));
if(!status || !cat.ok) throw new Error('Toolbox sem status ou sem db_catalog: ' + (cat.error || ''));
const catalog = Cat.buildCatalog(cat.rows);
const callModel = Ask.modelCaller({ fetch:(...a) => fetch(...a), url:MODEL_URL, useSchema:process.env.CD2_EVAL_SCHEMA !== '0' });
const runSql = Ask.toolRunner(client, { timeoutMs:15000 });

let acertos = 0, visuais = 0, tempo = 0;
for(const [i, p] of perguntas.entries()){
  const ref = await runSql(p.sql);
  if(!ref.ok) throw new Error('SQL de referência da pergunta ' + (i + 1) + ' falhou: ' + ref.error);
  const t0 = Date.now();
  const r = await Ask.ask({ pergunta:p.pergunta, catalog, motor:status.engine, versao:String(status.db_version || '').split('\n')[0].trim(), callModel, runSql });
  const s = (Date.now() - t0) / 1000; tempo += s;
  const ok = r.ok && sameResult(ref.rows, r.todas);
  if(ok) acertos++;
  if(r.ok && p.visual.includes(r.visual)) visuais++;
  console.log((ok ? '[OK]   ' : '[ERRO] ') + s.toFixed(1).padStart(5) + 's  ' + (r.ok ? r.visual : r.motivo).padEnd(11) + p.pergunta + (ok || !r.sql ? '' : '\n         SQL: ' + r.sql));
}
const pct = Math.round(acertos / perguntas.length * 100);
console.log('\nAcerto: ' + acertos + '/' + perguntas.length + ' (' + pct + '%). Visual aceitável: ' + visuais + '/' + perguntas.length
  + '. Tempo médio: ' + (tempo / perguntas.length).toFixed(1) + 's.');
console.log('PORTÃO (' + META + '%): ' + (pct >= META ? 'PASSOU' : 'NÃO PASSOU'));
process.exit(pct >= META ? 0 : 1);
```

`tests/eval/rodar.sh`:
```sh
#!/usr/bin/env sh
# Sobe o banco de avaliacao, o toolbox e o llamafile (so CPU por padrao), roda a avaliacao e derruba tudo.
#   sh tests/eval/rodar.sh                      modelo padrao em models/, so CPU
#   CD2_EVAL_GPU=1 sh tests/eval/rodar.sh       usa a GPU (mais rapido, nao vale para o portao)
#   CD2_EVAL_MODEL=/caminho/outro.gguf sh tests/eval/rodar.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLAT=darwin-arm64 ;; Darwin-*) PLAT=darwin-amd64 ;; *) PLAT=linux-amd64 ;;
esac
MODEL="${CD2_EVAL_MODEL:-$(ls "$ROOT"/models/*.gguf 2>/dev/null | head -n 1)}"
[ -n "$MODEL" ] || { echo "Sem modelo em models/"; exit 1; }
NGL="-ngl 0"; [ "${CD2_EVAL_GPU:-0}" = 1 ] && NGL=""
LOG="${TMPDIR:-/tmp}/cd2-eval"; mkdir -p "$LOG"

docker compose -f "$HERE/docker-compose.yml" up -d --wait || exit 1
set -a; . "$HERE/erp.env"; set +a
"$ROOT/bin/toolbox/$PLAT/toolbox" --config "$ROOT/core/toolbox/postgres.yaml" --address 127.0.0.1 --port 9080 \
  --allowed-origins http://127.0.0.1:8080 --disable-reload > "$LOG/toolbox.log" 2>&1 &
TB=$!
"$ROOT/bin/llamafile" -m "$MODEL" --server --host 127.0.0.1 --port 8080 --jinja -c 8192 $NGL > "$LOG/llama.log" 2>&1 &
LL=$!
trap 'kill $TB $LL 2>/dev/null; docker compose -f "$HERE/docker-compose.yml" down >/dev/null 2>&1' EXIT INT TERM
i=0; until curl -sf http://127.0.0.1:8080/health >/dev/null; do i=$((i+1)); [ $i -gt 180 ] && { echo "llamafile nao subiu (log em $LOG/llama.log)"; exit 1; }; sleep 1; done
i=0; until curl -s -o /dev/null http://127.0.0.1:9080/; do i=$((i+1)); [ $i -gt 30 ] && { echo "toolbox nao subiu (log em $LOG/toolbox.log)"; exit 1; }; sleep 1; done
echo "Modelo: $(basename "$MODEL")  ${NGL:-GPU}"
node "$HERE/run-eval.mjs"
```

- [ ] **Step 8: Conferir as referências antes de medir o modelo**

```bash
docker compose -f tests/eval/docker-compose.yml up -d --wait
for q in "SELECT p.ds_prod, sum(i.vlr_tot_it) t FROM mov_venda_item i JOIN produto p ON p.cd_prod = i.cd_prod GROUP BY 1 ORDER BY 2 DESC LIMIT 6" \
         "SELECT l.nm_loja, sum(v.vlr_tot) t FROM mov_venda v JOIN loja l ON l.cd_loja = v.cd_loja GROUP BY 1 ORDER BY 2 DESC"; do
  docker compose -f tests/eval/docker-compose.yml exec -T erp psql -U erp -d erp -c "$q"; done
```
Expected: o 5º e o 6º produto com valores diferentes; as lojas com totais diferentes (sem empate no topo). Se houver empate, mude o custo no seed (`+ g * 0.01` para `+ g * 0.013`) e repita.

- [ ] **Step 9: Rodar a avaliação com o modelo padrão (só CPU)**

```bash
sh tests/eval/rodar.sh
```
Expected: 20 linhas `[OK]`/`[ERRO]`, o resumo e `PORTÃO (70%): PASSOU`. Guarde a saída inteira para a mensagem de commit. Se não passar, **não ajuste perguntas nem referências para passar**: registre o resultado, rode o Step 10 e leve os números ao usuário.

- [ ] **Step 10: Rodar com o modelo de reserva**

```bash
curl -L --fail -C - -o /tmp/qwen2.5-coder-7b-instruct-q4_k_m.gguf https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf
shasum -a 256 /tmp/qwen2.5-coder-7b-instruct-q4_k_m.gguf   # 509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c
CD2_EVAL_MODEL=/tmp/qwen2.5-coder-7b-instruct-q4_k_m.gguf sh tests/eval/rodar.sh
```
Registre acerto e tempo médio dos dois modelos. A decisão de trocar o padrão é do usuário (spec, seção 6): não troque sozinho.

- [ ] **Step 11: Rodar todos os testes e commitar**

```bash
node --test
git add tests/eval
git commit -m "Avaliação do roteiro de relatórios com banco de cara de ERP e portão de 70%

Modelo padrão (CPU): <cole aqui a linha Acerto/Tempo do Step 9>
Reserva (CPU): <cole aqui a linha do Step 10>"
```

---

### Task 11: Documentação, site e versão 0.7.0

**Files:**
- Modify: `README.md`, `docs/index.html`, `VERSION`, `web/mcp.js:13`

- [ ] **Step 1: Versão**

`VERSION`: `0.7.0`. Em `web/mcp.js`, `const CLIENT_INFO = { name:'cd2-harness', version:'0.7.0' };`. Rode `node --test` (se `tests/mcp.test.js` fixar a versão, atualize o valor esperado lá).

- [ ] **Step 2: README, seção 3**

Troque "A IA ganha seis ferramentas somente leitura: `db_connection_status`, ..." por:
```markdown
A IA ganha sete ferramentas somente leitura: `db_connection_status`, `db_catalog` (o mapa do banco para os relatórios), `db_list_tables`, `db_describe_table`, `db_search_columns`, `db_sample_table` (até 20 linhas) e `db_read_only_query` (SELECT avulso, até 200 linhas). O botão **Ferramentas** mostra a conexão ativa e a lista.
```
E acrescente, no fim da lista de cuidados da seção 3:
```markdown
- **Tempo máximo de 15 segundos por consulta.** PostgreSQL corta no servidor (`statement_timeout`), MariaDB/MySQL pelo `queryTimeout` da receita. No SQL Server e no Oracle, <preencha conforme os Resultados da Task 1: "também pelo `queryTimeout` da receita" ou "o harness para de esperar aos 15 s, mas a consulta pode continuar no servidor: crie a conta de leitura com limite de recurso (Resource Governor no SQL Server, perfil com `CPU_PER_CALL` no Oracle)">.
```
(Substitua o trecho entre `< >` pelo texto escolhido, sem os sinais.)

- [ ] **Step 3: README, seção nova 3c**

Depois da seção "3b. Conectar ao Archeo MCP", acrescente:
```markdown
## 3c. Relatórios e gráficos

No modo Banco de dados, cada pergunta vira uma consulta, um gráfico e um relatório. Ao conectar, o harness lê o mapa do banco uma vez e sugere quatro perguntas tiradas do próprio esquema do cliente.

- **Pergunte do jeito que falaria:** "faturamento por mês", "top 10 produtos por valor", "quantos clientes por estado".
- **O que aparece:** título, uma frase de resumo e o visual (número, barra, linha, pizza ou tabela), com a consulta usada num bloco recolhível.
- **Os números vêm do banco, não do modelo.** O modelo escolhe a consulta e o tipo de gráfico, mas nunca vê o resultado. A frase de resumo é montada pelo harness a partir do dado.
- **Quando não dá:** o harness diz que não achou tabelas, que não conseguiu montar a consulta, que a consulta demorou demais ou que veio vazia. Nunca inventa.
- **Levar embora:** **CSV** baixa os dados (abre no Excel com acentos e decimais certos). **Imprimir/PDF** gera o relatório com logo e contato da CD2 no rodapé.
- **Contato no relatório:** preencha `report.contact` em `web/config.json` (site, e-mail, telefone).

Para medir a qualidade num banco de teste com cara de ERP: `sh tests/eval/rodar.sh` (precisa de Docker). O portão para levar a cliente é 70% de acerto com o llamafile só em CPU.
```

- [ ] **Step 4: README, limitações, personalização e checklist**

Troque as linhas de **Velocidade** e **Procedência do modelo** da seção 6 por:
```markdown
- **Velocidade.** O modelo padrão é o Qwen3 4B Instruct 2507, sem fase de raciocínio. No modo Banco de dados cada pergunta custa uma chamada ao modelo (duas no pior caso). Em notebook só com CPU, espere alguns segundos por resposta; a avaliação em `tests/eval/` mede o tempo médio.
- **Procedência do modelo.** GGUF do Qwen3-4B-Instruct-2507 quantizado pela Unsloth, licença Apache 2.0 da Qwen, conferido por SHA-256 no preparo. A Qwen não publica o GGUF oficial deste modelo.
```
Na seção 4, acrescente: `- \`web/config.json\`: \`report.contact\` é o contato que sai no rodapé do relatório impresso.`
No checklist da seção 7, acrescente:
```markdown
- [ ] `report.contact` preenchido em `web/config.json`
- [ ] `sh tests/eval/rodar.sh` com PORTÃO PASSOU no modelo que vai para o pen drive
- [ ] Relatório impresso testado (Imprimir/PDF) num notebook do evento
```

- [ ] **Step 5: Site**

Em `docs/index.html`, no card "Velocidade" da seção `#cuidados`, troque o parágrafo por:
```html
<p>O modelo padrão responde sem fase de raciocínio. Em notebook só com CPU, espere alguns segundos por pergunta.</p>
```
No card "Procedência do modelo", troque o parágrafo por:
```html
<p>GGUF do Qwen3 4B Instruct 2507, licença Apache 2.0, conferido por SHA-256 no preparo do pen drive.</p>
```
Antes de `<section class="s" id="cuidados"`, acrescente:
```html
  <section class="s" id="relatorios">
    <div class="wrap">
      <span class="eyebrow">Relatórios</span>
      <h2>Da pergunta ao <em>relatório impresso.</em></h2>
      <p class="lead">Conecte o banco e pergunte. Os números vêm do banco, nunca do modelo.</p>
      <div class="grid2">
        <div class="card"><h3>Pergunte</h3><p>"Faturamento por mês", "top 10 produtos". O harness sugere perguntas tiradas do próprio banco.</p></div>
        <div class="card"><h3>Veja o gráfico</h3><p>Número, barra, linha, pizza ou tabela, com uma frase de resumo montada a partir do dado.</p></div>
        <div class="card"><h3>Leve o relatório</h3><p>CSV para o Excel ou PDF com a marca e o contato da CD2.</p></div>
        <div class="card"><h3>Sem travar o banco</h3><p>Só leitura, no máximo 200 linhas e 15 segundos por consulta.</p></div>
      </div>
    </div>
  </section>
```
Abra `docs/index.html` no navegador (preview `web-static` não serve `docs/`; use `mcp__Claude_Browser__preview_start` com `url` `file://` do arquivo ou `python3 -m http.server --directory docs`) e confira a seção nova em 375 px e em desktop.

- [ ] **Step 6: Conferir regras de texto**

```bash
git diff main -- README.md docs/index.html web/ | grep -n '—' && echo "TEM TRAVESSAO" || echo "sem travessao"
```
Expected: `sem travessao`.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/index.html VERSION web/mcp.js tests/mcp.test.js
git commit -m "Documenta relatórios e gráficos, modelo Instruct e sobe para v0.7.0"
```

---

## Resultados da Task 1

(Preenchido pelo executor da Task 1. Formato:)

- `response_format` com `json_schema` no llamafile v0.10.x: **aceito / recusado** → `USE_SCHEMA = true / false`. Evidência: (resposta resumida).
- PostgreSQL, `statement_timeout`: **suportado**. Mensagem: `...`
- MariaDB, `queryTimeout`: **suportado**. Mensagem: `...`
- SQL Server, `queryTimeout`: **suportado / não suportado / aceito e ignorado**. Mensagem: `...`
- Oracle, `queryTimeout`: **suportado / não suportado / aceito e ignorado**. Mensagem: `...`
