import "server-only";

import { randomUUID } from "node:crypto";

import type pg from "pg";

import { query, transaction } from "./db";
import { MARCADORES_INDECISAO, sinalEsperadoDe, type Universo } from "./contratos/categorizacao";

/**
 * A central de categorização — o lado da ESCRITA.
 *
 * Três operações, e cada uma existe por causa de um incidente medido nesta base.
 *
 * ==========================================================================
 * 1. RECLASSIFICAR EM LOTE — e por que a trava humana é obrigatória
 * ==========================================================================
 *
 * Em 11/08/2026 uma pessoa classificou 52 lançamentos na tela. Em 16/08 o
 * passo 5 de `import-asaas.mjs` herdou a categoria do documento liquidado, o
 * documento estava sem categoria, e o UPDATE gravou `category_id = NULL` por
 * cima — apagando as 52 decisões e carimbando `classified_by = 'contrato'`
 * sobre o `'humano'`. É a coorte B da §11 do CONTINUACAO.md, hoje a dúvida 40.
 *
 * A defesa não é "corrigir o importador" (isso já foi feito, `11b763e`): é
 * `human_locked_fields`. Enquanto ela não existir na linha, a próxima
 * sincronização tem o direito de sobrescrever. Por isso toda reclassificação
 * daqui acrescenta `category_id` a `human_locked_fields`, sem exceção.
 *
 * ==========================================================================
 * 2. A ORDEM: FILA PRIMEIRO, LINHA DEPOIS
 * ==========================================================================
 *
 * A 0094 ensinou `fin_transaction_revisao_sincroniza` a checar se ainda existe
 * `fin_review_item` **pendente** de motivo `baixa_confianca` antes de aceitar
 * `review_status = 'ok'`. Um UPDATE que resolve o item de fila DEPOIS de
 * atualizar a linha, mesmo na mesma transação SQL, sofre o gatilho lendo o item
 * como ainda pendente: o `'ok'` explícito é sobrescrito de volta para
 * `'pendente'`. Isso derrubou H4 por um instante (39→38 invariantes).
 *
 * Medido nesta frente, com a 0101 aplicada em transação:
 *
 *   ordem errada (tx antes da fila) → review_status = pendente
 *   ordem certa  (fila antes da tx) → review_status = ok
 *
 * ==========================================================================
 * 3. SINAL DA CATEGORIA — a recusa tem de vir ANTES do UPDATE
 * ==========================================================================
 *
 * `fin_transaction_sinal_da_categoria` ANULA `category_id` quando o sinal não
 * bate (receita numa saída, despesa numa entrada — a assinatura do bug do
 * "POSTO"). Ele faz isso em silêncio, dentro do BEFORE. Se a rota só mandasse
 * o UPDATE, o resultado seria: nada classificado, `rowCount` alto, e uma trava
 * apontando para o vazio. A 0101 fecha o segundo problema por gatilho; o
 * primeiro se resolve aqui, recusando o lote com a lista dos incompatíveis.
 *
 * ==========================================================================
 * O QUE ESTA CAMADA NÃO FAZ
 * ==========================================================================
 *
 * **Não roda o motor de regras sobre conta nenhuma.** A dúvida 0 (205 linhas
 * de `6.02 Pró-labore` → `6.01 Salários`, com consequência tributária) está
 * aberta. Uma rota de lote é ferramenta para uma pessoa decidir item a item,
 * com o efeito medido antes; ela não é `reclassificar.mjs --conta=inter` com
 * outra roupa. Por isso todo lote exige `ids` explícitos — nunca um filtro que
 * o servidor expanda — e por isso `virarRegra` nasce sempre `status='proposta'`.
 */

const ENTIDADE = "xpe";

/** Teto por requisição. Desfazer 5.000 linhas é bem mais caro que refazer duas chamadas. */
export const LOTE_MAXIMO = 1000;

type Cliente = pg.PoolClient;

export class RecusaCategorizacao extends Error {
  constructor(
    message: string,
    readonly detalhe: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "RecusaCategorizacao";
  }
}

// ---------------------------------------------------------------------------
// A tabela de cada universo, num lugar só
// ---------------------------------------------------------------------------

const TABELA: Record<Universo, string> = {
  lancamento: "fin_transaction",
  documento: "fin_document",
  item_cartao: "fin_card_transaction"
};

/**
 * `fin_review_item.target_table` só aceita transaction e document (CHECK da
 * 0009). O subledger do cartão não tem fila — e isso não é descuido desta
 * frente: é o motivo de item de cartão nunca aparecer como "em dúvida".
 */
const TEM_FILA: Record<Universo, boolean> = {
  lancamento: true,
  documento: true,
  item_cartao: false
};

// ---------------------------------------------------------------------------
// Reclassificação em lote
// ---------------------------------------------------------------------------

export type AlvoLote = { universo: Universo; ids: number[] };

export type PrevisaoLote = {
  universo: Universo;
  /** Quantos itens existem, dos ids pedidos. */
  encontrados: number;
  /** Ids pedidos que não existem naquele universo. */
  inexistentes: number[];
  /** Quantos já estão na categoria de destino — o UPDATE não muda nada neles. */
  jaNaCategoria: number;
  /** Quantos estão travados por decisão humana anterior. */
  travados: number;
  /** Itens que o sinal da categoria recusaria. O lote inteiro para por causa deles. */
  incompativeis: { id: number; valorCents: number; direcao: string; motivo: string }[];
  /** Itens declarados não classificáveis pela view (pagamento de fatura). */
  naoClassificaveis: { id: number; motivo: string }[];
  valorAntesCents: number;
  categoriasAntes: { code: string | null; n: number }[];
};

export type ResultadoLote = {
  loteId: string;
  categoria: { code: string; nome: string; kind: string; sinalEsperado: string };
  previsao: PrevisaoLote[];
  aplicado: boolean;
  /** Por universo, quantas linhas o UPDATE efetivamente mudou. */
  aplicados: { universo: Universo; n: number }[];
  /** Itens de fila resolvidos ANTES do UPDATE — a ordem que o gatilho da 0094 exige. */
  filaResolvida: { universo: Universo; n: number }[];
  eventosTrilha: number;
  travasEscritas: { universo: Universo; n: number }[];
};

/**
 * Aplica uma categoria a N itens de qualquer universo.
 *
 * `aplicar = false` (padrão) é dry-run: mede tudo, escreve nada. É o padrão da
 * casa — todo script de escrita aqui tem `--aplicar` e o default é não gravar.
 */
export async function reclassificarLote(args: {
  alvos: AlvoLote[];
  code: string;
  motivo: string;
  evidencia?: string | null;
  ator: string;
  aplicar: boolean;
}): Promise<ResultadoLote> {
  const total = args.alvos.reduce((s, a) => s + a.ids.length, 0);
  if (total === 0) throw new RecusaCategorizacao("informe ao menos um item");
  if (total > LOTE_MAXIMO) {
    throw new RecusaCategorizacao(
      `lote de ${total} itens acima do teto de ${LOTE_MAXIMO} — divida em chamadas menores`,
      { total, teto: LOTE_MAXIMO }
    );
  }
  if (!args.motivo?.trim()) {
    // Sem motivo a trilha vira "alguém mudou isso" e o desfazer perde o porquê.
    throw new RecusaCategorizacao("informe o motivo da reclassificação — a trilha sem motivo não explica nada");
  }

  return transaction(async (cli) => {
    const cat = await categoriaPorCodigo(cli, args.code);
    const sinal = sinalEsperadoDe(cat.kind);
    const loteId = randomUUID();

    const previsao: PrevisaoLote[] = [];
    for (const alvo of args.alvos) {
      previsao.push(await preverUniverso(cli, alvo, cat, sinal));
    }

    const incompativeis = previsao.flatMap((p) => p.incompativeis);
    if (incompativeis.length) {
      // Recusa ANTES do UPDATE. Se deixasse passar, o gatilho de sinal anularia
      // a categoria em silêncio e a linha sairia pior do que entrou.
      throw new RecusaCategorizacao(
        `${incompativeis.length} item(ns) têm sinal incompatível com ${cat.code} ${cat.name} ` +
          `(esperado: ${sinal}). O gatilho fin_transaction_sinal_da_categoria anularia a categoria ` +
          `em silêncio, e o lote sairia com a linha pior do que entrou.`,
        { esperado: sinal, itens: incompativeis.slice(0, 20), total: incompativeis.length }
      );
    }

    const naoClassificaveis = previsao.flatMap((p) => p.naoClassificaveis);
    if (naoClassificaveis.length) {
      throw new RecusaCategorizacao(
        `${naoClassificaveis.length} item(ns) não são classificáveis: ${naoClassificaveis[0].motivo}`,
        { itens: naoClassificaveis.slice(0, 20) }
      );
    }

    const base: ResultadoLote = {
      loteId,
      categoria: { code: cat.code, nome: cat.name, kind: cat.kind, sinalEsperado: sinal },
      previsao,
      aplicado: false,
      aplicados: [],
      filaResolvida: [],
      eventosTrilha: 0,
      travasEscritas: []
    };

    if (!args.aplicar) {
      // Dry-run: a transação sobe intacta, mas nada foi escrito.
      return base;
    }

    let eventos = 0;
    for (const alvo of args.alvos) {
      if (!alvo.ids.length) continue;
      const tabela = TABELA[alvo.universo];

      // ---- 1. TRILHA, com o valor anterior. É o que torna o desfazer possível.
      const { rowCount: nEventos } = await cli.query(
        `INSERT INTO fin_classification_event
           (target_table, target_id, stage, category_id, accepted, superseded_value, rationale, actor)
         SELECT $2::text, x.id, 'humano', $3::bigint, true,
                jsonb_build_object('category_id', x.category_id,
                                   'classified_by', x.classified_by,
                                   'classified_rule_id', x.classified_rule_id,
                                   'human_locked_fields', to_jsonb(x.human_locked_fields)),
                jsonb_build_object('motivo', $4::text, 'evidencia', $5::text,
                                   'lote', $6::text, 'universo', $7::text,
                                   'origem', 'central de categorização'),
                $8::text
           FROM ${tabela} x WHERE x.id = ANY($1::bigint[])`,
        [alvo.ids, tabela, cat.id, args.motivo, args.evidencia ?? null, loteId, alvo.universo, args.ator]
      );
      eventos += nEventos ?? 0;

      // ---- 2. FILA ANTES DA LINHA. A ordem que a §6 do CONTINUACAO exige.
      //
      // O gatilho fin_transaction_revisao_sincroniza lê `fin_review_item`
      // pendente de motivo `baixa_confianca` no BEFORE do UPDATE. Resolver
      // depois, mesmo no statement seguinte da mesma transação, faz o
      // `review_status='ok'` voltar a 'pendente' sozinho.
      //
      // Exceção declarada: se o destino é 3.99/5.99, o item de fila NÃO é
      // resolvido — o H3 exige item pendente para todo indeciso, e marcar
      // "a classificar" é declarar indecisão, não resolvê-la.
      let filaN = 0;
      if (TEM_FILA[alvo.universo] && !MARCADORES_INDECISAO.includes(cat.code as never)) {
        const { rowCount } = await cli.query(
          `UPDATE fin_review_item
              SET status = 'resolvido', resolved_at = now(), resolved_by = $3::text
            WHERE target_table = $2::text AND target_id = ANY($1::bigint[]) AND status = 'pendente'`,
          [alvo.ids, tabela, args.ator]
        );
        filaN = rowCount ?? 0;
      }
      base.filaResolvida.push({ universo: alvo.universo, n: filaN });

      // ---- 3. A LINHA. `classified_by='humano'`, ponteiro de regra zerado
      //         (D6 exige o par completo) e a TRAVA acrescentada.
      // `classified_rule_id = NULL` É OBRIGATÓRIO NO MESMO SET. Não é higiene.
      //
      // Medido em 16/08/2026: 9.793 lançamentos (R$ 4.599.435,44) carregam
      // `classified_rule_id`. Um `UPDATE fin_transaction SET category_id = X`
      // que NÃO cite `classified_rule_id` estoura o CHECK
      // `fin_transaction_rule_version_paridade`, e a mensagem fala de versão de
      // regra — não de categoria. O mecanismo: `fin_transaction_sinal_da_categoria`
      // zera `classified_rule_id` de dentro do BEFORE, mas
      // `zz_fin_transaction_rule_version` é `BEFORE UPDATE OF classified_rule_id,
      // classified_rule_version_id` e não dispara, deixando a versão órfã.
      //
      // Provado nos dois sentidos em `scripts/test-categorizacao.mjs`:
      //   SET category_id                        → viola a paridade
      //   SET category_id, classified_rule_id=NULL → passa
      //
      // No cartão o motivo é outro e igualmente obrigatório: `fin_card_transaction`
      // não tem esses dois gatilhos, então nada estoura — a linha simplesmente
      // ficaria dizendo "quem decidiu foi a regra X" com uma categoria escolhida
      // por gente. É o badge "por quê?" mentindo, que é o defeito que o D6 existe
      // para pegar.
      const colunas = [
        `category_id = $2`,
        `classified_by = 'humano'`,
        `classified_rule_id = NULL`,
        `classified_at = now()`,
        `human_locked_fields = (
           SELECT COALESCE(array_agg(DISTINCT f), '{}'::text[])
             FROM unnest(x.human_locked_fields || ARRAY['category_id']) AS f)`
      ];
      if (alvo.universo === "item_cartao") {
        // FK para fin_card_evidencia; o slug nasce na 0101.
        colunas.push(`classified_evidence = 'decisao_humana'`);
      } else {
        colunas.push(
          `classified_reason = jsonb_build_object('motivo', $3::text, 'evidencia', $4::text, 'lote', $5::text)`
        );
        colunas.push(`review_status = 'ok'`);
        colunas.push(`updated_at = now()`);
      }

      const params: unknown[] =
        alvo.universo === "item_cartao"
          ? [alvo.ids, cat.id]
          : [alvo.ids, cat.id, args.motivo, args.evidencia ?? null, loteId];

      const { rowCount } = await cli.query(
        `UPDATE ${tabela} x SET ${colunas.join(", ")} WHERE x.id = ANY($1::bigint[])`,
        params
      );
      base.aplicados.push({ universo: alvo.universo, n: rowCount ?? 0 });

      // ---- 4. A PROVA de que a trava ficou escrita, relida do banco.
      const { rows: travadas } = await cli.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${tabela} x
          WHERE x.id = ANY($1::bigint[]) AND 'category_id' = ANY (x.human_locked_fields)`,
        [alvo.ids]
      );
      base.travasEscritas.push({ universo: alvo.universo, n: Number(travadas[0]?.n ?? 0) });
    }

    // ---- 5. AUDITORIA. `before`/`after` no formato que o desfazer lê.
    //
    // `target_id` é NOT NULL em fin_audit_log (0004) — esta linha resume um
    // LOTE, não uma única linha, então não existe um alvo único de verdade.
    // Em vez de um sentinela inventado (0, -1: nenhum dos dois documentado em
    // lugar nenhum), uso o primeiro id do lote como âncora — o resto do lote
    // já está inteiro dentro de `before`/`after`, e `batch_id` é o que agrupa
    // a trilha completa (fin_audit_log.batch_id, lido por
    // lib/financeiro/contratos/auditoria.ts). Bug pré-existente: literal NULL
    // aqui violava a constraint sempre que `aplicar: true` chegava a esta
    // linha — achado ao reclassificar um lançamento de verdade, não
    // introduzido agora.
    const primeiroId = args.alvos.flatMap((a) => a.ids)[0];
    await cli.query(
      `INSERT INTO fin_audit_log (entity_id, batch_id, actor, action, target_table, target_id, before, after, fields)
       SELECT e.id, $1::uuid, $2::text, 'bulk_update', 'fin_categorizavel_v', $6::bigint,
              $3::jsonb, $4::jsonb, ARRAY['category_id','classified_by','human_locked_fields']
         FROM fin_entity e WHERE e.slug = $5`,
      [
        loteId,
        args.ator,
        JSON.stringify({ previsao }),
        JSON.stringify({
          categoria: cat.code,
          motivo: args.motivo,
          evidencia: args.evidencia ?? null,
          aplicados: base.aplicados,
          filaResolvida: base.filaResolvida,
          travasEscritas: base.travasEscritas
        }),
        ENTIDADE,
        primeiroId
      ]
    );

    base.aplicado = true;
    base.eventosTrilha = eventos;
    return base;
  });
}

async function categoriaPorCodigo(
  cli: Cliente,
  code: string
): Promise<{ id: number; code: string; name: string; kind: string }> {
  const { rows } = await cli.query<{ id: string; code: string; name: string; kind: string; is_active: boolean }>(
    `SELECT c.id, c.code, c.name, c.kind, c.is_active FROM fin_category c
       JOIN fin_entity e ON e.id = c.entity_id AND e.slug = $1
      WHERE c.code = $2`,
    [ENTIDADE, code]
  );
  if (!rows.length) throw new RecusaCategorizacao(`categoria ${code} não existe`);
  if (!rows[0].is_active) {
    throw new RecusaCategorizacao(
      `categoria ${code} está desativada — reative-a antes de classificar, ou escolha outra`
    );
  }
  return { id: Number(rows[0].id), code: rows[0].code, name: rows[0].name, kind: rows[0].kind };
}

async function preverUniverso(
  cli: Cliente,
  alvo: AlvoLote,
  cat: { id: number; code: string; name: string; kind: string },
  sinal: "entrada" | "saida" | "ambos"
): Promise<PrevisaoLote> {
  const { rows } = await cli.query<Record<string, unknown>>(
    `SELECT v.id, v.valor_abs_cents::text AS valor, v.direcao, v.categoria_code, v.travado,
            v.category_id, v.classificavel, v.motivo_nao_classificavel
       FROM fin_categorizavel_v v
      WHERE v.universo = $1 AND v.id = ANY($2::bigint[])`,
    [alvo.universo, alvo.ids]
  );

  const achados = new Set(rows.map((r) => Number(r.id)));
  const contagem = new Map<string | null, number>();
  for (const r of rows) {
    const k = (r.categoria_code as string) ?? null;
    contagem.set(k, (contagem.get(k) ?? 0) + 1);
  }

  return {
    universo: alvo.universo,
    encontrados: rows.length,
    inexistentes: alvo.ids.filter((id) => !achados.has(id)),
    jaNaCategoria: rows.filter((r) => r.categoria_code === cat.code).length,
    travados: rows.filter((r) => r.travado).length,
    incompativeis: rows
      .filter((r) => sinal !== "ambos" && r.direcao !== sinal)
      .map((r) => ({
        id: Number(r.id),
        valorCents: Number(r.valor),
        direcao: String(r.direcao),
        motivo: `${cat.code} ${cat.name} é ${cat.kind} e exige ${sinal}; este item é ${r.direcao}`
      })),
    naoClassificaveis: rows
      .filter((r) => !r.classificavel)
      .map((r) => ({ id: Number(r.id), motivo: String(r.motivo_nao_classificavel ?? "não classificável") })),
    valorAntesCents: rows.reduce((s, r) => s + Number(r.valor), 0),
    categoriasAntes: [...contagem.entries()]
      .map(([code, n]) => ({ code, n }))
      .sort((a, b) => b.n - a.n)
  };
}

// ---------------------------------------------------------------------------
// Transformar a decisão em regra — sempre PROPOSTA
// ---------------------------------------------------------------------------

export type PropostaRegra = {
  slug: string;
  status: "proposta";
  categoria: string;
  /** Quantos itens do acervo ATUAL a regra pegaria se fosse ativada. Medido, não estimado. */
  alcanceAtual: { universo: Universo; n: number; valorAbsCents: number }[];
  /** Desses, quantos já estão em outra categoria — a regra os reclassificaria. */
  conflitos: { categoriaCode: string; n: number }[];
  /** Quantos estão travados por decisão humana e a regra NÃO tocaria. */
  protegidos: number;
};

/**
 * Transforma uma decisão em `fin_rule`, sempre com `status='proposta'`.
 *
 * NUNCA ativa direto, e o motivo é medido: a regra 40 (`meios-de-pagamento`)
 * nasceu ativa, acumulou 25 acertos e **zero** verdadeiros positivos — ela
 * procurava `stone|cielo|pagseguro` no texto e o Nubank põe o banco do
 * RECEBEDOR no fim de todo PIX enviado. Posto de combustível e oito PIX a
 * pessoa física foram parar em `4.05 Tarifas bancárias`. Pessoa física não
 * emite tarifa bancária.
 *
 * `proposta` é o estado em que uma regra pode ser medida antes de valer, e o
 * invariante D1 garante que nenhum lançamento a aponte enquanto ela não for
 * ativada: `classified_rule_id` só resolve para regra `ativa`.
 */
export async function virarRegra(args: {
  code: string;
  padrao: string;
  porContraparte: boolean;
  rotulo: string;
  ator: string;
  nota?: string | null;
  aplicar: boolean;
}): Promise<PropostaRegra> {
  const alvo = args.padrao.replace(/#/g, " ").replace(/\s+/g, " ").trim();
  if (alvo.length < 18) {
    // Uma regra curta engole meio extrato. É a `pix-pessoa-fisica`, precisão
    // medida de 15,2%, e é ela quem move as 205 linhas da dúvida 0.
    throw new RecusaCategorizacao(
      `o padrão "${alvo}" tem ${alvo.length} caracteres — abaixo de 18 ele pega lançamento alheio. ` +
        `Foi assim que a regra pix-pessoa-fisica chegou a 15,2% de precisão.`,
      { padrao: alvo, minimo: 18 }
    );
  }

  const slug = `categorizacao-${alvo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 46)}`;

  const cond = args.porContraparte
    ? { all: [{ op: "equals", field: "counterparty_name_norm", value: alvo.toLowerCase() }] }
    : { all: [{ op: "contains_any", field: "description_norm", value: [alvo.slice(0, 60).toLowerCase()] }] };

  // O alcance é medido contra o acervo de HOJE, com a mesma semântica da
  // condição. "Quantos itens futuros pegaria" não tem resposta exata; "quantos
  // do acervo atual pegaria" tem, e é o número honesto de oferecer.
  const alcance = await query<Record<string, unknown>>(
    `SELECT v.universo, count(*)::text AS n, sum(v.valor_abs_cents)::text AS valor,
            count(*) FILTER (WHERE v.travado)::text AS protegidos
       FROM fin_categorizavel_v v
      WHERE ${args.porContraparte ? "lower(coalesce(v.contraparte, '')) = $1" : "v.descricao_norm LIKE '%' || $1 || '%'"}
      GROUP BY v.universo ORDER BY v.universo`,
    [args.porContraparte ? alvo.toLowerCase() : alvo.slice(0, 60).toLowerCase()]
  );

  const conflitos = await query<Record<string, unknown>>(
    `SELECT v.categoria_code, count(*)::text AS n
       FROM fin_categorizavel_v v
      WHERE ${args.porContraparte ? "lower(coalesce(v.contraparte, '')) = $1" : "v.descricao_norm LIKE '%' || $1 || '%'"}
        AND v.categoria_code IS NOT NULL AND v.categoria_code <> $2
      GROUP BY 1 ORDER BY 2 DESC`,
    [args.porContraparte ? alvo.toLowerCase() : alvo.slice(0, 60).toLowerCase(), args.code]
  );

  const proposta: PropostaRegra = {
    slug,
    status: "proposta",
    categoria: args.code,
    alcanceAtual: alcance.map((a) => ({
      universo: String(a.universo) as Universo,
      n: Number(a.n),
      valorAbsCents: Number(a.valor ?? 0)
    })),
    conflitos: conflitos.map((c) => ({ categoriaCode: String(c.categoria_code), n: Number(c.n) })),
    protegidos: alcance.reduce((s, a) => s + Number(a.protegidos ?? 0), 0)
  };

  if (!args.aplicar) return proposta;

  await transaction(async (cli) => {
    await categoriaPorCodigo(cli, args.code);
    await cli.query(
      `INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions,
                             confidence, source, status, created_by, notes)
       SELECT e.id, $1, $2, 120, 'transaction', $3::jsonb,
              jsonb_build_object('category_code', $4::text), 70, 'humano', 'proposta', $5, $6
         FROM fin_entity e WHERE e.slug = $7
       ON CONFLICT (entity_id, slug) DO UPDATE
          SET conditions = EXCLUDED.conditions, actions = EXCLUDED.actions,
              notes = EXCLUDED.notes, updated_at = now()
        WHERE fin_rule.status = 'proposta'`,
      [
        slug,
        `Categorização: ${args.rotulo.slice(0, 50)}`,
        JSON.stringify(cond),
        args.code,
        args.ator,
        args.nota ??
          `Proposta na central de categorização. Alcance medido no acervo atual: ` +
            `${proposta.alcanceAtual.reduce((s, a) => s + a.n, 0)} item(ns), ` +
            `${proposta.conflitos.length} categoria(s) em conflito, ${proposta.protegidos} travado(s).`,
        ENTIDADE
      ]
    );
  });

  return proposta;
}

// ---------------------------------------------------------------------------
// CRUD de categoria
// ---------------------------------------------------------------------------

export type CategoriaEntrada = {
  code: string;
  nome: string;
  kind: string;
  cashFlowGroup: string;
  dreLine: string;
  tocClass?: string;
  nucleoPadrao?: string | null;
  parentCode?: string | null;
  /** Linha de produto (0124) — nula é "ainda não classificada", não um erro. */
  productLineId?: number | null;
};

const KINDS = [
  "receita",
  "deducao_receita",
  "custo_variavel_direto",
  "despesa_operacional",
  "pessoal",
  "imposto",
  "investimento",
  "movimentacao_financeira"
] as const;

/** Derivado de `kind`, para a categoria nova não nascer com DRE incoerente. */
const TOC_POR_KIND: Record<string, string> = {
  receita: "throughput_receita",
  deducao_receita: "throughput_receita",
  custo_variavel_direto: "custo_totalmente_variavel",
  despesa_operacional: "despesa_operacional",
  pessoal: "despesa_operacional",
  imposto: "custo_totalmente_variavel",
  investimento: "investimento",
  movimentacao_financeira: "neutro"
};

export async function criarCategoria(entrada: CategoriaEntrada, ator: string) {
  const code = entrada.code.trim();
  if (!/^\d\.\d{2}$/.test(code)) {
    throw new RecusaCategorizacao(
      `o código "${code}" não segue o formato do plano de contas (N.NN, ex.: 6.09)`,
      { code }
    );
  }
  if (MARCADORES_INDECISAO.includes(code as never)) {
    throw new RecusaCategorizacao(
      `${code} já existe e é marcador de indecisão, não linha do plano de contas`
    );
  }
  if (!KINDS.includes(entrada.kind as never)) {
    throw new RecusaCategorizacao(`kind inválido: use um de ${KINDS.join(", ")}`, { kinds: KINDS });
  }
  if (!entrada.nome?.trim()) throw new RecusaCategorizacao("informe o nome da categoria");

  return transaction(async (cli) => {
    const { rows } = await cli.query<Record<string, unknown>>(
      `INSERT INTO fin_category
         (entity_id, parent_id, code, name, kind, toc_class, dre_line, cash_flow_group,
          default_nucleo, is_active, sort_order, product_line_id)
       SELECT e.id,
              (SELECT p.id FROM fin_category p WHERE p.entity_id = e.id AND p.code = $9),
              $1, $2, $3, $4, $5, $6, $7, true,
              COALESCE((SELECT max(c2.sort_order) + 1 FROM fin_category c2 WHERE c2.entity_id = e.id), 1),
              $10
         FROM fin_entity e WHERE e.slug = $8
       RETURNING id, code, name, kind, cash_flow_group, dre_line, default_nucleo, is_active, product_line_id`,
      [
        code,
        entrada.nome.trim(),
        entrada.kind,
        entrada.tocClass ?? TOC_POR_KIND[entrada.kind],
        entrada.dreLine,
        entrada.cashFlowGroup,
        entrada.nucleoPadrao ?? null,
        ENTIDADE,
        entrada.parentCode ?? null,
        entrada.productLineId ?? null
      ]
    );

    await cli.query(
      `INSERT INTO fin_audit_log (entity_id, actor, action, target_table, target_id, before, after)
       SELECT e.id, $1, 'insert', 'fin_category', $2::bigint, NULL, $3::jsonb
         FROM fin_entity e WHERE e.slug = $4`,
      [ator, rows[0].id, JSON.stringify(rows[0]), ENTIDADE]
    );

    return {
      ...rows[0],
      sinalEsperado: sinalEsperadoDe(entrada.kind)
    };
  });
}

export type CategoriaEdicao = {
  nome?: string;
  cashFlowGroup?: string;
  dreLine?: string;
  nucleoPadrao?: string | null;
  parentCode?: string | null;
  ativa?: boolean;
  /** Linha de produto (0124). `undefined` não mexe; `null` desatribui. */
  productLineId?: number | null;
};

/**
 * Edita nome/agrupamento, ou desativa.
 *
 * As duas recusas que importam — 3.99/5.99 e categoria com uso vivo — moram no
 * BANCO (gatilhos da 0101), não aqui. Esta função lê `fin_categoria_uso_v`
 * antes para poder explicar em português, mas se ela errasse o gatilho ainda
 * recusaria. A régua é uma só; esta camada é a tradução dela.
 *
 * `kind` NÃO é editável: ele decide o sinal exigido e a linha da DRE, e trocá-lo
 * numa categoria com uso vivo reclassificaria dinheiro sem passar por
 * `fin_classification_event`. Categoria com natureza errada se resolve criando a
 * certa e movendo os itens em lote — com trilha.
 */
export async function editarCategoria(code: string, edicao: CategoriaEdicao, ator: string) {
  const campos: string[] = [];
  const params: unknown[] = [ENTIDADE, code];
  const push = (sql: string, valor: unknown) => {
    params.push(valor);
    campos.push(sql.replace("$?", `$${params.length}`));
  };

  if (edicao.nome !== undefined) push("name = $?", edicao.nome.trim());
  if (edicao.cashFlowGroup !== undefined) push("cash_flow_group = $?", edicao.cashFlowGroup);
  if (edicao.dreLine !== undefined) push("dre_line = $?", edicao.dreLine);
  if (edicao.nucleoPadrao !== undefined) push("default_nucleo = $?", edicao.nucleoPadrao);
  if (edicao.productLineId !== undefined) push("product_line_id = $?", edicao.productLineId);
  if (edicao.ativa !== undefined) push("is_active = $?", edicao.ativa);
  if (edicao.parentCode !== undefined) {
    params.push(edicao.parentCode);
    campos.push(
      `parent_id = (SELECT p.id FROM fin_category p JOIN fin_entity e2 ON e2.id = p.entity_id
                     AND e2.slug = $1 WHERE p.code = $${params.length})`
    );
  }
  if (!campos.length) throw new RecusaCategorizacao("nada a alterar");

  return transaction(async (cli) => {
    const { rows: antes } = await cli.query<Record<string, unknown>>(
      `SELECT u.* FROM fin_categoria_uso_v u
         JOIN fin_category c ON c.id = u.id
         JOIN fin_entity e ON e.id = c.entity_id AND e.slug = $1
        WHERE u.code = $2`,
      [ENTIDADE, code]
    );
    if (!antes.length) throw new RecusaCategorizacao(`categoria ${code} não existe`);

    const { rows: depois } = await cli.query<Record<string, unknown>>(
      `UPDATE fin_category c SET ${campos.join(", ")}
         FROM fin_entity e
        WHERE e.id = c.entity_id AND e.slug = $1 AND c.code = $2
       RETURNING c.id, c.code, c.name, c.kind, c.cash_flow_group, c.dre_line,
                 c.default_nucleo, c.is_active, c.product_line_id`,
      params
    );

    await cli.query(
      `INSERT INTO fin_audit_log (entity_id, actor, action, target_table, target_id, before, after)
       SELECT e.id, $1, 'update', 'fin_category', $2::bigint, $3::jsonb, $4::jsonb
         FROM fin_entity e WHERE e.slug = $5`,
      [ator, antes[0].id, JSON.stringify(antes[0]), JSON.stringify(depois[0]), ENTIDADE]
    );

    return { ...depois[0], sinalEsperado: sinalEsperadoDe(String(depois[0].kind)) };
  });
}
