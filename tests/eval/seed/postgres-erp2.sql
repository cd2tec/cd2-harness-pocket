-- ERP de avaliação 2: nomes em inglês, sem prefixo, no padrão <entidade>_id, com tabelas que
-- confundem o ranking (lista de preços, parâmetros, auditoria grande, tabelas vazias) e uma view de
-- vendas sem contagem de linhas. Perguntas em tests/eval/perguntas-erp2.json.
CREATE TABLE stores (id integer PRIMARY KEY, name varchar(40) NOT NULL, state char(2));
CREATE TABLE categories (id integer PRIMARY KEY, name varchar(40) NOT NULL);
CREATE TABLE products (id integer PRIMARY KEY, name varchar(80) NOT NULL, category_id integer REFERENCES categories, created_at timestamp, updated_at timestamp);
CREATE TABLE customers (id integer PRIMARY KEY, name varchar(80), state char(2), created_at timestamp);
CREATE TABLE sales_orders (id integer PRIMARY KEY, store_id integer REFERENCES stores, customer_id integer REFERENCES customers, order_date date NOT NULL, total_amount numeric(12,2));
CREATE TABLE order_lines (order_id integer REFERENCES sales_orders, line_no integer, product_id integer REFERENCES products, quantity integer, line_total numeric(12,2), PRIMARY KEY (order_id, line_no));
CREATE TABLE price_list (product_id integer REFERENCES products, store_id integer REFERENCES stores, unit_price numeric(10,2), created_at timestamp, updated_at timestamp, updated_by varchar(30), PRIMARY KEY (product_id, store_id));
CREATE TABLE app_settings (setting_key varchar(40) PRIMARY KEY, setting_value text);
CREATE TABLE audit_log (id bigserial PRIMARY KEY, created_at timestamp, user_name varchar(30), action text);
CREATE TABLE legacy_sales_import (line integer, content text);
CREATE TABLE tmp_sync_orders (id integer, payload text);

INSERT INTO stores VALUES (1,'Downtown','SP'),(2,'Airport','SP'),(3,'Beach','RJ'),(4,'Mountain','MG');
INSERT INTO categories VALUES (1,'Grocery'),(2,'Drinks'),(3,'Produce'),(4,'Bakery'),(5,'Cleaning');
INSERT INTO products SELECT g, 'Product ' || g, (g % 5) + 1, TIMESTAMP '2025-01-01' + g * INTERVAL '1 day', TIMESTAMP '2025-06-01' + g * INTERVAL '1 hour' FROM generate_series(1, 100) g;
INSERT INTO customers SELECT g, 'Customer ' || g, CASE WHEN g % 10 < 6 THEN 'SP' WHEN g % 10 < 9 THEN 'RJ' ELSE 'MG' END, TIMESTAMP '2024-01-01' + g * INTERVAL '2 days' FROM generate_series(1, 250) g;
INSERT INTO sales_orders SELECT g, ((g * 3) % 4) + 1, CASE WHEN g % 6 = 0 THEN NULL ELSE ((g * 7) % 250) + 1 END, DATE '2026-01-01' + ((g * 13) % 240), 0 FROM generate_series(1, 4000) g;
INSERT INTO order_lines SELECT o.id, s, ((o.id * 17 + s * 11) % 100) + 1, ((o.id + s) % 4) + 1, 0 FROM sales_orders o CROSS JOIN generate_series(1, 3) s WHERE s <= (o.id % 3) + 1;
UPDATE order_lines SET line_total = round(quantity * (3 + product_id * 0.37), 2);
UPDATE sales_orders o SET total_amount = l.t FROM (SELECT order_id, sum(line_total) AS t FROM order_lines GROUP BY order_id) l WHERE l.order_id = o.id;
INSERT INTO price_list SELECT p.id, s.id, round(3 + p.id * 0.37 + s.id, 2), TIMESTAMP '2025-01-01', TIMESTAMP '2026-01-01' + p.id * INTERVAL '1 hour', 'admin' FROM products p CROSS JOIN stores s;
INSERT INTO app_settings VALUES ('currency','BRL'),('timezone','America/Sao_Paulo'),('version','2.3');
INSERT INTO audit_log (created_at, user_name, action) SELECT TIMESTAMP '2026-01-01' + g * INTERVAL '3 minutes', 'user' || (g % 5), 'update order ' || g FROM generate_series(1, 30000) g;
CREATE VIEW v_daily_sales AS SELECT o.order_date AS sale_date, s.name AS store, sum(o.total_amount) AS total FROM sales_orders o JOIN stores s ON s.id = o.store_id GROUP BY o.order_date, s.name;
ANALYZE;
