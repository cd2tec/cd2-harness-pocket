# CD2 Harness (pen drive)

IA local da CD2 que roda direto do pen drive: plugou, clicou, abriu uma janela com a cara da CD2 e já conversa com um modelo Qwen3 4B rodando no próprio computador. Opcionalmente conecta a um MCP do Archeo para consultar dados reais.

## O que tem aqui

```
CD2-HARNESS/
  INICIAR-CD2-Windows.bat     <- duplo clique no Windows
  INICIAR-CD2-Mac.command     <- duplo clique no Mac
  iniciar-cd2-linux.sh        <- no Linux: sh iniciar-cd2-linux.sh
  web/                        <- a interface (index.html + config.json)
  core/                       <- scripts de preparo, de gravação e de inicialização
  bin/    (criado no preparo) <- llamafile
  models/ (criado no preparo) <- modelo .gguf

Só no repositório (não vão para o pen drive):
  GRAVAR-PENDRIVE-Windows.bat <- grava um pen drive pronto, no Windows
  GRAVAR-PENDRIVE-Mac.command <- idem, no Mac
  gravar-pendrive-linux.sh    <- idem, no Linux
  docs/criar-pendrive.md      <- o passo a passo completo
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

## 3. Conectar ao Archeo MCP

Botão **Ferramentas** no topo, escolher "Archeo MCP", informar a URL HTTP do servidor MCP e, se houver, o token.

- O token fica só na memória da aba. **Nunca grave token no `config.json`**: o pen drive vai circular.
- Use um MCP **somente leitura** e um token de escopo mínimo para o evento.
- O navegador fala direto com o servidor MCP, então o Archeo precisa liberar **CORS**:
  - origens: `http://127.0.0.1:8080` e `http://localhost:8080` (se a 8080 estiver ocupada, o launcher sobe a porta seguinte, até 8099; fixe com a variável `CD2_PORT` ou libere a faixa)
  - métodos: `POST`, `OPTIONS`
  - headers permitidos: `Authorization`, `Content-Type`, `Accept`, `Mcp-Session-Id`
  - header exposto: `Mcp-Session-Id`
- Para deixar o Archeo como padrão no stand, edite `web/config.json` (`mcp.mode` = `"mcp"` e `mcp.url`), sem token.

Sem internet ou sem MCP, o modo **Demonstração** funciona offline com dados fictícios, sempre rotulados como tal na resposta da ferramenta.

## 4. Personalizar

- `web/config.json`: nome, frase de efeito, prompt de sistema, sugestões da tela inicial.
- `web/index.html`: cores no bloco `:root` (azul escuro, cinza e dourado discreto). A marca "CD2" no topo é um placeholder tipográfico; troque pelo logo real.
- Outro modelo: coloque outro `.gguf` em `models/` e deixe só um arquivo lá. O launcher usa o primeiro que encontrar.
- Contexto maior: variável `CD2_CTX` (padrão 8192; mais contexto consome mais RAM).

## 5. Limitações e cuidados

- **Velocidade.** O Qwen3 4B Thinking "pensa" antes de responder. Em notebook só com CPU, espere poucos tokens por segundo e respostas que levam dezenas de segundos. O raciocínio aparece num bloco recolhível. Para demonstração ao vivo, considere um modelo Instruct (sem fase de raciocínio) e deixe o Thinking para quem quiser ver "a IA pensando".
- **Procedência do modelo.** O arquivo vem de um repositório pessoal (`pramodlohra`) que se apresenta como fine-tune do Qwen3-4B-Thinking-2507, com README mínimo. Antes de distribuir sob a marca da CD2, confirme licença e origem, ou use o GGUF oficial da Qwen.
- **Antivírus e SmartScreen.** O llamafile é um executável "poliglota" (APE) e alguns antivírus corporativos o bloqueiam. Teste nos notebooks em que vai rodar e leve o seu como reserva.
- **Mac.** Em Apple Silicon o llamafile precisa das Xcode Command Line Tools na primeira execução. Se o macOS reclamar de "desenvolvedor não verificado", libere em Ajustes do Sistema > Privacidade e Segurança.
- **Linux.** Se der erro de `run-detectors`/WINE, é `binfmt_misc`; a doc do llamafile traz o registro do `ape`.
- **Pen drive.** exFAT não guarda permissão de execução, então Mac/Linux rodam o motor a partir de uma cópia em `~/.cache/cd2-harness` (ou `~/Library/Caches/cd2-harness`). Nada é instalado e nada fica no sistema além desse cache.
- **Modelo pequeno erra.** O aviso na tela é proposital. Em números do Archeo, o dado vem da ferramenta; o texto em volta é do modelo.

## 6. Checklist antes do evento

- [ ] Preparo rodado e `CHECKSUMS.sha256` guardado
- [ ] Testado em Windows (Intel/AMD), Mac (Apple Silicon) e, se aplicável, Linux, em máquina "limpa"
- [ ] Testado com antivírus ligado
- [ ] CORS do Archeo liberado e token de evento criado (somente leitura, com expiração)
- [ ] Pen drive com cópia reserva (e um segundo pen drive igual)
- [ ] Um notebook seu com tudo já funcionando no stand

## 7. Atualizar e distribuir

O repositório guarda só o código (launchers, interface, scripts). O **llamafile** e o **modelo** não ficam no Git: são baixados pelo preparo e listados no `.gitignore`.

Fluxo de uma atualização:

1. Ajuste o código e/ou `web/config.json` e suba a mudança aqui (suba o número em `VERSION`).
2. Num pen drive já preparado, copie por cima só o que mudou. Normalmente basta a pasta `web/` e a pasta `core/`; `bin/` e `models/` ficam.
3. Para um pen drive novo: rode o gravador (`GRAVAR-PENDRIVE-*`), que formata, baixa do cache e confere. Ver [docs/criar-pendrive.md](docs/criar-pendrive.md).
4. Duplicar em série: com um pen drive aprovado, copie a pasta inteira (incluindo `bin/` e `models/`) para os demais, sem rodar o preparo de novo, e compare o `CHECKSUMS.sha256`.

Fim de linha: `.bat` e `.ps1` usam CRLF e `.sh`/`.command` usam LF (definido em `.gitattributes`). Se editar no Windows, não troque isso, ou o launcher do Mac/Linux quebra.

## 8. Licenças e origem dos componentes

Este código é Apache 2.0 (ver `LICENSE`). O harness baixa, mas não redistribui no repositório:

- **llamafile** (Mozilla.ai, Apache 2.0), de https://github.com/mozilla-ai/llamafile
- **Modelo GGUF** (configurável em `CD2_MODEL_URL`): confira licença e origem antes de distribuir os pen drives sob a marca da CD2.
