# Harness Pocket: relatórios e gráficos a partir de qualquer banco

Data: 2026-10-13. Versão alvo: 0.7.0. Continua a v0.6.0 (configuração do banco pela tela com o
`cd2-ctl`, spec `2026-10-13-configuracao-banco-pela-tela-design.md`).

## Objetivo

O harness é uma isca para clientes da CD2. O cliente pluga o pen drive, conecta o banco dele e,
em poucos minutos, vê o próprio dado virar tabela, gráfico e um relatório impresso com a marca e o
contato da CD2. A conversão acontece fora do harness, pelo contato que sai no relatório.

Premissas que não mudam: roda do pen drive, 100% local, sem nuvem, sem instalar nada.

## O que define sucesso

- Pergunta livre, em português, sobre **qualquer banco plugado**, sem conhecer o esquema antes.
- Um gráfico certo sai em minutos, sem a pessoa saber o que perguntar (sugestões tiradas do banco dela).
- **Nenhum número exibido passa pelo modelo.** Errar um número no dado do cliente queima a CD2;
  dizer "não consegui" com honestidade não queima.
- O banco é de produção do cliente: nenhuma consulta pode travá-lo.

## Decisões já tomadas

| Tema | Decisão |
|---|---|
| Tipo de pergunta | Livre, sobre qualquer esquema. Sem receitas por ERP: os bancos são muitos e não temos acesso a eles. |
| Condução | No modo Banco de dados, um **roteiro fixo conduzido pelo front** substitui o laço de agente. Demonstração e Archeo continuam com o laço atual. |
| Chamadas ao modelo | Uma por pergunta no caso bom, duas no pior (uma nova tentativa após erro de SQL). |
| O que o modelo faz | Escolhe o SQL, o tipo de visual, as colunas dos eixos e o título. Nunca vê o resultado. |
| Frase de resumo | Montada pelo front a partir do resultado, por molde. O modelo não escreve números. |
| Gráficos | SVG desenhado à mão em `web/chart.js`, sem biblioteca, nas cores da CD2. Funciona offline. |
| Relatório | Imprimir/PDF pelo navegador e exportar CSV. Nada é gravado no pen drive. |
| Conversão | Fora do harness. Sem formulário de contato. O rodapé do relatório traz logo e contato da CD2. |
| Modelo padrão | Qwen3-4B-Instruct-2507, Q4_K_M, de fonte conhecida. A reserva é Qwen2.5-Coder-7B-Instruct. A avaliação decide. |
| Proteção do banco | Timeout de 15 s por consulta e LIMIT imposto pelo front, além da guarda de SELECT e da conta de leitura. |

## Arquitetura

```
conectar ──► db_catalog (1 consulta) ──► catálogo no navegador ──► 4 perguntas sugeridas
pergunta ──► busca no catálogo ──► 3 a 5 tabelas ──► modelo (1 chamada, JSON)
         ──► guarda SQL + LIMIT ──► toolbox (com timeout) ──► visual + frase de molde
         └─ erro de SQL: devolve ao modelo 1 vez; falhou de novo: "não consegui"
```

| Peça | Responsabilidade | Depende de |
|---|---|---|
| `db_catalog` (nas 4 receitas YAML) | Uma consulta ao dicionário do banco: tabela, coluna, tipo, linhas estimadas. | toolbox |
| `web/catalog.js` | Monta o catálogo, ranqueia tabelas pela pergunta, gera sugestões. Lógica pura. | nada |
| `web/ask.js` | O roteiro: prompt, chamada ao modelo, validação, execução, nova tentativa, escolha do visual, frase de molde. | catalog.js, toolbox.js, um `callModel` e um `runSql` injetados |
| `web/chart.js` | Tabela, cartão de número e gráficos de barra, linha e pizza em SVG. Lógica pura que devolve string SVG/HTML. | nada |
| `web/index.html` | Liga as peças, mostra a resposta, botões Imprimir/PDF e CSV, CSS de impressão. | todas acima |
| `tests/eval/` | Banco com cara de ERP, perguntas com resultado esperado e script de avaliação. | Docker, llamafile |

Cada módulo de `web/` segue o padrão de `toolbox.js` e `mcp.js`: funciona no navegador como
global e no Node via `module.exports`, para ser testado com `node --test`.

## 1. `db_catalog` nas receitas do toolbox

Ferramenta nova nas quatro receitas (`core/toolbox/*.yaml`), somente leitura, sem parâmetros de SQL
livre. Devolve uma linha por coluna: `table_name`, `table_type` (TABLE ou VIEW), `num_rows`
(estimativa do dicionário), `column_name`, `data_type`, `ordinal`.

- Fonte por motor: `pg_class`/`pg_attribute` (PostgreSQL), `ALL_TAB_COLUMNS` + `ALL_TABLES`
  (Oracle), `information_schema.COLUMNS` + `TABLES` (MariaDB/MySQL), `sys.columns` + `sys.tables`
  + `sys.partitions` (SQL Server). Sempre restrito ao schema configurado.
- Teto: as **300 tabelas** com mais linhas estimadas (views entram com peso de tabela média) e no
  máximo **60 colunas por tabela**, para não varrer dicionários com milhares de objetos.
- A verificação das receitas com Docker (`tests/toolbox/check-recipe.sh`) passa a cobrir `db_catalog`.

## 2. Catálogo e sugestões (`web/catalog.js`)

**Montagem.** `buildCatalog(rows)` agrupa as linhas do `db_catalog` em
`{ tables: [{ name, type, rows, columns: [{ name, type, kind }] }] }`. `kind` classifica cada
coluna em `data`, `numero`, `texto` ou `outro` a partir do tipo do motor.

**Normalização.** Nomes e pergunta passam por: minúsculas, sem acento, `_` e camelCase viram
espaço, prefixos/sufixos comuns de ERP são separados (`vlr`, `qtd`, `dt`, `cod`, `id`, `tot`).

**Sinônimos.** Uma tabela fixa e pequena, pt e en, no próprio módulo. Exemplos: venda/sale/sales/
pedido/order, produto/product/item/sku/mercadoria, cliente/customer/client, data/date/dt/dia/mes/
ano, valor/vlr/total/amount/price/preco, quantidade/qtd/qty, loja/store/filial/branch.

**Ranqueamento.** `rankTables(catalog, pergunta)` dá nota a cada tabela:
- +3 por palavra da pergunta (ou sinônimo) que bate com o nome da tabela;
- +1 por palavra que bate com o nome de uma coluna (no máximo +5 por tabela);
- +1 se a tabela tem coluna `data`, +1 se tem coluna `numero`;
- desempate por número de linhas (log).

Tabelas com nota zero ficam de fora. As **5 primeiras** com nota > 0 vão para o modelo, cada uma
com até **25 colunas**, priorizando as que bateram com a pergunta, depois `data` e `numero`.

**Sugestões.** `suggest(catalog)` gera 4 perguntas a partir do próprio esquema, usando as tabelas
mais volumosas que tenham colunas `data` e `numero`:
"Total por mês em VENDAS", "Top 10 de PRODUTO por VALOR", "Quantos registros tem CLIENTE",
"Distribuição de VENDAS por LOJA". Nomes vêm do esquema, humanizados. Sem tabelas assim, sobram
sugestões de contagem. Elas substituem as sugestões fixas do `config.json` no modo Banco de dados.

## 3. O roteiro de uma pergunta (`web/ask.js`)

`ask({ pergunta, catalog, dialeto, callModel, runSql })` devolve um dos resultados:
`{ ok:true, visual, titulo, frase, colunas, linhas, sql, aviso? }` ou
`{ ok:false, motivo, sql? }`. `callModel` e `runSql` são injetados, o que permite testar com
modelo e banco falsos.

**Passo 1, tabelas.** `rankTables`. Sem candidatas: `{ ok:false, motivo:'sem_tabelas' }`, sem
chamar o modelo.

**Passo 2, modelo.** Mensagem de sistema com: dialeto do motor, as tabelas candidatas (nome,
colunas, tipos), as regras e 3 exemplos genéricos curtos (contagem, total por mês, top 10).
Regras: um único SELECT, sem ponto e vírgula; agregar no banco (GROUP BY); alias legível em
português para cada coluna do resultado; no máximo 50 linhas; só usar tabelas e colunas listadas.
Pede exatamente este JSON:

```json
{ "sql": "SELECT ...", "visual": "barra", "x": "mes", "y": "total", "titulo": "Vendas por mês" }
```

`visual` aceita `barra`, `linha`, `pizza`, `tabela`, `numero`. A requisição usa
`temperature: 0` e restringe a saída a JSON pelo `response_format` (com schema) do servidor do
llamafile. Se a versão embarcada não aceitar o campo, o parse tolerante extrai o primeiro objeto
`{...}` do texto. A primeira tarefa do plano confirma qual dos dois vale.

**Passo 3, validação.** JSON inválido ou `visual` fora da lista consome a única nova tentativa do
roteiro (a mesma do passo 4). Se a nova tentativa também falhar, ou se o modelo não responder:
`{ ok:false, motivo:'modelo' }`. O SQL passa pela `guardSql` que já existe e depois por `applyLimit` (seção 5).

**Passo 4, execução.** `runSql` chama `db_read_only_query`. Erro de SQL: se a nova tentativa ainda não foi usada, uma nova chamada ao modelo
com a mesma mensagem mais o SQL anterior e o texto do erro. Segundo erro:
`{ ok:false, motivo:'sql', sql }`. Timeout: `{ ok:false, motivo:'timeout', sql }`, sem nova
tentativa; no SQL Server e no Oracle, quando quem parou foi o prazo do front, `motivo:'timeout_front'`.
Resultado vazio, ou só com nulos: `{ ok:false, motivo:'vazio', sql }`. Antes de ir ao banco, o SQL
precisa ler ao menos uma tabela listada; se não ler, gasta a nova tentativa. Parar aborta o request ao
toolbox (fetch com signal), e o prazo de 15 s também.

**Passo 5, visual pelo resultado.** O pedido do modelo é ajustado pelo dado:
- `x` vazio ou fora do resultado, com uma só coluna de texto: ela vira `x`; `y` vazio ou fora, com uma
  só coluna numérica de medida (fora tempo e chave): ela vira `y`; sem inferência possível: `tabela`;
- uma linha com uma coluna numérica: `numero`; `numero` pedido com uma coluna de texto junto: `barra`
  de uma barra, para o rótulo aparecer; `numero` escolhe a medida, não a coluna de tempo nem a chave;
- `pizza` com mais de 6 categorias ou com valor negativo: `barra`;
- `linha` sem `x` do tipo data (ou texto com cara de data/mês): `barra`;
- `barra` no tempo com mais de 20 pontos: `linha`, sem corte;
- `barra` com mais de 20 categorias: as 20 maiores, com `aviso` dizendo quantas ficaram de fora;
- `y` não numérico: `tabela`.

**Passo 6, frase de molde.** `frase` é montada pelo front, nunca pelo modelo:
- `numero`: "Resultado: 1.234."
- `barra`/`pizza`: "Maior: Bebidas, 12.430. Total: 58.900 em 9 categorias."
- `linha`: "De jan/2026 a set/2026. Maior valor em mar/2026: 8.120."
- `tabela`: "12 linhas."

O título vem do modelo, mas se trouxer número que não está na pergunta, vira a própria pergunta.

Números formatados em pt-BR (`Intl.NumberFormat`). Sem símbolo de moeda: o harness não sabe se a
coluna é dinheiro.

**Mensagens na tela** por `motivo`, em português simples, sempre com as sugestões ao lado:
`sem_tabelas` "Não achei tabelas sobre isso neste banco."; `sql` "Não consegui montar essa
consulta."; `timeout` "A consulta demorou demais e foi cancelada para proteger o banco.";
`timeout_front` "A consulta passou de 15 segundos e o harness parou de esperar. Ela pode continuar
rodando no servidor.";
`vazio` "A consulta não trouxe nenhuma linha."; `modelo` "O modelo não respondeu." O SQL tentado
fica num bloco recolhível.

## 4. Visual e relatório (`web/chart.js` e `web/index.html`)

`chart.js` expõe `render(visual, colunas, linhas, opts)` e devolve uma string com SVG ou HTML.
Barra horizontal (rótulos longos cabem), linha com pontos, pizza com legenda, tabela com cabeçalho
fixo e cartão de número grande. Cores dos tokens do Design System CD2 (blue-retail como série
principal, tons derivados para pizza), texto em Manrope. Sem animação. Rótulos e valores escapados.
`viewBox` com largura relativa, legível de 360 px a 1200 px.

Cada resposta bem-sucedida mostra: título, frase, visual, aviso (se houver), SQL recolhível e dois
botões:
- **CSV**: gera o arquivo no navegador (`Blob`, separador `;`, UTF-8 com BOM para o Excel) com
  todas as linhas recebidas.
- **Imprimir/PDF**: `window.print()` com CSS `@media print` que esconde a interface e mostra só o
  relatório daquela resposta: pergunta, título, frase, visual, tabela de dados, SQL usado, data e
  hora, motor e base, e o rodapé com logo e contato da CD2.

O contato do rodapé vem de `web/config.json`, campo novo `report.contact` (texto livre: site,
e-mail, telefone). Preencher antes do evento entra no checklist do README.

## 5. Proteção do banco

**LIMIT imposto.** `applyLimit(sql, motor, n)` em `web/toolbox.js` envolve a consulta:
`SELECT * FROM (<sql>) q LIMIT n` (PostgreSQL, MariaDB/MySQL), `SELECT TOP n * FROM (<sql>) q`
(SQL Server; o `ORDER BY` interno é preservado com `TOP` ou `OFFSET 0 ROWS` quando necessário),
`SELECT * FROM (<sql>) WHERE ROWNUM <= n` (Oracle). `n` = 200: é teto de segurança, acima das 50 linhas pedidas ao modelo. Testado
por motor nas receitas Docker.

**Timeout de 15 s por consulta.**

| Motor | Mecanismo |
|---|---|
| PostgreSQL | `statement_timeout: "15000"` em `queryParams`, junto com `default_transaction_read_only` |
| MariaDB | `SET STATEMENT max_statement_time=15 FOR <sql>` aplicado pelo front |
| MySQL | dica `/*+ MAX_EXECUTION_TIME(15000) */` aplicada pelo front |
| SQL Server e Oracle | Parâmetro de timeout do driver do toolbox, se existir. Se não existir, o front aborta a espera aos 15 s e o README recomenda limite de recurso na conta de leitura (Resource Governor; perfil com `CPU_PER_CALL` no Oracle) |

O plano verifica cada linha da tabela contra o toolbox v1.14.0 antes de implementar. MariaDB e
MySQL são distinguidos pela versão que `db_connection_status` já devolve.

## 6. Modelo

- Padrão: **Qwen3-4B-Instruct-2507, Q4_K_M**, baixado pelo preparo de fonte conhecida (repositório
  oficial da Qwen se publicar o GGUF; senão um quantizador estabelecido). A URL e o checksum ficam
  fixos no preparo, como hoje. Isso também resolve o risco de procedência do modelo atual
  registrado no README.
- Reserva: **Qwen2.5-Coder-7B-Instruct, Q4_K_M**. Só vira padrão se a avaliação (seção 7) mostrar
  ganho de acerto que compense o tempo e a RAM extras.
- `CD2_CTX` continua 8192: o roteiro manda só as tabelas candidatas, então cabe.
- O bloco "Raciocínio" continua funcionando para quem trocar por um modelo Thinking.

## 7. Testes e avaliação

**Unitários (`node --test`):**
- `catalog.test.js`: normalização, sinônimos, ranqueamento (pergunta → tabelas esperadas),
  sugestões, teto de colunas.
- `ask.test.js`: com `callModel`/`runSql` falsos, cobre caminho feliz, JSON inválido, erro de SQL
  com nova tentativa, segundo erro, timeout, vazio, sem tabelas e cada regra do passo 5; frase de
  molde por visual.
- `chart.test.js`: cada visual gera SVG/HTML válido, escapa rótulos, lida com valores zero e
  negativos.
- `toolbox.test.js`: `applyLimit` por motor e prefixos de timeout de MariaDB/MySQL.

**Avaliação (`tests/eval/`):**
- Seed nova com cara de ERP de varejo nos quatro motores: lojas, produtos, departamentos,
  clientes, vendas e itens de venda, com meses de dados e alguns nomes crípticos (`VLR_TOT_IT`,
  `DT_MOV`, `CD_PROD`), mais tabelas de ruído que não deveriam ser escolhidas.
- `perguntas.json`: 20 perguntas em português, cada uma com o resultado esperado (calculado por um
  SQL de referência) e o visual aceitável.
- `run-eval.mjs`: roda o `ask.js` real contra o llamafile e o toolbox locais, compara o resultado
  (mesmos valores, tolerância de arredondamento, ordem livre quando não pedida) e imprime acerto
  e tempo por pergunta e no total.
- **Portão:** 70% de acerto no PostgreSQL com o modelo padrão, em notebook só com CPU, antes de
  levar a cliente. O mesmo script decide entre o modelo padrão e o de reserva.

## 8. Documentação

- README: seção nova "Relatórios e gráficos" (como perguntar, o que o harness garante sobre os
  números, CSV e PDF), tabela de timeout por motor, recomendação de limite de recurso no SQL Server
  e no Oracle, `report.contact` no checklist do evento, modelo novo e o fim do aviso de procedência.
- Site (`docs/index.html`): um passo mostrando pergunta → gráfico → relatório.
- `VERSION` 0.7.0.

## Fora de escopo

- Receitas por ERP e camada semântica configurada pela pessoa.
- Painel com vários gráficos, filtros interativos, drill-down.
- Relatório salvo no pen drive, histórico entre sessões.
- Captura de contato ou qualquer formulário de lead.
- Gráficos nos modos Demonstração e Archeo.
- Biblioteca de gráficos externa.
