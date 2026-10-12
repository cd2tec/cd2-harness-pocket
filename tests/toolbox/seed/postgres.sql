-- Banco de teste da receita PostgreSQL (tests/toolbox/check-recipe.sh postgres)
CREATE TABLE produto (id serial PRIMARY KEY, nome text NOT NULL, preco numeric(10,2));
COMMENT ON COLUMN produto.nome IS 'Descricao do produto';
CREATE TABLE venda (id serial PRIMARY KEY, produto_id integer NOT NULL REFERENCES produto(id), qtd integer);
CREATE VIEW v_venda AS SELECT v.id, p.nome, v.qtd FROM venda v JOIN produto p ON p.id = v.produto_id;
INSERT INTO produto (nome, preco) SELECT 'produto ' || g, g * 1.5 FROM generate_series(1, 25) g;
INSERT INTO venda (produto_id, qtd) VALUES (1, 2), (2, 5);
ANALYZE produto;
