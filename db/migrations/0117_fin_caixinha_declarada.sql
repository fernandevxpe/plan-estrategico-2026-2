-- As caixinhas ganham nome — declarado, porque a API não transmite.
--
-- ---------------------------------------------------------------------------
-- POR QUE O NOME NÃO VEM DA FONTE
-- ---------------------------------------------------------------------------
-- Medido posição a posição na 0115: nas 66 posições do Polp, `name` tem UM
-- valor distinto ("CDB - NU FINANCEIRA S.A. ...") e `number`, `code`, `isin`,
-- `owner`, `institution`, `metadata` e `provider_id` são nulos em 66/66.
--
-- A razão é estrutural, não falha de integração: o Open Finance transmite a
-- camada de INVESTIMENTO — cada caixinha é, por baixo, um punhado de CDBs. A
-- "caixinha" é agrupamento do APP do Nubank, uma camada acima, e essa camada
-- não trafega.
--
-- ---------------------------------------------------------------------------
-- DE ONDE VEM ESTE DADO
-- ---------------------------------------------------------------------------
-- Print da tela "Minha organização" do app do Nubank, enviado pelo Fernando em
-- 18/08/2026 às 11:24:
--
--   Impostos e tributos ..... R$ 18.958,74   rendimento R$ 223,50
--   reserva de obras ........ R$  7.897,07   rendimento R$   0,00
--   Comissionamento ......... R$    334,00   rendimento R$   8,00
--   Caixa Livre ............. sem valor exibido
--   ------------------------------------------------------------
--   total exibido ........... R$ 27.189,81   rendimento R$ 231,50
--
-- Isto responde a dúvida 67, que perguntava se as caixinhas têm finalidade
-- declarada ou são só onde a sobra rende. **Têm finalidade**, e ela é de
-- gestão: imposto, obra e comissão são exatamente as três obrigações que a
-- empresa precisa provisionar.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTE DADO NÃO É
-- ---------------------------------------------------------------------------
-- NÃO é o saldo das posições, e não substitui `fin_caixinha_posicao_v`.
--
-- As 18 posições ativas somam R$ 27.700,17 cotadas em **15/08**; o print é de
-- **18/08** e soma R$ 27.189,81. A diferença de R$ 510,36 é de três dias, não
-- de erro — e as duas medidas continuam separadas de propósito, porque uma vem
-- da API com data e a outra é uma foto que uma pessoa leu na tela.
--
-- NÃO existe mapeamento posição → caixinha. 18 lotes de CDB agrupados em 4
-- caixinhas, e o vínculo mora só no app. Inventar o rateio faria a soma fechar
-- e a informação mentir.

CREATE TABLE IF NOT EXISTS fin_caixinha_declarada (
  id             bigserial PRIMARY KEY,
  entity_id      bigint NOT NULL REFERENCES fin_entity(id),
  account_id     bigint NOT NULL REFERENCES fin_account(id),
  nome           text   NOT NULL,
  saldo_cents    bigint NOT NULL CHECK (saldo_cents >= 0),
  rendimento_cents bigint,
  declarado_em   date   NOT NULL,
  declarado_por  text   NOT NULL,
  fonte          text   NOT NULL CHECK (fonte IN ('print_do_app','extrato_pdf','informado','outro')),
  observacao     text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, nome, declarado_em)
);

COMMENT ON TABLE fin_caixinha_declarada IS
  'Nome e saldo de cada caixinha, lidos por uma pessoa no app do Nubank. O Open Finance '
  'transmite a camada de investimento (os CDBs), não o agrupamento do app — por isso o nome '
  'só existe declarado. NÃO substitui fin_caixinha_posicao_v: aquela vem da API com data de '
  'cotação, esta é uma foto. Não há mapeamento posição → caixinha, e inventá-lo faria a soma '
  'fechar mentindo.';

INSERT INTO fin_caixinha_declarada
  (entity_id, account_id, nome, saldo_cents, rendimento_cents, declarado_em, declarado_por, fonte, observacao)
SELECT e.id, a.id, v.nome, v.saldo, v.rend, DATE '2026-08-18', 'Fernando', 'print_do_app', v.obs
  FROM fin_entity e
  JOIN fin_account a ON a.entity_id = e.id AND a.slug = 'nubank-caixinhas'
  CROSS JOIN (VALUES
    ('Impostos e tributos', 1895874::bigint,  22350::bigint, 'provisão de imposto'),
    ('reserva de obras',     789707::bigint,      0::bigint, 'provisão de obra'),
    ('Comissionamento',       33400::bigint,    800::bigint, 'provisão de comissão de vendas'),
    ('Caixa Livre',               0::bigint,   NULL::bigint, 'sem valor exibido no print')
  ) AS v(nome, saldo, rend, obs)
 WHERE e.slug = 'xpe'
ON CONFLICT (account_id, nome, declarado_em) DO UPDATE
  SET saldo_cents = EXCLUDED.saldo_cents, rendimento_cents = EXCLUDED.rendimento_cents;

-- ---------------------------------------------------------------------------
-- A view que mostra os dois lados sem fingir que se encaixam
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_caixinha_declarada_v AS
WITH ultimo AS (
  SELECT account_id, max(declarado_em) AS declarado_em
    FROM fin_caixinha_declarada GROUP BY account_id
),
decl AS (
  SELECT d.*, row_number() OVER (PARTITION BY d.account_id ORDER BY d.saldo_cents DESC) AS posicao
    FROM fin_caixinha_declarada d
    JOIN ultimo u ON u.account_id = d.account_id AND u.declarado_em = d.declarado_em
),
posicoes AS (
  SELECT account_id,
         count(*) FILTER (WHERE balance_cents > 0) AS posicoes_ativas,
         sum(balance_cents) FILTER (WHERE balance_cents > 0) AS api_cents,
         max(quoted_on) AS cotado_em
    FROM fin_caixinha_posicao_v GROUP BY account_id
)
SELECT d.account_id,
       d.posicao,
       d.nome,
       d.saldo_cents,
       d.rendimento_cents,
       d.declarado_em,
       d.declarado_por,
       d.observacao,
       sum(d.saldo_cents) OVER (PARTITION BY d.account_id)      AS declarado_total_cents,
       p.api_cents,
       p.posicoes_ativas,
       p.cotado_em,
       -- A diferença fica NOMEADA, não escondida. Duas fontes com datas
       -- diferentes vão divergir; o que não pode é a tela fingir que não.
       sum(d.saldo_cents) OVER (PARTITION BY d.account_id) - p.api_cents AS diferenca_cents,
       CASE
         WHEN p.cotado_em IS NULL THEN 'sem cotação da API para comparar'
         WHEN d.declarado_em > p.cotado_em::date
           THEN 'o print é de ' || d.declarado_em || ' e a cotação da API é de '
                || p.cotado_em::date || ' — a diferença é o intervalo, não erro'
         WHEN d.declarado_em < p.cotado_em::date
           THEN 'a cotação da API é mais nova que o print; o declarado envelheceu'
         ELSE 'mesma data: divergência aqui é achado'
       END AS diferenca_motivo
  FROM decl d
  LEFT JOIN posicoes p ON p.account_id = d.account_id;

COMMENT ON VIEW fin_caixinha_declarada_v IS
  'Caixinhas com nome (declarado no app) ao lado do total das posições (API), com a diferença '
  'nomeada e o motivo. As duas medidas NÃO se somam: são a mesma pilha de dinheiro vista de '
  'duas alturas e em datas diferentes.';

-- Pós-condição: o declarado tem de somar o que o print mostra.
DO $$
DECLARE v_soma bigint;
BEGIN
  SELECT sum(saldo_cents) INTO v_soma
    FROM fin_caixinha_declarada WHERE declarado_em = DATE '2026-08-18';
  IF v_soma <> 2718981 THEN
    RAISE EXCEPTION '[0117] soma declarada % ≠ R$ 27.189,81 do print', v_soma;
  END IF;
  RAISE NOTICE '[0117] 4 caixinhas declaradas, somando R$ 27.189,81';
END $$;
