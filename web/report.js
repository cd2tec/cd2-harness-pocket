/* Saídas do roteiro de relatórios: CSV para o Excel em pt-BR e o HTML do relatório impresso
   (Imprimir/PDF do navegador), com logo e contato da CD2 no rodapé. Nada vai para o pen drive. */
(function(root){
"use strict";
function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
// Decimal com vírgula para o Excel em português; texto que começa como fórmula ganha apóstrofo.
function cell(v){
  if(v == null) return '';
  let s;
  if(typeof v === 'number') s = String(v).replace('.', ',');
  else if(/^\s*-?\d+\.\d+\s*$/.test(String(v))) s = String(v).trim().replace('.', ',');
  else s = String(v);
  if(/^[=+@]/.test(s) || /^-(?!\d)/.test(s)) s = "'" + s;
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(colunas, linhas){
  const out = [colunas.map(cell).join(';')];
  for(const r of linhas) out.push(colunas.map(c => cell(r[c])).join(';'));
  return '﻿' + out.join('\r\n') + '\r\n';
}
function fileName(d){
  const p = n => String(n).padStart(2, '0');
  return 'cd2-relatorio-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.csv';
}
function printHtml(o){
  return '<div class="pr">'
    + '<header class="pr-head">' + (o.logoSvg || '') + '<span>Relatório gerado pelo Harness Pocket</span></header>'
    + '<p class="pr-q">Pergunta: ' + esc(o.pergunta) + '</p>'
    + '<h1>' + esc(o.titulo) + '</h1><p>' + esc(o.frase) + '</p>'
    + (o.aviso ? '<p>' + esc(o.aviso) + '</p>' : '')
    + '<div class="pr-viz">' + (o.visualHtml || '') + '</div>'
    + '<h2>Dados</h2>' + (o.tabelaHtml || '')
    + '<h2>Consulta usada</h2><pre>' + esc(o.sql) + '</pre>'
    + '<p class="pr-meta">' + esc(o.quando) + ' · ' + esc(o.motor) + (o.base ? ' · base ' + esc(o.base) : '') + '</p>'
    + '<footer class="pr-foot">' + (o.logoSvg || '') + '<span>CD2 Tech' + (o.contato ? ' · ' + esc(o.contato) : '') + '</span></footer>'
    + '</div>';
}

const api = { toCsv, fileName, printHtml };
if(typeof module !== 'undefined' && module.exports) module.exports = api; else root.CD2Report = api;
})(typeof window !== 'undefined' ? window : globalThis);
