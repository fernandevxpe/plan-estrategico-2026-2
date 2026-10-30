-- As parcelas da planilha que JÁ FORAM PAGAS em 02/09 e 02/10 entram no contador.
--
-- O DEFEITO, MEDIDO EM 30/10/2026
-- -------------------------------
-- As 12 séries vivas da planilha (`fin_reembolso_item`) têm a última linha em
-- competência 2026-07, e `fin_reembolso_saldo_v` lê a última linha. Só que a
-- casa já pagou DUAS parcelas de cada uma depois disso: a linha de competência
-- M é paga no 1º dia útil de M+1, e as ordens de reembolso da folha
-- (`AAAA-MM|fin_person:N:reembolso`) de 2026-09 e 2026-10 estão `pago`.
-- O dono viu na tela "Curso LGR 03/10" quando o Jonildo já recebeu a 5/10.
--
-- Cada ordem fecha NO CENTAVO com "itens do app baixados por ela + uma parcela
-- de cada série" — então a parcela não é inventada, está dentro do PIX:
--
--   ordem          mês      pago        séries     app baixado   resto
--   PG-2026-0048   09  Gab   817,86      506,35      311,51        0
--   PG-2026-0099   10  Gab   895,01      506,35      388,66        0
--   PG-2026-0056   09  Jon   439,86       99,70      340,16        0
--   PG-2026-0102   10  Jon   889,25       99,70      789,55        0
--   PG-2026-0044   09  Fer 1.440,76    1.168,47      164,00      108,29 ← TV
--   PG-2026-0097   10  Fer 1.168,47    1.168,47        —           0
--   PG-2026-0026   09  Adr   103,11      103,11        —           0
--   PG-2026-0091   10  Adr   103,11      103,11        —           0
--   PG-2026-0038   09  Dec   331,87      331,87        —           0
--   PG-2026-0095   10  Dec   620,37      331,87      288,50        0
--
-- Os R$ 108,29 do Fernando em setembro são a parcela da TV, cancelada em 02/10
-- (`fin_reembolso_slug_cancelado`); ela fica fora daqui, como a 0194 decidiu.
--
-- O QUE ENTRA
-- -----------
-- 24 linhas: 12 séries × competências 2026-08 e 2026-09, parcela + 1 e + 2, só
-- quando a ordem do mês de caixa (competência + 1) da pessoa está `pago`. O
-- Adryan vai a 11/12 e 12/12 e a série dele quita.
--
--   saldo da planilha    R$ 17.134,47 → R$ 12.715,47  (−R$ 4.419,00 = 2 × 2.209,50)
--   a pagar no mês       cai R$ 103,11 — só a parcela do Adryan, que já acabou
--
-- Daqui para frente, `scripts/baixar-reembolso-pago.mjs` grava a mesma linha
-- quando a ordem do mês é paga e fecha no centavo; o ON CONFLICT o torna
-- idempotente com esta migration.

-- POR QUE AS PÓS-CONDIÇÕES SÃO RELATIVAS
-- --------------------------------------
-- Esta migration roda no boot do deploy, não agora. Até lá a conciliação de
-- hora em hora roda e alguém pode rodar `baixar-reembolso-pago.mjs --aplicar`
-- — que grava estas MESMAS linhas. Uma primeira versão contava
-- `criado_por = 'migration:0198'` = 24 e exigia saldo = 1.271.547 absoluto:
-- com o script rodado antes, ela inseriria 0 e derrubaria o boot. Por isso:
--   * o conjunto esperado é ancorado na linha de 2026-07 de cada série (que
--     não muda), não na "última linha";
--   * a prova é "cada linha esperada EXISTE com a parcela e o valor certos",
--     venha desta migration ou do script;
--   * o saldo tem de cair exatamente a soma do que ESTA migration inseriu.

CREATE TEMP TABLE _0198_antes AS
SELECT (SELECT coalesce(sum(saldo_cents), 0) FROM fin_reembolso_saldo_v)::bigint AS saldo_planilha,
       (SELECT coalesce(sum(valor_parcela_cents), 0) FROM fin_reembolso_saldo_unificado_v WHERE NOT quitado)::bigint AS a_pagar;

CREATE TEMP TABLE _0198_esperado AS
SELECT u.entity_id,
       u.person_id,
       u.slug,
       -- "Curso LGR 03/10" → "Curso LGR 04/10"; "Gela Água - 1/18" → "Gela Água - 2/18":
       -- troca só o número antes da barra final e mantém o zero à esquerda.
       -- (lpad corta à esquerda quando o texto é maior que o tamanho: o
       -- tamanho é o maior entre o número novo e o antigo, ou 10/12 viraria 1/12.)
       regexp_replace(u.descricao, '[0-9]+(\s*/\s*[0-9]+)\s*$', '')
         || lpad((u.parcela + k)::text,
                 greatest(length((u.parcela + k)::text),
                          length(substring(u.descricao FROM '([0-9]+)\s*/\s*[0-9]+\s*$'))),
                 '0')
         || substring(u.descricao FROM '[0-9]+(\s*/\s*[0-9]+)\s*$') AS descricao,
       (u.competencia + make_interval(months => k))::date AS competencia,
       u.valor_parcela_cents,
       u.parcela + k AS parcela,
       u.parcelas_total,
       u.categoria_livre,
       pr.code,
       pr.source_id,
       c.cancelado_em
  FROM fin_reembolso_item u
 CROSS JOIN generate_series(1, 2) AS k
  JOIN fin_payment_request pr
    ON pr.source_id = to_char(u.competencia + make_interval(months => k + 1), 'YYYY-MM')
                      || '|fin_person:' || u.person_id || ':reembolso'
   AND pr.status = 'pago'
  LEFT JOIN fin_reembolso_slug_cancelado c
    ON c.person_id = u.person_id AND c.slug = u.slug
 WHERE u.competencia = DATE '2026-07-01'
   AND u.parcelas_total > 1
   AND u.parcela + k <= u.parcelas_total;

CREATE TEMP TABLE _0198_inserido (valor_parcela_cents bigint);

WITH ins AS (
  INSERT INTO fin_reembolso_item
         (entity_id, person_id, slug, descricao, competencia, valor_parcela_cents,
          parcela, parcelas_total, categoria_livre, fonte, nota, criado_por)
  SELECT e.entity_id, e.person_id, e.slug, e.descricao, e.competencia, e.valor_parcela_cents,
         e.parcela, e.parcelas_total, e.categoria_livre,
         'ordem ' || e.code || ' paga',
         '0198: parcela paga pela ordem ' || e.code || ' (' || split_part(e.source_id, '|', 1)
           || '); a planilha parou em 2026-07',
         'migration:0198'
    FROM _0198_esperado e
   WHERE e.cancelado_em IS NULL
  ON CONFLICT (person_id, slug, competencia) DO NOTHING
  RETURNING valor_parcela_cents
)
INSERT INTO _0198_inserido SELECT valor_parcela_cents FROM ins;

-- ---------------------------------------------------------------------------
-- Pós-condições
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_antes record; v_esperado int; v_faltando int; v_ins int; v_ins_cents bigint;
        v_saldo bigint; v_apagar bigint; v_revit boolean; v_revit_agora boolean;
        v_estouro int; v_desc int;
BEGIN
  SELECT * INTO v_antes FROM _0198_antes;

  -- 12 séries × 2 meses = 24. Cancelamento feito DEPOIS de 30/10 não muda o
  -- esperado (só deixa de inserir a série) — senão derrubaria o boot.
  SELECT count(*) INTO v_esperado FROM _0198_esperado
   WHERE cancelado_em IS NULL OR cancelado_em > TIMESTAMPTZ '2026-10-30 00:00-03';
  IF v_esperado <> 24 THEN
    RAISE EXCEPTION '0198: % parcela(s) esperada(s), esperava 24', v_esperado;
  END IF;

  -- Cada parcela esperada (de série não cancelada) existe com parcela e valor
  -- certos — gravada aqui ou antes pelo script.
  SELECT count(*) INTO v_faltando FROM _0198_esperado e
   WHERE e.cancelado_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM fin_reembolso_item i
                      WHERE i.person_id = e.person_id AND i.slug = e.slug
                        AND i.competencia = e.competencia AND i.parcela = e.parcela
                        AND i.parcelas_total = e.parcelas_total
                        AND i.valor_parcela_cents = e.valor_parcela_cents);
  IF v_faltando > 0 THEN
    RAISE EXCEPTION '0198: % parcela(s) esperada(s) ausente(s) ou divergente(s)', v_faltando;
  END IF;

  SELECT count(*), coalesce(sum(valor_parcela_cents), 0) INTO v_ins, v_ins_cents FROM _0198_inserido;
  SELECT coalesce(sum(saldo_cents), 0) INTO v_saldo FROM fin_reembolso_saldo_v;
  IF v_antes.saldo_planilha - v_saldo <> v_ins_cents THEN
    RAISE EXCEPTION '0198: saldo caiu %, esperava % (soma do inserido)',
      v_antes.saldo_planilha - v_saldo, v_ins_cents;
  END IF;

  SELECT bool_and(s.quitado) INTO v_revit
    FROM fin_reembolso_saldo_v s JOIN _0198_esperado e USING (person_id, slug)
   WHERE s.slug = 'curso-revit';
  IF v_revit IS NOT TRUE THEN
    RAISE EXCEPTION '0198: curso-revit do Adryan deveria estar quitado';
  END IF;

  SELECT count(*) INTO v_estouro FROM fin_reembolso_item WHERE parcela > parcelas_total;
  IF v_estouro > 0 THEN
    RAISE EXCEPTION '0198: % linha(s) com parcela > total', v_estouro;
  END IF;

  -- A descrição nova termina em "parcela/total" coerente com as colunas.
  SELECT count(*) INTO v_desc FROM _0198_esperado
   WHERE substring(descricao FROM '([0-9]+)\s*/\s*[0-9]+\s*$')::int <> parcela
      OR substring(descricao FROM '/\s*([0-9]+)\s*$')::int <> parcelas_total;
  IF v_desc > 0 THEN
    RAISE EXCEPTION '0198: % descrição(ões) com N/M diferente de parcela/total', v_desc;
  END IF;

  -- "A pagar" do mês: só a série que QUITOU agora sai (curso-revit, R$ 103,11,
  -- medido 477.515 → 467.204 em 30/10). Se o script já tinha gravado a 12/12,
  -- ela já saiu antes e a queda aqui é zero.
  SELECT EXISTS (SELECT 1 FROM fin_reembolso_item
                  WHERE slug = 'curso-revit' AND criado_por = 'migration:0198' AND parcela = parcelas_total)
    INTO v_revit_agora;
  SELECT coalesce(sum(valor_parcela_cents), 0) INTO v_apagar
    FROM fin_reembolso_saldo_unificado_v WHERE NOT quitado;
  IF v_antes.a_pagar - v_apagar <> (CASE WHEN v_revit_agora THEN 10311 ELSE 0 END) THEN
    RAISE EXCEPTION '0198: a pagar caiu %, esperava % (só o Adryan)',
      v_antes.a_pagar - v_apagar, CASE WHEN v_revit_agora THEN 10311 ELSE 0 END;
  END IF;

  RAISE NOTICE '0198: % de % parcelas gravadas aqui; saldo da planilha % → %',
    v_ins, v_esperado, v_antes.saldo_planilha, v_saldo;
END $$;

DROP TABLE _0198_antes;
DROP TABLE _0198_esperado;
DROP TABLE _0198_inserido;
