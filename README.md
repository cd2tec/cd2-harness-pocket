<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logos/cd2-logo-horizontal-negativo.svg">
    <img src="docs/assets/logos/cd2-logo-horizontal.svg" alt="CD2 Tech" width="200">
  </picture>
</p>

# CD2 Harness

**A IA da CD2 rodando 100% no seu computador, direto do pen drive.**

Plugou, clicou, conversou. O harness abre uma janela com a identidade da CD2 e conversa com um modelo Qwen3 4B rodando no próprio computador, sem instalar nada e sem mandar dados para a nuvem. Quando houver rede, conecta a um MCP do Archeo para consultar dados reais.

[Site do projeto](https://cd2tec.github.io/cd2-harness-pocket/) · [Passo a passo do pen drive](docs/criar-pendrive.md) · [Baixar ZIP](https://github.com/cd2tec/cd2-harness-pocket/archive/refs/heads/main.zip)

## O que tem aqui

```
CD2-HARNESS/
  INICIAR-CD2-Windows.bat     <- duplo clique no Windows
  INICIAR-CD2-Mac.command     <- duplo clique no Mac
  iniciar-cd2-linux.sh        <- no Linux: sh iniciar-cd2-linux.sh
  web/                        <- a interface (index.html, config.json e fontes Manrope)
  core/                       <- scripts de preparo, de gravação e de inicialização
  bin/    (criado no preparo) <- llamafile
  bin/toolbox/ (criado no preparo) <- MCP Toolbox, um por sistema
  bin/ctl/ (criado no preparo) <- cd2-ctl, o controle do banco, um por sistema
  core/toolbox/               <- receitas SQL por motor
  models/ (criado no preparo) <- modelo .gguf

Só no repositório (não vão para o pen drive):
  GRAVAR-PENDRIVE-Windows.bat <- grava um pen drive pronto, no Windows
  GRAVAR-PENDRIVE-Mac.command <- idem, no Mac
  gravar-pendrive-linux.sh    <- idem, no Linux
  docs/criar-pendrive.md      <- o passo a passo completo
  docs/index.html             <- o site do projeto (GitHub Pages)
  ctl/                        <- código do cd2-ctl (Go), compilado pelo GitHub Actions
```

## 1. Criar o pen drive (uma vez, com internet)

Plugue um pen drive de 16 GB (USB 3) e rode o gravador do seu sistema:

| Sistema | Como gravar |
|---|---|
| Windows | duplo clique em `GRAVAR-PENDRIVE-Windows.bat` (pede administrador) |
| Mac | duplo clique em `GRAVAR-PENDRIVE-Mac.command` |
| Linux | `sh gravar-pendrive-linux.sh` |

Ele lista os pen drives, pede confirmação (digite `APAGAR`), formata em exFAT, baixa o llamafile e o modelo para um cache no seu computador, copia tudo, confere os checksums e ejeta. O segundo pen drive não baixa nada de novo. O passo a passo, o jeito manual e a lista de problemas conhecidos estão em [docs/criar-pendrive.md](docs/criar-pendrive.md).

Se preferir fazer na mão: formate em exFAT, copie esta pasta para o pen drive e rode o preparo (`core\prepare-windows.bat` no Windows, `sh core/prepare-unix.sh` no Mac/Linux). O preparo retoma downloads interrompidos e pula o que já estiver completo. Ele grava `CHECKSUMS.sha256`; guarde uma cópia fora do pen drive.

No evento **não precisa de internet**. Só o modo Archeo MCP precisa.

## 2. Usar

| Sistema | Como abrir |
|---|---|
| Windows | duplo clique em `INICIAR-CD2-Windows.bat` |
| Mac | duplo clique em `INICIAR-CD2-Mac.command` |
| Linux | `sh iniciar-cd2-linux.sh` |

O launcher escolhe uma porta livre, sobe o servidor só em `127.0.0.1` (não fica exposto na rede), tenta GPU e cai para CPU sozinho, e abre a interface como janela de aplicativo (Edge no Windows; Chrome/Edge/Brave se existirem no Mac/Linux). Para encerrar: ENTER na janela do Windows, Ctrl+C ou fechar o terminal no Mac/Linux.

Windows e Mac modernos **não executam nada automaticamente** ao plugar o pen drive. O "plugou e abriu" é, na prática, um duplo clique. Deixe o `.bat` com nome grande e visível; o resto fica nas subpastas.

## 3. Conectar a um banco de dados

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
- **Portas.** O launcher usa um trio que avança junto: P para o harness, P+1000 para o toolbox e P+3000 para o `cd2-ctl` (8080, 9080 e 11080 por padrão). Todos escutam só em `127.0.0.1`.
- Se o banco não responder em 15 segundos (senha errada, firewall), a tela mostra Atenção com o motivo e as últimas linhas do log, já filtradas.
- É preciso a variante certa em `bin/toolbox/` e `bin/ctl/` (`windows-amd64`, `darwin-arm64`, `darwin-amd64`, `linux-amd64`). O preparo baixa as quatro; `CD2_TOOLBOX_PLATFORMS` limita as duas pastas. Sem o `cd2-ctl` da plataforma, o launcher avisa e segue sem banco (Demonstração e Archeo continuam).

## 3b. Conectar ao Archeo MCP

Botão **Ferramentas** no topo, escolher "Archeo MCP", informar a URL do MCP (`https://archeo.cd2.com.br/api/mcp`) e clicar em **Entrar com a conta do Archeo**. A janela vai para o consentimento do Archeo, a pessoa autoriza o workspace e volta para o harness já conectado.

Como funciona por baixo (spec 041 do Archeo): OAuth 2.1 com Authorization Code + PKCE, registro dinâmico do cliente, escopo `mcp:tools:read`. O access token dura 15 minutos e o harness renova sozinho com o refresh token (30 dias, rotacionado a cada uso). Código em `web/oauth.js` e `web/mcp.js`, testes em `tests/`.

- **Nada fica no pen drive.** Access e refresh token moram no `sessionStorage`: fechou a aba, acabou o acesso. Só o `client_id` (público, não é segredo) fica no `localStorage` para não registrar o cliente de novo a cada recarga.
- O Archeo não exibe mais token estático na interface. O campo "Token estático" continua como plano B, caso a operação gere um por fora; ele tem prioridade sobre o login.
- **Gambiarra consciente:** o consentimento do Archeo só aceita cliente Codex ou Claude Code, e classifica pelo nome. Por isso o harness se registra como `CD2 Harness (Claude)` (constante `CLIENT_NAME` em `web/oauth.js`). Nos grants do workspace ele aparece como Claude Code. Quando o Archeo aceitar um kind próprio, basta trocar o nome.
- O navegador fala direto com o Archeo, então o servidor precisa liberar as origens do pen drive em **duas** variáveis (o launcher usa 8080 e, se ocupada, sobe até 8099; fixe com `CD2_PORT` ou libere a faixa):
  - `API_CORS_ORIGINS`: CORS do FastAPI para `/.well-known/*`, `/api/oauth/*` e `/api/mcp`. Ex.: `["http://127.0.0.1:8080","http://localhost:8080"]`
  - `DATABASE_MCP_BROWSER_ORIGINS`: allowlist do gateway `/api/mcp` contra DNS rebinding. Sem ela a resposta é `403 ORIGIN_REJECTED`, e o harness mostra "o Archeo recusou a origem".
- Erros que a tela explica: origem recusada (falta a env acima), "sem permissão" (a pessoa não é membro do workspace) e falha de rede ou CORS (falta a primeira env).
- Para deixar o Archeo como padrão no stand, edite `web/config.json` (`mcp.mode` = `"mcp"` e `mcp.url`). Cada pessoa ainda precisa entrar com a própria conta.

Sem internet ou sem MCP, o modo **Demonstração** funciona offline com dados fictícios, sempre rotulados como tal na resposta da ferramenta.

## 4. Personalizar

- `web/config.json`: nome, frase de efeito, prompt de sistema, sugestões da tela inicial.
- `web/index.html`: a interface segue o Design System da CD2 (ver seção 5). As cores e medidas são os tokens do sistema, declarados no bloco `:root`; ajuste ali, nunca com valor solto no meio do CSS.
- Outro modelo: coloque outro `.gguf` em `models/` e deixe só um arquivo lá. O launcher usa o primeiro que encontrar.
- Contexto maior: variável `CD2_CTX` (padrão 8192; mais contexto consome mais RAM).
- `web/config.json`: `mcp.mode` aceita `toolbox` (padrão), `demo` e `mcp`; `suggestions` pode ser uma lista única ou uma por modo.

## 5. Identidade visual

Interface, site e README seguem o **Design System CD2 Tech** (Manual de Marca CD2 2026).

| Elemento | Como aparece aqui |
|---|---|
| Cores | `blue-retail` #0000ff na barra superior, botões e destaques; `white-human` #f2f2f2 de fundo; texto em `ink` #0d1233. `yellow-like` #dbff2a só como energia pontual (modo Demonstração, terceiro passo do site). |
| Tema | Claro (White_HUMAN) na interface do harness, como pede o sistema para sistemas e dashboards; azul (Blue_RETAIL) no hero e no rodapé do site. |
| Tipografia | Manrope (400 a 800), embutida em `web/fonts/` e `docs/assets/fonts/` em WOFF2 com subconjunto latino. Funciona offline. Licença SIL OFL 1.1, gravada nos próprios arquivos. |
| Logo | `cd2-logo-horizontal` negativa (branca) sobre a barra azul; símbolo como avatar da IA e favicon. Arquivos em `docs/assets/logos/`. |
| Componentes | Botões em pílula (primário, secundário), StatusTag para o estado do modelo e das ferramentas (Concluído = pronto, Em melhoria = Demonstração, Atenção = offline ou erro), SectionHeader com eyebrow e régua de 240px, blocos de conexão no site. |
| Movimento | Só transições de 150 ms em cor. O indicador de carregamento é uma barra que desliza; nada gira, pulsa ou salta, e ele para com "reduzir movimento". |

Regras de texto que valem para qualquer mudança: português do Brasil, frases curtas, sem emoji e sem travessão. A tagline de mercado "Para operações que não podem parar." é a única que vai para fora.

## 6. Limitações e cuidados

- **Velocidade.** O Qwen3 4B Thinking "pensa" antes de responder. Em notebook só com CPU, espere poucos tokens por segundo e respostas que levam dezenas de segundos. O raciocínio aparece num bloco recolhível. Para demonstração ao vivo, considere um modelo Instruct (sem fase de raciocínio) e deixe o Thinking para quem quiser ver "a IA pensando".
- **Procedência do modelo.** O arquivo vem de um repositório pessoal (`pramodlohra`) que se apresenta como fine-tune do Qwen3-4B-Thinking-2507, com README mínimo. Antes de distribuir sob a marca da CD2, confirme licença e origem, ou use o GGUF oficial da Qwen.
- **Antivírus e SmartScreen.** O llamafile é um executável "poliglota" (APE) e alguns antivírus corporativos o bloqueiam. Teste nos notebooks em que vai rodar e leve o seu como reserva.
- **Mac.** Em Apple Silicon o llamafile precisa das Xcode Command Line Tools na primeira execução. Se o macOS reclamar de "desenvolvedor não verificado", libere em Ajustes do Sistema > Privacidade e Segurança.
- **Linux.** Se der erro de `run-detectors`/WINE, é `binfmt_misc`; a doc do llamafile traz o registro do `ape`.
- **Pen drive.** exFAT não guarda permissão de execução, então Mac/Linux rodam o motor a partir de uma cópia em `~/.cache/cd2-harness` (ou `~/Library/Caches/cd2-harness`). Nada é instalado e nada fica no sistema além desse cache.
- **Oracle.** Driver Go puro: sem wallet, Kerberos ou TNS. **SQL Server** em Docker para teste é amd64; no Apple Silicon ligue Rosetta.
- **Modelo pequeno erra.** O aviso na tela é proposital. Em números do Archeo, o dado vem da ferramenta; o texto em volta é do modelo.

## 7. Checklist antes do evento

- [ ] Preparo rodado e `CHECKSUMS.sha256` guardado
- [ ] Testado em Windows (Intel/AMD), Mac (Apple Silicon) e, se aplicável, Linux, em máquina "limpa"
- [ ] Testado com antivírus ligado
- [ ] Origens do pen drive liberadas no Archeo (`API_CORS_ORIGINS` e `DATABASE_MCP_BROWSER_ORIGINS`) e login testado com a conta que vai ao evento
- [ ] Conta de leitura do banco criada e testada pela tela Ferramentas num notebook que não é o seu
- [ ] `node --test` verde na raiz do repo
- [ ] Pen drive com cópia reserva (e um segundo pen drive igual)
- [ ] Um notebook seu com tudo já funcionando no stand

## 8. Atualizar e distribuir

O repositório guarda só o código (launchers, interface, scripts). O **llamafile** e o **modelo** não ficam no Git: são baixados pelo preparo e listados no `.gitignore`.

Fluxo de uma atualização:

1. Ajuste o código e/ou `web/config.json` e suba a mudança aqui (suba o número em `VERSION`).
2. Num pen drive já preparado, copie por cima só o que mudou. Normalmente basta a pasta `web/` e a pasta `core/`; `bin/` (incluindo `bin/toolbox/` e `bin/ctl/`) e `models/` ficam. Se o `cd2-ctl` mudou de versão, rode o preparo de novo: ele baixa só o que mudou.
3. Para um pen drive novo: rode o gravador (`GRAVAR-PENDRIVE-*`), que formata, baixa do cache e confere. Ver [docs/criar-pendrive.md](docs/criar-pendrive.md).
4. Duplicar em série: com um pen drive aprovado, copie a pasta inteira (incluindo `bin/` e `models/`) para os demais, sem rodar o preparo de novo, e compare o `CHECKSUMS.sha256`.

O site do projeto é o `docs/index.html`, publicado pelo GitHub Pages a partir da pasta `/docs` do branch `main` (Settings > Pages > Deploy from a branch). O `docs/.nojekyll` faz o Pages servir os arquivos como estão.

Fim de linha: `.bat` e `.ps1` usam CRLF e `.sh`/`.command` usam LF (definido em `.gitattributes`). Se editar no Windows, não troque isso, ou o launcher do Mac/Linux quebra.

### Para quem mexe no `cd2-ctl`

Só quem altera a pasta `ctl/` precisa de Go (1.23 ou mais novo; no Mac, `brew install go`). O resto do projeto continua sem build.

- Testes: `cd ctl && go test ./...` e, com o Postgres do Docker no ar (`docker compose -f tests/toolbox/docker-compose.yml up -d postgres`), `sh tests/ctl/e2e.sh`. A CI (`.github/workflows/ci.yml`) roda `go test` e `node --test` em todo pull request e push na `main`.
- Teste local sem release: `sh ctl/build.sh` compila para `bin/ctl/<plataforma>/`, e `CD2_CTL_LOCAL=1 sh core/prepare-unix.sh` usa esse binário em vez de baixar.
- Publicar uma versão: suba `CTL_VERSION` em `core/prepare-unix.sh` e `core/prepare-windows.ps1`, faça o merge e crie a tag, por exemplo `git tag ctl-v0.6.1 && git push origin ctl-v0.6.1`. O workflow `.github/workflows/ctl-release.yml` compila as quatro plataformas e anexa `cd2-ctl-<os>-<arch>` e `SHA256SUMS` ao release; o preparo confere o checksum antes de usar. `CD2_CTL_VERSION` escolhe outra versão no preparo, nunca "latest".

## 9. Licenças e origem dos componentes

Este código é Apache 2.0 (ver `LICENSE`). O harness baixa, mas não redistribui no repositório:

- **Manrope** (The Manrope Project Authors, SIL Open Font License 1.1), embutida em subconjunto em `web/fonts/` e `docs/assets/fonts/`
- **llamafile** (Mozilla.ai, Apache 2.0), de https://github.com/mozilla-ai/llamafile
- **MCP Toolbox for Databases** (Google, Apache 2.0), de https://github.com/googleapis/mcp-toolbox
- **cd2-ctl** (código deste repositório, Apache 2.0, pasta `ctl/`), compilado pelo GitHub Actions e baixado do release `ctl-v<versão>` deste repositório
- **Modelo GGUF** (configurável em `CD2_MODEL_URL`): confira licença e origem antes de distribuir os pen drives sob a marca da CD2.
