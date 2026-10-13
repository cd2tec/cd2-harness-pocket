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
test('sameResult: rótulo de texto trocado com números certos é recusado; caixa e acento são livres', () => {
  assert.equal(sameResult([{ loja:'A', total:10 }, { loja:'B', total:20 }], [{ loja:'A', total:20 }, { loja:'B', total:10 }]), false);
  assert.equal(sameResult([{ loja:'Loja Açaí', total:10 }], [{ nome:'  loja acai ', total:10 }]), true);
});
