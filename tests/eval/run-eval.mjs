// Avaliação do roteiro de relatórios contra o llamafile e o toolbox locais (rode por tests/eval/rodar.sh).
// Para cada pergunta: roda o SQL de referência, roda o roteiro de verdade e compara os números.
// Variáveis: CD2_EVAL_MODEL_URL, CD2_EVAL_TOOLBOX_URL, CD2_EVAL_SCHEMA (0 desliga response_format), CD2_EVAL_META (padrão 70).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { McpClient } = require('../../web/mcp.js');
const Cat = require('../../web/catalog.js');
const Ask = require('../../web/ask.js');
const Tb = require('../../web/toolbox.js');
const Perfil = require('../../web/perfil.js');
const Desc = require('../../web/descricao.js');
const { sameResult } = require('./compare.js');
const perguntas = require(process.env.CD2_EVAL_PERGUNTAS || './perguntas.json');

const MODEL_URL = process.env.CD2_EVAL_MODEL_URL || 'http://127.0.0.1:18080/v1/chat/completions';
const TOOLBOX_URL = process.env.CD2_EVAL_TOOLBOX_URL || 'http://127.0.0.1:19080/mcp';
const META = Number(process.env.CD2_EVAL_META || 70);

const client = new McpClient(TOOLBOX_URL, { fetch:(...a) => fetch(...a), origin:new URL(MODEL_URL).origin });
await client.init();
const status = Tb.parseStatus(await client.call('db_connection_status', {}));
const cat = Ask.parseRows(await client.call('db_catalog', {}));
if(!status || !cat.ok) throw new Error('Toolbox sem status ou sem db_catalog: ' + (cat.error || ''));
const catalog = Cat.buildCatalog(cat.rows);
// Perfil das tabelas como o front faz ao conectar: amostra, papel e, se ligada, a descrição pelo modelo.
// O prazo de cada amostra fica dentro de Perfil.amostrar.
const sample = async nome => {
  const r = await client.call('db_sample_table', { table_name:nome }).then(Ask.parseRows, () => null);
  return r && r.ok ? r.rows : null;
};
const amostras = await Perfil.amostrar(catalog, sample, {});
console.log('Papéis: ' + JSON.stringify(Perfil.analisarCatalogo(catalog, amostras)));
if(process.env.CD2_EVAL_DESCRICAO !== '0'){
  const t0 = Date.now();
  const d = await Desc.executarFila({ catalog, amostras,
    callModel:Ask.modelCaller({ fetch:(...a) => fetch(...a), url:MODEL_URL, useSchema:true, schema:Desc.SCHEMA, schemaName:'tabela', maxTokens:200 }) });
  console.log('Descrições: ' + d.descritas + ' descritas de ' + d.feitos + ' processadas em ' + ((Date.now() - t0) / 1000).toFixed(0) + 's' + (d.parou ? ' (parou: ' + d.parou + ')' : ''));
}
const callModel = Ask.modelCaller({ fetch:(...a) => fetch(...a), url:MODEL_URL, useSchema:process.env.CD2_EVAL_SCHEMA !== '0' });
const runSql = Ask.toolRunner(client, { timeoutMs:15000 });

// [OK] acertou; [ERRADO] mostrou um resultado errado (o pior caso); [NAO] falhou e disse que falhou.
let acertos = 0, errados = 0, visuais = 0, tempo = 0;
for(const [i, p] of perguntas.entries()){
  const ref = await runSql(p.sql);
  if(!ref.ok) throw new Error('SQL de referência da pergunta ' + (i + 1) + ' falhou: ' + ref.error);
  const t0 = Date.now();
  const r = await Ask.ask({ pergunta:p.pergunta, catalog, motor:status.engine, versao:String(status.db_version || '').split('\n')[0].trim(), schema:status.schema, usuario:status.user, callModel, runSql });
  const s = (Date.now() - t0) / 1000; tempo += s;
  const ok = r.ok && sameResult(ref.rows, r.todas);
  if(ok) acertos++; else if(r.ok) errados++;
  if(r.ok && p.visual.includes(r.visual)) visuais++;
  const tag = ok ? '[OK]     ' : r.ok ? '[ERRADO] ' : '[NAO]    ';
  console.log(tag + s.toFixed(1).padStart(5) + 's  ' + (r.ok ? r.visual : r.motivo).padEnd(14) + p.pergunta + (ok || !r.sql ? '' : '\n           SQL: ' + r.sql));
}
const n = perguntas.length, exato = acertos / n * 100, pct = Math.round(exato);
console.log('\nAcerto: ' + acertos + '/' + n + ' (' + pct + '%). Visual aceitável: ' + visuais + '/' + n
  + '. Tempo médio: ' + (tempo / n).toFixed(1) + 's.');
console.log('Errado exibido: ' + errados + '/' + n + '.');
if(errados > 0) console.log('ALERTA: respostas erradas exibidas');
console.log('PORTÃO (' + META + '%): ' + (exato >= META ? 'PASSOU' : 'NÃO PASSOU'));
process.exit(exato >= META ? 0 : 1);
