-- ERP de varejo de mentira para a avaliacao (tests/eval). Dados deterministicos, jan a set de 2026.
CREATE TABLE loja (cd_loja integer PRIMARY KEY, nm_loja varchar(40) NOT NULL, uf char(2));
CREATE TABLE departamento (cd_depto integer PRIMARY KEY, ds_depto varchar(40) NOT NULL);
CREATE TABLE produto (cd_prod integer PRIMARY KEY, ds_prod varchar(80) NOT NULL, cd_depto integer REFERENCES departamento, vlr_custo numeric(10,2));
CREATE TABLE cliente (cd_cli integer PRIMARY KEY, nm_cli varchar(80), uf char(2), dt_cad date);
CREATE TABLE mov_venda (nr_cupom integer PRIMARY KEY, cd_loja integer REFERENCES loja, cd_cli integer REFERENCES cliente, dt_mov date NOT NULL, vlr_tot numeric(12,2));
CREATE TABLE mov_venda_item (nr_cupom integer REFERENCES mov_venda, seq integer, cd_prod integer REFERENCES produto, qtd_it integer, vlr_tot_it numeric(12,2), PRIMARY KEY (nr_cupom, seq));
-- tabelas de ruido, que nao deveriam ser escolhidas
CREATE TABLE log_integracao (id bigserial PRIMARY KEY, dt_log timestamp, msg text);
CREATE TABLE cfg_parametro (chave varchar(40) PRIMARY KEY, valor text);
CREATE TABLE aux_tmp_import (linha integer, conteudo text);
CREATE TABLE usuario_sistema (cd_usu integer PRIMARY KEY, nm_usu varchar(40), dt_ult_acesso timestamp);

INSERT INTO loja VALUES (1,'Loja Centro','SP'),(2,'Loja Norte','SP'),(3,'Loja Praia','RJ'),(4,'Loja Serra','MG');
INSERT INTO departamento VALUES (1,'Mercearia'),(2,'Bebidas'),(3,'Hortifruti'),(4,'Acougue'),(5,'Padaria'),(6,'Limpeza');
INSERT INTO produto SELECT g, 'Produto ' || g, CASE WHEN g % 60 < 25 THEN 1 WHEN g % 60 < 40 THEN 2 WHEN g % 60 < 50 THEN 3 WHEN g % 60 < 56 THEN 4 WHEN g % 60 < 59 THEN 5 ELSE 6 END, round((2 + (g % 17) * 1.35 + g * 0.01)::numeric, 2) FROM generate_series(1, 120) g;
INSERT INTO cliente SELECT g, 'Cliente ' || g, CASE WHEN g % 20 < 10 THEN 'SP' WHEN g % 20 < 16 THEN 'RJ' WHEN g % 20 < 19 THEN 'MG' ELSE 'PR' END, DATE '2025-01-01' + (g % 500) FROM generate_series(1, 300) g;
INSERT INTO mov_venda SELECT g, ((g * 7) % 4) + 1, CASE WHEN g % 5 = 0 THEN NULL ELSE ((g * 13) % 300) + 1 END, DATE '2026-01-01' + ((g * 11) % 273), 0 FROM generate_series(1, 6000) g;
INSERT INTO mov_venda_item SELECT c.nr_cupom, s, ((c.nr_cupom * 31 + s * 17) % 120) + 1, ((c.nr_cupom + s) % 5) + 1, 0 FROM mov_venda c CROSS JOIN generate_series(1, 5) s WHERE s <= 1 + (c.nr_cupom % 4);
UPDATE mov_venda_item i SET vlr_tot_it = round(i.qtd_it * p.vlr_custo * 1.3, 2) FROM produto p WHERE p.cd_prod = i.cd_prod;
UPDATE mov_venda v SET vlr_tot = s.t FROM (SELECT nr_cupom, sum(vlr_tot_it) AS t FROM mov_venda_item GROUP BY nr_cupom) s WHERE s.nr_cupom = v.nr_cupom;
INSERT INTO log_integracao (dt_log, msg) SELECT TIMESTAMP '2026-01-01' + g * INTERVAL '7 minutes', 'evento ' || g FROM generate_series(1, 20000) g;
INSERT INTO cfg_parametro VALUES ('versao','1.0'),('moeda','BRL');
INSERT INTO usuario_sistema VALUES (1,'admin',now()),(2,'caixa01',now());
ANALYZE;
