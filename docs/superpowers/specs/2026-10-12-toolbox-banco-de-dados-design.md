# CD2 Harness: MCP Toolbox embutido com PostgreSQL, Oracle, MariaDB e SQL Server

Data: 2026-10-12. Versão alvo: 0.4.0.

## Objetivo

O pen drive passa a carregar o MCP Toolbox for Databases (googleapis/mcp-toolbox, v1.14.0) e
ele vira o modo padrão de ferramentas do harness. A pessoa que roda o pen drive escolhe um
banco (PostgreSQL, Oracle, MariaDB ou SQL Server), informa a conexão uma vez, e a IA local
passa a explorar esse banco com seis ferramentas somente leitura:

| Ferramenta | O que faz |
|---|---|
| `db_connection_status` | Verifica se o banco está acessível e devolve motor, versão, host, base, usuário, schema e tabelas visíveis. |
| `db_describe_table` | Colunas, tipos, nulidade, chave primária e chaves estrangeiras de uma tabela ou view. |
| `db_list_tables` | Tabelas e views do schema, com filtro por nome e paginação. |
| `db_search_columns` | Encontra colunas pelo nome em todas as tabelas do schema. |
| `db_read_only_query` | Executa um SELECT avulso em modo somente leitura, com teto de 200 linhas. |
| `db_sample_table` | Amostra de até 20 linhas de uma tabela. |

Os nomes, as descrições curtas e a ordem seguem o painel "Exploração" do Archeo (imagem de
referência do pedido). Na interface elas aparecem como "publicadas pelo sistema, já
disponíveis e não editáveis".

## Decisões já tomadas

1. **Ponte entre front e toolbox: o launcher pergunta, o front mostra.** O navegador não grava
   arquivo nem sobe processo, e o toolbox precisa das credenciais ao iniciar. Então quem
   coleta a conexão é o launcher (terminal), que guarda no computador e sobe o toolbox. O
   front conecta sozinho e exibe a configuração ativa, sem campo de senha. Alternativas
   descartadas: front gerar um arquivo para a pessoa salvar à mão (passo manual, senha na
   pasta Downloads) e um ajudante HTTP local (duas implementações, mais pontos de falha no
   stand).
2. **Credencial nunca fica no pen drive.** O arquivo de conexão vai para o cache do
   computador, com permissão só do dono. O pen drive circula; o cache não.
3. **Um arquivo de receita por motor.** O toolbox conecta em todos os sources ao subir; um
   YAML com os quatro cairia por falta de credencial dos outros três.
4. **Somente leitura em três camadas** (ver seção "Leitura garantida"), porque o toolbox não
   valida SQL.
5. **Modos Demonstração e Archeo MCP continuam** como estão. O novo modo entra como terceiro
   e vira o padrão em `config.json`.

## Arquitetura

```
pen drive
  bin/llamafile                     (já existe)
  bin/toolbox/
    windows-amd64/toolbox.exe       294 MB
    darwin-arm64/toolbox            156 MB
    darwin-amd64/toolbox            167 MB
    linux-amd64/toolbox             316 MB
  core/toolbox/
    postgres.yaml  oracle.yaml  mariadb.yaml  sqlserver.yaml
  core/start-unix.sh, core/start-windows.ps1   (ganham a etapa do banco)
  core/prepare-unix.sh, core/prepare-windows.ps1 (baixam os quatro binários)
  web/index.html, web/config.json   (modo "toolbox")

computador (cache: ~/Library/Caches/cd2-harness | ~/.cache/cd2-harness | %LOCALAPPDATA%\cd2-harness)
  llamafile (cópia executável)      (já existe)
  toolbox   (cópia executável)
  db.env                            (CD2_DB_ENGINE, HOST, PORT, NAME, USER, PASSWORD, SCHEMA)
  toolbox.log
```

Processos em execução, ambos só em `127.0.0.1`:

- llamafile na porta P (8080 em diante), servindo a interface e o modelo, como hoje.
- toolbox na porta P + 1000 (8080 vira 9080), servindo MCP em `/mcp`.

O front deriva a URL do toolbox de `location.port + 1000`. Não há arquivo de runtime nem
parâmetro na URL. Se a porta P + 1000 estiver ocupada, o launcher avança o par inteiro
(P e P + 1000 juntos) para que a regra continue valendo.

## 1. Binários e preparo

- `core/prepare-unix.sh` e `core/prepare-windows.ps1` ganham a etapa "Toolbox": baixam os
  quatro binários de
  `https://storage.googleapis.com/mcp-toolbox-for-databases/v${TOOLBOX_VERSION}/<os>/<arch>/toolbox[.exe]`
  para `bin/toolbox/<os>-<arch>/`, usando a mesma função `fetch` (retoma, pula se completo).
- `TOOLBOX_VERSION` é uma variável no topo de cada preparo, fixada em `1.14.0`, sobrescrevível
  por `CD2_TOOLBOX_VERSION`. Não há resolução de "latest": o pen drive precisa ser
  reprodutível.
- Conferência de tamanho mínimo (100 MB) para cada binário, como é feito com o modelo.
- Os quatro entram no `CHECKSUMS.sha256`.
- `CD2_TOOLBOX_PLATFORMS` permite limitar o download (ex.: `darwin-arm64 windows-amd64`)
  para quem monta um pen drive só para um tipo de máquina. Padrão: os quatro.
- `.gitignore` já cobre `bin/`. `docs/criar-pendrive.md` ganha o tamanho e o tempo extra.

## 2. Receitas por motor (`core/toolbox/*.yaml`)

Cada arquivo tem um source e as seis ferramentas. O source lê do ambiente:

```yaml
kind: source
name: cd2-db
type: postgres        # mysql | mssql | oracle
host: ${CD2_DB_HOST}
port: ${CD2_DB_PORT}
database: ${CD2_DB_NAME}   # Oracle usa serviceName: ${CD2_DB_NAME}
user: ${CD2_DB_USER}
password: ${CD2_DB_PASSWORD}
```

Detalhes por motor:

| Motor | source `type` | tool `type` | Porta padrão | Schema padrão | Catálogo usado |
|---|---|---|---|---|---|
| PostgreSQL | `postgres` | `postgres-sql` | 5432 | `public` | `information_schema` + `pg_catalog` (reaproveita o SQL do gerador Instivo) |
| Oracle | `oracle` | `oracle-sql` | 1521 | usuário em maiúsculas | `ALL_TABLES`, `ALL_VIEWS`, `ALL_TAB_COLUMNS`, `ALL_CONSTRAINTS`, `ALL_CONS_COLUMNS`, `ALL_TAB_COMMENTS`, `ALL_COL_COMMENTS` |
| MariaDB | `mysql` | `mysql-sql` | 3306 | nome da base | `information_schema` (TABLES, COLUMNS, KEY_COLUMN_USAGE) |
| SQL Server | `mssql` | `mssql-sql` | 1433 | `dbo` | `sys.objects`, `sys.columns`, `sys.types`, `sys.extended_properties` (reaproveita o `tools.yaml` do Zeus) |

Oracle usa o driver Go puro (`useOCI` ausente), então não precisa de Instant Client.
MariaDB entra pelo driver MySQL do toolbox; o rótulo na interface é "MariaDB / MySQL".

Contrato comum das seis ferramentas, igual nos quatro arquivos:

- `db_connection_status()`: devolve uma linha com `engine`, `db_version`, `host` (literal
  `${CD2_DB_HOST}` interpolado no SQL), `database`, `user`, `schema`, `visible_tables`.
- `db_list_tables(pattern='', include_views=true, limit=50, offset=0)`: `name`, `type`
  (`TABLE`/`VIEW`), `num_rows` (aproximado, quando o motor tem), `comments`. Sem `%` no
  pattern vira `%pattern%`; busca insensível a caixa.
- `db_describe_table(table_name)`: uma linha por coluna com `column_name`, `data_type`,
  `nullable`, `comments`, `is_primary_key`, `foreign_key_references`, `table`.
- `db_search_columns(pattern, limit=50, offset=0)`: `table`, `column`, `data_type`,
  `comments`.
- `db_sample_table(table_name)`: até 20 linhas. `table_name` é `templateParameters` (vai
  interpolado no SQL); a descrição avisa que só aceita nome vindo de `db_list_tables`.
- `db_read_only_query(sql)`: `sql` é `templateParameters`, embrulhado pelo statement (ver
  abaixo). Teto de 200 linhas.

O schema é fixo por sessão (vem de `${CD2_DB_SCHEMA}`); nenhuma ferramenta expõe parâmetro
`schema`. Isso simplifica o uso pelo modelo pequeno.

### Leitura garantida

1. **Conta do banco.** O README, o site e o checklist pedem uma conta de leitura
   (`pg_read_all_data`, `db_datareader`, `SELECT` only, `CREATE SESSION` + `SELECT ANY TABLE`
   ou grants por tabela no Oracle). Esta é a camada que de fato garante.
2. **Embrulho no SQL.** `db_read_only_query` nunca executa o texto cru. O statement é:
   - PostgreSQL e MariaDB: `SELECT * FROM ({{.sql}}) AS q LIMIT 200`
   - SQL Server: `SELECT TOP (200) * FROM ({{.sql}}) AS q`
   - Oracle: `SELECT * FROM ({{.sql}}) q FETCH FIRST 200 ROWS ONLY`
   O subselect rejeita DML/DDL por sintaxe. Statement múltiplo por `;` é recusado pelos
   quatro drivers no modo em que o toolbox os usa (pgx estendido, go-sql-driver sem
   `multiStatements`, go-ora, go-mssqldb com batch único dentro de subquery inválido).
3. **Guarda no front.** Antes de chamar `db_read_only_query`, o front recusa texto que não
   comece com `SELECT` ou `WITH` (ignorando espaços e comentários) ou que contenha `;`, e
   devolve ao modelo a mensagem "só SELECT é permitido" como resultado da ferramenta.

## 3. Launcher

Etapa nova nos dois launchers (`start-unix.sh` e `start-windows.ps1`), depois do modelo
subir e antes de abrir o navegador:

1. **Escolha das portas.** Procura P a partir de 8080 tal que P e P + 1000 estejam livres.
2. **Configuração.** Se não existir `db.env` no cache, ou se o launcher recebeu `--banco`
   (`INICIAR-CD2-*.bat/.command` e `iniciar-cd2-linux.sh` repassam argumentos), pergunta:
   - Motor: `1` PostgreSQL, `2` Oracle, `3` MariaDB / MySQL, `4` SQL Server, `0` nenhum
     (segue em Demonstração e não grava nada).
   - Host, porta (padrão do motor), base (Oracle: service name), usuário, senha (sem eco:
     `stty -echo` no sh, `Read-Host -AsSecureString` no PowerShell), schema (padrão do motor).
   - Grava `db.env` com `CD2_DB_ENGINE=postgres|oracle|mariadb|sqlserver` e as demais
     variáveis, permissão `600` (Unix) ou ACL só do usuário (Windows).
3. **Cópia executável.** Copia `bin/toolbox/<os>-<arch>/toolbox` para o cache quando difere,
   `chmod +x` e remoção de quarentena no Mac, igual ao llamafile. No Mac escolhe `arm64` ou
   `amd64` por `uname -m`.
4. **Subida.** Exporta o `db.env` e roda
   `toolbox --config core/toolbox/<engine>.yaml --address 127.0.0.1 --port P+1000
   --allowed-hosts 127.0.0.1:P+1000,localhost:P+1000
   --allowed-origins http://127.0.0.1:P,http://localhost:P --disable-reload`,
   log em `toolbox.log` no cache.
5. **Espera.** Até 15 s por `GET http://127.0.0.1:P+1000/` responder. Se o processo morrer
   ou não responder: mostra as últimas 15 linhas do log, avisa "Banco indisponível, seguindo
   em Demonstração. Para corrigir a conexão: INICIAR --banco" e segue sem o toolbox.
6. **Encerramento.** `cleanup`/`Stop-Server` matam os dois processos.

Terminal em português, sem acento nos launchers (padrão já adotado por causa de codificação
no Windows). A senha nunca é impressa, nem no log.

## 4. Front (`web/index.html`, `web/config.json`)

- `config.json`: `mcp.mode` passa a aceitar `"toolbox"` e esse vira o valor padrão.
  `mcp.name` segue servindo ao modo Archeo.
- Diálogo Ferramentas com três opções de rádio: **Banco de dados (Toolbox)**, Demonstração
  (offline), Archeo MCP. Os campos URL/token aparecem só no modo Archeo.
- Modo Toolbox:
  - URL fixa `http://127.0.0.1:<location.port + 1000>/mcp`, conectada pelo `McpClient`
    existente, sem token.
  - Após `tools/list`, chama `db_connection_status` e preenche um bloco de leitura: motor,
    versão (primeira linha), host, base, usuário, schema, tabelas visíveis.
  - Lista as seis ferramentas no formato do painel Exploração: ponto verde, nome em mono,
    descrição curta. Cabeçalho "Exploração" com a frase "Publicadas automaticamente pelo
    sistema. Já disponíveis e não editáveis."
  - Dica: "Para trocar de banco, feche o harness e abra com INICIAR --banco."
  - Falha de conexão: StatusTag Atenção com a causa provável ("o toolbox não respondeu em
    127.0.0.1:9080; o launcher deve ter avisado no terminal") e botão "Usar Demonstração".
- Tag do topo: "PostgreSQL: 6 ferramentas" (nome do motor vem de `engine` do status).
- Guarda do `db_read_only_query` (seção 2.3) implementada em `callTool`, antes do
  `provider.call`.
- Sugestões iniciais em `config.json` para o modo banco: "Quais tabelas existem aqui?",
  "Descreva a tabela de produtos", "Procure colunas com CNPJ", "Mostre uma amostra de
  vendas". As do modo Demonstração continuam.
- Prompt de sistema ganha uma frase: "Para explorar o banco, comece por db_list_tables ou
  db_search_columns, depois db_describe_table, e só então db_read_only_query. Escreva só
  SELECT, no dialeto do motor informado por db_connection_status."
- Visual nos tokens do Design System CD2 já declarados em `:root`; nada de valor solto.
  Sem emoji, sem travessão, português do Brasil.

## 5. Testes

- **Receitas.** Cada YAML roda contra um banco real: PostgreSQL (uma base Instivo),
  SQL Server (ZeusManager), Oracle e MariaDB em contêineres Docker locais com uma tabela de
  exemplo, chave primária, chave estrangeira e comentário de coluna. Para cada motor, as seis
  ferramentas são invocadas com `toolbox invoke` e o resultado conferido: colunas do contrato
  presentes, `is_primary_key` e `foreign_key_references` corretos, `db_read_only_query` com
  `DELETE` falhando e com `SELECT 1; SELECT 2` falhando.
- **Launcher.** Em Mac, Windows e Linux: primeira execução (pergunta e grava), segunda
  execução (não pergunta), `--banco` (pergunta de novo), opção `0`, credencial errada
  (cai em Demonstração com aviso), portas 8080/9080 ocupadas (avança o par), encerramento
  mata os dois processos. Conferir que `db.env` tem permissão `600` e que o pen drive não
  contém senha (`grep -r` por ela).
- **Front.** Conecta e mostra o bloco de status; lista as seis; guarda recusa `DELETE`,
  `select ...; drop` e aceita `WITH x AS (...) SELECT`; modo Archeo e Demonstração seguem
  funcionando; falha do toolbox mostra Atenção e o botão de Demonstração.
- **Preparo.** Pen drive novo baixa os quatro binários, checksums batem, `CD2_TOOLBOX_PLATFORMS`
  limita o download.

## 6. Documentação

- README: nova seção "3. Conectar a um banco de dados" (a do Archeo vira 3b), tabela de
  motores e portas, aviso de conta de leitura, onde fica `db.env`, como trocar (`--banco`),
  tamanho extra do pen drive. Checklist ganha "conta de leitura criada e testada".
- `docs/criar-pendrive.md`: etapa do toolbox, tamanhos, `CD2_TOOLBOX_PLATFORMS`.
- `docs/index.html` (site): o passo "conecta ao Archeo" passa a citar os quatro bancos.
- `VERSION`: 0.4.0.

## Fora de escopo

- Mais de uma conexão ao mesmo tempo.
- Edição das ferramentas pela interface (são fixas, como no Archeo).
- Oracle via wallet, Kerberos ou TNS; MySQL com TLS obrigatório (ficam para quando houver
  pedido real).
- Autenticação no toolbox local: ele só escuta em `127.0.0.1` com origem restrita, que é o
  mesmo nível de proteção do llamafile hoje.
