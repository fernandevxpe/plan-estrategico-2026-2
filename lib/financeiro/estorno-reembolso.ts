import "server-only";

import { normalizeDescription } from "@/scripts/lib/fin-normalize.mjs";
import { query, transaction } from "./db";
import { gerarPixBrcode } from "./pix-brcode";
import { historicoParcelasItem, type Sessao, TimeError } from "./time";

const ENTITY = "xpe";
const CIDADE_PIX = "BELO HORIZONTE";

export const MOTIVOS_ESTORNO = [
  { slug: "devolucao", rotulo: "Devolução da compra" },
  { slug: "erro_compra", rotulo: "Erro na compra" },
  { slug: "desistencia", rotulo: "Desisti da compra" },
  { slug: "outro", rotulo: "Outro motivo" }
] as const;

export type MotivoEstorno = (typeof MOTIVOS_ESTORNO)[number]["slug"];
export type StatusEstorno = "aberto" | "parcial" | "quitado" | "cancelado_admin";

export type EstornoReembolso = {
  id: number;
  itemFonte: "app" | "planilha";
  itemId: number;
  titulo: string;
  motivoCategoria: MotivoEstorno;
  motivo: string;
  valorCents: number;
  parcelasPagas: number;
  parcelasDetalhe: { parcela: number; mes: string; valorCents: number }[];
  status: StatusEstorno;
  pixChave: string;
  pixTipo: string;
  pixNomeRecebedor: string;
  brcode: string | null;
  contaSugeridaSlug: string | null;
  criadoEm: string;
  quitadoEm: string | null;
  matchSugeridoId: number | null;
  matchConfianca: "alta" | "media" | "baixa" | null;
};

async function dadosPixEmpresa(): Promise<{
  cnpj: string;
  nome: string;
  contaInterId: number | null;
}> {
  const [ent] = await query<{ cnpj: string; legal_name: string }>(
    `SELECT cnpj, legal_name FROM fin_entity WHERE slug = $1`,
    [ENTITY]
  );
  if (!ent?.cnpj) throw new TimeError("CNPJ da empresa não configurado", 503);
  const [conta] = await query<{ id: number }>(
    `SELECT a.id FROM fin_account a
      JOIN fin_entity e ON e.id = a.entity_id AND e.slug = $1
     WHERE a.slug = 'inter' AND a.is_active`,
    [ENTITY]
  );
  return { cnpj: ent.cnpj.replace(/\D/g, ""), nome: ent.legal_name, contaInterId: conta?.id ?? null };
}

async function estornoPorItem(
  fonte: "app" | "planilha",
  itemId: number,
  personId?: number
): Promise<EstornoReembolso | null> {
  const params: unknown[] = [fonte, itemId];
  let filtro = "";
  if (personId !== undefined) {
    filtro = " AND e.person_id = $3";
    params.push(personId);
  }
  const [row] = await query<Record<string, unknown>>(
    `SELECT e.id, e.item_fonte, e.item_id, e.titulo, e.motivo_categoria, e.motivo,
            e.valor_cents, e.parcelas_pagas, e.parcelas_detalhe, e.status,
            e.pix_chave, e.pix_tipo, e.pix_nome_recebedor, e.brcode,
            e.criado_em, e.quitado_em, e.match_sugerido_id, e.match_confianca,
            a.slug AS conta_slug
       FROM fin_reembolso_estorno e
       LEFT JOIN fin_account a ON a.id = e.conta_sugerida_id
      WHERE e.item_fonte = $1 AND e.item_id = $2${filtro}`,
    params
  );
  if (!row) return null;
  return mapEstorno(row);
}

function mapEstorno(row: Record<string, unknown>): EstornoReembolso {
  const detalhe = row.parcelas_detalhe;
  return {
    id: Number(row.id),
    itemFonte: row.item_fonte as "app" | "planilha",
    itemId: Number(row.item_id),
    titulo: String(row.titulo),
    motivoCategoria: row.motivo_categoria as MotivoEstorno,
    motivo: String(row.motivo),
    valorCents: Number(row.valor_cents),
    parcelasPagas: Number(row.parcelas_pagas),
    parcelasDetalhe: Array.isArray(detalhe) ? (detalhe as EstornoReembolso["parcelasDetalhe"]) : [],
    status: row.status as StatusEstorno,
    pixChave: String(row.pix_chave),
    pixTipo: String(row.pix_tipo),
    pixNomeRecebedor: String(row.pix_nome_recebedor),
    brcode: row.brcode ? String(row.brcode) : null,
    contaSugeridaSlug: row.conta_slug ? String(row.conta_slug) : null,
    criadoEm: new Date(row.criado_em as string).toISOString(),
    quitadoEm: row.quitado_em ? new Date(row.quitado_em as string).toISOString() : null,
    matchSugeridoId: row.match_sugerido_id === null ? null : Number(row.match_sugerido_id),
    matchConfianca: (row.match_confianca as EstornoReembolso["matchConfianca"]) ?? null
  };
}

/** Sugere transação de entrada com valor exato e nome da pessoa no extrato. */
export async function sugerirMatchEstorno(
  personId: number,
  valorCents: number,
  desde: string
): Promise<{ transactionId: number; confianca: "alta" | "media" | "baixa"; descricao: string } | null> {
  const [pessoa] = await query<{ name: string; normalized_name: string | null }>(
    `SELECT name, normalized_name FROM fin_person WHERE id = $1`,
    [personId]
  );
  if (!pessoa) return null;
  const prefixo = (pessoa.normalized_name ?? pessoa.name).split(/\s+/)[0]?.toLowerCase();
  if (!prefixo || prefixo.length < 3) return null;

  const candidatos = await query<{ id: number; description: string; amount_cents: number }>(
    `SELECT t.id, t.description, t.amount_cents
       FROM fin_transaction t
       JOIN fin_account a ON a.id = t.account_id
       JOIN fin_entity e ON e.id = a.entity_id AND e.slug = $1
      WHERE t.amount_cents = $2
        AND t.occurred_at >= $3::timestamptz
        AND t.amount_cents > 0
        AND t.transfer_status = 'nao'
      ORDER BY t.occurred_at DESC
      LIMIT 20`,
    [ENTITY, valorCents, desde]
  );

  for (const c of candidatos) {
    const desc = normalizeDescription(c.description).toLowerCase();
    if (desc.includes(prefixo)) {
      return { transactionId: c.id, confianca: "alta", descricao: c.description };
    }
  }
  if (candidatos.length === 1) {
    return { transactionId: candidatos[0].id, confianca: "media", descricao: candidatos[0].description };
  }
  if (candidatos.length > 0) {
    return { transactionId: candidatos[0].id, confianca: "baixa", descricao: candidatos[0].description };
  }
  return null;
}

export async function buscarEstornoItem(
  sessao: Sessao,
  fonte: "app" | "planilha",
  itemId: number
): Promise<EstornoReembolso | null> {
  return estornoPorItem(fonte, itemId, sessao.personId);
}

export async function cancelarItemReembolso(
  sessao: Sessao,
  fonte: "app" | "planilha",
  itemId: number,
  dados: { motivoCategoria: string; motivo: string; confirmar: boolean }
): Promise<EstornoReembolso> {
  return cancelarItemReembolsoInterno(sessao.personId, fonte, itemId, dados, `time:${sessao.personId}`);
}

export async function cancelarItemReembolsoAdmin(
  personId: number,
  fonte: "app" | "planilha",
  itemId: number,
  dados: { motivoCategoria: string; motivo: string; confirmar: boolean },
  ator: string
): Promise<EstornoReembolso> {
  return cancelarItemReembolsoInterno(personId, fonte, itemId, dados, ator);
}

async function cancelarItemReembolsoInterno(
  personId: number,
  fonte: "app" | "planilha",
  itemId: number,
  dados: { motivoCategoria: string; motivo: string; confirmar: boolean },
  criadoPor: string
): Promise<EstornoReembolso> {
  if (!dados.confirmar) throw new TimeError("confirme o cancelamento", 400);
  const motivo = dados.motivo?.trim();
  if (!motivo || motivo.length < 3) throw new TimeError("descreva o motivo do cancelamento", 400);
  const cat = dados.motivoCategoria;
  if (!MOTIVOS_ESTORNO.some((m) => m.slug === cat)) throw new TimeError("motivo inválido", 400);

  const existente = await estornoPorItem(fonte, itemId, personId);
  if (existente && existente.status !== "cancelado_admin") {
    throw new TimeError("este item já foi cancelado", 409);
  }

  const sessaoStub = { personId, nome: "", prova: "declarada" as const, admin: false, trocarSenha: false, expiraEm: "" };
  const historico = await historicoParcelasItem(sessaoStub, fonte, itemId);
  const parcelasPagas = historico.parcelas.filter((p) => p.situacao === "pago");
  const valorCents = parcelasPagas.reduce((s, p) => s + p.valorCents, 0);
  const parcelasDetalhe = parcelasPagas.map((p) => ({
    parcela: p.parcela,
    mes: p.mes,
    valorCents: p.valorCents
  }));

  const pix = await dadosPixEmpresa();
  const brcode =
    valorCents > 0
      ? gerarPixBrcode({
          chave: pix.cnpj,
          tipoChave: "CNPJ",
          nomeRecebedor: pix.nome,
          cidade: CIDADE_PIX,
          valorReais: valorCents / 100,
          txid: `EST${itemId}`
        })
      : null;

  const [pessoa] = await query<{ name: string }>(`SELECT name FROM fin_person WHERE id = $1`, [personId]);
  const titulo = historico.titulo || "Item de reembolso";

  return transaction(async (client) => {
    const entRes = await client.query<{ id: number }>(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTITY]);
    const ent = entRes.rows[0];
    if (!ent) throw new TimeError("entidade não configurada", 503);

    let slug: string | null = historico.slug;
    if (fonte === "planilha") {
      const linhaRes = await client.query<{ slug: string }>(
        `SELECT slug FROM fin_reembolso_item WHERE id = $1 AND person_id = $2`,
        [itemId, personId]
      );
      const linha = linhaRes.rows[0];
      if (!linha) throw new TimeError("item não encontrado", 404);
      slug = linha.slug;
    }

    if (fonte === "app") {
      const r = await client.query(
        `UPDATE fin_reimbursement_item i
            SET status = 'cancelado'
           FROM fin_reimbursement r
          WHERE i.id = $1 AND i.reimbursement_id = r.id AND r.person_id = $2
            AND i.status <> 'cancelado'
          RETURNING i.installment_plan_id`,
        [itemId, personId]
      );
      if (!r.rowCount) throw new TimeError("item não encontrado", 404);
      const planoId = r.rows[0]?.installment_plan_id as number | null;
      if (planoId) {
        await client.query(
          `UPDATE fin_installment_plan SET status = 'cancelado', notes = COALESCE(notes, '') || ' — cancelado pelo app' WHERE id = $1`,
          [planoId]
        );
      }
    }

    const ins = await client.query<{ id: number }>(
      `INSERT INTO fin_reembolso_estorno (
         entity_id, person_id, item_fonte, item_id, slug, titulo,
         motivo_categoria, motivo, valor_cents, parcelas_pagas, parcelas_detalhe,
         pix_chave, pix_tipo, pix_nome_recebedor, brcode, conta_sugerida_id, criado_por
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,'CNPJ',$13,$14,$15,$16)
       RETURNING id`,
      [
        ent.id,
        personId,
        fonte,
        itemId,
        slug,
        titulo,
        cat,
        motivo,
        valorCents,
        parcelasPagas.length,
        JSON.stringify(parcelasDetalhe),
        pix.cnpj,
        pix.nome,
        brcode,
        pix.contaInterId,
        criadoPor
      ]
    );
    const estornoId = ins.rows[0].id;

    if (slug) {
      await client.query(
        `INSERT INTO fin_reembolso_slug_cancelado (entity_id, person_id, slug, estorno_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (person_id, slug) DO UPDATE SET estorno_id = EXCLUDED.estorno_id, cancelado_em = now()`,
        [ent.id, personId, slug, estornoId]
      );
    }

    let documentId: number | null = null;
    if (valorCents > 0) {
      const descricao = `Estorno reembolso — ${pessoa?.name ?? "colaborador"} — ${titulo}`;
      const doc = await client.query<{ id: number }>(
        `INSERT INTO fin_document (
           entity_id, direction, counterparty_id, description, description_norm,
           competence_date, due_date, expected_cash_date, cash_date_basis, flexibility,
           amount_cents, status, source, source_id, planned_at, created_by, notes
         )
         SELECT $1, 'receber', p.counterparty_id, $2, $3,
                CURRENT_DATE, CURRENT_DATE, CURRENT_DATE, 'vencimento', 'fixo',
                $4, 'previsto', 'reembolso_estorno', $5, now(), $6, $7
           FROM fin_person p WHERE p.id = $8
         RETURNING id`,
        [
          ent.id,
          descricao,
          normalizeDescription(descricao),
          valorCents,
          `reembolso_estorno:${estornoId}`,
          criadoPor,
          motivo,
          personId
        ]
      );
      documentId = doc.rows[0]?.id ?? null;
      if (documentId) {
        await client.query(`UPDATE fin_reembolso_estorno SET document_id = $2 WHERE id = $1`, [
          estornoId,
          documentId
        ]);
      }
    }

    const match = valorCents > 0 ? await sugerirMatchEstorno(personId, valorCents, new Date().toISOString()) : null;
    if (match) {
      await client.query(
        `UPDATE fin_reembolso_estorno
            SET match_sugerido_id = $2, match_confianca = $3
          WHERE id = $1`,
        [estornoId, match.transactionId, match.confianca]
      );
    }

    const criado = await estornoPorItem(fonte, itemId, personId);
    if (!criado) throw new TimeError("falha ao registrar estorno", 500);
    return criado;
  });
}

export type EstornoAdmin = EstornoReembolso & {
  pessoaNome: string;
  pessoaId: number;
  matchSugeridoDescricao: string | null;
};

export async function listarEstornosAdmin(): Promise<EstornoAdmin[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT e.*, p.name AS pessoa_nome, p.id AS pessoa_id,
            t.description AS match_descricao
       FROM fin_reembolso_estorno e
       JOIN fin_person p ON p.id = e.person_id
       LEFT JOIN fin_transaction t ON t.id = e.match_sugerido_id
      WHERE e.entity_id = (SELECT id FROM fin_entity WHERE slug = $1)
      ORDER BY
        CASE e.status WHEN 'aberto' THEN 0 WHEN 'parcial' THEN 1 ELSE 2 END,
        e.criado_em DESC`,
    [ENTITY]
  );
  return rows.map((row) => ({
    ...mapEstorno(row),
    pessoaNome: String(row.pessoa_nome),
    pessoaId: Number(row.pessoa_id),
    matchSugeridoDescricao: row.match_descricao ? String(row.match_descricao) : null
  }));
}

export async function confirmarEstornoAdmin(
  estornoId: number,
  dados: { transactionId?: number | null; ator: string }
): Promise<EstornoReembolso> {
  return transaction(async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT e.*, a.slug AS conta_slug
         FROM fin_reembolso_estorno e
         LEFT JOIN fin_account a ON a.id = e.conta_sugerida_id
        WHERE e.id = $1 FOR UPDATE`,
      [estornoId]
    );
    const atual = rows[0];
    if (!atual) throw new TimeError("estorno não encontrado", 404);
    if (atual.status === "quitado") throw new TimeError("estorno já quitado", 409);

    const txId = dados.transactionId ?? (atual.match_sugerido_id as number | null);
    await client.query(
      `UPDATE fin_reembolso_estorno
          SET status = 'quitado',
              transaction_id = $2,
              quitado_em = now(),
              quitado_por = $3
        WHERE id = $1`,
      [estornoId, txId, dados.ator]
    );

    if (atual.document_id) {
      await client.query(
        `UPDATE fin_document SET status = 'confirmado' WHERE id = $1 AND status NOT IN ('cancelado', 'estornado')`,
        [atual.document_id]
      );
    }

    const { rows: finais } = await client.query<Record<string, unknown>>(
      `SELECT e.*, a.slug AS conta_slug FROM fin_reembolso_estorno e
        LEFT JOIN fin_account a ON a.id = e.conta_sugerida_id WHERE e.id = $1`,
      [estornoId]
    );
    return mapEstorno(finais[0]);
  });
}

export async function atualizarMatchesEstornosAbertos(): Promise<number> {
  const abertos = await query<{ id: number; person_id: number; valor_cents: number; criado_em: string }>(
    `SELECT id, person_id, valor_cents, criado_em::text
       FROM fin_reembolso_estorno
      WHERE status IN ('aberto', 'parcial') AND valor_cents > 0`
  );
  let n = 0;
  for (const e of abertos) {
    const match = await sugerirMatchEstorno(e.person_id, e.valor_cents, e.criado_em);
    if (match) {
      await query(
        `UPDATE fin_reembolso_estorno
            SET match_sugerido_id = $2, match_confianca = $3
          WHERE id = $1 AND status IN ('aberto', 'parcial')`,
        [e.id, match.transactionId, match.confianca]
      );
      n++;
    }
  }
  return n;
}
