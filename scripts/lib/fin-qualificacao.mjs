/**
 * O motor de qualificação: quem é este lançamento, e como sei disso.
 *
 * O PROBLEMA REAL, medido antes de escrever qualquer linha
 *
 * São 306 lançamentos sem categoria em 2026, R$ 595.579,80. Destes, 156 —
 * R$ 514 mil, 86% do valor — não têm contraparte nenhuma. O extrato do Nubank
 * entrega "Transferência recebida pelo Pix" e mais nada: nem nome, nem
 * documento, nem descrição. Classificar isso um a um é adivinhação.
 *
 * A VIRADA: a informação existe, só não está no extrato. Está na carteira de
 * cobranças. Um PIX de R$ 13.388,00 no dia 23/07 e uma cobrança de
 * R$ 13.388,00 vencendo em 22/07 são o mesmo fato visto de dois lados. Casando
 * por valor e proximidade de data, 112 das 131 entradas órfãs ganham nome E
 * categoria de uma vez.
 *
 * QUATRO FONTES DE EVIDÊNCIA, da mais forte para a mais fraca
 *
 *   liquidacao   existe cobrança em aberto do mesmo valor, perto na data.
 *                Dá contraparte e categoria juntas. É quase certeza quando o
 *                candidato é único e a distância é de 0 a 2 dias.
 *   contraparte  a contraparte já tem histórico classificado. O que ela foi
 *                antes é o que ela tende a ser.
 *   padrao       a descrição, com os números mascarados, já apareceu
 *                classificada. Pega mensalidade, tarifa, anuidade.
 *   valor        o valor exato já apareceu classificado. É o mais fraco e só
 *                entra quando nada acima respondeu — R$ 100,00 pode ser
 *                qualquer coisa.
 *
 * CADA SUGESTÃO CARREGA A EVIDÊNCIA, não só o palpite. A tela mostra "casou com
 * a cobrança do Condomínio Morada, mesma quantia, 1 dia de diferença" em vez de
 * "provavelmente 3.05". Sem isso o usuário não tem como discordar com
 * fundamento — e uma sugestão que não se pode contestar é um chute com
 * autoridade.
 *
 * POR QUE MASCARAR DÍGITOS NO PADRÃO
 *
 * "cobranca recebida fatura nr 12345 condominio le parc" e a mesma linha com
 * outro número de fatura são o mesmo fato recorrente. Sem mascarar, cada mês
 * vira um padrão de um item só e o agrupamento não agrupa nada.
 */

/** Distância máxima, em dias, entre o caixa e a competência da cobrança. */
export const JANELA_LIQUIDACAO_DIAS = 45;

/** Até aqui a diferença de data é irrelevante: o banco compensa em D+0/D+2. */
export const JANELA_CERTEZA_DIAS = 2;

/**
 * A descrição com os números mascarados.
 *
 * Fica aqui e não copiada em cada consulta porque agrupar por um padrão e
 * sugerir por outro produziria grupos que discordam da própria sugestão.
 */
export const SQL_PADRAO = `
  regexp_replace(
    regexp_replace(coalesce(t.description_norm, ''), '[0-9]+', '#', 'g'),
    '\\s+', ' ', 'g')`;

/**
 * Lançamentos pendentes com as quatro evidências, um por linha.
 *
 * Parâmetros: $1 entidade, $2 início, $3 fim.
 *
 * `human_locked_fields` e `classified_by='humano'` ficam de fora porque decisão
 * humana anterior não é pendência — é resposta. Reapresentá-la faria o usuário
 * decidir duas vezes a mesma coisa e desconfiar da fila.
 */
export const SQL_PENDENTES = `
WITH pend AS (
  SELECT t.id, t.posted_on, t.amount_cents, t.account_id, t.counterparty_id,
         t.description_norm, t.description_raw, t.source,
         ${SQL_PADRAO} AS padrao
    FROM fin_transaction t
    JOIN fin_entity e ON e.id = t.entity_id AND e.slug = $1
   WHERE t.category_id IS NULL
     AND t.transfer_status = 'nao'
     AND t.posted_on >= $2::date AND t.posted_on <= $3::date
     AND t.classified_by IS DISTINCT FROM 'humano'
     AND NOT ('category_id' = ANY (t.human_locked_fields))
),

-- 0. TRANSFERÊNCIA INTERNA. Vence todas as outras, e por um motivo caro.
--
--    O dono explicou o desenho: o capital entra pelo Asaas e é distribuído —
--    Inter para pagamentos de consultoria, Nubank para obras. O extrato do
--    Nubank registra essa remessa como "Transferência recebida pelo Pix", sem
--    nome, exatamente igual ao PIX de um cliente.
--
--    Como o valor remetido costuma ser o valor que o cliente pagou, essas
--    remessas TAMBÉM casam com a cobrança dele. Sem esta verificação, a
--    evidência de liquidação classificaria a remessa como receita e a empresa
--    contaria o mesmo dinheiro duas vezes: uma no Asaas, quando o cliente
--    pagou, outra no Nubank, quando o dinheiro só mudou de bolso.
--
--    Medido no acervo: 60 das 131 entradas órfãs de 2026 têm saída de valor
--    idêntico em outra conta, quase sempre no MESMO dia. Até R$ 210 mil de
--    faturamento fantasma.
transf AS (
  SELECT p.id,
         (array_agg(a2.slug ORDER BY abs(o.posted_on - p.posted_on)))[1] AS conta_par,
         (array_agg(o.posted_on ORDER BY abs(o.posted_on - p.posted_on)))[1] AS data_par,
         min(abs(o.posted_on - p.posted_on)) AS dias,
         count(*) AS pares
    FROM pend p
    JOIN fin_transaction o ON o.amount_cents = -p.amount_cents
                          AND o.account_id <> p.account_id
                          AND abs(o.posted_on - p.posted_on) <= 3
    JOIN fin_account a2 ON a2.id = o.account_id
   -- 'Cobrança recebida' é o Asaas dizendo que um CLIENTE pagou uma fatura.
   -- Isso é receita por definição, e nenhuma coincidência de valor em outra
   -- conta a transforma em remessa interna. Sem esta guarda, uma mensalidade
   -- de valor redondo (R$ 5.000) encontra espelho por acaso e some do
   -- faturamento — o erro inverso, e igualmente caro.
     AND p.description_norm NOT LIKE 'cobranca recebida%'
     AND p.description_norm NOT LIKE 'cobranca%recebida%fatura%'
   GROUP BY p.id
),

-- 1. LIQUIDAÇÃO. Cobrança em aberto, mesmo valor, data próxima.
--    'NOT EXISTS' contra fin_settlement é o que impede sugerir uma cobrança que
--    já foi paga por outro lançamento — sem isso, uma mensalidade de valor fixo
--    casaria com todos os meses ao mesmo tempo.
liq AS (
  SELECT p.id,
         d.id AS document_id,
         cp.name AS quem,
         d.description AS doc_descricao,
         d.installment_number AS doc_parcela, d.installment_total AS doc_parcelas,
         d.billing_type AS doc_forma, d.nucleo AS doc_nucleo,
         c.code, c.name AS categoria,
         abs(d.competence_date - p.posted_on) AS dias,
         count(*) OVER (PARTITION BY p.id) AS candidatos,
         row_number() OVER (PARTITION BY p.id
                            ORDER BY abs(d.competence_date - p.posted_on),
                                     (c.id IS NULL)) AS ordem
    FROM pend p
    JOIN fin_document d
      ON d.amount_cents = abs(p.amount_cents)
     AND d.direction = CASE WHEN p.amount_cents > 0 THEN 'receber' ELSE 'pagar' END
     AND d.status NOT IN ('cancelado', 'estornado')
     AND abs(d.competence_date - p.posted_on) <= ${JANELA_LIQUIDACAO_DIAS}
     AND NOT EXISTS (SELECT 1 FROM fin_settlement s WHERE s.document_id = d.id)
    LEFT JOIN fin_counterparty cp ON cp.id = d.counterparty_id
    LEFT JOIN fin_category c ON c.id = d.category_id
),

-- 2. CONTRAPARTE. O que esta contraparte costuma ser.
hist_cp AS (
  SELECT p.id, c.code, c.name AS categoria, count(*) AS n,
         count(*)::numeric / sum(count(*)) OVER (PARTITION BY p.id) AS share,
         row_number() OVER (PARTITION BY p.id ORDER BY count(*) DESC) AS ordem
    FROM pend p
    JOIN fin_transaction h ON h.counterparty_id = p.counterparty_id
                          AND h.category_id IS NOT NULL AND h.id <> p.id
    JOIN fin_category c ON c.id = h.category_id
   WHERE p.counterparty_id IS NOT NULL
   GROUP BY p.id, c.code, c.name
),

-- 3. PADRÃO DE TEXTO.
hist_txt AS (
  SELECT p.id, c.code, c.name AS categoria, count(*) AS n,
         count(*)::numeric / sum(count(*)) OVER (PARTITION BY p.id) AS share,
         row_number() OVER (PARTITION BY p.id ORDER BY count(*) DESC) AS ordem
    FROM pend p
    JOIN fin_transaction h
      ON regexp_replace(regexp_replace(coalesce(h.description_norm,''), '[0-9]+', '#', 'g'), '\\s+', ' ', 'g') = p.padrao
     AND h.category_id IS NOT NULL AND h.id <> p.id
    JOIN fin_category c ON c.id = h.category_id
   WHERE length(p.padrao) > 8
   GROUP BY p.id, c.code, c.name
),

-- 4. VALOR EXATO.
hist_val AS (
  SELECT p.id, c.code, c.name AS categoria, count(*) AS n,
         count(*)::numeric / sum(count(*)) OVER (PARTITION BY p.id) AS share,
         row_number() OVER (PARTITION BY p.id ORDER BY count(*) DESC) AS ordem
    FROM pend p
    JOIN fin_transaction h ON h.amount_cents = p.amount_cents
                          AND h.category_id IS NOT NULL AND h.id <> p.id
    JOIN fin_category c ON c.id = h.category_id
   GROUP BY p.id, c.code, c.name
)

SELECT p.id, p.posted_on, p.amount_cents, p.padrao,
       p.description_raw, p.source,
       a.slug AS conta,
       COALESCE(cp.name, p.description_norm) AS rotulo,
       cp.name AS contraparte,
       tr.conta_par AS tr_conta, tr.data_par AS tr_data, tr.dias AS tr_dias, tr.pares AS tr_pares,
       l.quem AS liq_quem, l.doc_descricao AS liq_descricao,
       l.doc_parcela AS liq_parcela, l.doc_parcelas AS liq_parcelas,
       l.doc_forma AS liq_forma, l.doc_nucleo AS liq_nucleo,
       l.code AS liq_code, l.categoria AS liq_categoria,
       l.dias AS liq_dias, l.candidatos AS liq_candidatos, l.document_id AS liq_documento,
       hc.code AS cp_code, hc.categoria AS cp_categoria, hc.n AS cp_n, hc.share AS cp_share,
       ht.code AS tx_code, ht.categoria AS tx_categoria, ht.n AS tx_n, ht.share AS tx_share,
       hv.code AS vl_code, hv.categoria AS vl_categoria, hv.n AS vl_n, hv.share AS vl_share
  FROM pend p
  JOIN fin_account a ON a.id = p.account_id
  LEFT JOIN fin_counterparty cp ON cp.id = p.counterparty_id
  LEFT JOIN transf tr ON tr.id = p.id
  LEFT JOIN liq l ON l.id = p.id AND l.ordem = 1
  LEFT JOIN hist_cp hc ON hc.id = p.id AND hc.ordem = 1
  LEFT JOIN hist_txt ht ON ht.id = p.id AND ht.ordem = 1
  LEFT JOIN hist_val hv ON hv.id = p.id AND hv.ordem = 1
 ORDER BY p.posted_on DESC, abs(p.amount_cents) DESC`;

/**
 * Escolhe a melhor evidência e traduz em confiança.
 *
 * A ordem não é arbitrária. Liquidação é um FATO com duas pontas (a cobrança
 * existe, o dinheiro entrou no valor dela); as outras três são frequência
 * histórica, que é indício. Por isso liquidação vence mesmo com share menor.
 *
 * Devolve `null` quando nenhuma fonte respondeu — e null é uma resposta útil:
 * significa "preciso de gente", que é diferente de "chutei com pouca certeza".
 */
/**
 * Categorias que existem para dizer "não sei" e por isso não podem ser
 * sugeridas. Sugerir 5.99 com 90% de confiança é a plataforma afirmando com
 * segurança que não sabe — pior que não sugerir, porque consome a decisão do
 * usuário sem entregar informação.
 */
const NAO_SUGERIR = new Set(['5.99', '3.99']);

export function melhorSugestao(linha) {
  const opcoes = [];

  // Espelho em outra conta vence tudo. Não é frequência histórica: é o mesmo
  // dinheiro visto dos dois lados, e tratá-lo como receita conta duas vezes.
  if (linha.tr_conta) {
    const dias = Number(linha.tr_dias ?? 0);
    return {
      fonte: 'transferencia',
      code: '9.01',
      categoria: 'Transferência entre contas próprias',
      confianca: dias === 0 ? 0.95 : 0.8,
      evidencia: `espelho exato em ${linha.tr_conta} ${dias === 0 ? 'no mesmo dia' : `com ${dias} dia(s) de diferença`}${Number(linha.tr_pares) > 1 ? ` (${linha.tr_pares} candidatos)` : ''} — é o dinheiro mudando de conta, não receita`,
      documentoId: null,
      transferencia: true,
      alternativas: []
    };
  }

  if (linha.liq_code && !NAO_SUGERIR.has(linha.liq_code)) {
    const dias = Number(linha.liq_dias ?? 99);
    const candidatos = Number(linha.liq_candidatos ?? 1);
    // Candidato único e data colada é quase certeza. Muitos candidatos do mesmo
    // valor (mensalidade padronizada) derrubam a confiança: o valor deixa de
    // distinguir quem pagou.
    let conf = dias <= JANELA_CERTEZA_DIAS ? 0.95 : dias <= 10 ? 0.8 : 0.6;
    if (candidatos > 1) conf -= Math.min(0.35, 0.08 * (candidatos - 1));
    opcoes.push({
      fonte: 'liquidacao',
      code: linha.liq_code,
      categoria: linha.liq_categoria,
      confianca: Math.max(0.3, conf),
      evidencia: [
        `cobrança de ${linha.liq_quem ?? 'cliente não identificado'}, mesma quantia, ${dias} dia(s) de diferença`,
        // O detalhamento da cobrança é o que diz QUE serviço foi vendido. Sem
        // ele a evidência prova o cliente e não o tipo, e o tipo é justamente o
        // que a categoria precisa.
        linha.liq_descricao ? `“${String(linha.liq_descricao).slice(0, 70)}”` : null,
        linha.liq_parcelas ? `parcela ${linha.liq_parcela}/${linha.liq_parcelas}` : null,
        linha.liq_forma ? String(linha.liq_forma).toLowerCase() : null,
        candidatos > 1 ? `atenção: ${candidatos} cobranças do mesmo valor` : null
      ].filter(Boolean).join(' · '),
      documentoId: linha.liq_documento ?? null
    });
  }
  if (linha.cp_code && !NAO_SUGERIR.has(linha.cp_code)) {
    opcoes.push({
      fonte: 'contraparte',
      code: linha.cp_code,
      categoria: linha.cp_categoria,
      confianca: 0.5 + 0.4 * Number(linha.cp_share),
      evidencia: `${linha.contraparte} já apareceu ${linha.cp_n}x nesta categoria (${(100 * Number(linha.cp_share)).toFixed(0)}% do histórico dela)`,
      documentoId: null
    });
  }
  if (linha.tx_code && !NAO_SUGERIR.has(linha.tx_code)) {
    opcoes.push({
      fonte: 'padrao',
      code: linha.tx_code,
      categoria: linha.tx_categoria,
      confianca: 0.4 + 0.4 * Number(linha.tx_share),
      evidencia: `descrição igual já classificada ${linha.tx_n}x (${(100 * Number(linha.tx_share)).toFixed(0)}%)`,
      documentoId: null
    });
  }
  if (linha.vl_code && !NAO_SUGERIR.has(linha.vl_code)) {
    opcoes.push({
      fonte: 'valor',
      code: linha.vl_code,
      categoria: linha.vl_categoria,
      // Teto baixo de propósito: valor igual é a evidência mais fraca e não
      // deve competir de igual para igual com as outras.
      confianca: Math.min(0.55, 0.3 + 0.3 * Number(linha.vl_share)),
      evidencia: `mesmo valor já classificado ${linha.vl_n}x`,
      documentoId: null
    });
  }

  if (!opcoes.length) return null;
  opcoes.sort((a, b) => b.confianca - a.confianca);
  return { ...opcoes[0], alternativas: opcoes.slice(1) };
}

/**
 * Agrupa os pendentes pelo que os torna decidíveis juntos.
 *
 * A chave é (padrão de texto ou contraparte) + categoria sugerida. Duas linhas
 * com o mesmo texto mas sugestões diferentes NÃO viram um grupo — juntá-las
 * faria o usuário aplicar uma categoria a algo que o motor achava ser outra
 * coisa, que é o erro que este agrupamento existe para evitar.
 *
 * Ordenado pelo mais recente, como o dono pediu: o passado distante já não muda
 * decisão nenhuma, e 2026 é o ano que precisa fechar.
 */
export function agrupar(linhas) {
  const grupos = new Map();

  for (const linha of linhas) {
    const s = melhorSugestao(linha);
    // A evidência de LIQUIDAÇÃO vale para UM lançamento: aquele valor casou com
    // aquela cobrança. Usá-la como chave de grupo aplicaria a categoria de um
    // cliente a 22 PIX de 16 valores diferentes — que foi exatamente o que a
    // primeira versão fez com R$ 162 mil de entradas. Quando a prova é por
    // item, a decisão é por item.
    const provaPorItem = s?.fonte === 'liquidacao';
    const direcao = Number(linha.amount_cents) > 0 ? 'entrada' : 'saida';
    const chave = provaPorItem
      ? `item:${linha.id}`
      : [direcao,
         linha.contraparte ? `cp:${linha.contraparte}` : `tx:${linha.padrao}`,
         s?.code ?? 'sem-sugestao'].join('|');

    let g = grupos.get(chave);
    if (!g) {
      g = {
        chave,
        rotulo: provaPorItem
          ? `${linha.liq_quem ?? 'cliente'} — ${String(linha.description_raw ?? linha.padrao).slice(0, 40)}`
          : (linha.contraparte ?? linha.padrao),
        porItem: provaPorItem,
        porContraparte: Boolean(linha.contraparte),
        sugestao: s,
        itens: [],
        n: 0,
        valorCents: 0,
        maisRecente: linha.posted_on,
        maisAntigo: linha.posted_on,
        contas: new Set(),
        // Entrada e saída nunca se misturam num grupo: são perguntas
        // diferentes ("de onde veio" × "para onde foi") e uma categoria de
        // receita aplicada a uma saída é o bug que o invariante D2 mede.
        direcao: Number(linha.amount_cents) > 0 ? 'entrada' : 'saida',
        valoresDistintos: new Set()
      };
      grupos.set(chave, g);
    }
    g.itens.push({ ...linha, sugestao: s });
    g.n += 1;
    g.valorCents += Math.abs(Number(linha.amount_cents));
    g.contas.add(linha.conta);
    g.valoresDistintos.add(Number(linha.amount_cents));
    if (linha.posted_on > g.maisRecente) g.maisRecente = linha.posted_on;
    if (linha.posted_on < g.maisAntigo) g.maisAntigo = linha.posted_on;
  }

  return [...grupos.values()]
    .map((g) => ({
      ...g,
      contas: [...g.contas],
      // Valor único num grupo de vários é a assinatura de recorrência —
      // assinatura, aluguel, anuidade. Vale destacar porque decide junto.
      valorFixo: g.valoresDistintos.size === 1 && g.n > 1,
      valoresDistintos: g.valoresDistintos.size
    }))
    .sort((a, b) => (a.maisRecente < b.maisRecente ? 1 : a.maisRecente > b.maisRecente ? -1 : b.valorCents - a.valorCents));
}
