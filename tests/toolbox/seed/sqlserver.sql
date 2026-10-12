-- Banco de teste da receita SQL Server (aplicado com sqlcmd, ver o plano / README dos testes)
CREATE DATABASE cd2;
GO
USE cd2;
CREATE TABLE produto (id INT IDENTITY PRIMARY KEY, nome NVARCHAR(100) NOT NULL, preco DECIMAL(10,2));
EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Descricao do produto',
  @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'produto', @level2type = N'COLUMN', @level2name = N'nome';
CREATE TABLE venda (id INT IDENTITY PRIMARY KEY, produto_id INT NOT NULL REFERENCES produto(id), qtd INT);
GO
CREATE VIEW v_venda AS SELECT v.id, p.nome, v.qtd FROM venda v JOIN produto p ON p.id = v.produto_id;
GO
INSERT INTO produto (nome, preco)
SELECT 'produto ' + CAST(n AS VARCHAR(5)), n * 1.5
  FROM (SELECT TOP (25) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects) x;
INSERT INTO venda (produto_id, qtd) VALUES (1, 2), (2, 5);
GO
