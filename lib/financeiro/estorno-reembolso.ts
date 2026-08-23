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
/*
 * Dois estados foram removidos daqui porque NINGUÉM os gravava.
 *
 * `parcial` aparecia em ORDER BY e em filtros e nunca casava — devolução
 * parcial não existe no fluxo: ou a pessoa devolve o valor do item, ou não
 * devolve. Quando existir, é uma funcionalidade com desenho próprio.
 *
 * `cancelado_admin` era pior que morto: a checagem de duplicidade deixava
 * passar quem estivesse nesse estado, e o INSERT seguinte batia na UNIQUE
 * (item_fonte, item_id). Um ramo inalcançável que, se fosse alcançado,
 * quebraria. Desfazer um estorno é outra funcionalidade, e ela precisa
 * remover ou suceder a linha, não inventar um estado que o INSERT recusa.
 */
export type StatusEstorno = "aberto" | "quitado";

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

/**
 * O CNPJ e a razão social, e só isso.
 *
 * Não resolve mais a conta do Inter aqui: `fin_account` está na lista de
 * tabelas que a superfície do time não alcança, e este módulo é chamado de
 * `/api/time/*`. A conta que recebe o PIX é sempre a mesma e o lado do admin
 * resolve por `slug` na hora de listar — guardar o id no momento do
 * cancelamento não acrescentava nada e custava furar a regra.
 */
async function dadosPixEmpresa(): Promise<{ cnpj: string; nome: string }> {
  const [ent] = await query<{ cnpj: string; legal_name: string }>(
    `SELECT cnpj, legal_name FROM fin_entity WHERE slug = $1`,
    [ENTITY]
  );
  if (!ent?.cnpj) throw new TimeError("CNPJ da empresa não configurado", 503);
  return { cnpj: ent.cnpj.replace(/\D/g, ""), nome: ent.legal_name };
}

/**
 * @param executor quem roda a consulta. Passar o `client` da transação é
 *   OBRIGATÓRIO quando se quer ler algo gravado por ela e ainda não commitado:
 *   `query()` é `pool.query`, pega OUTRA conexão, e em READ COMMITTED não
 *   enxerga o INSERT pendente. Foi assim que o cancelamento inteiro morreu —
 *   a releitura final voltava `null`, o `throw` disparava, e o ROLLBACK apagava
 *   o estorno, o documento e o status do item. Nenhum cancelamento chegou a
 *   commitar: `fin_reembolso_estorno` ficou com zero linhas desde que subiu.
 */
async function estornoPorItem(
  fonte: "app" | "planilha",
  itemId: number,
  personId?: number,
  executor?: { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }
): Promise<EstornoReembolso | null> {
  const params: unknown[] = [fonte, itemId];
  let filtro = "";
  if (personId !== undefined) {
    filtro = " AND e.person_id = $3";
    params.push(personId);
  }
  const rodar = executor
    ? async (t: string, p: unknown[]) => (await executor.query(t, p)).rows
    : (t: string, p: unknown[]) => query<Record<string, unknown>>(t, p);
  const [row] = await rodar(
    `SELECT e.id, e.item_fonte, e.item_id, e.titulo, e.motivo_categoria, e.motivo,
            e.valor_cents, e.parcelas_pagas, e.parcelas_detalhe, e.status,
            e.pix_chave, e.pix_tipo, e.pix_nome_recebedor, e.brcode,
            e.criado_em, e.quitado_em, e.match_sugerido_id, e.match_confianca,
            -- Sem JOIN na conta bancária: tabela fora do alcance da
            -- superfície do time. Quem precisa saber a conta é o admin, e o
            -- listarEstornosAdmin resolve lá.
            NULL::text AS conta_slug
       FROM fin_reembolso_estorno e
      WHERE e.item_fonte = $1 AND e.item_id = $2${filtro}`,
    params
  );
  if (!row) return null;
  return mapEstorno(row);
}

export function mapEstorno(row: Record<string, unknown>): EstornoReembolso {
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


export async function cancelarItemReembolsoInterno(
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
  if (existente) throw new TimeError("este item já foi cancelado", 409);

  const sessaoStub = { personId, nome: "", prova: "declarada" as const, admin: false, trocarSenha: false, expiraEm: "" };
  const historico = await historicoParcelasItem(sessaoStub, fonte, itemId);

  /*
   * O VALOR VEM DO ITEM CANCELADO, NUNCA DO SLUG INTEIRO.
   *
   * `historicoParcelasItem` devolve TODAS as linhas daquele slug para aquela
   * pessoa, e marca cada uma como "pago" (situação fixa). Isso serve para
   * MOSTRAR o histórico da categoria na tela. Somar aquilo para cobrar foi o
   * erro caro: slug não é compra, é categoria — e metade delas é linha mensal
   * recorrente com parcela 1/1.
   *
   * Medido nos dados reais: Igor, slug `transporte`, 7 linhas mensais
   * independentes de jan a jul. Cancelar o transporte de JANEIRO (R$ 429,97)
   * gerava um PIX de R$ 5.409,26 — 12,6× o devido. Em `alimentacao`, R$ 45,04
   * virava R$ 1.302,19 (28,9×). E como cada mês é uma linha própria, dava para
   * repetir: cancelar janeiro e depois fevereiro criava DOIS estornos do valor
   * cheio para uma dívida só.
   *
   * A regra correta tem um discriminador só: o item faz parte de uma compra
   * PARCELADA de verdade (`parcelasTotal > 1`)? Então o que a empresa pagou por
   * aquela compra são as parcelas dela, e é isso que se devolve. Se é linha
   * avulsa (1/1), devolve-se aquela linha e nada mais.
   */
  const pagasDoSlug = historico.parcelas.filter((p) => p.situacao === "pago");
  const ehCompraParcelada = historico.parcelasTotal > 1;

  let parcelasPagas: typeof pagasDoSlug;
  if (ehCompraParcelada) {
    // Compra parcelada: as parcelas do slug SÃO as parcelas desta compra.
    parcelasPagas = pagasDoSlug;
  } else if (fonte === "planilha") {
    // Linha avulsa da planilha: só ela. `id` aqui é o `item_id` da view.
    parcelasPagas = pagasDoSlug.filter((p) => p.id === itemId);
  } else {
    // Item do app avulso: o valor é o do próprio item, e não se vai à planilha
    // buscá-lo — o casamento por primeira palavra do título é palpite, e
    // palpite não pode virar cobrança.
    parcelasPagas = [];
  }

  let valorCents = parcelasPagas.reduce((s, p) => s + p.valorCents, 0);

  if (!ehCompraParcelada && fonte === "app") {
    // A fonte de verdade do item do app é a própria linha, e só conta se a
    // empresa REALMENTE pagou: item pendente ou rejeitado não gera dívida.
    const [linha] = await query<{ amount_cents: string; status: string }>(
      `SELECT i.amount_cents, i.status
         FROM fin_reimbursement_item i
         JOIN fin_reimbursement r ON r.id = i.reimbursement_id
        WHERE i.id = $1 AND r.person_id = $2`,
      [itemId, personId]
    );
    if (!linha) throw new TimeError("item não encontrado", 404);
    valorCents = linha.status === "pago" ? Number(linha.amount_cents) : 0;
    parcelasPagas =
      valorCents > 0
        ? [{ id: itemId, mes: historico.parcelas[0]?.mes ?? "", parcela: 1, parcelasTotal: 1,
             valorCents, descricao: historico.titulo, situacao: "pago" as const }]
        : [];
  }

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
        null,
        criadoPor
      ]
    );
    const estornoId = ins.rows[0].id;

    /*
     * `fin_reembolso_slug_cancelado` NÃO é mais escrita, e o motivo é a
     * correção do valor.
     *
     * Ela existia para "a previsão de reembolso futuro ignorar estes slugs" —
     * e nunca chegou a ser lida por ninguém. Pior: com o estorno passando a
     * ser por ITEM, marcar o slug inteiro como cancelado é errado. Cancelar o
     * transporte de janeiro suprimiria o transporte de fevereiro, que é uma
     * despesa legítima e não tem nada a ver.
     *
     * O escopo certo da supressão, se um dia for implementada, é a compra
     * parcelada — e essa informação já está em `fin_installment_plan`, que o
     * cancelamento marca acima.
     */

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

    /*
     * O MATCH NÃO ACONTECE AQUI, e sair daqui conserta três coisas de uma vez.
     *
     * 1. Ele NUNCA podia achar nada: era chamado com `desde = agora`, e nenhuma
     *    transação já lançada é posterior ao instante do cancelamento. Custo
     *    puro.
     * 2. `sugerirMatchEstorno` usa `query()` — outra conexão do pool — segurada
     *    DENTRO desta transação. Com pool de 5, cinco cancelamentos ao mesmo
     *    tempo travavam o financeiro inteiro.
     * 3. Era o que arrastava `fin_transaction` para dentro da superfície do
     *    time. Conciliar extrato é trabalho do financeiro, não de quem cancela
     *    uma compra no celular — e `atualizarMatchesEstornosAbertos()` já faz
     *    isso do lado do admin, onde o dado pertence.
     */

    // `client`, não `query()`: a linha que acabou de ser inserida só existe
    // nesta conexão até o COMMIT.
    const criado = await estornoPorItem(fonte, itemId, personId, client);
    if (!criado) throw new TimeError("falha ao registrar estorno", 500);
    return criado;
  });
}
