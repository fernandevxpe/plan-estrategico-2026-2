import "server-only";

import { query, queryOne, transaction } from "@/lib/financeiro/db";
import { TimeError } from "@/lib/financeiro/time";

/**
 * O outro lado do app do time: a fila de quem decide.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO É SEPARADO DE `time.ts`
 * ---------------------------------------------------------------------------
 * Porque aqui existe a consulta que `time.ts` não pode ter: a que lista o envio
 * de TODO MUNDO. Se ela morasse no mesmo módulo, uma linha de import a
 * distância separaria uma rota do time de devolver a caixa inteira — e o erro
 * seria invisível na revisão, porque a chamada pareceria igual às outras.
 *
 * A fronteira é física: `time.ts` só tem funções que recebem `Sessao`;
 * `time-admin.ts` só é importado por rotas sob `/api/financeiro`, que o
 * middleware protege com 404 para o perfil comum.
 *
 * ---------------------------------------------------------------------------
 * O QUE DECIDIR SIGNIFICA AQUI — E O QUE NÃO SIGNIFICA
 * ---------------------------------------------------------------------------
 * Decidir é TRIAGEM: aceito, devolvo com motivo, recuso com motivo. Não é
 * autorizar pagamento. Um envio aprovado continua sem tocar caixa: para virar
 * saída, ele precisa de um `fin_payment_request`, e esse caminho exige alçada
 * (`fin_approval_rule`), que está vazia por desenho — dúvida 27. Confundir os
 * dois faria "aprovado" significar "pago", que é exatamente o que a fila de
 * pagamento da 0075 foi construída para impedir.
 */

const ENTITY = "xpe";

export type ItemDaFilaDoTime = {
  origem: "custo" | "nota_entrada" | "compra" | "reembolso";
  id: number;
  code: string;
  pessoa: string;
  pessoaId: number;
  titulo: string;
  detalhe: string | null;
  valorCents: number;
  data: string | null;
  status: string;
  enviadoEm: string | null;
  /**
   * O que sustenta a identidade de quem enviou. Vai para a tela do decisor
   * porque muda o peso do que ele está lendo: 'declarada' quer dizer que a
   * credencial do time é compartilhada e ninguém provou ser aquela pessoa.
   */
  identidade: "declarada" | "pin" | null;
  anexos: number;
  links: { url: string; loja: string | null; titulo: string | null; precoCents: number | null }[];
};

export async function getFilaDoTime(): Promise<{
  envios: ItemDaFilaDoTime[];
  totalCents: number;
  semComprovante: number;
}> {
  const envios = await query<Record<string, unknown>>(
    `SELECT e.kind AS origem, e.id, e.code, p.name AS pessoa, e.person_id,
            e.titulo, e.descricao, e.amount_cents, e.incurred_on, e.status, e.enviado_em,
            e.identidade_prova,
            (SELECT count(*) FROM fin_payment_attachment a
              WHERE a.target_table = 'fin_time_envio' AND a.target_id = e.id)::int AS anexos
       FROM fin_time_envio e
       JOIN fin_person p ON p.id = e.person_id
       JOIN fin_entity en ON en.id = e.entity_id AND en.slug = $1
      WHERE e.status IN ('enviado', 'em_analise')
      ORDER BY e.enviado_em`,
    [ENTITY]
  );

  const compras = await query<Record<string, unknown>>(
    `SELECT c.id, c.code, coalesce(p.name, c.requested_by) AS pessoa, c.requested_person_id,
            c.title AS titulo, c.justification AS descricao, c.amount_cents, c.needed_by,
            c.status, c.created_at, c.priority, c.quantity, c.unit
       FROM fin_purchase_request c
       LEFT JOIN fin_person p ON p.id = c.requested_person_id
       JOIN fin_entity en ON en.id = c.entity_id AND en.slug = $1
      WHERE c.status IN ('enviada', 'em_cotacao')
      ORDER BY
        CASE c.priority WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        c.needed_by NULLS LAST`,
    [ENTITY]
  );

  const links = compras.length
    ? await query<Record<string, unknown>>(
        `SELECT purchase_request_id, url, loja, titulo, price_cents
           FROM fin_purchase_request_link
          WHERE purchase_request_id = ANY($1::bigint[])
          ORDER BY id`,
        [compras.map((c) => Number(c.id))]
      )
    : [];

  const porPedido = new Map<number, ItemDaFilaDoTime["links"]>();
  for (const l of links) {
    const id = Number(l.purchase_request_id);
    if (!porPedido.has(id)) porPedido.set(id, []);
    porPedido.get(id)!.push({
      url: String(l.url),
      loja: (l.loja as string) ?? null,
      titulo: (l.titulo as string) ?? null,
      precoCents: l.price_cents === null ? null : Number(l.price_cents)
    });
  }

  const lista: ItemDaFilaDoTime[] = [
    ...envios.map((e) => ({
      origem: String(e.origem) as "custo" | "nota_entrada",
      id: Number(e.id),
      code: String(e.code),
      pessoa: String(e.pessoa),
      pessoaId: Number(e.person_id),
      titulo: String(e.titulo),
      detalhe: (e.descricao as string) ?? null,
      valorCents: Number(e.amount_cents),
      data: e.incurred_on ? new Date(e.incurred_on as string).toISOString().slice(0, 10) : null,
      status: String(e.status),
      enviadoEm: e.enviado_em ? new Date(e.enviado_em as string).toISOString() : null,
      identidade: (e.identidade_prova as "declarada" | "pin") ?? null,
      anexos: Number(e.anexos ?? 0),
      links: []
    })),
    ...compras.map((c) => ({
      origem: "compra" as const,
      id: Number(c.id),
      code: String(c.code),
      pessoa: String(c.pessoa ?? "—"),
      pessoaId: c.requested_person_id === null ? 0 : Number(c.requested_person_id),
      titulo:
        c.quantity === null
          ? String(c.titulo)
          : `${String(c.titulo)} · ${Number(c.quantity)}${c.unit ? ` ${c.unit}` : ""}`,
      detalhe: (c.descricao as string) ?? null,
      valorCents: Number(c.amount_cents),
      data: c.needed_by ? new Date(c.needed_by as string).toISOString().slice(0, 10) : null,
      status: String(c.status),
      enviadoEm: c.created_at ? new Date(c.created_at as string).toISOString() : null,
      identidade: null,
      anexos: 0,
      links: porPedido.get(Number(c.id)) ?? []
    }))
  ];

  return {
    envios: lista,
    totalCents: lista.reduce((a, i) => a + i.valorCents, 0),
    semComprovante: lista.filter((i) => i.origem !== "compra" && i.anexos === 0).length
  };
}

const DECISOES_ENVIO: Record<string, string> = {
  aprovar: "aprovado",
  devolver: "devolvido",
  recusar: "recusado",
  analisar: "em_analise"
};

const DECISOES_COMPRA: Record<string, string> = {
  aprovar: "aprovada",
  devolver: "em_cotacao",
  recusar: "reprovada",
  analisar: "em_cotacao"
};

/**
 * Registra a decisão.
 *
 * Duas exigências que o banco também faz, repetidas aqui só para a mensagem ser
 * útil em vez de um erro de constraint na cara do usuário:
 *
 *   · devolver ou recusar SEM motivo é recusado. "O que voltou e por quê" é
 *     metade do que o time pediu; um estado 'devolvido' sem texto é uma porta
 *     que fecha sem dizer nada.
 *   · quem decide tem de se identificar. `decided_by` e `decided_at` andam
 *     juntos (CHECK na 0105): meia decisão gravada tira o item da fila sem que
 *     ninguém tenha assinado.
 */
export async function decidirEnvioDoTime(entrada: {
  origem: unknown;
  id: unknown;
  decisao: unknown;
  motivo: unknown;
  ator: string;
}) {
  const id = Number(entrada.id);
  if (!Number.isInteger(id) || id <= 0) throw new TimeError("id inválido");
  const decisao = String(entrada.decisao ?? "");
  const motivo = typeof entrada.motivo === "string" && entrada.motivo.trim() ? entrada.motivo.trim() : null;
  const ator = entrada.ator?.trim();
  if (!ator) throw new TimeError("quem está decidindo?", 400);

  if (["devolver", "recusar"].includes(decisao) && !motivo) {
    throw new TimeError("devolver ou recusar exige o motivo — é o que a pessoa vai ler");
  }

  const ehCompra = entrada.origem === "compra";
  const alvo = ehCompra ? DECISOES_COMPRA[decisao] : DECISOES_ENVIO[decisao];
  if (!alvo) throw new TimeError(`decisão desconhecida: ${decisao}`);

  return transaction(async (client) => {
    if (ehCompra) {
      const r = await client.query(
        `UPDATE fin_purchase_request
            SET status = $2, decided_by = $3, decided_at = now(), decision_reason = coalesce($4, decision_reason)
          WHERE id = $1 AND status IN ('enviada', 'em_cotacao')
          RETURNING id, code, status`,
        [id, alvo, ator, motivo]
      );
      if (!r.rows[0]) throw new TimeError("pedido não está na fila", 404);
      await client.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
         SELECT entity_id, 'fin_purchase_request', $1, 'update', $2::jsonb, ARRAY['status','decision_reason'], $3
           FROM fin_purchase_request WHERE id = $1`,
        [id, JSON.stringify({ status: alvo, decision_reason: motivo }), ator]
      );
      return r.rows[0];
    }

    const r = await client.query(
      `UPDATE fin_time_envio
          SET status = $2, decided_by = $3, decided_at = now(), decision_reason = coalesce($4, decision_reason)
        WHERE id = $1 AND status IN ('enviado', 'em_analise')
        RETURNING id, code, status`,
      [id, alvo, ator, motivo]
    );
    if (!r.rows[0]) throw new TimeError("envio não está na fila", 404);
    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
       SELECT entity_id, 'fin_time_envio', $1, 'update', $2::jsonb, ARRAY['status','decision_reason'], $3
         FROM fin_time_envio WHERE id = $1`,
      [id, JSON.stringify({ status: alvo, decision_reason: motivo }), ator]
    );

    // APROVAR PASSA A PRODUZIR ALGO.
    //
    // Até aqui, aprovar mudava `status` e escrevia auditoria — e parava. O custo
    // aprovado era uma decisão registrada que não chegava na DRE, não entrava na
    // previsão de caixa e não tinha como ser confrontada com o extrato. O app
    // inteiro parava de valer nesse ponto.
    //
    // Agora nasce um `fin_custo_previsto`, que é a tabela desenhada exatamente
    // para isso na 0100 e que estava com zero linhas: ela guarda o previsto, e
    // tem `realizado_transaction_id` para receber o lançamento do extrato quando
    // ele chegar. É o outro lado da ponte que a conciliação vai atravessar.
    //
    // NÃO cria fin_transaction, e isso é regra: registro de pessoa não vira
    // caixa. Caixa é o que o banco diz. O previsto espera o realizado; nunca o
    // substitui.
    if (alvo === "aprovado") {
      await client.query(
        `INSERT INTO fin_custo_previsto
           (entity_id, origem, origem_ref, person_id, competencia, descricao,
            category_id, nucleo, cost_center_id, dia_esperado, valor_previsto_cents,
            estado, created_by)
         SELECT e.entity_id, 'derivado', 'fin_time_envio:' || e.id, e.person_id,
                date_trunc('month', e.incurred_on)::date,
                left(e.titulo, 200),
                e.categoria_sugerida_id,
                (SELECT c.default_nucleo FROM fin_category c WHERE c.id = e.categoria_sugerida_id),
                e.cost_center_id,
                coalesce(e.due_on, e.incurred_on),
                e.amount_cents,
                'previsto', $2
           FROM fin_time_envio e
          WHERE e.id = $1 AND e.kind = 'custo' AND e.amount_cents > 0
         ON CONFLICT DO NOTHING`,
        [id, `aprovacao:${ator}`]
      );
    }

    return r.rows[0];
  });
}

/** Quanto do que o time manda chega com comprovante. A régua da lacuna que o app fecha. */
export async function getSaudeComprovante() {
  return queryOne<{
    itens: number;
    com_comprovante: number;
    sem_comprovante: number;
    sem_comprovante_cents: number;
    pct_com_comprovante: number | null;
  }>(`SELECT * FROM fin_time_comprovante_saude_v`);
}
