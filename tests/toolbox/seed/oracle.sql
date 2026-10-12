-- Banco de teste da receita Oracle (roda como SYSDBA no container gvenzl/oracle-free)
ALTER SESSION SET CONTAINER = FREEPDB1;
ALTER SESSION SET CURRENT_SCHEMA = CD2;
CREATE TABLE produto (id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, nome VARCHAR2(100) NOT NULL, preco NUMBER(10,2));
COMMENT ON COLUMN produto.nome IS 'Descricao do produto';
CREATE TABLE venda (id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, produto_id NUMBER NOT NULL REFERENCES produto(id), qtd NUMBER);
CREATE VIEW v_venda AS SELECT v.id, p.nome, v.qtd FROM venda v JOIN produto p ON p.id = v.produto_id;
INSERT INTO produto (nome, preco) SELECT 'produto ' || LEVEL, LEVEL * 1.5 FROM dual CONNECT BY LEVEL <= 25;
INSERT INTO venda (produto_id, qtd) VALUES (1, 2);
INSERT INTO venda (produto_id, qtd) VALUES (2, 5);
COMMIT;
EXEC DBMS_STATS.GATHER_TABLE_STATS('CD2', 'PRODUTO');
