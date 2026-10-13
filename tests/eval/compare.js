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
