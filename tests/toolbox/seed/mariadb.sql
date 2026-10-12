-- Banco de teste da receita MariaDB/MySQL (tests/toolbox/check-recipe.sh mariadb)
CREATE TABLE produto (id INT AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(100) NOT NULL COMMENT 'Descricao do produto', preco DECIMAL(10,2));
CREATE TABLE venda (id INT AUTO_INCREMENT PRIMARY KEY, produto_id INT NOT NULL, qtd INT,
  CONSTRAINT fk_venda_produto FOREIGN KEY (produto_id) REFERENCES produto(id));
CREATE VIEW v_venda AS SELECT v.id, p.nome, v.qtd FROM venda v JOIN produto p ON p.id = v.produto_id;
INSERT INTO produto (nome, preco) SELECT CONCAT('produto ', seq), seq * 1.5 FROM seq_1_to_25;
INSERT INTO venda (produto_id, qtd) VALUES (1, 2), (2, 5);
ANALYZE TABLE produto;
