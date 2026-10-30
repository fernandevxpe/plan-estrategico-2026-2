import "server-only";

import { pacoteDaComissao } from "./contas-a-pagar-eixos";
import { isFinanceConfigured, query } from "./db";

/**
 * PAGAMENTOS ENVIADOS — o histórico de TODA ordem de pagamento, por dia de envio.
 *
 * Somente leitura. Nada aqui envia, aprova, cancela nem dá baixa: quem envia é
 * /financeiro/aprovacoes, quem aprova é o dono no app do Inter, e quem dá baixa
 * é `scripts/conciliar-pagamentos.mjs`, de hora em hora.
 *
 * ---------------------------------------------------------------------------
 * QUAL DATA É "ENVIADO"
 * ---------------------------------------------------------------------------
 * `fin_payment_request` não tem coluna de envio — a 0075 proíbe campo cuja
 * semântica seja "mandar para o banco". Mas a data EXATA existe, em dois lugares:
 *
 *   1. `fin_audit_log`: o gatilho da 0075 grava toda mudança de status, e
 *      `pagar-programar.ts` grava uma linha explícita com `codigo_solicitacao`
 *      a cada envio. A primeira linha com `after.status = 'aguardando_autorizacao'`
 *      é o primeiro envio. Medido em 30/10/2026: bate com a linha datada de
 *      `notes` com diferença de ~0,5s em todas as ordens conferidas (31, 33, 40,
 *      90, 132) — a nota é escrita antes do UPDATE.
 *   2. `notes`: "[ISO] enviado ao Inter por …". Resgate para ordem cujo log não
 *      exista.
 *
 * `created_at` NÃO serve: as 41 ordens de set/26 nasceram em lote às 02:21 de
 * 01/09 e algumas só foram ao banco 21h depois (PG-2026-0090, 23:09).
 * `updated_at` também não: a conciliação reescreve (ordem 31, conciliada em
 * 30/10 20:49, enviada em 01/09).
 *
 * Ordem nunca enviada (rascunho) entra no dia em que foi CRIADA, marcada como
 * tal — esconder rascunho seria esconder justamente a 52/53, que o João recebeu
 * por fora e que continuam abertas.
 *
 * ---------------------------------------------------------------------------
 * COMPOSIÇÃO
 * ---------------------------------------------------------------------------
 * O modelo NÃO grava vínculo item → ordem. A ordem é uma soma por chave
 * (`AAAA-MM|fin_person:N:natureza`), e a composição é reconstruída:
 *
 *   - comissão: linhas de `fin_pessoa_comissao_declarada` da mesma pessoa e
 *     competência que JÁ EXISTIAM quando a ordem nasceu — a mesma regra de
 *     trava de `lib/financeiro/comissoes.ts` (`ordemEnviadaNoMes`). Quando a
 *     chave tem pacote (`…:comissao:consultoria`), só entram as linhas cujo
 *     `tipo_slug` cai nesse pacote por `pacoteDaComissao` — a MESMA função que
 *     contas-a-pagar usa para montar a chave. Sem esse filtro a PG-2026-0132
 *     listava 10 linhas de todos os pacotes contra uma ordem de um só. Ainda é
 *     aproximação (linha editada depois do envio muda a soma); a tela mostra as
 *     duas somas lado a lado.
 *   - reembolso: NÃO reconstruído. Testado em 30/10 com as 22 ordens de
 *     reembolso: nem `fin_reembolso_item` (competência anterior, criado antes
 *     da ordem — 0 de 22 batem) nem `fin_reimbursement_item` (4 de 22 batem)
 *     reproduzem o valor. Mostrar uma lista que não fecha seria pior que dizer
 *     que ela não existe.
 */

export type TipoPagamento =
  | "salario"
  | "prolabore"
  | "reembolso"
  | "comissao"
  | "fornecedor"
  | "cartao"
  | "outro";

export const ROTULO_TIPO_PAGAMENTO: Record<TipoPagamento, string> = {
  salario: "Salário",
  prolabore: "Pró-labore",
  reembolso: "Reembolso",
  comissao: "Comissão",
  fornecedor: "Fornecedor",
  cartao: "Fatura de cartão",
  outro: "Outro"
};

/** Estado legível — o `status` cru tem 10 valores e só 5 interessam aqui. */
export type EstadoPagamento =
  | "rascunho"
  | "aguardando_banco"
  | "pago"
  | "pago_parcial"
  | "cancelado"
  | "outro";

export const ROTULO_ESTADO: Record<EstadoPagamento, string> = {
  rascunho: "Rascunho (não enviado)",
  aguardando_banco: "No banco, aguardando aprovação",
  pago: "Pago",
  pago_parcial: "Pago parcial",
  cancelado: "Cancelado / rejeitado",
  outro: "Em andamento"
};

/**
 * Ordem aberta há mais que isto provavelmente já foi paga (por fora, ou a
 * conciliação não casou). 20 dias, e não os 2 de `aprovacoes.ts`: lá a pergunta
 * é "o dono esqueceu de aprovar?"; aqui é "isto ainda é dívida de verdade?". A
 * folha sai até o dia 3 — 20 dias depois, quem não recebeu já reclamou.
 */
export const DIAS_ABERTA_SUSPEITA = 20;

export type EventoLinha = { em: string; rotulo: string };

export type ExecucaoPagamento = {
  pagoEm: string;
  valorCents: number;
  conciliadoEm: string | null;
  conciliadoPor: string | null;
  confianca: number | null;
  transacao: {
    id: number;
    data: string;
    valorCents: number;
    descricao: string;
    conta: string | null;
  } | null;
};

export type ItemComposicao = {
  id: number;
  descricao: string;
  valorCents: number;
  criadoEm: string;
  tipoSlug: string | null;
};

export type OrdemHistorico = {
  id: number;
  code: string;
  /** YYYY-MM-DD, America/Sao_Paulo. Dia de envio, ou de criação se rascunho. */
  dia: string;
  /** true quando `dia` é o do envio de verdade (log ou nota). */
  enviada: boolean;
  enviadaEm: string | null;
  criadaEm: string;
  personId: number | null;
  favorecido: string;
  tipo: TipoPagamento;
  pacote: string | null;
  competencia: string | null;
  vencimento: string;
  valorCents: number;
  pagoCents: number;
  status: string;
  estado: EstadoPagamento;
  tentativas: number;
  codigosSolicitacao: string[];
  diasAberta: number | null;
  suspeitaPagaPorFora: boolean;
  descricao: string;
  execucoes: ExecucaoPagamento[];
  /** Soma das execuções − valor da ordem; ≠ 0 é divergência. */
  divergenciaCents: number | null;
  linhaDoTempo: EventoLinha[];
  composicao: ItemComposicao[] | null;
  composicaoNota: string | null;
};

export type ResumoPagamentos = {
  enviadoHoje: { n: number; cents: number };
  aguardandoBanco: { n: number; cents: number };
  pagoNoMes: { n: number; cents: number };
  abertasSuspeitas: { n: number; cents: number; codes: string[] };
  porEstado: Record<EstadoPagamento, { n: number; cents: number }>;
};

export type HistoricoPagamentos = {
  disponivel: boolean;
  hoje: string;
  ordens: OrdemHistorico[];
  resumo: ResumoPagamentos;
  pessoas: { id: number | null; nome: string }[];
};

export type FiltroPagamentos = {
  de?: string | null;
  ate?: string | null;
  pessoa?: string | null;
  tipo?: string | null;
  estado?: string | null;
  busca?: string | null;
};

const ENTITY = "xpe";

export function estadoDe(status: string): EstadoPagamento {
  if (status === "rascunho") return "rascunho";
  if (status === "aguardando_autorizacao") return "aguardando_banco";
  if (status === "pago") return "pago";
  if (status === "pago_parcial") return "pago_parcial";
  if (status === "cancelada" || status === "rejeitada" || status === "devolvida") return "cancelado";
  return "outro";
}

/** `2026-10|fin_person:2:comissao:consultoria` → partes. */
export function lerChave(sourceId: string | null): {
  competencia: string | null;
  personId: number | null;
  natureza: string | null;
  pacote: string | null;
} {
  const m = /^(\d{4}-\d{2})\|fin_person:(\d+):([a-z_]+)(?::([a-z0-9_]+))?$/.exec(sourceId ?? "");
  if (!m) return { competencia: null, personId: null, natureza: null, pacote: null };
  return { competencia: m[1], personId: Number(m[2]), natureza: m[3], pacote: m[4] ?? null };
}

function tipoDe(natureza: string | null, source: string): TipoPagamento {
  if (natureza === "salario" || natureza === "prolabore" || natureza === "reembolso" || natureza === "comissao") {
    return natureza;
  }
  if (source === "reembolso") return "reembolso";
  if (source === "fatura_cartao") return "cartao";
  if (source === "documento" || source === "compra" || source === "recorrente") return "fornecedor";
  return natureza ? "outro" : "fornecedor";
}

const vazio = () => ({ n: 0, cents: 0 });

function resumoVazio(): ResumoPagamentos {
  return {
    enviadoHoje: vazio(),
    aguardandoBanco: vazio(),
    pagoNoMes: vazio(),
    abertasSuspeitas: { n: 0, cents: 0, codes: [] },
    porEstado: {
      rascunho: vazio(),
      aguardando_banco: vazio(),
      pago: vazio(),
      pago_parcial: vazio(),
      cancelado: vazio(),
      outro: vazio()
    }
  };
}

const SQL_ORDENS = `
  SELECT pr.id, pr.code, pr.status, pr.source, pr.source_id, pr.description,
         pr.net_cents, pr.paid_cents, pr.tags, pr.notes,
         pr.due_date::text AS vencimento,
         to_char(pr.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS criada_em,
         to_char(pr.cancelled_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS cancelada_em,
         pr.cancel_reason,
         cp.name AS contraparte,
         pe.name AS pessoa,
         envios.primeiro AS enviada_log,
         envios.todos   AS envios_log,
         (SELECT count(*)::int FROM unnest(pr.tags) t WHERE t LIKE 'inter-solicitacao:%') AS n_codigos,
         (SELECT max(nullif(replace(t, 'inter-tentativa:', ''), '')::int)
            FROM unnest(pr.tags) t WHERE t ~ '^inter-tentativa:[0-9]+$') AS tentativa_tag,
         ARRAY(SELECT replace(t, 'inter-solicitacao:', '') FROM unnest(pr.tags) t
                WHERE t LIKE 'inter-solicitacao:%' ORDER BY t) AS codigos
    FROM fin_payment_request pr
    JOIN fin_entity en ON en.id = pr.entity_id AND en.slug = $1
    LEFT JOIN fin_counterparty cp ON cp.id = pr.counterparty_id
    LEFT JOIN fin_person pe
           ON pe.id = CASE WHEN pr.source_id ~ '\\|fin_person:[0-9]+:'
                           THEN (substring(pr.source_id FROM '\\|fin_person:([0-9]+):'))::bigint END
    -- Envios pelo log de auditoria: a linha explícita de pagar-programar.ts
    -- (com codigo_solicitacao) e/ou a do gatilho, ambas com o status novo.
    LEFT JOIN LATERAL (
      SELECT to_char(min(a.created_at) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS primeiro,
             array_agg(to_char(a.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS')
                       ORDER BY a.created_at)
               FILTER (WHERE a.after ? 'codigo_solicitacao') AS todos
        FROM fin_audit_log a
       WHERE a.target_table = 'fin_payment_request'
         AND a.target_id = pr.id
         AND a.after ->> 'status' = 'aguardando_autorizacao'
    ) envios ON TRUE
   ORDER BY pr.id DESC`;

const SQL_EXECUCOES = `
  SELECT e.payment_request_id, e.paid_on::text AS paid_on, e.amount_cents,
         to_char(e.reconciled_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS reconciled_at,
         e.reconciled_by, e.reconcile_confidence,
         t.id AS tx_id, t.posted_on::text AS tx_data, t.amount_cents AS tx_valor,
         t.description_raw AS tx_descricao, a.name AS tx_conta
    FROM fin_payment_execution e
    JOIN fin_payment_request pr ON pr.id = e.payment_request_id
    JOIN fin_entity en ON en.id = pr.entity_id AND en.slug = $1
    LEFT JOIN fin_transaction t ON t.id = e.transaction_id
    LEFT JOIN fin_account a ON a.id = t.account_id
   ORDER BY e.paid_on, e.id`;

/** Linhas de comissão da mesma pessoa e competência, existentes quando a ordem nasceu. */
const SQL_COMPOSICAO_COMISSAO = `
  SELECT pr.id AS ordem_id, c.id, c.tipo_slug, coalesce(nullif(c.descricao, ''), t.nome, 'comissão') AS descricao,
         c.cliente, c.valor_cents,
         to_char(c.criado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
    FROM fin_payment_request pr
    JOIN fin_entity en ON en.id = pr.entity_id AND en.slug = $1
    JOIN fin_pessoa_comissao_declarada c
      ON c.person_id = (substring(pr.source_id FROM '\\|fin_person:([0-9]+):'))::bigint
     AND to_char(c.competencia, 'YYYY-MM') = split_part(pr.source_id, '|', 1)
     AND c.criado_em <= pr.created_at
    LEFT JOIN fin_comissao_tipo t ON t.slug = c.tipo_slug
   WHERE pr.source_id ~ '\\|fin_person:[0-9]+:comissao'
   ORDER BY c.criado_em, c.id`;

function diaSP(iso: string): string {
  return iso.slice(0, 10);
}

function diasEntre(deIso: string, ateIso: string): number {
  return Math.floor((Date.parse(ateIso.slice(0, 10)) - Date.parse(deIso.slice(0, 10))) / 86_400_000);
}

function enviadaPelaNota(notes: string | null): string[] {
  if (!notes) return [];
  const out: string[] = [];
  for (const m of notes.matchAll(/\[(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)\] enviado ao Inter/g)) {
    // A nota é UTC; a tela fala America/Sao_Paulo (UTC−3, sem horário de verão desde 2019).
    const d = new Date(Date.parse(m[1]) - 3 * 3_600_000);
    out.push(d.toISOString().slice(0, 19));
  }
  return out;
}

export async function getHistoricoPagamentos(filtro: FiltroPagamentos = {}): Promise<HistoricoPagamentos> {
  const hojeSP = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
  if (!isFinanceConfigured()) {
    return { disponivel: false, hoje: hojeSP, ordens: [], resumo: resumoVazio(), pessoas: [] };
  }

  // Três consultas leves em vez de uma com tudo agregado: 86 ordens e 84
  // execuções em 30/10/2026. Não há view aninhada aqui — o JIT não entra.
  const [ordensRows, execRows, compRows] = await Promise.all([
    query<Record<string, unknown>>(SQL_ORDENS, [ENTITY]),
    query<Record<string, unknown>>(SQL_EXECUCOES, [ENTITY]),
    // Composição é enfeite: se falhar, a lista de ordens continua — mas o erro
    // vai para o log em vez de sumir calado (antes: `.catch(() => [])` mudo).
    query<Record<string, unknown>>(SQL_COMPOSICAO_COMISSAO, [ENTITY]).catch((e) => {
      console.error("[financeiro] pagamentos: composição de comissão:", e);
      return [] as Record<string, unknown>[];
    })
  ]);

  const execPorOrdem = new Map<number, ExecucaoPagamento[]>();
  for (const r of execRows) {
    const id = Number(r.payment_request_id);
    const lista = execPorOrdem.get(id) ?? [];
    lista.push({
      pagoEm: String(r.paid_on),
      valorCents: Number(r.amount_cents),
      conciliadoEm: r.reconciled_at == null ? null : String(r.reconciled_at),
      conciliadoPor: r.reconciled_by == null ? null : String(r.reconciled_by),
      confianca: r.reconcile_confidence == null ? null : Number(r.reconcile_confidence),
      transacao:
        r.tx_id == null
          ? null
          : {
              id: Number(r.tx_id),
              data: String(r.tx_data),
              valorCents: Number(r.tx_valor),
              descricao: String(r.tx_descricao ?? ""),
              conta: r.tx_conta == null ? null : String(r.tx_conta)
            }
    });
    execPorOrdem.set(id, lista);
  }

  const compPorOrdem = new Map<number, ItemComposicao[]>();
  for (const r of compRows) {
    const id = Number(r.ordem_id);
    const lista = compPorOrdem.get(id) ?? [];
    const cliente = r.cliente ? ` — ${String(r.cliente)}` : "";
    lista.push({
      id: Number(r.id),
      descricao: `${String(r.descricao)}${cliente}`,
      valorCents: Number(r.valor_cents),
      criadoEm: String(r.criado_em),
      tipoSlug: r.tipo_slug == null ? null : String(r.tipo_slug)
    });
    compPorOrdem.set(id, lista);
  }

  const todas: OrdemHistorico[] = ordensRows.map((r) => {
    const id = Number(r.id);
    const chave = lerChave(r.source_id == null ? null : String(r.source_id));
    const tipo = tipoDe(chave.natureza, String(r.source));
    const status = String(r.status);
    const estado = estadoDe(status);
    const criadaEm = String(r.criada_em);
    const enviosLog = (r.envios_log as string[] | null) ?? [];
    const enviosNota = enviadaPelaNota(r.notes == null ? null : String(r.notes));
    const enviadaEm =
      (r.enviada_log == null ? null : String(r.enviada_log)) ?? enviosNota[0] ?? null;
    const codigos = ((r.codigos as string[] | null) ?? []).filter(Boolean);
    // Tentativas: o maior dos três sinais. Cada reenvio grava uma linha de log
    // com codigo_solicitacao e acumula um código na tag (511a90e); a tag
    // `inter-tentativa:N` só existe quando a ordem foi devolvida à fila.
    const tentativas = Math.max(
      enviosLog.length,
      enviosNota.length,
      Number(r.n_codigos ?? 0),
      Number(r.tentativa_tag ?? 0),
      enviadaEm ? 1 : 0
    );
    const valorCents = Number(r.net_cents);
    const pagoCents = Number(r.paid_cents);
    const execucoes = execPorOrdem.get(id) ?? [];
    const somaExec = execucoes.reduce((s, e) => s + e.valorCents, 0);
    const divergenciaCents = execucoes.length ? somaExec - valorCents : null;
    const aberta = estado === "rascunho" || estado === "aguardando_banco" || estado === "pago_parcial" || estado === "outro";
    const desde = enviadaEm ?? criadaEm;
    const diasAberta = aberta ? diasEntre(desde, hojeSP) : null;

    const linhaDoTempo: EventoLinha[] = [{ em: criadaEm, rotulo: "Ordem criada" }];
    const enviosTodos = enviosLog.length ? enviosLog : enviosNota;
    enviosTodos.forEach((em, i) =>
      linhaDoTempo.push({ em, rotulo: i === 0 ? "Enviada ao Inter" : `Reenviada ao Inter (tentativa ${i + 1})` })
    );
    if (!enviosTodos.length && enviadaEm) linhaDoTempo.push({ em: enviadaEm, rotulo: "Enviada ao Inter" });
    for (const e of execucoes) {
      linhaDoTempo.push({ em: `${e.pagoEm}T00:00:00`, rotulo: `Saiu da conta (${(e.valorCents / 100).toFixed(2).replace(".", ",")})` });
      if (e.conciliadoEm) {
        linhaDoTempo.push({
          em: e.conciliadoEm,
          rotulo: `Baixa por ${e.conciliadoPor ?? "?"}${e.confianca != null ? ` (confiança ${e.confianca}%)` : ""}`
        });
      }
    }
    if (r.cancelada_em) {
      linhaDoTempo.push({
        em: String(r.cancelada_em),
        rotulo: `Cancelada${r.cancel_reason ? `: ${String(r.cancel_reason)}` : ""}`
      });
    }
    linhaDoTempo.sort((a, b) => a.em.localeCompare(b.em));

    let composicao: ItemComposicao[] | null = null;
    let composicaoNota: string | null = null;
    if (tipo === "comissao") {
      composicao = (compPorOrdem.get(id) ?? []).filter(
        (c) => !chave.pacote || pacoteDaComissao(c.tipoSlug) === chave.pacote
      );
      const soma = composicao.reduce((s, c) => s + c.valorCents, 0);
      composicaoNota =
        soma === valorCents
          ? "Linhas de comissão da competência que existiam quando a ordem nasceu — fecham com a ordem."
          : "Linhas de comissão da competência (e do pacote da ordem) que existiam quando ela nasceu. Não fecham: " +
            "o vínculo linha → ordem não é gravado, e linha editada/excluída depois do envio muda a soma.";
    } else if (tipo === "reembolso") {
      composicaoNota =
        "O modelo não grava quais itens de reembolso esta ordem pagou — e nenhuma reconstrução fecha o valor. " +
        "Os itens estão em /financeiro/reembolsos, na competência anterior ao mês da ordem.";
    }

    const favorecido = r.pessoa ? String(r.pessoa) : String(r.contraparte ?? "—");
    return {
      id,
      code: String(r.code),
      dia: diaSP(enviadaEm ?? criadaEm),
      enviada: enviadaEm != null,
      enviadaEm,
      criadaEm,
      personId: chave.personId,
      favorecido,
      tipo,
      pacote: chave.pacote,
      competencia: chave.competencia,
      vencimento: String(r.vencimento),
      valorCents,
      pagoCents,
      status,
      estado,
      tentativas,
      codigosSolicitacao: codigos,
      diasAberta,
      suspeitaPagaPorFora: diasAberta != null && diasAberta > DIAS_ABERTA_SUSPEITA,
      descricao: String(r.description ?? ""),
      execucoes,
      divergenciaCents,
      linhaDoTempo,
      composicao,
      composicaoNota
    };
  });

  // Resumo sobre TODAS as ordens, não sobre o filtro: "enviado hoje" que muda
  // quando se filtra por pessoa deixaria de responder "o que eu mandei hoje?".
  const resumo = resumoVazio();
  const mesHoje = hojeSP.slice(0, 7);
  for (const o of todas) {
    resumo.porEstado[o.estado].n += 1;
    resumo.porEstado[o.estado].cents += o.valorCents;
    if (o.enviada && o.dia === hojeSP) {
      resumo.enviadoHoje.n += 1;
      resumo.enviadoHoje.cents += o.valorCents;
    }
    if (o.estado === "aguardando_banco") {
      resumo.aguardandoBanco.n += 1;
      resumo.aguardandoBanco.cents += o.valorCents;
    }
    const pagoNoMes = o.execucoes.filter((e) => e.pagoEm.slice(0, 7) === mesHoje);
    if (pagoNoMes.length) {
      resumo.pagoNoMes.n += 1;
      resumo.pagoNoMes.cents += pagoNoMes.reduce((s, e) => s + e.valorCents, 0);
    }
    if (o.suspeitaPagaPorFora) {
      resumo.abertasSuspeitas.n += 1;
      resumo.abertasSuspeitas.cents += o.valorCents;
      resumo.abertasSuspeitas.codes.push(o.code);
    }
  }

  const pessoasMap = new Map<string, { id: number | null; nome: string }>();
  for (const o of todas) pessoasMap.set(o.favorecido, { id: o.personId, nome: o.favorecido });
  const pessoas = [...pessoasMap.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return { disponivel: true, hoje: hojeSP, ordens: filtrar(todas, filtro), resumo, pessoas };
}

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function filtrar(ordens: OrdemHistorico[], f: FiltroPagamentos): OrdemHistorico[] {
  const busca = f.busca ? semAcento(f.busca.trim()) : "";
  return ordens
    .filter((o) => !f.de || o.dia >= f.de)
    .filter((o) => !f.ate || o.dia <= f.ate)
    .filter((o) => !f.pessoa || o.favorecido === f.pessoa || String(o.personId) === f.pessoa)
    .filter((o) => !f.tipo || o.tipo === f.tipo)
    .filter((o) => !f.estado || o.estado === f.estado)
    .filter(
      (o) =>
        !busca ||
        semAcento(`${o.code} ${o.favorecido} ${o.descricao} ${o.codigosSolicitacao.join(" ")}`).includes(busca)
    )
    .sort((a, b) => (b.enviadaEm ?? b.criadaEm).localeCompare(a.enviadaEm ?? a.criadaEm) || b.id - a.id);
}
