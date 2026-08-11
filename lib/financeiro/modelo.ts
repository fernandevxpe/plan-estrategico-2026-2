import "server-only";

import { isFinanceConfigured, query } from "./db";

/**
 * O modelo de gestão do dono, montado a partir de três fontes que discordam.
 *
 * Cada célula (linha do modelo × mês) pode ter três números:
 *
 *   realizado   somado do ledger pelo mapa de `fin_model_map`. É o que os
 *               extratos bancários provam que aconteceu.
 *   referencia  o que a planilha de 21 abas afirma. Congelado na importação.
 *   manual      o que o dono digitou na tela, quando sabe algo que o extrato
 *               ainda não sabe.
 *
 * O EXIBIDO é `manual ?? realizado`. A referência NUNCA vira o valor exibido:
 * ela é a coluna de conferência. A distinção importa porque a planilha e o
 * ledger discordam de verdade — em janeiro, 15,7% — e a tela que escolhesse
 * sozinha qual dos dois mostrar estaria escondendo a pergunta em vez de fazê-la.
 *
 * SINAL. Não há regra de sinal por seção. `amount_cents` já vem assinado pelo
 * sentido do dinheiro no extrato: receita positiva, despesa negativa. Todo
 * subtotal é soma simples, e o EBITDA é a soma de tudo. Foi a decisão que
 * eliminou a classe inteira de bug "o custo entrou somando".
 *
 * REGIME. Caixa, não competência: `posted_on`. É deliberado e diferente de
 * `dre.ts`, que soma por `competence_date` a partir de `fin_document`. A
 * planilha do dono é de caixa — a aba chama-se "Fluxo de Caixa" — e o objetivo
 * aqui é ser comparável com ela. Quem quiser competência usa `dre.ts`, e a tela
 * diz qual regime está lendo.
 */

const ENTIDADE = "xpe";

export type Secao = "receita" | "deducao" | "custo_operacao" | "custo_fixo" | "resultado";
export type Procedencia = "referencia" | "manual";
export type Confianca = "exata" | "alta" | "media" | "sem_fonte";

export type CelulaModelo = {
  mes: number;
  realizado: number | null;
  referencia: number | null;
  manual: number | null;
  /** `manual ?? realizado`. É o que a tela mostra e o que os subtotais somam. */
  valor: number;
  /** `valor - referencia`, ou null quando não há referência para comparar. */
  divergencia: number | null;
};

export type LinhaModelo = {
  slug: string;
  nome: string;
  paiSlug: string | null;
  secao: Secao;
  tipo: "item" | "subtotal" | "calculado";
  ordem: number;
  nivel: number;
  origemLinha: number | null;
  confianca: Confianca;
  /** Categorias do plano de contas que alimentam a linha, para a tela explicar. */
  fontes: string[];
  celulas: CelulaModelo[];
  total: number;
  totalReferencia: number | null;
  temManual: boolean;
};

export type ResumoModelo = {
  ano: number;
  /** Meses com qualquer movimento no ledger — define até onde o realizado vale. */
  mesesComDado: number[];
  /** Meses com referência da planilha. Difere do acima, e é o ponto. */
  mesesComReferencia: number[];
  /**
   * Meses cujo extrato ainda não chegou ao fim do mês.
   *
   * Sem isto, agosto — com dados só até o dia 7 — entra na margem do ano como
   * se fosse um mês inteiro de operação, e puxa o resultado para cima porque a
   * folha do dia 30 ainda não saiu. É o mesmo erro da planilha (período
   * desigual), só que um nível mais sutil.
   */
  mesesParciais: number[];
  linhas: LinhaModelo[];
  totaisPorSecao: Record<Secao, number[]>;
  ebitda: number[];
  /** Quanto do realizado do ano está em linhas de confiança 'media' ou pior. */
  valorEmLinhaIncerta: number;
  /**
   * Quanto do dinheiro do extrato o modelo alcança.
   *
   * Lançamento sem categoria não cai em linha nenhuma, e portanto não aparece
   * em nenhum total desta tela. Se essa fração for grande, o EBITDA daqui é
   * otimista por construção — a despesa existe no banco e não no modelo. O
   * número tem de estar na tela, não num comentário.
   */
  cobertura: { dentro: number; fora: number; pct: number };
  atualizadoEm: string | null;
};

const SECOES: Secao[] = ["receita", "deducao", "custo_operacao", "custo_fixo", "resultado"];

/**
 * O realizado, do ledger.
 *
 * `transfer_status = 'nao'` e não `<> 'pareado'`: aqui a pergunta é "quanto a
 * operação ganhou e gastou", e transferência entre contas próprias não é nem
 * ganho nem gasto. As duas convenções vivem nomeadas em `queries.ts` porque
 * respondem perguntas diferentes; esta é a de resultado.
 *
 * O `DISTINCT` no join importa: uma linha pode ter vários critérios de mapa
 * (6.01@obras, 6.02@obras, …) e um lançamento casaria com mais de um se algum
 * dia dois critérios se sobrepusessem. `semear-modelo.mjs` prova que não se
 * sobrepõem hoje; o DISTINCT garante que, se um dia se sobrepuserem, o número
 * fique certo e o alarme apareça no seminário em vez de na decisão do dono.
 */
const SQL_REALIZADO = `
  WITH casado AS (
    SELECT DISTINCT t.id, l.slug AS line_slug,
           extract(month FROM t.posted_on)::int AS mes,
           t.amount_cents
      FROM fin_transaction t
      JOIN fin_category c    ON c.id = t.category_id
      JOIN fin_model_map m   ON m.entity_id = c.entity_id
                            AND m.category_code = c.code
                            AND (m.nucleo IS NULL
                                 OR (NOT m.nucleo_excluir AND t.nucleo = m.nucleo)
                                 OR (m.nucleo_excluir AND t.nucleo IS DISTINCT FROM m.nucleo))
      JOIN fin_model_line l  ON l.id = m.line_id
      JOIN fin_entity e      ON e.id = t.entity_id AND e.slug = $1
     WHERE extract(year FROM t.posted_on) = $2
       AND t.transfer_status = 'nao'
  )
  SELECT line_slug, mes, sum(amount_cents)::bigint AS valor
    FROM casado GROUP BY 1, 2`;

export async function carregarModelo(ano: number): Promise<ResumoModelo | null> {
  if (!isFinanceConfigured()) return null;

  const [linhasRaw, realizado, valores, movimento, atualizacao] = await Promise.all([
    query<{
      slug: string; name: string; parent_slug: string | null; section: Secao;
      kind: LinhaModelo["tipo"]; sort_order: number; origem_linha: number | null;
      fontes: string[] | null; confianca: string | null;
    }>(
      `SELECT l.slug, l.name, l.parent_slug, l.section, l.kind, l.sort_order, l.origem_linha,
              array_remove(array_agg(DISTINCT m.category_code), NULL) AS fontes,
              min(m.observacao) AS confianca
         FROM fin_model_line l
         JOIN fin_entity e ON e.id = l.entity_id AND e.slug = $1
         LEFT JOIN fin_model_map m ON m.line_id = l.id
        WHERE l.is_active
        GROUP BY l.id, l.slug, l.name, l.parent_slug, l.section, l.kind, l.sort_order, l.origem_linha
        ORDER BY l.sort_order`,
      [ENTIDADE]
    ),
    query<{ line_slug: string; mes: number; valor: number }>(SQL_REALIZADO, [ENTIDADE, ano]),
    query<{ line_slug: string; mes: number; procedencia: Procedencia; valor_cents: number }>(
      `SELECT v.line_slug, v.mes, v.procedencia, v.valor_cents
         FROM fin_model_value v
         JOIN fin_entity e ON e.id = v.entity_id AND e.slug = $1
        WHERE v.ano = $2`,
      [ENTIDADE, ano]
    ),
    // Um mês é parcial quando o último lançamento dele não alcança o último dia
    // do mês. `max(posted_on)` por mês é o que o extrato afirma sobre a própria
    // cobertura; não há como saber melhor sem perguntar ao banco.
    query<{ mes: number; parcial: boolean; dentro: number; fora: number }>(
      `SELECT extract(month FROM t.posted_on)::int AS mes,
              (max(t.posted_on) < (date_trunc('month', max(t.posted_on)) + interval '1 month - 1 day')::date) AS parcial,
              COALESCE(sum(abs(t.amount_cents)) FILTER (WHERE t.category_id IS NOT NULL), 0)::bigint AS dentro,
              COALESCE(sum(abs(t.amount_cents)) FILTER (WHERE t.category_id IS NULL), 0)::bigint AS fora
         FROM fin_transaction t JOIN fin_entity e ON e.id = t.entity_id AND e.slug = $1
        WHERE extract(year FROM t.posted_on) = $2 AND t.transfer_status = 'nao'
        GROUP BY 1 ORDER BY 1`,
      [ENTIDADE, ano]
    ),
    query<{ quando: string | null }>(
      `SELECT max(updated_at)::text AS quando FROM fin_model_value v
         JOIN fin_entity e ON e.id = v.entity_id AND e.slug = $1 WHERE v.ano = $2`,
      [ENTIDADE, ano]
    )
  ]);

  const chave = (slug: string, mes: number) => `${slug} ${mes}`;

  const mapRealizado = new Map<string, number>();
  for (const r of realizado) mapRealizado.set(chave(r.line_slug, r.mes), Number(r.valor));

  const mapReferencia = new Map<string, number>();
  const mapManual = new Map<string, number>();
  for (const v of valores) {
    const alvo = v.procedencia === "manual" ? mapManual : mapReferencia;
    alvo.set(chave(v.line_slug, v.mes), Number(v.valor_cents));
  }

  const mesesComDado = movimento.map((m) => m.mes);
  const mesesParciais = movimento.filter((m) => m.parcial).map((m) => m.mes);
  const dentro = movimento.reduce((s, m) => s + Number(m.dentro), 0);
  const fora = movimento.reduce((s, m) => s + Number(m.fora), 0);
  const mesesComReferencia = [
    ...new Set(valores.filter((v) => v.procedencia === "referencia").map((v) => v.mes))
  ].sort((a, b) => a - b);

  // Profundidade na hierarquia, para a tela indentar sem recalcular.
  const paiDe = new Map(linhasRaw.map((l) => [l.slug, l.parent_slug]));
  const nivelDe = (slug: string) => {
    let n = 0;
    let atual = paiDe.get(slug) ?? null;
    while (atual && n < 8) { n += 1; atual = paiDe.get(atual) ?? null; }
    return n;
  };

  const linhas: LinhaModelo[] = linhasRaw.map((l) => {
    const celulas: CelulaModelo[] = [];
    for (let mes = 1; mes <= 12; mes += 1) {
      const k = chave(l.slug, mes);
      const r = mapRealizado.get(k) ?? null;
      const ref = mapReferencia.get(k) ?? null;
      const man = mapManual.get(k) ?? null;
      const valor = man ?? r ?? 0;
      celulas.push({
        mes,
        realizado: r,
        referencia: ref,
        manual: man,
        valor,
        divergencia: ref === null ? null : valor - ref
      });
    }
    return {
      slug: l.slug,
      nome: l.name,
      paiSlug: l.parent_slug,
      secao: l.section,
      tipo: l.kind,
      ordem: l.sort_order,
      nivel: nivelDe(l.slug),
      origemLinha: l.origem_linha,
      confianca: (l.confianca as Confianca) ?? "sem_fonte",
      fontes: l.fontes ?? [],
      celulas,
      total: celulas.reduce((s, c) => s + c.valor, 0),
      totalReferencia: celulas.some((c) => c.referencia !== null)
        ? celulas.reduce((s, c) => s + (c.referencia ?? 0), 0)
        : null,
      temManual: celulas.some((c) => c.manual !== null)
    };
  });

  // Subtotal soma os DESCENDENTES-FOLHA, não os filhos diretos.
  //
  // Somar filhos diretos exigiria que a árvore fosse resolvida de baixo para
  // cima em ordem topológica; somar as folhas dá o mesmo resultado sem depender
  // da ordem, e um nível intermediário novo não quebra a conta.
  const porSlug = new Map(linhas.map((l) => [l.slug, l]));
  const ehFolha = (l: LinhaModelo) => l.tipo === "item";
  const descende = (slug: string, ancestral: string) => {
    let atual: string | null | undefined = slug;
    for (let i = 0; atual && i < 8; i += 1) {
      atual = porSlug.get(atual)?.paiSlug ?? null;
      if (atual === ancestral) return true;
    }
    return false;
  };

  for (const linha of linhas) {
    if (linha.tipo !== "subtotal") continue;
    const folhas = linhas.filter((l) => ehFolha(l) && descende(l.slug, linha.slug));
    for (let mes = 1; mes <= 12; mes += 1) {
      const c = linha.celulas[mes - 1];
      c.realizado = folhas.reduce((s, f) => s + (f.celulas[mes - 1].realizado ?? 0), 0);
      c.referencia = folhas.some((f) => f.celulas[mes - 1].referencia !== null)
        ? folhas.reduce((s, f) => s + (f.celulas[mes - 1].referencia ?? 0), 0)
        : null;
      c.manual = null; // subtotal não é editável: editar o filho é o caminho
      c.valor = folhas.reduce((s, f) => s + f.celulas[mes - 1].valor, 0);
      c.divergencia = c.referencia === null ? null : c.valor - c.referencia;
    }
    linha.total = linha.celulas.reduce((s, c) => s + c.valor, 0);
    linha.totalReferencia = linha.celulas.some((c) => c.referencia !== null)
      ? linha.celulas.reduce((s, c) => s + (c.referencia ?? 0), 0)
      : null;
  }

  // Totais por seção e EBITDA. Como o sinal já vem do extrato, o EBITDA é a
  // soma corrida das quatro seções — nenhuma subtração escrita à mão.
  const totaisPorSecao = Object.fromEntries(
    SECOES.map((s) => [s, Array.from({ length: 12 }, () => 0)])
  ) as Record<Secao, number[]>;

  for (const linha of linhas) {
    if (linha.tipo !== "item") continue;
    for (let mes = 0; mes < 12; mes += 1) totaisPorSecao[linha.secao][mes] += linha.celulas[mes].valor;
  }

  const ebitda = Array.from({ length: 12 }, (_, mes) =>
    totaisPorSecao.receita[mes] + totaisPorSecao.deducao[mes] +
    totaisPorSecao.custo_operacao[mes] + totaisPorSecao.custo_fixo[mes]
  );

  const linhaEbitda = porSlug.get("ebitda");
  if (linhaEbitda) {
    linhaEbitda.celulas.forEach((c, i) => {
      c.realizado = ebitda[i];
      c.valor = ebitda[i];
      c.divergencia = c.referencia === null ? null : ebitda[i] - c.referencia;
    });
    linhaEbitda.total = ebitda.reduce((s, v) => s + v, 0);
  }

  const valorEmLinhaIncerta = linhas
    .filter((l) => l.tipo === "item" && (l.confianca === "media" || l.confianca === "sem_fonte"))
    .reduce((s, l) => s + Math.abs(l.total), 0);

  return {
    ano,
    mesesComDado,
    mesesComReferencia,
    mesesParciais,
    linhas,
    totaisPorSecao,
    ebitda,
    valorEmLinhaIncerta,
    cobertura: { dentro, fora, pct: dentro + fora ? (100 * dentro) / (dentro + fora) : 0 },
    atualizadoEm: atualizacao[0]?.quando ?? null
  };
}

/**
 * Grava o valor digitado pelo dono numa célula.
 *
 * Apagar (valor `null`) remove a linha em vez de gravar zero. A diferença é
 * real: zero é uma afirmação ("não houve"), ausência é a devolução do controle
 * ao ledger. Sem essa distinção não haveria como desfazer uma edição.
 *
 * Subtotal recusado de propósito: seu valor é a soma dos filhos, e aceitar uma
 * edição ali criaria um total que não corresponde às suas próprias parcelas.
 */
export async function gravarValorManual(params: {
  ano: number; mes: number; lineSlug: string;
  valorCents: number | null; motivo?: string; autor?: string;
}): Promise<{ ok: true; id: number | null } | { ok: false; erro: string }> {
  const { ano, mes, lineSlug, valorCents, motivo, autor } = params;

  if (!isFinanceConfigured()) return { ok: false, erro: "banco do financeiro não configurado" };
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return { ok: false, erro: "mês fora de 1..12" };
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) return { ok: false, erro: "ano fora de 2000..2100" };
  if (valorCents !== null && !Number.isSafeInteger(valorCents)) return { ok: false, erro: "valor precisa ser inteiro em centavos" };

  const linha = await query<{ id: number; entity_id: number; kind: string }>(
    `SELECT l.id, l.entity_id, l.kind FROM fin_model_line l
       JOIN fin_entity e ON e.id = l.entity_id AND e.slug = $1
      WHERE l.slug = $2 AND l.is_active`,
    [ENTIDADE, lineSlug]
  );
  if (!linha.length) return { ok: false, erro: `linha "${lineSlug}" não existe` };
  if (linha[0].kind !== "item") return { ok: false, erro: "subtotal não é editável: edite as linhas que o compõem" };

  // O id volta em ambos os caminhos porque a trilha de auditoria precisa dele:
  // `fin_audit_log.target_id` é NOT NULL, e apontar para nada seria uma trilha
  // que não leva de volta ao que mudou.
  if (valorCents === null) {
    const removido = await query<{ id: number }>(
      `DELETE FROM fin_model_value
        WHERE entity_id = $1 AND line_slug = $2 AND ano = $3 AND mes = $4 AND procedencia = 'manual'
        RETURNING id`,
      [linha[0].entity_id, lineSlug, ano, mes]
    );
    return { ok: true, id: removido[0]?.id ?? null };
  }

  const gravado = await query<{ id: number }>(
    `INSERT INTO fin_model_value (entity_id, line_slug, ano, mes, procedencia, valor_cents, motivo, updated_by)
     VALUES ($1,$2,$3,$4,'manual',$5,$6,$7)
     ON CONFLICT (entity_id, line_slug, ano, mes, procedencia)
     DO UPDATE SET valor_cents = EXCLUDED.valor_cents, motivo = EXCLUDED.motivo,
                   updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING id`,
    [linha[0].entity_id, lineSlug, ano, mes, valorCents, motivo ?? null, autor ?? "tela"]
  );
  return { ok: true, id: gravado[0]?.id ?? null };
}
