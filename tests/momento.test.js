'use strict';
// Testes do momento da conversa (web/momento.js). Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../web/momento.js');
const em = (h, min, dia) => new Date(2026, 9, dia || 14, h, min || 0); // outubro de 2026; 14 é quarta-feira

test('período do dia pelo relógio', () => {
  const casos = [[0, 30, 'madrugada'], [4, 59, 'madrugada'], [5, 0, 'cedo'], [7, 59, 'cedo'], [8, 0, 'manha'], [11, 29, 'manha'],
    [11, 30, 'almoco'], [13, 59, 'almoco'], [14, 0, 'tarde'], [17, 59, 'tarde'], [18, 0, 'noite'], [21, 59, 'noite'], [22, 0, 'tardeNoite'], [23, 59, 'tardeNoite']];
  for(const [h, m, id] of casos) assert.equal(M.periodo(em(h, m)).id, id, h + 'h' + m);
});

test('cumprimento formal: bom dia até o meio-dia, boa tarde até as 18h, boa noite depois', () => {
  assert.equal(M.saudacaoCurta(em(6)), 'Bom dia');
  assert.equal(M.saudacaoCurta(em(11, 45)), 'Bom dia');
  assert.equal(M.saudacaoCurta(em(12, 10)), 'Boa tarde');
  assert.equal(M.saudacaoCurta(em(15)), 'Boa tarde');
  assert.equal(M.saudacaoCurta(em(19)), 'Boa noite');
  assert.equal(M.saudacaoCurta(em(2)), 'Boa noite');
});

test('estação do hemisfério sul', () => {
  assert.equal(M.estacao(new Date(2026, 0, 10)), 'verao');
  assert.equal(M.estacao(new Date(2026, 3, 10)), 'outono');
  assert.equal(M.estacao(new Date(2026, 6, 10)), 'inverno');
  assert.equal(M.estacao(new Date(2026, 9, 10)), 'primavera');
  assert.equal(M.estacao(new Date(2026, 11, 10)), 'verao');
});

test('descrição do momento em português', () => {
  assert.equal(M.descrever(em(14, 5, 16)), 'sexta-feira, 16 de outubro de 2026, 14h05 (tarde)');
});

test('ganchos: período, dia da semana e época do mês entram no sorteio', () => {
  const sexta = M.ganchosDe(em(15, 0, 16));
  assert.ok(sexta.some(g => /sextou/.test(g)));
  assert.ok(sexta.some(g => /soninho|fuçar/.test(g)));
  assert.ok(M.ganchosDe(em(12, 30, 2)).some(g => /começo de mês/.test(g)));
  assert.ok(M.ganchosDe(em(12, 30, 28)).some(g => /fim de mês/.test(g)));
  assert.ok(M.ganchosDe(em(12, 30)).some(g => /almoçar/.test(g)));
  assert.ok(M.ganchosDe(new Date(2026, 11, 10, 10)).some(g => /dezembro/.test(g)));
});

test('contexto da primeira resposta pede saudação e gancho sorteados', () => {
  const c = M.contexto(em(6, 15), { primeira:true, rnd:() => 0 });
  assert.match(c, /quarta-feira, 14 de outubro de 2026, 06h15 \(começo da manhã\)/);
  assert.match(c, /saudação brasileira/);
  assert.match(c, /"Olá!"/);
  assert.match(c, /"acordou cedo hoje/);
});

test('contexto das respostas seguintes não repete a saudação', () => {
  const c = M.contexto(em(15), { primeira:false });
  assert.match(c, /não repita a saudação/);
  assert.doesNotMatch(c, /Abra a resposta/);
});

test('sorteio varia a saudação', () => {
  const vistos = new Set();
  for(let i = 0; i < 40; i++) vistos.add(/por exemplo "([^"]+)"/.exec(M.contexto(em(9), { primeira:true }))[1]);
  assert.ok(vistos.size >= 5, [...vistos].join(' | '));
});
