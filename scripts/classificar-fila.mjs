// Esvazia o que dá da fila de classificação de 2026 — e declara o resto.
//
// A FILA
//
// `fin_a_classificar_v` (0055, ampliada pela 0056) é o que está sem categoria,
// em 5.99 "Despesa a classificar" ou em 3.99 "Receita a classificar". As três
// são o mesmo vazio com roupas diferentes: as duas terminadas em .99 PARECEM
// classificadas — têm dre_line, somam na DRE, contam no indicador — e são a
// declaração de que ninguém sabe o que é aquilo.
//
// Escopo: **2026 apenas**. O histórico anterior está fora por decisão do
// Fernando.
//
// O QUE ESTE ARQUIVO NÃO FAZ, E É O PONTO
//
// Não classifica por semelhança de nome. Nenhum passo abaixo olha para o texto
// do fornecedor para escolher categoria. Os critérios são, nesta ordem:
//
//   · o que a FONTE carimbou (tipo do lançamento no Asaas, documento a receber
//     liquidado, perna de transferência já pareada);
//   · o que o BANCO escreveu sobre a natureza da operação, não sobre quem é a
//     outra ponta ("reembolso recebido", "boleto devolvido");
//   · a decisão que a MESMA contraparte, identificada por CNPJ, já recebeu em
//     outras linhas — com unanimidade, volume e direção conferidos.
//
// O que sobra fica na fila com uma tag `indeterminado:<motivo>` dizendo por
// quê. Um vazio declarado vale mais que uma categoria plausível na linha
// errada: o erro por semelhança de nome não aparece como erro, aparece como
// número.
//
// ÂNCORA
//
// A soma de `amount_cents` por conta é medida antes e depois e não pode mudar
// em um centavo. Classificação move rótulo, nunca dinheiro. Se mudar, o script
// aborta antes do COMMIT.
//
// Uso:
//   node scripts/classificar-fila.mjs              dry-run (padrão)
//   node scripts/classificar-fila.mjs --aplicar
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const DE = '2026-01-01';

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const n4 = (x) => String(x).padStart(4);

/**
 * Guarda comum a TODO update deste arquivo.
 *
 * `classified_by='humano'` e `human_locked_fields` são a fronteira: quem
 * decidiu à mão decidiu, e nenhuma regra desfaz isso em lote. O recorte de data
 * mantém o script dentro de 2026 mesmo que alguém o rode sem pensar.
 */
const GUARDA = `t.posted_on >= '${DE}'
    AND t.classified_by IS DISTINCT FROM 'humano'
    AND NOT ('category_id' = ANY (t.human_locked_fields))`;

/** A fila, como predicado — a mesma definição da view, usável dentro de UPDATE. */
const NA_FILA = `(t.category_id IS NULL OR c99.code IN ('5.99', '3.99'))
    AND COALESCE(c99.cash_flow_group, '') <> 'movimentacao'`;

const pool = financePool();
const client = await pool.connect();
const passos = [];

/** Grava o UPDATE e a trilha em fin_classification_event, e registra o passo. */
async function aplicar({ nome, evidencia, stage, regraSlug, sql, params = [] }) {
  const { rows } = await client.query(sql, params);
  const ids = rows.map((r) => r.id);
  const volume = rows.reduce((s, r) => s + Math.abs(Number(r.amount_cents)), 0);

  for (const r of rows) {
    await client.query(
      `INSERT INTO fin_classification_event
         (target_table, target_id, stage, rule_id, category_id, accepted, superseded_value, rationale, actor)
       SELECT 'fin_transaction', $1, $2,
              (SELECT id FROM fin_rule WHERE slug = $3),
              $4, true,
              CASE WHEN $5::text IS NULL THEN NULL
                   ELSE jsonb_build_object('category_code_anterior', $5::text) END,
              jsonb_build_object('passo', $6::text, 'evidencia', $7::text, 'valor_cents', $8::bigint),
              'classificar-fila'`,
      [r.id, stage, regraSlug, r.category_id, r.code_anterior, nome, evidencia, r.amount_cents]
    );
    // NÃO fecha o item de fila aqui, e isto é uma correção.
    //
    // A primeira versão deste arquivo fechava o item de TODA linha que tocava
    // — inclusive das 63 que ele mesmo mandou para 3.99. Resultado medido: 184
    // lançamentos em 3.99/5.99 com item `resolvido`, ou seja, dizendo "não sei
    // o que é" e fora da lista de pendências de todo mundo. Foi assim que 63
    // receitas sumiram da fila sem que ninguém decidisse nada.
    //
    // Quem abre e fecha item agora é o gatilho `fin_transaction_fila_indeciso`
    // (0080), que olha para a INDECISÃO e não para a existência de categoria.
    // Um único lugar decide, e ele não tem como esquecer de 3.99.
  }

  passos.push({ nome, evidencia, n: ids.length, volume, ids });
  return ids.length;
}

try {
  await client.query('BEGIN');

  // -------------------------------------------------------------------------
  // ÂNCORA E MEDIDA — ANTES
  // -------------------------------------------------------------------------
  const ancora = async () => (await client.query(
    `SELECT a.slug, count(*)::int n, COALESCE(sum(t.amount_cents), 0)::bigint soma
       FROM fin_transaction t JOIN fin_account a ON a.id = t.account_id
      GROUP BY 1 ORDER BY 1`
  )).rows;

  const medir = async () => (await client.query(
    `SELECT count(*)::int                                                              total,
            count(*) FILTER (WHERE t.category_id IS NOT NULL)::int                     com_categoria,
            count(*) FILTER (WHERE c.code IS NOT NULL AND c.code NOT IN ('5.99','3.99'))::int categoria_real,
            count(*) FILTER (WHERE t.counterparty_id IS NOT NULL)::int                 contraparte,
            count(*) FILTER (WHERE COALESCE(c.cash_flow_group,'') <> 'movimentacao')::int base_dre,
            count(*) FILTER (WHERE COALESCE(c.cash_flow_group,'') <> 'movimentacao'
                               AND t.nucleo IS NOT NULL)::int                          nucleo,
            count(*) FILTER (WHERE (t.category_id IS NULL OR c.code IN ('5.99','3.99'))
                               AND COALESCE(c.cash_flow_group,'') <> 'movimentacao')::int fila,
            -- O buraco do H3: indeciso (sem categoria OU em .99) que não tem
            -- item PENDENTE em fin_review_item. Medido sobre o ledger inteiro,
            -- não só 2026, porque a fila de pendências não tem recorte de data.
            (SELECT count(*)::int FROM fin_transaction t2
               LEFT JOIN fin_category c2 ON c2.id = t2.category_id
              WHERE NOT t2.is_split_parent
                AND (t2.category_id IS NULL OR c2.code IN ('5.99','3.99'))
                AND NOT EXISTS (SELECT 1 FROM fin_review_item ri
                                 WHERE ri.target_table = 'fin_transaction'
                                   AND ri.target_id = t2.id AND ri.status = 'pendente')) AS indeciso_fora_da_fila,
            count(*) FILTER (WHERE t.review_status <> 'pendente')::int revisao_ok
       FROM fin_transaction t LEFT JOIN fin_category c ON c.id = t.category_id
      WHERE t.posted_on >= $1`, [DE]
  )).rows[0];

  const ancoraAntes = await ancora();
  const antes = await medir();

  // As regras da 0056 precisam existir: sem elas os UPDATEs gravariam
  // classified_by='regra' sem classified_rule_id, e a linha ficaria dizendo
  // "por regra" sem conseguir dizer qual.
  //
  // No dry-run, se a migration ainda não rodou, ela é aplicada AQUI DENTRO da
  // mesma transação — que termina em ROLLBACK. Sem isso o preview seria inútil
  // justamente quando é mais necessário: antes de decidir aplicar. O arquivo da
  // migration é lido do disco, nunca reescrito aqui, para que preview e
  // aplicação nunca divirjam. Com `--aplicar` o script recusa: aplicar
  // migration é trabalho do `db:migrate`, que registra a versão.
  const REGRAS_0056 = [
    'receita-asaas-cobranca-recebida', 'reembolso-recebido-de-fornecedor',
    'fornecedor-lyra-m2m', 'fornecedor-startlaw', 'concessionaria-neoenergia-pe'
  ];
  const DEPENDENCIAS = [
    { arquivo: '0056_fin_classificacao_fila.sql',
      presente: async () => Number((await client.query(
        'SELECT count(*)::int n FROM fin_rule WHERE slug = ANY($1)', [REGRAS_0056]
      )).rows[0].n) === REGRAS_0056.length },
    { arquivo: '0080_fin_indeciso_na_fila.sql',
      presente: async () => Number((await client.query(
        `SELECT count(*)::int n FROM pg_trigger WHERE tgname = 'fin_transaction_fila_indeciso'`
      )).rows[0].n) === 1 }
  ];

  const simuladas = [];
  for (const dep of DEPENDENCIAS) {
    if (await dep.presente()) continue;
    if (APLICAR) {
      throw new Error(`migration ${dep.arquivo} não aplicada: rode \`npm run db:migrate\` antes de --aplicar`);
    }
    // Trava de lock: as duas migrations mexem em fin_transaction, e esperar por
    // isso de forma indefinida penduraria a sessão atrás de qualquer importador
    // em curso.
    await client.query("SET LOCAL lock_timeout = '10s'");
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    await client.query(await readFile(
      fileURLToPath(new URL(`../db/migrations/${dep.arquivo}`, import.meta.url)), 'utf8'));
    if (!(await dep.presente())) {
      throw new Error(`${dep.arquivo} rodou e o que ela declara continua ausente`);
    }
    simuladas.push(dep.arquivo);
  }
  const simulouMigration = simuladas.length > 0;

  // -------------------------------------------------------------------------
  // PASSO 0 — devolver o indeciso para a fila de pendências
  // -------------------------------------------------------------------------
  // O gatilho da 0080 garante daqui para a frente; este passo conserta o que já
  // está fechado. Medido antes de escrever: 189 lançamentos em 3.99/5.99 sem
  // item pendente — 184 com item marcado `resolvido` (fechados pela primeira
  // versão deste próprio arquivo) e 5 que nunca tiveram item.
  //
  // Sem recorte de data: a fila de pendências não é sobre 2026, é sobre o que
  // está indeciso. `adiado` e `ignorado` continuam intocados — quem adiou
  // escolheu adiar.
  //
  // O gatilho não faz isso sozinho porque só dispara em INSERT/UPDATE de
  // `category_id`, e estas linhas não vão ser tocadas de novo.
  const { rows: [reabertos] } = await client.query(`
    WITH indeciso AS (
      SELECT t.id, t.entity_id, t.amount_cents
        FROM fin_transaction t LEFT JOIN fin_category c ON c.id = t.category_id
       WHERE NOT t.is_split_parent
         AND (t.category_id IS NULL OR c.code IN ('5.99', '3.99'))
    ), ins AS (
      INSERT INTO fin_review_item (entity_id, target_table, target_id, reason, amount_cents, status)
      SELECT i.entity_id, 'fin_transaction', i.id, 'sem_categoria', i.amount_cents, 'pendente'
        FROM indeciso i
      ON CONFLICT (target_table, target_id) DO UPDATE
         SET status = 'pendente', resolved_at = NULL, resolved_by = NULL
       WHERE fin_review_item.status NOT IN ('pendente', 'adiado', 'ignorado')
      RETURNING 1
    )
    SELECT count(*)::int n FROM ins`);

  // E a coluna `review_status` junto, pelo mesmo motivo. O gatilho da 0080 só
  // dispara em INSERT/UPDATE de `category_id`; as linhas que já estão em
  // 3.99/5.99 não vão ser tocadas de novo e continuariam marcadas 'ok'.
  //
  // Medido: 300 lançamentos saem de 'ok' para 'pendente', e o indicador
  // "revisão concluída" do painel cai de 96,9% para 94,8% no ledger inteiro. A
  // queda É o resultado: nenhum lançamento mudou de lugar, o painel é que parou
  // de chamar "não sei o que é isso" de revisão concluída.
  const { rows: [repend] } = await client.query(`
    WITH upd AS (
      UPDATE fin_transaction t
         SET review_status = 'pendente', updated_at = now()
        FROM fin_category c
       WHERE c.id = t.category_id AND c.code IN ('5.99', '3.99')
         AND t.review_status = 'ok'
      RETURNING 1
    )
    SELECT count(*)::int n FROM upd`);

  // -------------------------------------------------------------------------
  // PASSO 1 — Asaas: a MESMA contraparte, o MESMO valor exato, já decidido
  // -------------------------------------------------------------------------
  // Antes de mandar tudo para 3.99, o pouco que dá para determinar de verdade.
  //
  // O critério NÃO é o nome do cliente: é o par (contraparte cadastrada, valor
  // em centavos) com pelo menos DUAS decisões anteriores unânimes em cobranças
  // recebidas do Asaas. Uma cobrança mensal de valor idêntico ao mesmo cliente
  // é a mesma fatura recorrente — o serviço não muda entre um mês e outro.
  //
  // Medido: sobra 1 par — CONDOMINIO LE PARC BOA VIAGEM, R$ 17.000,00, quatro
  // decisões anteriores todas em 3.03. Todos os outros pares têm UMA decisão
  // anterior só, e uma decisão não estabelece recorrência. Ficam para o passo 2.
  await aplicar({
    nome: 'asaas: mesma contraparte e mesmo valor já decididos ≥2×',
    evidencia: 'par (contraparte, valor_cents) com >=2 decisoes anteriores unanimes em cobranca recebida do Asaas',
    stage: 'historico',
    regraSlug: 'receita-asaas-cobranca-recebida',
    sql: `
      WITH decidido AS (
        SELECT t.counterparty_id, t.amount_cents,
               min(c.code) code, min(c.id) category_id, count(*) n
          FROM fin_transaction t
          JOIN fin_category c ON c.id = t.category_id
          JOIN fin_account  a ON a.id = t.account_id
         WHERE a.slug = 'asaas' AND t.source_kind = 'PAYMENT_RECEIVED'
           AND c.kind = 'receita' AND c.code <> '3.99'
         GROUP BY 1, 2
        HAVING count(DISTINCT c.code) = 1 AND count(*) >= 2
      ), alvo AS (
        SELECT t.id, d.category_id, d.code
          FROM fin_transaction t
          JOIN fin_account a ON a.id = t.account_id
          LEFT JOIN fin_category c99 ON c99.id = t.category_id
          JOIN decidido d ON d.counterparty_id = t.counterparty_id AND d.amount_cents = t.amount_cents
         WHERE ${NA_FILA} AND ${GUARDA}
           AND a.slug = 'asaas' AND t.source_kind = 'PAYMENT_RECEIVED'
      )
      UPDATE fin_transaction t
         SET category_id = alvo.category_id,
             classified_by = 'historico',
             classified_reason = jsonb_build_object(
               'origem', 'mesma_contraparte_mesmo_valor',
               'motivo', 'cobranca recorrente identica ao mesmo cliente, decidida >=2x na mesma categoria'),
             classified_at = now(), updated_at = now()
        FROM alvo
       WHERE t.id = alvo.id
      RETURNING t.id, t.amount_cents, t.category_id, NULL::text AS code_anterior`
  });

  // -------------------------------------------------------------------------
  // PASSO 2 — Asaas: cobrança recebida é receita. Fato estrutural.
  // -------------------------------------------------------------------------
  // O Asaas declara o tipo do lançamento: PAYMENT_RECEIVED, "cobrança
  // recebida". E não é só o rótulo: cada uma tem `fin_settlement` apontando
  // para um `fin_document` com direction='receber' e status='liquidado'. É um
  // título a receber sendo baixado — o sinal está estabelecido pela estrutura,
  // não interpretado.
  //
  // O destino é 3.99 "Receita a classificar", e a escolha de NÃO ir além é a
  // parte que importa. 48 das 65 têm nota fiscal ligada. A nota traz o código
  // de serviço municipal — e ele não determina nada: 17.01.01.501 aparece em
  // 387 linhas já decididas espalhadas por ONZE categorias de receita. É o
  // código genérico da prefeitura. Ele prova que houve serviço, não qual.
  //
  // O ganho real: hoje essas linhas não têm categoria nenhuma e não entram na
  // DRE de lado nenhum. Em 3.99 entram como receita_bruta, que é o que são. O
  // que continua desconhecido é a linha da DRE, não o sinal — e a 0056 pôs 3.99
  // dentro da fila justamente para que isso continue visível.
  //
  // 54 das 65 estão com `classified_by='contrato'` e categoria NULA — estado
  // impossível de resolver sozinho: o motor de regras protege 'contrato' e
  // nunca volta nelas, então a marca de proveniência as congelou sem decisão
  // nenhuma. Este passo as destrava. O carimbo anterior vai para
  // `classified_reason.classified_by_anterior` e para o evento de
  // classificação: a proveniência não se perde, muda de lugar.
  await aplicar({
    nome: 'asaas: cobrança recebida é receita (serviço a determinar)',
    evidencia: 'source_kind=PAYMENT_RECEIVED com fin_settlement -> fin_document(direction=receber, status=liquidado)',
    stage: 'fato_estrutural',
    regraSlug: 'receita-asaas-cobranca-recebida',
    sql: `
      WITH alvo AS (
        SELECT t.id
          FROM fin_transaction t
          JOIN fin_account a ON a.id = t.account_id
          LEFT JOIN fin_category c99 ON c99.id = t.category_id
         WHERE ${NA_FILA} AND ${GUARDA}
           -- Só o que ainda não tem categoria nenhuma. Uma linha que JÁ está em
           -- 3.99 recebeu este mesmo carimbo numa rodada anterior; regravá-lo
           -- não muda nada no banco e faria o relatório contar como
           -- classificação o que é repetição.
           AND t.category_id IS NULL
           AND a.slug = 'asaas' AND t.source_kind = 'PAYMENT_RECEIVED'
           AND t.amount_cents > 0
           AND EXISTS (
                 SELECT 1 FROM fin_settlement s JOIN fin_document d ON d.id = s.document_id
                  WHERE s.transaction_id = t.id AND d.direction = 'receber')
      )
      UPDATE fin_transaction t
         SET category_id = (SELECT id FROM fin_category WHERE code = '3.99'),
             classified_by = 'fato_estrutural',
             classified_rule_id = (SELECT id FROM fin_rule WHERE slug = 'receita-asaas-cobranca-recebida'),
             classified_reason = jsonb_build_object(
               'origem', 'tipo_declarado_pela_fonte',
               'motivo', 'Asaas declara PAYMENT_RECEIVED e ha documento a receber liquidado: e receita',
               'nao_determinado', 'qual servico — o codigo municipal da NFe cobre 11 categorias de receita',
               'classified_by_anterior', t.classified_by),
             classified_at = now(), updated_at = now()
        FROM alvo WHERE t.id = alvo.id
      RETURNING t.id, t.amount_cents, t.category_id, NULL::text AS code_anterior`
  });

  // -------------------------------------------------------------------------
  // PASSO 3 — perna de transferência já pareada herda a categoria da irmã
  // -------------------------------------------------------------------------
  // Uma linha com `transfer_status='pareado'` tem `transfer_group_id`, e o
  // grupo tem exatamente duas pernas — o índice único
  // `fin_transaction_transfer_group_perna_idx` garante uma por conta. Se a
  // outra perna já está numa categoria de movimentação, esta é o mesmo
  // dinheiro visto do outro lado. Não há terceira leitura possível.
  //
  // Medido: 1 linha em 2026 — R$ 5.600,00 no Inter, cuja irmã no Asaas está em
  // 9.01. Só herda de categoria com cash_flow_group='movimentacao': herdar
  // 6.02, como havia numa perna pareada do histórico, espalharia um erro.
  await aplicar({
    nome: 'perna pareada herda a categoria da irmã (movimentação)',
    evidencia: 'transfer_status=pareado e a outra perna do transfer_group_id ja esta em categoria de movimentacao',
    stage: 'fato_estrutural',
    regraSlug: 'transferencia-cnpj-proprio',
    sql: `
      WITH alvo AS (
        SELECT t.id, irma.category_id, ic.code
          FROM fin_transaction t
          LEFT JOIN fin_category c99 ON c99.id = t.category_id
          JOIN fin_transaction irma ON irma.transfer_group_id = t.transfer_group_id AND irma.id <> t.id
          JOIN fin_category ic ON ic.id = irma.category_id
         WHERE ${NA_FILA} AND ${GUARDA}
           AND t.transfer_status = 'pareado'
           AND ic.cash_flow_group = 'movimentacao'
      )
      UPDATE fin_transaction t
         SET category_id = alvo.category_id, nucleo = NULL,
             classified_by = 'fato_estrutural',
             classified_reason = jsonb_build_object(
               'origem', 'perna_irma_do_grupo_de_transferencia',
               'motivo', 'transferencia ja pareada: a outra perna esta em ' || alvo.code),
             classified_at = now(), updated_at = now()
        FROM alvo WHERE t.id = alvo.id
      RETURNING t.id, t.amount_cents, t.category_id, NULL::text AS code_anterior`
  });

  // -------------------------------------------------------------------------
  // PASSO 4 — fornecedor identificado por CNPJ, com decisão já tomada
  // -------------------------------------------------------------------------
  // As três regras da 0056, aplicadas pelo documento. O motor de regras
  // (`reclassificar.mjs`) preencheria a categoria vazia sozinho, mas não TROCA
  // 5.99 por outra coisa — 5.99 se comporta como categoria de verdade para a
  // proteção dele, e uma linha marcada "não sei" fica congelada mesmo depois
  // que a evidência aparece. É esse recorte que este passo cobre, e por isso
  // ele aplica a MESMA regra, com `classified_rule_id` preenchido.
  //
  // Os guardas estão na 0056 e valem repetir: unanimidade nas decisões
  // anteriores, pelo menos 4 delas, e a mesma direção. O guarda de direção
  // barrou Adryan Santos (36 saídas em pró-labore contra uma ENTRADA de
  // R$ 1.066,38 — dinheiro voltando não é pró-labore) e Recife Prommo.
  for (const [slug, doc, code] of [
    ['fornecedor-lyra-m2m', '27554839000128', '5.03'],
    ['fornecedor-startlaw', '35027867000115', '5.04'],
    ['concessionaria-neoenergia-pe', '10835932000108', '5.02']
  ]) {
    await aplicar({
      nome: `fornecedor por CNPJ ${doc} → ${code}`,
      evidencia: `decisoes anteriores unanimes em ${code} para o mesmo CNPJ, mesma direcao (regra ${slug})`,
      stage: 'regra',
      regraSlug: slug,
      sql: `
        WITH alvo AS (
          SELECT t.id, c99.code AS code_anterior
            FROM fin_transaction t
            LEFT JOIN fin_category c99 ON c99.id = t.category_id
            LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
           WHERE ${NA_FILA} AND ${GUARDA}
             AND COALESCE(t.counterparty_document, cp.document_number) = $1
             AND t.amount_cents < 0
        )
        UPDATE fin_transaction t
           SET category_id = (SELECT id FROM fin_category WHERE code = $2),
               classified_by = 'regra',
               classified_rule_id = (SELECT id FROM fin_rule WHERE slug = $3),
               classified_reason = jsonb_build_object(
                 'origem', 'documento_da_contraparte',
                 'motivo', 'CNPJ ' || $1::text || ' com decisoes anteriores unanimes em ' || $2::text),
               classified_at = now(), updated_at = now()
          FROM alvo WHERE t.id = alvo.id
        RETURNING t.id, t.amount_cents, t.category_id, alvo.code_anterior`,
      params: [doc, code, slug]
    });
  }

  // -------------------------------------------------------------------------
  // PASSO 5 — reembolso recebido é recuperação de despesa
  // -------------------------------------------------------------------------
  // O banco escreve a natureza da operação: "Reembolso recebido pelo Pix",
  // "Pagamento de boleto devolvido". Não é o nome do fornecedor que decide — é
  // o verbo do extrato.
  //
  // Hoje essas 18 entradas estão em 5.99, ou seja, dentro de
  // despesas_administrativas com sinal positivo, ABATENDO despesa
  // administrativa que não é delas. 9.02 "Recuperação de despesa" existe para
  // isso e é neutra na DRE.
  //
  // 9.02 e não 3.90: 3.90 "Estornos e devoluções" é dedução de RECEITA, para
  // quando somos nós que devolvemos ao cliente — é o que a regra 19
  // (`estorno-de-pix`) faz com os refunds do Asaas. Sentidos opostos, e a
  // guarda de direção é o que impede uma de virar a outra.
  await aplicar({
    nome: 'reembolso recebido → recuperação de despesa',
    evidencia: 'o extrato declara a natureza: "reembolso recebido" / "boleto devolvido", com direcao de entrada',
    stage: 'regra',
    regraSlug: 'reembolso-recebido-de-fornecedor',
    sql: `
      WITH alvo AS (
        SELECT t.id, c99.code AS code_anterior
          FROM fin_transaction t
          LEFT JOIN fin_category c99 ON c99.id = t.category_id
         WHERE ${NA_FILA} AND ${GUARDA}
           AND t.amount_cents > 0
           AND (t.description_norm LIKE '%reembolso recebido%'
             OR t.description_norm LIKE '%boleto devolvido%'
             OR t.description_norm LIKE '%pagamento devolvido%')
      )
      UPDATE fin_transaction t
         SET category_id = (SELECT id FROM fin_category WHERE code = '9.02'),
             nucleo = NULL,
             classified_by = 'regra',
             classified_rule_id = (SELECT id FROM fin_rule WHERE slug = 'reembolso-recebido-de-fornecedor'),
             classified_reason = jsonb_build_object(
               'origem', 'natureza_declarada_pelo_extrato',
               'motivo', 'dinheiro que volta de fornecedor: recuperacao de despesa, nao receita'),
             classified_at = now(), updated_at = now()
        FROM alvo WHERE t.id = alvo.id
      RETURNING t.id, t.amount_cents, t.category_id, alvo.code_anterior`
  });

  // -------------------------------------------------------------------------
  // PASSO 6 — o que não deu: indeterminado declarado, com motivo
  // -------------------------------------------------------------------------
  // Nenhuma linha da fila sai daqui sem um motivo escrito. A ordem do CASE é a
  // ordem da causa mais específica para a mais genérica, e cada ramo responde
  // "por que olhar não resolveu":
  //
  //   fatura-sem-itemizacao ....... 9 pagamentos de fatura do cartão do Inter,
  //     R$ 41.061,32. O cartão do Nubank tem `fin_card_bill` e
  //     `fin_card_transaction` — por isso os 8 pagamentos DELE viraram 9.01 com
  //     segurança: a despesa reaparece itemizada. O cartão do Inter não está no
  //     ledger. Chamar esses 9 de transferência tiraria R$ 41 mil de despesa
  //     real da DRE sem que ela reapareça em lugar nenhum — erro para cima, que
  //     é o mais perigoso.
  //
  //   servico-nao-declarado ....... as cobranças do Asaas que pararam em 3.99.
  //     Sabe-se que é receita; não se sabe de qual serviço.
  //
  //   duas-leituras-possiveis ..... Uber, iFood, Amazon, supermercado,
  //     "PIX Marketplace", convênio da Prefeitura. A escolha entre 4.04
  //     (deslocamento atribuível a serviço) e 5.06 (viagens), ou entre 7.02
  //     (ISS) e 5.10 (taxas), muda o resultado da empresa e não há dado que
  //     separe. É pergunta para o Fernando, não escolha do script.
  //
  //   contraparte-sem-historico ... contraparte com CNPJ/CPF no lastro e
  //     nenhuma decisão anterior no ledger. Sobraria o nome como critério — e
  //     foi por nome que nasceram os pareamentos falsos desfeitos na 0044.
  //
  //   sem-lastro-nem-contraparte .. não há nem documento nem cadastro. Não há o
  //     que consultar.
  const { rows: marcadas } = await client.query(`
    WITH fila AS (
      SELECT t.id, t.amount_cents, t.description_norm, t.source_kind,
             COALESCE(t.counterparty_document, cp.document_number) AS doc,
             t.counterparty_id, c99.code AS code_atual
        FROM fin_transaction t
        JOIN fin_account a ON a.id = t.account_id
        LEFT JOIN fin_category c99 ON c99.id = t.category_id
        LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
       WHERE ${NA_FILA} AND t.posted_on >= '${DE}'
    ), historico AS (
      SELECT t.counterparty_id
        FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
       WHERE c.code NOT IN ('5.99', '3.99')
         AND t.counterparty_id IN (SELECT counterparty_id FROM fila WHERE counterparty_id IS NOT NULL)
       GROUP BY 1
    ), assinatura AS (
      -- Cobrança que é de uma assinatura identificada do Asaas: casa por
      -- (contraparte, valor exato) com fin_contract, e só quando o casamento é
      -- 1:1 — nenhum cliente com duas assinaturas do mesmo valor. Ver
      -- fin_receita_assinatura_v e o cabeçalho da 0080.
      SELECT DISTINCT f.id
        FROM fila f
        JOIN fin_transaction t2 ON t2.id = f.id
        JOIN fin_contract fc ON fc.counterparty_id = t2.counterparty_id
                            AND fc.amount_cents    = t2.amount_cents
       WHERE fc.asaas_subscription_id IS NOT NULL
         AND 1 = (SELECT count(*) FROM fin_contract f2
                   WHERE f2.counterparty_id = fc.counterparty_id
                     AND f2.amount_cents    = fc.amount_cents
                     AND f2.asaas_subscription_id IS NOT NULL)
    ), motivo AS (
      SELECT f.id, f.amount_cents,
             CASE
               WHEN f.description_norm LIKE '%fatura%' AND f.amount_cents < 0
                 THEN 'indeterminado:fatura-sem-itemizacao'
               -- Mais específico que servico-nao-declarado, e por isso vem
               -- antes: aqui a dúvida é sobre 7 contratos, não sobre 45
               -- cobranças. Responder uma vez resolve todas — inclusive as
               -- futuras.
               WHEN asg.id IS NOT NULL
                 THEN 'indeterminado:assinatura-sem-servico-declarado'
               WHEN f.code_atual = '3.99'
                 THEN 'indeterminado:servico-nao-declarado'
               -- Contraparte COM decisões anteriores que este script não pôde
               -- usar (não unânimes, ou de direção oposta) é caso de leitura,
               -- não de falta de dado: o histórico existe e discorda de si.
               WHEN h.counterparty_id IS NOT NULL
                 THEN 'indeterminado:duas-leituras-possiveis'
               WHEN f.description_norm ~ '(uber|ifood|amazon|americanas|marketplace|mercado pago|99app|supermercado|restaurante)'
                 OR f.source_kind IN ('CONVENIO_ARRECADACAO', 'COMPRA_DEBITO')
                 THEN 'indeterminado:duas-leituras-possiveis'
               WHEN f.doc IS NOT NULL OR f.counterparty_id IS NOT NULL
                 THEN 'indeterminado:contraparte-sem-historico'
               ELSE 'indeterminado:sem-lastro-nem-contraparte'
             END AS tag
        FROM fila f
        LEFT JOIN historico h ON h.counterparty_id = f.counterparty_id
        LEFT JOIN assinatura asg ON asg.id = f.id
    )
    UPDATE fin_transaction t
       -- Remove antes de acrescentar: uma linha que já tinha outro motivo
       -- (servico-nao-declarado, por exemplo) e agora tem um mais específico
       -- não pode acumular os dois, senão a contagem por motivo passa a somar
       -- mais que a fila.
       SET tags = array_append(
                    ARRAY(SELECT x FROM unnest(t.tags) AS x
                           WHERE x NOT LIKE 'indeterminado:%'), m.tag),
           updated_at = now()
      FROM motivo m
     WHERE t.id = m.id
       AND ARRAY(SELECT x FROM unnest(t.tags) AS x WHERE x LIKE 'indeterminado:%') IS DISTINCT FROM ARRAY[m.tag]
    RETURNING t.id, t.amount_cents, m.tag AS tag`);

  // Quem saiu da fila perde a tag. Sem isto, `fin_indeterminado_v` viraria um
  // cemitério: a linha classificada com evidência continuaria listada como
  // impossível de determinar, e o motivo mais honesto do banco passaria a ser
  // o mais desatualizado.
  const { rows: [limpas] } = await client.query(`
    WITH fora AS (
      SELECT t.id
        FROM fin_transaction t
        LEFT JOIN fin_category c99 ON c99.id = t.category_id
       WHERE EXISTS (SELECT 1 FROM unnest(t.tags) AS u(tag) WHERE u.tag LIKE 'indeterminado:%')
         AND NOT (${NA_FILA})
    ), upd AS (
      UPDATE fin_transaction t
         SET tags = ARRAY(SELECT x FROM unnest(t.tags) AS x WHERE x NOT LIKE 'indeterminado:%'),
             updated_at = now()
        FROM fora WHERE t.id = fora.id
      RETURNING 1
    )
    SELECT count(*)::int n FROM upd`);

  const porMotivo = new Map();
  for (const r of marcadas) {
    const acc = porMotivo.get(r.tag) ?? { n: 0, v: 0 };
    acc.n += 1;
    acc.v += Math.abs(Number(r.amount_cents));
    porMotivo.set(r.tag, acc);
  }

  // Uma linha da fila sem motivo é a falha silenciosa que este passo existe
  // para impedir: ela sairia do relatório sem sair da fila.
  const { rows: [orfas] } = await client.query(`
    SELECT count(*)::int n
      FROM fin_transaction t
      LEFT JOIN fin_category c99 ON c99.id = t.category_id
     WHERE ${NA_FILA} AND t.posted_on >= '${DE}'
       AND NOT EXISTS (SELECT 1 FROM unnest(t.tags) AS u(tag) WHERE u.tag LIKE 'indeterminado:%')`);
  if (Number(orfas.n) > 0) {
    throw new Error(`${orfas.n} linhas continuam na fila sem motivo declarado — o passo 6 não cobriu todos os casos`);
  }

  // -------------------------------------------------------------------------
  // RELATÓRIO
  // -------------------------------------------------------------------------
  const depois = await medir();
  const ancoraDepois = await ancora();

  const pct = (ok, base) => `${((100 * Number(ok)) / Number(base)).toFixed(1)}%`;
  console.log(`\nFila de classificação — 2026 (a partir de ${DE})\n`);
  if (simulouMigration) {
    console.log(`  [não aplicada(s) ainda: ${simuladas.join(', ')} — rodaram dentro desta transação, que termina em ROLLBACK]\n`);
  }
  console.log('  CLASSIFICADO, POR EVIDÊNCIA');
  let totalN = 0;
  let totalV = 0;
  for (const p of passos) {
    totalN += p.n;
    totalV += p.volume;
    console.log(`  ${n4(p.n)}  ${brl(p.volume).padStart(14)}  ${p.nome}`);
    if (p.n) console.log(`        └ evidência: ${p.evidencia}`);
  }
  console.log(`  ${n4(totalN)}  ${brl(totalV).padStart(14)}  TOTAL`);

  console.log('\n  DECLARADO COMO INDETERMINADO (motivo gravado ou trocado nesta rodada)');
  for (const [tag, x] of [...porMotivo.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${n4(x.n)}  ${brl(x.v).padStart(14)}  ${tag.replace('indeterminado:', '')}`);
  }
  console.log(`  ${n4(limpas.n)}  ${''.padStart(14)}  saíram da fila e perderam a tag`);

  const { rows: estoque } = await client.query(
    `SELECT motivo, count(*)::int n, sum(abs(amount_cents))::bigint v
       FROM fin_indeterminado_v WHERE posted_on >= $1 GROUP BY 1 ORDER BY 2 DESC`, [DE]);
  console.log('\n  INDETERMINADO — ESTOQUE DE 2026 DEPOIS DA RODADA');
  for (const e of estoque) {
    console.log(`  ${n4(e.n)}  ${brl(e.v).padStart(14)}  ${e.motivo.replace('indeterminado:', '')}`);
  }
  const somaEstoque = estoque.reduce((s, e) => s + e.n, 0);
  console.log(`  ${n4(somaEstoque)}  ${''.padStart(14)}  TOTAL — tem de bater com a fila de 2026`);

  console.log('\n  FILA DE PENDÊNCIAS (fin_review_item)');
  console.log(`  ${n4(reabertos.n)}  itens reabertos ou criados para lançamento indeciso`);
  console.log(`        └ indeciso FORA da fila: ${antes.indeciso_fora_da_fila} → ${depois.indeciso_fora_da_fila}` +
              `  (é o buraco do invariante H3)`);
  console.log(`  ${n4(repend.n)}  lançamentos em 3.99/5.99 voltaram a review_status='pendente'`);

  const { rows: perguntas } = await client.query(
    `SELECT assinatura, cliente_documento, left(cliente, 24) cliente, valor_mensal_cents,
            cobrancas_na_fila, valor_na_fila_cents, sugestao, base_sugestao
       FROM fin_receita_assinatura_v ORDER BY cobrancas_na_fila DESC`);
  if (perguntas.length) {
    console.log('\n  PERGUNTA PARA O FERNANDO — qual serviço presta cada assinatura do Asaas');
    console.log('  (responder 7 linhas resolve as cobranças abaixo e todas as futuras)');
    console.log('   cob.        valor/mês  cliente                   CNPJ             sugestão');
    for (const p of perguntas) {
      console.log(`  ${n4(p.cobrancas_na_fila)}  ${brl(p.valor_mensal_cents).padStart(13)}  ` +
        `${String(p.cliente).padEnd(24)}  ${String(p.cliente_documento).padEnd(15)}  ` +
        `${p.sugestao ? `${p.sugestao} (base ${p.base_sugestao})` : '— sem base, não sugerido'}`);
    }
  }

  console.log('\n  ANTES → DEPOIS (2026)');
  const linha = (nome, a, b, base) =>
    console.log(`  ${nome.padEnd(26)} ${String(a).padStart(5)} → ${String(b).padStart(5)}   ${pct(a, base.a)} → ${pct(b, base.b)}`);
  linha('categoria real (sem .99)', antes.categoria_real, depois.categoria_real, { a: antes.total, b: depois.total });
  linha('categoria atribuída', antes.com_categoria, depois.com_categoria, { a: antes.total, b: depois.total });
  linha('núcleo definido', antes.nucleo, depois.nucleo, { a: antes.base_dre, b: depois.base_dre });
  linha('contraparte identificada', antes.contraparte, depois.contraparte, { a: antes.total, b: depois.total });
  linha('revisão concluída', antes.revisao_ok, depois.revisao_ok, { a: antes.total, b: depois.total });
  console.log(`  ${'fila (a classificar)'.padEnd(26)} ${String(antes.fila).padStart(5)} → ${String(depois.fila).padStart(5)}`);
  console.log('  (revisão concluída CAI de propósito: a 0080 fez 3.99/5.99 pararem de contar como revisadas)');

  // -------------------------------------------------------------------------
  // ÂNCORA DE DINHEIRO — a única trava que reprova a rodada inteira
  // -------------------------------------------------------------------------
  console.log('\n  ÂNCORA — soma por conta (não pode mudar)');
  const mapa = Object.fromEntries(ancoraDepois.map((r) => [r.slug, r]));
  let quebrou = false;
  for (const a of ancoraAntes) {
    const d = mapa[a.slug];
    const ok = d && String(d.soma) === String(a.soma) && d.n === a.n;
    if (!ok) quebrou = true;
    console.log(`  ${a.slug.padEnd(18)} ${brl(a.soma).padStart(16)} → ${brl(d?.soma).padStart(16)}  ${ok ? '✓' : '✗ MUDOU'}`);
  }
  if (quebrou || ancoraAntes.length !== ancoraDepois.length) {
    throw new Error('âncora de dinheiro quebrada: classificação mexeu em valor ou em quantidade de lançamento');
  }

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('\n  COMMIT — gravado.\n');
  } else {
    await client.query('ROLLBACK');
    console.log('\n  ROLLBACK — dry-run. Use --aplicar para gravar.\n');
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nabortado, nada gravado:', e.message, '\n');
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
