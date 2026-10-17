/* O momento da conversa pelo relógio deste computador: período do dia, dia da semana, época do mês
   e estação (hemisfério sul). Vira uma instrução para o modelo abrir a resposta com uma saudação
   brasileira e, às vezes, um comentário leve sobre a hora. A saudação e o gancho são sorteados aqui,
   não pelo modelo: um modelo pequeno repete sempre a mesma frase. Nada sai do computador. */
(function(root){
"use strict";
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Em minutos desde a meia-noite: [início, id, rótulo, cumprimento formal do período].
const PERIODOS = [
  [0, 'madrugada', 'madrugada', 'Boa noite'],
  [5 * 60, 'cedo', 'começo da manhã', 'Bom dia'],
  [8 * 60, 'manha', 'manhã', 'Bom dia'],
  [11 * 60 + 30, 'almoco', 'hora do almoço', 'Boa tarde'],
  [14 * 60, 'tarde', 'tarde', 'Boa tarde'],
  [18 * 60, 'noite', 'noite', 'Boa noite'],
  [22 * 60, 'tardeNoite', 'fim da noite', 'Boa noite']
];
function periodo(d){
  const m = d.getHours() * 60 + d.getMinutes();
  let p = PERIODOS[0];
  for(const x of PERIODOS) if(m >= x[0]) p = x;
  // Antes do meio-dia ainda é "bom dia", mesmo no começo do almoço.
  const formal = (p[1] === 'almoco' && d.getHours() < 12) ? 'Bom dia' : p[3];
  return { id:p[1], rotulo:p[2], formal };
}
function estacao(d){
  const m = d.getMonth();
  return m === 11 || m <= 1 ? 'verao' : m <= 4 ? 'outono' : m <= 7 ? 'inverno' : 'primavera';
}

// Saudações comuns no Brasil. As do período entram junto com as que servem a qualquer hora.
const SAUDACOES = {
  qualquer:['Olá!', 'Oi!', 'Opa!', 'E aí!', 'Oi, tudo bem?', 'Opa, tudo bem?', 'E aí, tudo certo?', 'Olá, como vai?', 'Oi, tudo bom?', 'Opa, beleza?', 'Fala!', 'Oi, tudo joia?'],
  madrugada:['Boa noite... ou já é bom dia?', 'Opa, boa madrugada!'],
  cedo:['Bom dia!', 'Opa, bom dia!', 'Bom dia, tudo bem?', 'Bom diaaa!'],
  manha:['Bom dia!', 'Opa, bom dia!', 'Bom dia, como vai?', 'Bom dia, tudo certo?'],
  almoco:['Boa tarde!', 'Opa, boa tarde!', 'Oi, boa tarde!'],
  tarde:['Boa tarde!', 'Opa, boa tarde!', 'Boa tarde, tudo bem?', 'Boa tarde, como vai?'],
  noite:['Boa noite!', 'Opa, boa noite!', 'Boa noite, tudo bem?'],
  tardeNoite:['Boa noite!', 'Opa, boa noite!']
};
// Ganchos para um comentário leve. O modelo pode dizer do jeito dele.
const GANCHOS = {
  madrugada:['está madrugando por aqui? Eu não durmo, mas eu tenho desculpa: sou um programa',
    'a essa hora, na loja, só o alarme está acordado', 'inventário de madrugada ou insônia mesmo?'],
  cedo:['acordou cedo hoje, hein? Já passou o café?', 'chegou antes de a loja abrir', 'antes das oito e já trabalhando: horário de padeiro'],
  manha:['manhã é a hora boa de olhar a venda de ontem', 'o café já foi, né?'],
  almoco:['hora do almoço e você aqui? Não vai almoçar, não?', 'prometo ser rápida para a comida não esfriar', 'pico do almoço na loja e você aqui comigo?'],
  tarde:['aquele soninho depois do almoço bate, mas número acorda qualquer um', 'tarde boa para fuçar nos números'],
  noite:['ainda trabalhando a essa hora?', 'loja fechando e você aqui comigo'],
  tardeNoite:['já está tarde, hein? Amanhã a loja abre cedo', 'última olhada nos números antes de dormir?'],
  segunda:['segunda-feira, a semana está só começando'],
  sexta:['sextou! Só não vale sextar no fechamento do caixa'],
  sabado:['sábado é dia de loja cheia, e você aqui comigo?'],
  domingo:['trabalhando no domingo? Respeito'],
  inicioMes:['começo de mês: salário caiu e a loja enche'],
  fimMes:['fim de mês: hora de fechar o mês e correr atrás da meta'],
  dezembro:['dezembro: a temporada mais movimentada do varejo'],
  verao:['com esse calor, bebida gelada sai que é uma beleza'],
  outono:['outono chegando, o movimento muda junto'],
  inverno:['friozinho: chocolate quente e sopa saindo bem'],
  primavera:['primavera: dá até vontade de caprichar no hortifruti']
};
function ganchosDe(d){
  const p = periodo(d), dia = d.getDay(), n = d.getDate(), lista = [];
  // O período pesa mais: entra duas vezes no sorteio.
  lista.push(...GANCHOS[p.id], ...GANCHOS[p.id]);
  const nomeDia = { 0:'domingo', 1:'segunda', 5:'sexta', 6:'sabado' }[dia];
  if(nomeDia && p.id !== 'madrugada') lista.push(...GANCHOS[nomeDia]);
  if(n <= 6) lista.push(...GANCHOS.inicioMes);
  if(n >= 25) lista.push(...GANCHOS.fimMes);
  lista.push(...(d.getMonth() === 11 ? GANCHOS.dezembro : GANCHOS[estacao(d)]));
  return lista;
}
const sortear = (lista, rnd) => lista[Math.floor(rnd() * lista.length) % lista.length];

function descrever(d){
  const p = periodo(d), hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  return DIAS[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear() + ', ' + hh + 'h' + mm + ' (' + p.rotulo + ')';
}
// A instrução para o prompt de sistema. primeira: é a primeira resposta da conversa (ou mudou o período).
function contexto(d, opts){
  opts = opts || {};
  const rnd = opts.rnd || Math.random, p = periodo(d);
  const base = ' Agora, no relógio deste computador: ' + descrever(d) + '.';
  if(!opts.primeira) return base + ' Você já cumprimentou a pessoa nesta conversa: não repita a saudação, vá direto ao assunto com naturalidade, como uma pessoa conversando.';
  const sauda = sortear(SAUDACOES.qualquer.concat(SAUDACOES[p.id], SAUDACOES[p.id]), rnd);
  const gancho = sortear(ganchosDe(d), rnd);
  return base + ' Abra a resposta com uma saudação brasileira natural, por exemplo "' + sauda + '", e um comentário leve e bem-humorado sobre o momento, numa frase só, por exemplo: "' + gancho + '".'
    + ' Diga do seu jeito, sem copiar ao pé da letra, e depois responda a pergunta. Fale como uma pessoa simpática, nunca como robô.';
}
// Saudação curta para a tela inicial, sem o modelo.
function saudacaoCurta(d){ return periodo(d).formal; }

const api = { periodo, estacao, descrever, ganchosDe, contexto, saudacaoCurta, SAUDACOES, GANCHOS };
if(typeof module !== 'undefined' && module.exports) module.exports = api; else root.CD2Momento = api;
})(typeof window !== 'undefined' ? window : globalThis);
