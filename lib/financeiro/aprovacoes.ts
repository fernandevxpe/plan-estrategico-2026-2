import "server-only";

import { mascararChave } from "./contas-a-pagar-eixos";
import { isFinanceConfigured, query } from "./db";
import type { SaldoConta, SaldoInter, TipoOrdem } from "./aprovacoes-caixa";
import { consultarSaldoAsaas } from "./asaas-saldo";
import { saldoInterDoLedger, saldosAsaasNubankDoLedger } from "./inter-saldo";

export type { SaldoConta, SaldoInter, TipoOrdem } from "./aprovacoes-caixa";
export { ROTULO_TIPO } from "./aprovacoes-caixa";

/**
 * APROVAÇÕES — o que foi entregue ao Inter e ainda espera um dedo humano.
 *
 * Esta tela é a contraparte de leitura de `pagar-programar.ts`. Aquele módulo
 * escreve a ordem e a entrega ao banco; este só olha. Nenhuma função daqui
 * escreve em `fin_payment_request`, e NENHUMA toca `fin_payment_execution` —
 * `paid_cents` é mantido por gatilho a partir dela (0075:220-222), e uma
 * escrita nossa transformaria "mandei para o banco" em "saiu do caixa".
 *
 * A garantia central do produto, que a 0075 escreve no próprio schema:
 * `aguardando_autorizacao` é onde o produto termina o seu trabalho. Nenhuma
 * transição a partir dele é automática. Uma ordem que fica parada aí fica
 * parada para sempre até alguém abrir o aplicativo do banco — e é por isso que
 * esta tela existe: ordem esquecida no app é dinheiro que não saiu e ninguém
 * percebeu.
 */

const ENTIDADE = "xpe";

/**
 * Os quatro estados do CICLO, que não são os dez `status` da 0075.
 *
 * O `status` responde "onde a linha está na máquina"; o dono pergunta outra
 * coisa — "isso já foi para o banco? já saiu?". São perguntas de granularidade
 * diferente, e a tela responde a segunda.
 */
export type EstadoCiclo = "nao_enviada" | "aguardando" | "paga" | "encerrada";

/**
 * `em_aprovacao`, `aprovada` e `em_lote` caem em `nao_enviada` junto com
 * `rascunho`, e isso é decisão, não descuido.
 *
 * O enunciado da tela previa quatro blocos para sete status, e os outros três
 * ficariam de fora — some da tela justamente a ordem que está no meio do
 * caminho. Pior: `enviarOrdemAoInter` (pagar-programar.ts:462) aceita
 * `rascunho` E `aprovada` com o mesmo tratamento, ou seja, do ponto de vista
 * do banco as duas são exatamente a mesma coisa — ainda não foram.
 *
 * O `??` no fim fecha o buraco para sempre: se a 0075 ganhar um décimo-primeiro
 * status, a linha aparece em "ainda não foi ao banco" com o nome cru do status
 * no selo, em vez de desaparecer. Sumir em silêncio é o único desfecho que esta
 * tela não pode ter.
 */
const ESTADO_POR_STATUS: Record<string, EstadoCiclo> = {
  rascunho: "nao_enviada",
  em_aprovacao: "nao_enviada",
  aprovada: "nao_enviada",
  em_lote: "nao_enviada",
  aguardando_autorizacao: "aguardando",
  pago: "paga",
  pago_parcial: "paga",
  rejeitada: "encerrada",
  cancelada: "encerrada",
  devolvida: "encerrada"
};

export function estadoDe(status: string): EstadoCiclo {
  return ESTADO_POR_STATUS[status] ?? "nao_enviada";
}

/**
 * Depois de dois dias em `aguardando_autorizacao` sem execução, a linha fica
 * âmbar.
 *
 * A contagem é em dias de CALENDÁRIO, e isso tem um efeito conhecido: uma ordem
 * enviada na sexta fica âmbar no domingo, sem que nenhum dia útil tenha
 * passado. Fica assim de propósito. O falso alarme custa uma olhada; o alarme
 * que não veio custa um pagamento que o fornecedor não recebeu e que ninguém
 * procurou, porque a plataforma dizia "enviado" e o dono leu "resolvido".
 */
export const DIAS_PARA_ALERTA = 2;

/** O que o Inter devolveu quando a ordem foi criada, e onde ele mora. */
const MARCADOR_SOLICITACAO = "inter-solicitacao:";
/** A linha que `pagar-programar.ts:522` escreve em `notes`. */
const NOTA_SOLICITACAO = /codigoSolicitacao=([^,\n]+)/g;

/**
 * O `codigoSolicitacao` NÃO tem coluna, e não é esquecimento: a 0075:20-24
 * proíbe qualquer campo cuja semântica seja "mandar para o banco", e
 * `pagar-programar.ts:36-60` explica por que a proibição foi respeitada em vez
 * de contornada. Ele vive em dois lugares que uma pessoa também poderia ter
 * preenchido à mão — a tag `inter-solicitacao:<código>` e uma linha datada em
 * `notes`.
 *
 * A tag vem primeiro porque é estruturada; `notes` é o resgate para ordem
 * enviada antes de a tag existir, ou cuja tag alguém tenha limpado. Do `notes`
 * vale a ÚLTIMA ocorrência: reenvio acrescenta linha, não substitui.
 *
 * Este identificador é o que fecha o ciclo depois: o extrato do Inter traz o
 * mesmo campo em `detalhes.codigoSolicitacao` — 540 das 699 transações do
 * extrato local o têm —, então a ordem enviada pode ser reencontrada no
 * extrato. A conciliação em si NÃO mora aqui (ela escreve em
 * `fin_payment_execution`); esta tela só mostra o código para que a pessoa
 * consiga procurar no aplicativo do banco.
 */
function codigoSolicitacaoDe(tags: string[] | null, notes: string | null): string | null {
  for (const tag of tags ?? []) {
    if (!tag.startsWith(MARCADOR_SOLICITACAO)) continue;
    const valor = tag.slice(MARCADOR_SOLICITACAO.length).trim();
    if (valor) return valor;
  }
  if (!notes) return null;
  let achado: string | null = null;
  NOTA_SOLICITACAO.lastIndex = 0;
  for (const m of notes.matchAll(NOTA_SOLICITACAO)) {
    const valor = m[1]?.trim();
    // O envio grava "(não informado)" quando a resposta do Inter veio sem o
    // código. Isso é ausência escrita, não código — devolvê-la como se fosse
    // um identificador mandaria alguém procurar no banco por uma string que
    // nunca existiu lá.
    if (valor && valor !== "(não informado)") achado = valor;
  }
  return achado;
}

export type ExecucaoRegistrada = {
  /** YYYY-MM-DD. O gatilho da 0075 recusa data futura: isto já aconteceu. */
  paidOn: string;
  valorCents: number;
  endToEndId: string | null;
  /** A linha do extrato que provou a saída. Null = registrada, não conciliada. */
  transactionId: number | null;
  conciliadaEm: string | null;
};

export type OrdemAprovacao = {
  id: number;
  code: string;
  /** O `status` cru da 0075, para o selo dizer a verdade exata. */
  status: string;
  estado: EstadoCiclo;
  favorecido: string;
  /** Já mascarada. A chave inteira não sai do servidor. */
  chaveMascarada: string | null;
  /** De onde saiu a chave: a foto congelada na ordem, ou o cadastro de hoje. */
  chaveDoSnapshot: boolean;
  descricao: string;
  /**
   * Quem registrou a seleção, e quando.
   *
   * Existe porque a ordem pode nascer numa máquina e ser enviada de outra: em
   * produção a escrita bancária é bloqueada por construção, então quem
   * seleciona lá deixa a ordem em `rascunho` e quem tem a credencial envia
   * depois. Numa tela onde uma pessoa despacha o que outra escolheu, "quem
   * pediu isto" é o que separa conferir de despachar no automático.
   */
  pedidoPor: string | null;
  pedidoEm: string | null;
  /** `net_cents`: o que sai da conta, já com juros, multa e desconto. */
  valorCents: number;
  pagoCents: number;
  dueDate: string | null;
  scheduledFor: string | null;
  /** YYYY-MM-DD em que a ordem entrou no estado atual. */
  desde: string | null;
  diasNoEstado: number | null;
  codigoSolicitacao: string | null;
  execucao: ExecucaoRegistrada | null;
  execucoes: number;
  /** Aguardando há mais de `DIAS_PARA_ALERTA` dias e sem execução registrada. */
  esquecida: boolean;
  /**
   * De onde a ordem nasceu. O filtro da tela lê isto, não o `source` cru:
   * `manual` e `importacao` sem ponteiro caem no mesmo saco, e o ponteiro
   * (reembolso, documento, recorrente) vence o source quando os dois existem.
   */
  tipo: TipoOrdem;
};

export type Aprovacoes = {
  disponivel: boolean;
  /** Por que a tela pode estar vazia sem ser erro. */
  ressalva: string | null;
  hoje: string;
  ordens: OrdemAprovacao[];
  /** Saldo da conta `inter` no ledger — a tela troca pelo ao vivo depois. */
  saldoInter: SaldoInter | null;
  saldoAsaas: SaldoConta | null;
  saldoNubank: SaldoConta | null;
};

function vazio(ressalva: string | null): Aprovacoes {
  return {
    disponivel: false,
    ressalva,
    hoje: "",
    ordens: [],
    saldoInter: null,
    saldoAsaas: null,
    saldoNubank: null
  };
}

function tipoDe(r: {
  source: string | null;
  eh_compra: boolean;
  eh_documento: boolean;
  eh_recorrente: boolean;
  eh_reembolso: boolean;
  eh_fatura: boolean;
}): TipoOrdem {
  // O ponteiro vence o `source`: uma ordem `source=manual` com
  // `reimbursement_id` É reembolso. O source descreve quem digitou; o
  // ponteiro descreve o que é.
  if (r.eh_reembolso) return "reembolso";
  if (r.eh_recorrente) return "recorrente";
  if (r.eh_documento) return "documento";
  if (r.eh_fatura) return "fatura";
  if (r.eh_compra) return "compra";
  if (r.source === "app_time") return "time";
  if (r.source === "importacao") return "importacao";
  return "manual";
}

type LinhaBanco = {
  id: string;
  code: string;
  status: string;
  description: string;
  requested_by: string | null;
  requested_at: string | null;
  net_cents: string;
  paid_cents: string;
  due_date: string | null;
  scheduled_for: string | null;
  notes: string | null;
  tags: string[] | null;
  favorecido: string;
  chave: string | null;
  chave_tipo: string | null;
  chave_do_snapshot: boolean;
  desde: string | null;
  dias_no_estado: number | null;
  exec_paid_on: string | null;
  exec_cents: string | null;
  exec_e2e: string | null;
  exec_transaction_id: string | null;
  exec_conciliada_em: string | null;
  execucoes: number | null;
  source: string | null;
  eh_compra: boolean;
  eh_documento: boolean;
  eh_recorrente: boolean;
  eh_reembolso: boolean;
  eh_fatura: boolean;
};

/**
 * A ordem dentro de cada bloco responde à pergunta do bloco.
 *
 * Em `aguardando` é a mais VELHA no topo: o bloco existe para achar a ordem
 * esquecida, e ela é, por definição, a que está esperando há mais tempo. Nos
 * blocos terminais é o mais recente no topo, porque ali a pergunta é "o que
 * aconteceu agora".
 */
function comparar(a: OrdemAprovacao, b: OrdemAprovacao): number {
  if (a.estado !== b.estado) return 0;
  if (a.estado === "aguardando") {
    return (b.diasNoEstado ?? 0) - (a.diasNoEstado ?? 0) || a.code.localeCompare(b.code);
  }
  if (a.estado === "nao_enviada") {
    const chaveA = a.scheduledFor ?? a.dueDate ?? "9999-12-31";
    const chaveB = b.scheduledFor ?? b.dueDate ?? "9999-12-31";
    return chaveA.localeCompare(chaveB) || a.code.localeCompare(b.code);
  }
  const chaveA = a.execucao?.paidOn ?? a.desde ?? "";
  const chaveB = b.execucao?.paidOn ?? b.desde ?? "";
  return chaveB.localeCompare(chaveA) || b.code.localeCompare(a.code);
}

const ORDEM_DOS_BLOCOS: EstadoCiclo[] = ["nao_enviada", "aguardando", "paga", "encerrada"];

export async function getAprovacoes(): Promise<Aprovacoes> {
  if (!isFinanceConfigured()) return vazio("sem conexão com o banco do financeiro");

  try {
    const existe = (
      await query<{ tem: boolean }>(`SELECT to_regclass('fin_payment_request') IS NOT NULL AS tem`)
    )[0]?.tem;
    if (!existe) return vazio("a fila de pagamento (0075) não existe neste banco");

    const [hojeRows, linhas, saldoInter, saldoAsaas, outros] = await Promise.all([
      query<{ hoje: string }>(
        `SELECT to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS hoje`
      ),
      /*
       * Sem recorte de data, de propósito. A fila nasceu com a 0075 e não tem
       * histórico para esconder; um `LIMIT` cego cortaria pelo meio sem dizer
       * a ninguém, e "a ordem sumiu da tela" é o defeito que esta tela existe
       * para não ter. Se um dia isto passar de alguns milhares de linhas, o
       * corte certo é por data NOS BLOCOS TERMINAIS, com o rótulo do recorte
       * escrito na tela.
       */
      query<LinhaBanco>(
        `SELECT p.id::text                       AS id,
                p.code,
                p.status,
                p.description,
                p.net_cents::text                AS net_cents,
                p.paid_cents::text               AS paid_cents,
                to_char(p.due_date, 'YYYY-MM-DD')      AS due_date,
                to_char(p.scheduled_for, 'YYYY-MM-DD') AS scheduled_for,
                p.requested_by,
                to_char(p.requested_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS requested_at,
                p.notes,
                p.tags,
                c.name                           AS favorecido,
                -- A foto vem antes do cadastro: é para onde ESTA ordem manda.
                -- Ler a conta de hoje mostraria a coordenada nova para uma
                -- ordem que saiu com a antiga — a 0075:196-199 chama isso de
                -- reescrever retroativamente para onde o dinheiro foi.
                coalesce(p.payee_snapshot ->> 'pix_address_key', pa.pix_address_key)           AS chave,
                coalesce(p.payee_snapshot ->> 'pix_address_key_type', pa.pix_address_key_type) AS chave_tipo,
                (p.payee_snapshot ->> 'pix_address_key') IS NOT NULL                           AS chave_do_snapshot,
                to_char(coalesce(mudou.created_at, p.updated_at) AT TIME ZONE 'America/Sao_Paulo',
                        'YYYY-MM-DD')            AS desde,
                ((now() AT TIME ZONE 'America/Sao_Paulo')::date
                 - (coalesce(mudou.created_at, p.updated_at) AT TIME ZONE 'America/Sao_Paulo')::date
                )::int                           AS dias_no_estado,
                to_char(ex.paid_on, 'YYYY-MM-DD')     AS exec_paid_on,
                ex.amount_cents::text                 AS exec_cents,
                ex.end_to_end_id                      AS exec_e2e,
                ex.transaction_id::text               AS exec_transaction_id,
                to_char(ex.reconciled_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')
                                                      AS exec_conciliada_em,
                coalesce(ex.n, 0)::int                AS execucoes,
                p.source,
                (p.purchase_request_id IS NOT NULL) AS eh_compra,
                (p.document_id IS NOT NULL)         AS eh_documento,
                (p.recurring_id IS NOT NULL)        AS eh_recorrente,
                (p.reimbursement_id IS NOT NULL)    AS eh_reembolso,
                (p.card_bill_id IS NOT NULL)        AS eh_fatura
           FROM fin_payment_request p
           JOIN fin_entity e       ON e.id = p.entity_id AND e.slug = $1
           JOIN fin_counterparty c ON c.id = p.counterparty_id
           LEFT JOIN fin_payee_account pa ON pa.id = p.payee_account_id
           -- "Há quantos dias está NESTE estado" não é updated_at: qualquer
           -- edição de nota mexe em updated_at e zeraria o relógio de uma
           -- ordem que continua parada no aplicativo do banco. A entrada no
           -- estado está na trilha (fin_audit_log), e o índice
           -- fin_audit_target_idx (target_table, target_id, created_at DESC)
           -- serve exatamente este LATERAL. A mais RECENTE, e não a primeira:
           -- se a ordem entrou, saiu e voltou, o relógio conta da volta.
           LEFT JOIN LATERAL (
             SELECT a.created_at
               FROM fin_audit_log a
              WHERE a.target_table = 'fin_payment_request'
                AND a.target_id = p.id
                AND a.undone_at IS NULL
                AND a.after ->> 'status' = p.status
              ORDER BY a.created_at DESC
              LIMIT 1
           ) mudou ON TRUE
           -- count(*) OVER () é avaliado antes do LIMIT: sai a última execução
           -- E quantas existem, sem uma segunda varredura.
           LEFT JOIN LATERAL (
             SELECT x.paid_on, x.amount_cents, x.end_to_end_id, x.transaction_id,
                    x.reconciled_at, count(*) OVER () AS n
               FROM fin_payment_execution x
              WHERE x.payment_request_id = p.id
              ORDER BY x.paid_on DESC, x.id DESC
              LIMIT 1
           ) ex ON TRUE`,
        [ENTIDADE]
      ),
      saldoInterDoLedger(),
      consultarSaldoAsaas(),
      saldosAsaasNubankDoLedger()
    ]);

    const ordens: OrdemAprovacao[] = linhas.map((r) => {
      const estado = estadoDe(r.status);
      const dias = r.dias_no_estado == null ? null : Number(r.dias_no_estado);
      const execucao: ExecucaoRegistrada | null = r.exec_paid_on
        ? {
            paidOn: r.exec_paid_on,
            valorCents: Number(r.exec_cents ?? 0),
            endToEndId: r.exec_e2e,
            transactionId: r.exec_transaction_id == null ? null : Number(r.exec_transaction_id),
            conciliadaEm: r.exec_conciliada_em
          }
        : null;
      return {
        id: Number(r.id),
        code: r.code,
        status: r.status,
        estado,
        favorecido: r.favorecido,
        chaveMascarada: mascararChave(r.chave, r.chave_tipo),
        chaveDoSnapshot: Boolean(r.chave_do_snapshot),
        descricao: r.description,
        pedidoPor: r.requested_by == null ? null : String(r.requested_by),
        pedidoEm: r.requested_at == null ? null : String(r.requested_at),
        valorCents: Number(r.net_cents),
        pagoCents: Number(r.paid_cents),
        dueDate: r.due_date,
        scheduledFor: r.scheduled_for,
        desde: r.desde,
        diasNoEstado: dias,
        codigoSolicitacao: codigoSolicitacaoDe(r.tags, r.notes),
        execucao,
        execucoes: Number(r.execucoes ?? 0),
        esquecida: estado === "aguardando" && execucao === null && (dias ?? 0) >= DIAS_PARA_ALERTA,
        tipo: tipoDe(r)
      };
    });

    ordens.sort(
      (a, b) =>
        ORDEM_DOS_BLOCOS.indexOf(a.estado) - ORDEM_DOS_BLOCOS.indexOf(b.estado) || comparar(a, b)
    );

    return {
      disponivel: true,
      ressalva: ordens.length === 0 ? "nenhuma ordem de pagamento na fila" : null,
      hoje: hojeRows[0]?.hoje ?? "",
      ordens,
      saldoInter: saldoInter.disponivelCents === null ? null : saldoInter,
      saldoAsaas: saldoAsaas.disponivelCents === null ? null : saldoAsaas,
      saldoNubank: outros.nubank.disponivelCents === null ? null : outros.nubank
    };
  } catch (error) {
    console.error("[financeiro] aprovações indisponível:", error);
    return vazio("sem conexão com o banco do financeiro");
  }
}
