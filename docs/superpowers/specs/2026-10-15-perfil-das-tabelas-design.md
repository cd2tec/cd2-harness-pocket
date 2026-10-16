# Harness Pocket: perfil das tabelas para escolher a tabela certa

Data: 2026-10-15. Versão alvo: 0.9.0. Continua a v0.8.0 e o commit `272064e` (ligações entre
tabelas, trava de soma em dobro e views no `db_catalog`).

## Objetivo

Quando a pessoa pergunta "qual o valor total da venda", o roteiro de relatórios precisa escolher a
tabela de vendas, e não um cadastro que só tem "venda" no nome. Hoje o ranking (`rankTables`) olha
só nomes de tabela e de coluna. No ZeusManager, usado como referência, a pergunta cai em
`tab_mercadoria_tipo_venda` (cadastro de preço por tipo de venda, 169 mil linhas) em vez de
`view_resumo_venda` (movimento de vendas): os dois empatam em pontos e o desempate pelo número de
linhas favorece a tabela, porque view não tem contagem.

**Vale para qualquer banco de ERP.** O ZeusManager é referência, não alvo. Nenhuma regra pode
depender de nome específico de um ERP.

## O que define sucesso

- Pergunta de medida (total, faturamento, quanto, média, por mês) escolhe tabela de movimento ou
  de itens de movimento, não cadastro nem parâmetro, em bancos com nomes em português ou inglês,
  com ou sem prefixo.
- A pessoa pode perguntar desde o primeiro segundo depois de conectar; a análise nunca bloqueia.
- Continua valendo: nenhum número exibido passa pelo modelo, e nenhuma consulta pode pesar no
  banco de produção do cliente.

## Decisões já tomadas

| Tema | Decisão |
|---|---|
| Abordagem | Híbrida. Perfil determinístico ao conectar (segundos) + descrição de cada tabela pelo modelo, em segundo plano. |
| Quando roda | Ao conectar o banco, antes do ranking: analisar só as candidatas não resgataria a tabela certa que ficou de fora. |
| Bloqueio | Nenhum. Perguntas funcionam durante a análise; a qualidade sobe conforme ela avança. |
| Onde guarda | Em lugar nenhum. Tudo fica na memória da página; reconectou, refaz. Nada do banco do cliente vai para disco. |
| Quem decide o papel | A regra determinística. O papel sugerido pelo modelo só vale para tabela que a regra deixou indefinida. |
| Generalidade | Só sinais genéricos: tipo da coluna, formato dos valores na amostra, variação, colunas de auditoria, nomes comuns em português e inglês. |
| cd2-ctl | Sem mudança. Tudo no navegador, com as ferramentas do toolbox que já existem. |

## Arquitetura

```
conectar ──► db_catalog ──► catálogo (como hoje)
                 │
                 ├──► perfil determinístico: db_sample_table de cada tabela (10 linhas)
                 │        └──► papel + colunas úteis ──► rankTables usa o papel   [segundos]
                 │
                 └──► fila do modelo (em segundo plano, uma tabela por vez)
                          └──► descrição de uma frase ──► rankTables e prompt usam   [minutos]

pergunta ──► fila pausa ──► roteiro de relatórios (como hoje) ──► fila retoma
```

| Unidade | Papel | Depende de |
|---|---|---|
| `web/perfil.js` (novo) | Lógica pura: lê colunas e amostra, devolve o papel da tabela e as colunas úteis. Sem modelo, sem DOM. | catalog.js (tokens) |
| `web/descricao.js` (novo) | Fila de descrição: ordem, pausa, chamada ao modelo, validação da resposta. Recebe `callModel` e `sample` injetados. | perfil.js |
| `web/catalog.js` | `rankTables` passa a considerar papel e descrição; "preço" sai dos sinônimos de faturamento. | perfil.js |
| `web/ask.js` | `buildMessages` mostra papel, colunas úteis e descrição de cada tabela. | — |
| `web/index.html` | Orquestra a análise ao conectar, pausa a fila durante a pergunta, mostra a faixa animada. | todos |

## 1. Perfil determinístico (`web/perfil.js`)

**Amostra.** `db_sample_table` de cada tabela do catálogo, guardando até 10 linhas. No máximo 2
consultas ao mesmo tempo; views por último e uma de cada vez (ver seção 5). Cada amostra usa o
prazo de 15 s do `toolRunner`. As linhas ficam só na memória.

**Leitura de cada coluna** (nome em português e inglês, com e sem prefixo; tipo; valores da amostra):

| Sinal | Como reconhece |
|---|---|
| Data de movimento | Tipo data/hora, nome que não é de auditoria, valores variando na amostra. Auditoria: cadastro, inclusão, criação, alteração, atualização, `created`, `updated`, `modified`, `inserted`. |
| Valor total | Número que não é chave, com nome de valor, total, `amount`, `total`; marcado como total, salvo quando o nome diz unitário (`unit`, `unitario`, `preco_unit`). |
| Valor unitário / preço | Número com nome de preço, `price`, unitário. |
| Quantidade | `qtd`, `qtde`, `quant`, `quantidade`, `qty`, `quantity`. |
| Chave | Regra de chave que já existe (`isKey`); quando é diferente em todas as linhas da amostra, é identificador do registro. |
| Auditoria | Coluna de usuário (`usuario`, `user`, `operador_alteracao`) junto de data de auditoria. |
| Descrição | `ds_`, `nm_`, descrição, nome, `name`, `description`, `title`. |
| Chave/valor | Colunas com nome de chave e valor (`chave`, `key`, `parametro`, `param`, `valor`, `value`, `setting`) e valor em texto. |

**Papel da tabela.** Pontuação por papel a partir dos sinais; o nome da tabela só reforça
(mov, venda, sale, order, pedido, nota, invoice, cupom, lançamento, transação, item, line, config,
param, setting, cadastro):

| Papel | Sinais fortes |
|---|---|
| `movimento` | Data de movimento + (valor total ou quantidade) + identificador variando por linha. |
| `itens` | Chave que liga a uma tabela de movimento (pelas ligações já existentes) + chave de produto + quantidade ou valor; ou "item"/"line" no nome com ligação a tabela de movimento. |
| `cadastro` | Descrição e/ou auditoria, sem data de movimento. Preço unitário sem data de movimento é cadastro (tabela de preços). |
| `parametro` | Até 8 colunas, par chave/valor em texto. |
| `vazia` | Amostra sem nenhuma linha, mesmo que a estatística do banco diga outra coisa. |
| `indefinida` | Nenhum papel com vantagem clara, ou amostra indisponível sem sinais suficientes nas colunas. |

Saída por tabela: `{ papel, colunas:{ data, valor, quantidade }, amostra:true|false }`. Amostra
que falha (sem permissão, prazo) não derruba nada: o papel sai só das colunas.

## 2. Ranking com papel (`web/catalog.js`)

**Tipo de pergunta**, pelas palavras dela:

- **Medida**: total, faturamento, receita, valor, quanto, soma, média, ticket, por mês/dia/ano, vendeu, vendemos.
- **Entidade**: "quantos <entidade>", "lista de", "cadastro de", "quais <entidade>" sem palavra de medida.

**Ajuste na nota** (somado à nota atual; valores finais calibrados pelos testes e pela avaliação):

| Papel | Pergunta de medida | Pergunta de entidade |
|---|---|---|
| movimento | sobe forte | neutro |
| itens | sobe (forte se a pergunta cita produto, departamento, categoria ou item) | neutro |
| cadastro | desce | sobe |
| parametro | desce forte | desce forte |
| vazia | sai do ranking | sai do ranking |
| indefinida | neutro | neutro |

**Descrição do modelo**: quando existe, as palavras dela contam como palavras da tabela, com peso
menor que o nome.

**Outros ajustes:** "preço" sai do grupo de sinônimos de faturamento; view sem contagem de linhas
não perde o desempate por volume.

## 3. Fila de descrição pelo modelo (`web/descricao.js`)

- **Ordem:** movimento, itens, indefinida, cadastro. Vazias e parâmetros não entram.
- **Uma tabela por vez.** Antes de cada chamada, a fila confere se há pergunta em andamento; se
  houver, espera ela terminar.
- **Entrada:** nome, colunas e tipos, e 5 linhas da amostra (cada valor cortado em 40 caracteres).
- **Saída:** JSON validado por schema, `{ "descricao": string, "papel": enum }`. `descricao` limpa
  de quebras de linha e controles e cortada em 160 caracteres.
- **Uso:** a descrição entra no ranking e no prompt. O papel do modelo só substitui `indefinida`.
- **Proteção:** a amostra pode conter texto escrito como instrução. A descrição entra no prompt
  marcada como descrição, cortada; guarda de SQL, trava de soma em dobro e conta de leitura
  continuam valendo.
- **Tempo:** com GPU, menos de 1 s por tabela; só CPU, 2 a 5 s (300 tabelas, até uns 25 min).
- **Falhas:** erro ou resposta inválida numa tabela, ela fica sem descrição e a fila segue. Duas
  falhas de conexão seguidas com o modelo param a fila; o perfil determinístico continua valendo.
- **Troca de banco:** usa a mesma geração (`catalogGen`) do catálogo; análise de banco antigo é
  descartada.

## 4. Prompt e interface

**Prompt** (`buildMessages`): cada tabela passa a vir com papel, colunas úteis e descrição, por
exemplo `- view_resumo_venda (view, movimento; data: dta_movimento; valor: vlr_total_venda): Resumo
de cada venda do PDV... | colunas: ...`.

**Faixa animada** (`web/index.html`), logo abaixo da barra superior, sem cobrir a conversa:

| Fase | Texto |
|---|---|
| Perfil determinístico | "Lendo as tabelas… 42 de 300" |
| Fila do modelo | "Entendendo as tabelas… 87 de 300 (dá para ir perguntando)" |
| Fim | "Banco entendido: 300 tabelas" por alguns segundos, depois some |

Robô em pixel art no estilo do terminal (`core/robo.txt`), desenhado em SVG ou CSS no próprio
`index.html`, nas cores da CD2, sem biblioteca. Com "reduzir movimento", o robô fica parado e o
texto de progresso continua.

## 5. Proteção do banco

- `db_sample_table` já limita a 20 linhas, e só leitura.
- No máximo 2 amostras ao mesmo tempo; views por último e uma de cada vez. View pode esconder uma
  consulta pesada, e no SQL Server e no Oracle o banco continua executando depois que o front para
  de esperar.
- Prazo de 15 s por amostra (o mesmo do roteiro).
- Uma amostra por tabela por conexão; nada é refeito enquanto a página está aberta.

## 6. Testes e avaliação

**Testes automáticos** (`node --test`):

- `perfil.js` com tabelas de exemplo em três estilos: o ERP atual (português, prefixos); um ERP em
  inglês sem prefixo (`orders`, `order_lines`, `products`, `price_list`, `settings`, `audit_log`);
  e estruturas com o formato das do ZeusManager, mas com outros nomes.
- Bordas: estatística desatualizada (amostra vazia), view sem contagem, amostra sem permissão,
  empate de sinais.
- `rankTables`: pergunta de medida escolhe movimento, não cadastro de preço; "quantos produtos"
  escolhe cadastro; vazia some; indefinida mantém a nota de hoje.
- `descricao.js` com modelo falso: ordem, pausa durante pergunta, falha numa tabela, modelo fora
  do ar, troca de banco no meio, descrição longa ou com quebra de linha.

**Avaliação com modelo de verdade:**

- Segundo banco de avaliação (`tests/eval/seed/postgres-erp2.sql`), em inglês, com tabelas que
  confundem: lista de preços, parâmetros, tabelas vazias, auditoria e uma view de vendas sem
  contagem. Umas 20 perguntas próprias (`tests/eval/perguntas-erp2.json`).
- Critérios: os dois bancos passam o portão de 70%; o banco atual não cai abaixo de 19 de 20;
  nenhum dos dois mostra mais números errados do que antes.
- ZeusManager, conferido na mão: "qual o valor total da venda" e "faturamento por loja" escolhem
  `view_resumo_venda`. Não vira teste automático: o banco não vai para o repositório.

## 7. Documentação

README: uma linha na seção do modo Banco de dados explicando a análise das tabelas ao conectar e a
faixa de progresso; o critério "nada do banco do cliente vai para disco" continua valendo.

## Fora de escopo

- Guardar a análise em disco ou no pen drive.
- Mudanças no `cd2-ctl`.
- A pergunta ambígua "média de itens por cupom".
- Troca de modelo conforme o computador.
