-- As caixinhas do Nubank param de ser um total só — e a tela passa a dizer o
-- que a fonte NÃO entrega, em vez de inventar composição.
--
-- ===========================================================================
-- O PEDIDO, E O QUE A MEDIÇÃO RESPONDEU
-- ===========================================================================
-- O pedido foi: "detalhar mais as caixinhas do Nubank, que hoje mostra o
-- total, mas quero ver tbm o detalhado, acho que se o usuario clicar na
-- caixinha deveria expandir as subcaixas".
--
-- O modelo mental é o do app do Nubank: caixinhas COM NOME ("Reserva",
-- "Impostos", "13º"), e subcaixas dentro delas. Foi isso que se foi medir.
--
-- ---------------------------------------------------------------------------
-- O NOME DA CAIXINHA NÃO EXISTE EM FONTE NENHUMA DESTE ACERVO
-- ---------------------------------------------------------------------------
-- Medido em 18/08/2026, GET a GET, na API do Polp (integração 2906,
-- "Nubank Empresas"):
--
--   GET /integrations/2906/investments      66 posições, 36 campos cada
--   GET /investments/{id}                   o mesmo objeto, campo a campo
--   GET /integrations/2906/accounts         2 contas: CHECKING_ACCOUNT e CREDIT
--   GET /integrations/2906/bank-accounts    HTTP 404
--   GET /integrations/2906/products         HTTP 404
--
-- Nas 66 posições, TODO campo capaz de carregar identidade de caixinha é
-- constante ou nulo:
--
--   name ........... 1 valor distinto em 66 linhas
--                    "CDB - NU FINANCEIRA S.A. - SOCIEDADE DE CREDITO,
--                     FINANCIAMENTO E INVESTIMENTO"
--   number ......... null em 66/66      code ....... null em 66/66
--   isin ........... null em 66/66      owner ...... null em 66/66
--   institution .... null em 66/66      metadata ... null em 66/66
--   provider_id .... null em 66/66
--
-- E os movimentos (`GET /investments/{id}/transactions`) trazem
-- `description: null`.
--
-- A razão é estrutural, não um campo esquecido: o Open Finance transmite a
-- camada de INVESTIMENTO — o lote de CDB emitido pela NU FINANCEIRA que
-- lastreia o dinheiro. "Caixinha" é agrupamento do APLICATIVO do Nubank, uma
-- camada acima, que não é transmitida. O agregador não pode entregar o que não
-- recebe.
--
-- As outras duas fontes concordam, por caminhos independentes:
--   · o extrato da conta corrente escreve "Aplicação RDB" (65×) e "Resgate
--     RDB" (54×) — sem nome de caixinha;
--   · o PDF "Extrato de Rendimentos — Caixinhas PJ" (lote 4, sha256 41cd7597…)
--     imprime "Compra por aplicação" e "Rendimento até essa data" — idem.
--
-- CONCLUSÃO: o nível "caixinha nomeada" é INDETERMINADO, com motivo. Esta
-- migration NÃO cria tabela para ele, não semeia nome nenhum e não infere
-- agrupamento por valor ou por data — inferir seria exatamente o rótulo
-- inventado que a restrição 5 proíbe. Dúvida 67.
--
-- ===========================================================================
-- A HIERARQUIA QUE DE FATO EXISTE, E FECHA AO CENTAVO
-- ===========================================================================
--
--   conta `nubank-caixinhas` .......... R$ 27.700,17
--     └─ 18 posições ATIVAS de CDB ..... R$ 27.700,17   ← soma exata, delta 0
--          └─ 163 movimentos BUY/SELL em `fin_investment_flow`
--
-- São dois níveis reais, não três. O que a tela expande é isto, e o nível que
-- falta ela declara como ausente em vez de fabricar.
--
-- As 48 posições LIQUIDADAS somam R$ 0,00 e ficam num grupo à parte: elas são
-- histórico, não caixa. Somá-las na lista sem separar faria 66 linhas
-- disputarem a leitura de um total que 18 delas explicam inteiro.
--
-- ---------------------------------------------------------------------------
-- POR QUE VIEW E NÃO TABELA
-- ---------------------------------------------------------------------------
-- `fin_investment` e `fin_investment_flow` (0043) já guardam tudo: nome do
-- produto, emissor, emissão, carência, vencimento, indexador, taxa, principal,
-- bruto, imposto, saldo e o dia da leitura. O detalhe JÁ ESTAVA no banco e só
-- não chegava à tela — o trabalho é de exposição, não de ingestão. Criar
-- tabela nova duplicaria o dinheiro em dois lugares, que é o defeito que a
-- própria 0043 se preocupou em não cometer.
--
-- Esta migration não escreve um centavo: só cria views e o rótulo da lacuna.
-- Ver §5 — a âncora é conferida e a migration se recusa a commitar se mudar.

-- ---------------------------------------------------------------------------
-- 1. NÍVEL 1 — a posição
-- ---------------------------------------------------------------------------
-- Uma linha por lote de CDB, com o que a fonte entrega e o que ela não
-- entrega, lado a lado. `caixinha_nome` é NULL de propósito e vem sempre
-- acompanhado de `caixinha_nome_motivo`: é o contrato `Medida` do lado do
-- servidor (valor nulo obriga motivo), aplicado a texto.
CREATE OR REPLACE VIEW fin_caixinha_posicao_v AS
SELECT i.id                                    AS posicao_id,
       i.account_id,
       a.slug                                  AS account_slug,
       i.external_id,
       i.status,
       i.product_type,
       i.product_subtype,
       i.issuer,
       i.issue_date,
       i.grace_date,
       i.due_date,
       i.rate_type,
       i.rate_percent,
       i.principal_cents,
       i.gross_cents,
       i.taxes_cents,
       i.balance_cents,
       -- Rendimento LÍQUIDO apropriado dentro da posição: o dinheiro que
       -- nasceu aqui e nunca passou pela conta corrente. É ele que explica a
       -- diferença entre o saldo e o fluxo — ver `residuo_cents` abaixo.
       (i.gross_cents - i.principal_cents - i.taxes_cents)::bigint AS rendimento_liquido_cents,
       i.quoted_on,

       -- O que a fonte NÃO entrega, dito onde a tela vai ler.
       NULL::text                              AS caixinha_nome,
       'o Polp entrega a camada de investimento (o lote de CDB da NU '
       || 'FINANCEIRA que lastreia o dinheiro), não o nome que aparece no app '
       || 'do Nubank. Medido em 18/08/2026: name tem 1 valor distinto em 66 '
       || 'posições e number, code, isin, owner, institution, metadata e '
       || 'provider_id são nulos em todas. "Caixinha" é agrupamento do '
       || 'aplicativo e o Open Finance não o transmite.'
                                               AS caixinha_nome_motivo,

       -- Nível 2, agregado: quantos movimentos e quanto eles somam.
       COALESCE(f.movimentos, 0)               AS movimentos,
       COALESCE(f.aplicado_cents, 0)           AS aplicado_cents,
       COALESCE(f.resgatado_cents, 0)          AS resgatado_cents,
       COALESCE(f.liquido_cents, 0)            AS fluxo_liquido_cents,
       f.primeiro_movimento,
       f.ultimo_movimento,

       -- A CONFERÊNCIA DE UM NÍVEL PARA O OUTRO.
       --
       --   saldo − (aplicações − resgates) = rendimento apropriado dentro
       --
       -- Quando `residuo_cents` = `rendimento_liquido_cents`, a posição fecha:
       -- tudo que está no saldo ou entrou por movimento, ou rendeu ali dentro.
       -- Quando NÃO fecha, `divergencia_cents` é o que ninguém explica — e a
       -- tela mostra o número em vez de escondê-lo num arredondamento.
       (i.balance_cents - COALESCE(f.liquido_cents, 0))::bigint AS residuo_cents,
       (i.balance_cents - COALESCE(f.liquido_cents, 0)
        - (i.gross_cents - i.principal_cents - i.taxes_cents))::bigint AS divergencia_cents
  FROM fin_investment i
  JOIN fin_account a ON a.id = i.account_id
  LEFT JOIN LATERAL (
        SELECT count(*)                                                             AS movimentos,
               COALESCE(sum(x.amount_cents) FILTER (WHERE x.direction = 'aplicacao'), 0) AS aplicado_cents,
               COALESCE(sum(x.amount_cents) FILTER (WHERE x.direction = 'resgate'), 0)   AS resgatado_cents,
               COALESCE(sum(x.amount_cents) FILTER (WHERE x.direction = 'aplicacao'), 0)
                 - COALESCE(sum(x.amount_cents) FILTER (WHERE x.direction = 'resgate'), 0) AS liquido_cents,
               min(x.trade_date)                                                    AS primeiro_movimento,
               max(x.trade_date)                                                    AS ultimo_movimento
          FROM fin_investment_flow x
         WHERE x.investment_id = i.id) f ON true;

COMMENT ON VIEW fin_caixinha_posicao_v IS
  'Nível 1 da caixinha: uma linha por lote de CDB dentro de uma conta de '
  'aplicação. caixinha_nome é SEMPRE NULL e caixinha_nome_motivo diz por quê — '
  'o Open Finance não transmite o agrupamento do app do Nubank. '
  'divergencia_cents <> 0 é achado, não ruído: é saldo que nem entrou por '
  'movimento nem rendeu dentro da posição.';

-- ---------------------------------------------------------------------------
-- 2. NÍVEL 2 — o movimento de cada posição
-- ---------------------------------------------------------------------------
-- NÃO é ledger de caixa e nunca deve ser somado ao caixa (0043 já avisa). Ele
-- responde "de qual lote esse dinheiro saiu", que é a pergunta que o clique na
-- segunda linha faz.
CREATE OR REPLACE VIEW fin_caixinha_movimento_v AS
SELECT f.id            AS movimento_id,
       f.investment_id AS posicao_id,
       i.external_id   AS posicao_external_id,
       i.account_id,
       f.external_id,
       f.direction,
       f.trade_date,
       f.amount_cents,
       -- Sinal para a tela somar sem reinterpretar `direction`. Aplicação
       -- entra na posição (+), resgate sai (−).
       (CASE WHEN f.direction = 'aplicacao' THEN f.amount_cents ELSE -f.amount_cents END)::bigint
                       AS assinado_cents,
       f.quantity,
       f.settlement_transaction_id
  FROM fin_investment_flow f
  JOIN fin_investment i ON i.id = f.investment_id;

COMMENT ON VIEW fin_caixinha_movimento_v IS
  'Nível 2 da caixinha: BUY/SELL por posição. NUNCA somar ao caixa — quem '
  'fecha saldo é fin_transaction.';

-- ---------------------------------------------------------------------------
-- 3. A ÂNCORA — o total do pai contra a soma dos filhos
-- ---------------------------------------------------------------------------
-- A tela precisa mostrar os dois números lado a lado, e precisa que a
-- divergência seja consultável em vez de recalculada em TypeScript. Um total
-- que a tela recomputa é um segundo total, e dois totais discordam no dia em
-- que a diferença importa.
CREATE OR REPLACE VIEW fin_caixinha_ancora_v AS
SELECT a.id                                                    AS account_id,
       a.slug                                                  AS account_slug,
       a.name                                                  AS account_nome,
       a.current_balance_cents                                 AS saldo_conta_cents,
       COALESCE(sum(p.balance_cents), 0)::bigint               AS soma_posicoes_cents,
       (a.current_balance_cents - COALESCE(sum(p.balance_cents), 0))::bigint AS delta_cents,
       count(p.posicao_id)                                     AS posicoes,
       count(p.posicao_id) FILTER (WHERE p.status = 'ativa')    AS posicoes_ativas,
       count(p.posicao_id) FILTER (WHERE p.status <> 'ativa')   AS posicoes_encerradas,
       COALESCE(sum(p.principal_cents), 0)::bigint             AS principal_cents,
       COALESCE(sum(p.rendimento_liquido_cents), 0)::bigint    AS rendimento_liquido_cents,
       COALESCE(sum(p.taxes_cents), 0)::bigint                 AS impostos_cents,
       COALESCE(sum(p.movimentos), 0)                          AS movimentos,
       -- Quantas posições não se explicam, e quanto isso vale somado.
       count(p.posicao_id) FILTER (WHERE p.divergencia_cents <> 0) AS posicoes_divergentes,
       COALESCE(sum(p.divergencia_cents) FILTER (WHERE p.divergencia_cents <> 0), 0)::bigint
                                                               AS divergencia_cents,
       max(p.quoted_on)                                        AS lido_em,
       min(p.due_date) FILTER (WHERE p.status = 'ativa')        AS proximo_vencimento
  FROM fin_account a
  LEFT JOIN fin_caixinha_posicao_v p ON p.account_id = a.id
 WHERE a.kind = 'aplicacao'
 GROUP BY a.id, a.slug, a.name, a.current_balance_cents;

COMMENT ON VIEW fin_caixinha_ancora_v IS
  'Total do pai × soma dos filhos, para a tela exibir os dois. delta_cents <> 0 '
  'é sempre defeito de sincronização. NUNCA somar saldo_conta_cents com '
  'soma_posicoes_cents: são o mesmo dinheiro.';

-- ---------------------------------------------------------------------------
-- 4. A LACUNA, REGISTRADA ONDE O RESTO DA CASA REGISTRA LACUNA
-- ---------------------------------------------------------------------------
-- `fin_fonte_catalogo` (0109) descreve o que cada fonte alimenta. Ele é o
-- lugar em que alguém vai olhar para perguntar "por que a tela não mostra o
-- nome da caixinha?". O UPDATE só roda se a 0109 estiver aplicada e se a
-- frente da 0113 (Caixa/Polp) ainda não tiver reescrito a frase — nesse caso
-- o texto dela é preservado e o complemento é anexado.
DO $$
BEGIN
  IF to_regclass('public.fin_fonte_catalogo') IS NOT NULL THEN
    UPDATE fin_fonte_catalogo
       SET alimenta = alimenta
         || '. NÃO entrega o nome das caixinhas: o Open Finance transmite o '
         || 'lote de CDB que lastreia o dinheiro, e "caixinha" é agrupamento '
         || 'do app do Nubank (medido em 18/08/2026 — dúvida 67)'
     WHERE fonte = 'polp'
       AND alimenta NOT LIKE '%NÃO entrega o nome das caixinhas%';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. ASSERÇÕES
-- ---------------------------------------------------------------------------
-- Só o que é INVARIANTE entra como EXCEPTION. A uniformidade do `name` na
-- fonte é MEDIÇÃO, não invariante — se o Polp um dia passar a entregar o nome,
-- isso é notícia boa, e uma migration que explodisse por causa dela estaria
-- punindo a fonte por melhorar. Ela vira NOTICE.
DO $$
DECLARE
  v_delta   bigint;
  v_saldo   bigint;
  v_soma    bigint;
  v_ativas  bigint;
  v_nomes   bigint;
  v_div     bigint;
BEGIN
  -- 5.1 O ÂNCORA. O total do pai tem de ser a soma dos filhos, ao centavo.
  SELECT saldo_conta_cents, soma_posicoes_cents, delta_cents, posicoes_ativas
    INTO v_saldo, v_soma, v_delta, v_ativas
    FROM fin_caixinha_ancora_v WHERE account_slug = 'nubank-caixinhas';

  IF v_delta IS NULL THEN
    RAISE EXCEPTION '[0114] fin_caixinha_ancora_v não devolveu nubank-caixinhas';
  END IF;
  IF v_delta <> 0 THEN
    RAISE EXCEPTION
      '[0114] a soma das posições (%) não bate com o saldo da conta (%): delta %. '
      'A tela expansível existe para provar essa igualdade — sem ela, não há o que expandir.',
      v_soma, v_saldo, v_delta;
  END IF;

  -- 5.2 A identidade de cada posição, que a 0043 já obriga por CHECK. Repetida
  -- aqui porque a view NOVA depende dela para que rendimento_liquido_cents
  -- signifique alguma coisa.
  IF EXISTS (SELECT 1 FROM fin_caixinha_posicao_v
              WHERE balance_cents <> gross_cents - taxes_cents) THEN
    RAISE EXCEPTION '[0114] existe posição com balance <> gross − taxes';
  END IF;

  -- 5.3 Nenhuma linha pode oferecer nome sem evidência. `caixinha_nome` é NULL
  -- por construção; esta asserção existe para que qualquer futuro que a
  -- preencha tenha de vir junto com a fonte que a justifica.
  IF EXISTS (SELECT 1 FROM fin_caixinha_posicao_v
              WHERE caixinha_nome IS NOT NULL OR caixinha_nome_motivo IS NULL) THEN
    RAISE EXCEPTION
      '[0114] caixinha_nome preenchido, ou motivo ausente. Nome de caixinha só '
      'entra com a fonte que o entrega — inferir por valor ou data é o rótulo inventado.';
  END IF;

  RAISE NOTICE '[0114] âncora: conta % = soma das posições % (delta 0), % ativas',
    v_saldo, v_soma, v_ativas;

  -- 5.4 MEDIÇÕES declaradas, não invariantes.
  SELECT count(DISTINCT name) INTO v_nomes FROM fin_investment WHERE provider = 'polp';
  IF v_nomes <= 1 THEN
    RAISE NOTICE '[0114] a fonte entrega % nome(s) distinto(s) para todas as posições: '
      'o nível "caixinha nomeada" continua indeterminado (dúvida 67).', v_nomes;
  ELSE
    RAISE NOTICE '[0114] a fonte passou a entregar % nomes distintos. REVISITE a dúvida 67: '
      'talvez o nível da caixinha tenha virado dado.', v_nomes;
  END IF;

  SELECT posicoes_divergentes, divergencia_cents INTO v_ativas, v_div
    FROM fin_caixinha_ancora_v WHERE account_slug = 'nubank-caixinhas';
  RAISE NOTICE '[0114] % posição(ões) com histórico de movimento incompleto, somando % centavos. '
    'Isso NÃO afeta o saldo (que vem da posição, não do fluxo) e a tela mostra caso a caso.',
    v_ativas, v_div;
END $$;
