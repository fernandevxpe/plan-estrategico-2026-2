-- O reembolso pedido pelo APP passa a existir para a plataforma.
--
-- O DEFEITO, NAS PALAVRAS DE QUEM O ENCONTROU
-- -------------------------------------------
-- "na plataforma não está mostrando os reembolsos para receber que eu cadastrei
--  pelo aplicativo, pegou apenas os da planilha... até mostra na minha conta
--  pessoal, mas não está mostrando na plataforma."
--
-- Está certo. São duas tabelas, e cada lado lê uma:
--
--   fin_reembolso_item        194 linhas — a planilha, com parcela e slug.
--                             É a base de fin_reembolso_saldo_v (0129), e é
--                             daí que a plataforma tira "quanto falta pagar".
--   fin_reimbursement_item    195 linhas — a planilha MAIS o que o app cria,
--                             com data do gasto, comprovante e status.
--
-- O `/time` já fundia as duas na tela; a plataforma não. Resultado: um
-- reembolso pedido pelo aplicativo aparecia para a pessoa e sumia para quem
-- paga. E isso deixa de ser exceção agora — daqui para frente todo reembolso
-- novo nasce no app.
--
-- POR QUE UMA VIEW, E NÃO A FUSÃO DAS TABELAS
-- -------------------------------------------
-- O AGENTS.md registra o caminho "preencher uma a partir da outra e aposentar",
-- e avisa: irreversível, e muda número que a casa reporta. Medi antes de
-- escolher. Das 195 linhas do lado do app, 193 têm contraparte na planilha;
-- a diferença REAL são dois itens (R$ 164,00 do Fernando, agosto/2026). Os
-- outros dois candidatos são o "2x*" do Decézaris — a mesma dívida gravada
-- dobrada de um lado e normalizada do outro, de propósito (ver 0129).
--
-- Com uma diferença de dois itens, apagar 194 linhas para ganhar 2 é risco sem
-- prêmio. A view une na LEITURA: nenhuma linha morre, as duas tabelas seguem
-- como estão, e o que muda é quem lê. Se um dia a fusão física valer a pena,
-- ela começa daqui — com a regra de identidade já provada em produção.
--
-- A REGRA DE IDENTIDADE, E POR QUE NÃO É SÓ O VALOR
-- -------------------------------------------------
-- Deduplicar por valor sozinho engole item legítimo: dois Ubers de R$ 45,00 no
-- mesmo mês viram um. Deduplicar por descrição sozinha perde o "2x*", que tem
-- descrição igual e valor dobrado. A regra é (pessoa, competência) mais valor
-- OU descrição — e foi conferida contra a base inteira: sobram exatamente os
-- dois itens do app, nem um a mais.
--
-- O QUE CONTA COMO "A RECEBER"
-- ----------------------------
-- Da planilha: a aritmética de sempre — (parcelas_total - parcela) × parcela.
-- Do app: o item inteiro, enquanto o pedido não estiver pago nem rejeitado.
-- Um pedido do app é uma dívida de uma parcela só até alguém pagá-la.

CREATE VIEW fin_reembolso_saldo_unificado_v AS
-- ---------------------------------------------------------------------------
-- Lado A — a planilha. Mesmas colunas de fin_reembolso_saldo_v, para que quem
-- trocar a fonte não precise reescrever a leitura.
-- ---------------------------------------------------------------------------
SELECT 'planilha'::text                        AS origem,
       s.person_id,
       s.pessoa,
       s.slug,
       s.descricao,
       s.categoria_livre,
       s.ultima_competencia,
       s.parcela,
       s.parcelas_total,
       s.valor_parcela_cents,
       s.parcelas_restantes,
       s.saldo_cents,
       s.quitado,
       NULL::text                              AS status_pedido,
       false                                   AS tem_comprovante
  FROM fin_reembolso_saldo_v s

UNION ALL

-- ---------------------------------------------------------------------------
-- Lado B — o app, só o que a planilha não conhece.
-- ---------------------------------------------------------------------------
SELECT 'app'::text                             AS origem,
       r.person_id,
       p.name                                  AS pessoa,
       -- Sem slug de série: o item do app é avulso até alguém parcelá-lo. O id
       -- entra no slug para a chave continuar única por linha.
       'app-' || i.id::text                    AS slug,
       i.description                           AS descricao,
       NULL::text                              AS categoria_livre,
       date_trunc('month', r.reference_month)::date AS ultima_competencia,
       COALESCE(i.installment_number, 1)       AS parcela,
       COALESCE(i.installment_total, 1)        AS parcelas_total,
       i.amount_cents                          AS valor_parcela_cents,
       -- "Falta uma": o pedido inteiro ainda é devido enquanto não for pago.
       1                                       AS parcelas_restantes,
       i.amount_cents                          AS saldo_cents,
       false                                   AS quitado,
       COALESCE(r.status, 'aprovado')          AS status_pedido,
       (i.receipt_artifact_key IS NOT NULL)    AS tem_comprovante
  FROM fin_reimbursement_item i
  JOIN fin_reimbursement r ON r.id = i.reimbursement_id
  JOIN fin_person p        ON p.id = r.person_id
 WHERE COALESCE(r.status, 'aprovado') NOT IN ('pago', 'rejeitado')
   AND COALESCE(i.status, 'aprovado') NOT IN ('pago', 'rejeitado')
   AND NOT EXISTS (
     SELECT 1
       FROM fin_reembolso_item a
      WHERE a.person_id = r.person_id
        AND a.competencia = date_trunc('month', r.reference_month)::date
        AND (a.valor_parcela_cents = i.amount_cents
             OR lower(btrim(a.descricao)) = lower(btrim(i.description)))
   );

COMMENT ON VIEW fin_reembolso_saldo_unificado_v IS
  'O reembolso a receber de TODA origem: a planilha (fin_reembolso_saldo_v, com parcela) e os '
  'pedidos do app que ela não conhece. Existe porque o /time fundia as duas fontes na tela e a '
  'plataforma não — um reembolso pedido pelo aplicativo aparecia para a pessoa e sumia para quem '
  'paga (0179). Deduplica por (pessoa, competência) + valor OU descrição: só valor engoliria dois '
  'Ubers iguais, só descrição perderia o "2x*" do Decézaris.';
COMMENT ON COLUMN fin_reembolso_saldo_unificado_v.origem IS
  '''planilha'' ou ''app'' — de onde a linha veio. A tela usa para explicar a procedência sem que '
  'ninguém precise adivinhar por que um item tem comprovante e outro não.';

-- ---------------------------------------------------------------------------
-- Pós-condição
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_planilha int; v_app int; v_uni int; v_dobrado int;
BEGIN
  SELECT count(*) INTO v_planilha FROM fin_reembolso_saldo_v;
  SELECT count(*) INTO v_uni      FROM fin_reembolso_saldo_unificado_v;
  SELECT count(*) INTO v_app      FROM fin_reembolso_saldo_unificado_v WHERE origem = 'app';

  -- A união não pode PERDER nada da planilha: ela é UNION ALL sobre a view
  -- inteira, então o lado planilha tem de sair idêntico em contagem.
  IF v_uni - v_app <> v_planilha THEN
    RAISE EXCEPTION 'a união perdeu linhas da planilha: % na origem, % na união', v_planilha, v_uni - v_app;
  END IF;

  -- E não pode DOBRAR: nenhum item do app pode ter contraparte na planilha por
  -- valor ou descrição na mesma competência.
  SELECT count(*) INTO v_dobrado
    FROM fin_reembolso_saldo_unificado_v u
    JOIN fin_reembolso_item a
      ON a.person_id = u.person_id
     AND a.competencia = u.ultima_competencia
     AND (a.valor_parcela_cents = u.valor_parcela_cents
          OR lower(btrim(a.descricao)) = lower(btrim(u.descricao)))
   WHERE u.origem = 'app';
  IF v_dobrado > 0 THEN
    RAISE EXCEPTION '% item(ns) do app têm contraparte na planilha — dedupe falhou', v_dobrado;
  END IF;

  RAISE NOTICE 'reembolso unificado: % da planilha + % do app', v_planilha, v_app;
END $$;
