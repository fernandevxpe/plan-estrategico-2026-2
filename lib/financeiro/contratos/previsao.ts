import "server-only";

import { isFinanceConfigured, query } from "../db";
import { contrato, contratoIndisponivel, ENTIDADE, type Contrato, type Drill } from "./base";

/**
 * Previsão de caixa.
 *
 * O contrato desta tela é dominado por uma regra que já custou caro neste
 * projeto: **camadas não se somam**. A mesma despesa pode ser projetada como
 * recorrente detectada, como fatura de cartão E como conta a pagar. Somar as
 * três triplica.
 *
 * `fin_previsao_evento_v` resolve isso carregando `entra_no_saldo` por evento —
 * só o que está marcado como somável entra no saldo previsto. Este contrato
 * expõe as duas coisas separadas:
 *
 *   `saldoPrevistoCents`       o que entra no saldo (camadas somáveis)
 *   `naoSomadoCents`           o que existe mas ficaria em dobro se somado
 *
 * A tela deve mostrar as duas. Esconder a segunda faz o futuro parecer melhor
 * do que é; somá-la faz parecer pior. As duas juntas são a verdade.
 */

const DOMINIO = "previsao";

export type DiaPrevisto = {
  dia: string;
  diasAFrente: number;
  entradaCents: number;
  saidaCents: number;
  liquidoCents: number;
  saldoPrevistoCents: number;
  /** Cenário pessimista: inclui o vencido que ainda pode entrar. */
  saldoComVencidoCents: number;
  estimadoNoDiaCents: number;
  naoSomadoCents: number;
  eventos: number;
  /** Verdadeiro no primeiro dia em que o saldo previsto fica negativo. */
  rupturaDeCaixa: boolean;
};

export type CamadaPrevisao = {
  camada: string;
  confianca: string;
  entraNoSaldo: boolean;
  sentido: "entrada" | "saida";
  eventos: number;
  totalCents: number;
  /** Quando não entra no saldo, por quê. */
  motivo: string | null;
};

export type Previsao = {
  ancoraAte: string | null;
  ancoraSaldoCents: number;
  dias: DiaPrevisto[];
  camadas: CamadaPrevisao[];
  saldoPrevistoCents: number;
  naoSomadoTotalCents: number;
  /** Primeiro dia em que o caixa fica negativo, se houver. */
  primeiraRuptura: { dia: string; diasAFrente: number; saldoCents: number } | null;
  /** Quanto do horizonte tem base — depois disso a projeção é extrapolação. */
  horizonteConfiavelDias: number | null;
};

const VAZIO: Previsao = {
  ancoraAte: null,
  ancoraSaldoCents: 0,
  dias: [],
  camadas: [],
  saldoPrevistoCents: 0,
  naoSomadoTotalCents: 0,
  primeiraRuptura: null,
  horizonteConfiavelDias: null
};

export async function getPrevisao(horizonteDias = 120): Promise<Contrato<Previsao>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");
  const horizonte = Math.min(Math.max(horizonteDias, 7), 365);

  try {
    const [dias, camadas, compromisso] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT c.* FROM fin_caixa_previsto_dia_v c
           JOIN fin_entity e ON e.id = c.entity_id
          WHERE e.slug = $1 AND c.dias_a_frente <= $2
          ORDER BY c.dia`,
        [ENTIDADE, horizonte]
      ),
      query<{
        camada: string;
        confianca: string;
        entra_no_saldo: boolean;
        sentido: string;
        n: string;
        total: string;
      }>(
        `SELECT camada, confianca, entra_no_saldo, sentido,
                count(*)::text AS n, SUM(valor_cents)::text AS total
           FROM fin_previsao_evento_v ev
           JOIN fin_entity e ON e.id = ev.entity_id
          WHERE e.slug = $1 AND ev.dias_a_frente BETWEEN 0 AND $2
          GROUP BY 1,2,3,4 ORDER BY entra_no_saldo DESC, camada`,
        [ENTIDADE, horizonte]
      ),
      compromissoDaFila(horizonte)
    ]);

    const lista: DiaPrevisto[] = dias.map((d) => ({
      dia: String(d.dia).slice(0, 10),
      diasAFrente: Number(d.dias_a_frente),
      entradaCents: Number(d.entrada_cents ?? 0),
      saidaCents: Number(d.saida_cents ?? 0),
      liquidoCents: Number(d.liquido_cents ?? 0),
      saldoPrevistoCents: Number(d.saldo_previsto_cents ?? 0),
      saldoComVencidoCents: Number(d.saldo_com_vencido_cents ?? 0),
      estimadoNoDiaCents: Number(d.estimado_no_dia_cents ?? 0),
      naoSomadoCents: Number(d.saida_proposta_nao_somada_cents ?? 0),
      eventos: Number(d.n_eventos ?? 0),
      rupturaDeCaixa: false
    }));

    const ruptura = lista.find((d) => d.saldoPrevistoCents < 0) ?? null;
    if (ruptura) ruptura.rupturaDeCaixa = true;

    // Depois do último dia com evento real, a linha só repete o saldo — e uma
    // reta constante é lida como previsão, quando é ausência de informação.
    const ultimoComEvento = [...lista].reverse().find((d) => d.eventos > 0);

    const camadasLista: CamadaPrevisao[] = camadas.map((c) => ({
      camada: c.camada,
      confianca: c.confianca,
      entraNoSaldo: Boolean(c.entra_no_saldo),
      sentido: c.sentido === "entrada" ? "entrada" : "saida",
      eventos: Number(c.n),
      totalCents: Number(c.total),
      motivo: c.entra_no_saldo ? null : MOTIVO_NAO_SOMA[c.camada] ?? "camada declarada como não somável"
    }));

    if (compromisso) camadasLista.push(compromisso);

    return contrato({
      dominio: DOMINIO,
      dado: {
        ancoraAte: dias[0]?.ancora_ate ? String(dias[0].ancora_ate).slice(0, 10) : null,
        ancoraSaldoCents: Number(dias[0]?.ancora_saldo_cents ?? 0),
        dias: lista,
        camadas: camadasLista,
        saldoPrevistoCents: lista.at(-1)?.saldoPrevistoCents ?? 0,
        naoSomadoTotalCents: lista.reduce((s, d) => s + d.naoSomadoCents, 0),
        primeiraRuptura: ruptura
          ? { dia: ruptura.dia, diasAFrente: ruptura.diasAFrente, saldoCents: ruptura.saldoPrevistoCents }
          : null,
        horizonteConfiavelDias: ultimoComEvento?.diasAFrente ?? null
      },
      ressalvas: [
        "Camadas NÃO se somam: a mesma despesa pode existir como recorrente, fatura de cartão e conta a pagar.",
        "A âncora é o saldo real das contas; se o extrato de alguma estiver atrasado, a curva inteira nasce deslocada.",
        "Depois de horizonteConfiavelDias a linha é constante — é ausência de evento, não estabilidade prevista."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:previsao]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}

const MOTIVO_NAO_SOMA: Record<string, string> = {
  pagar_recorrente:
    "recorrente detectada do histórico: a mesma obrigação já pode estar em conta a pagar ou em fatura de cartão",
  receber_vencido: "vencido: já deveria ter entrado; somá-lo ao futuro contaria a mesma receita duas vezes"
};

/** A fila de pagamento como camada — sempre não somada, e o motivo caso a caso. */
async function compromissoDaFila(horizonte: number): Promise<CamadaPrevisao | null> {
  try {
    const [linha] = await query<{ n: string; total: string }>(
      `SELECT count(*)::text AS n, COALESCE(SUM(valor_cents), 0)::text AS total
         FROM fin_pagamento_compromisso_v c JOIN fin_entity e ON e.id = c.entity_id
        WHERE e.slug = $1 AND c.dias_a_frente BETWEEN 0 AND $2`,
      [ENTIDADE, horizonte]
    );
    if (!linha || Number(linha.n) === 0) return null;
    return {
      camada: "fila_pagamento",
      confianca: "aprovado",
      entraNoSaldo: false,
      sentido: "saida",
      eventos: Number(linha.n),
      totalCents: Number(linha.total),
      motivo:
        "solicitações aprovadas na fila: a maioria já é projetada por outra camada (recorrente, cartão, documento). " +
        "Somar exige escolher explicitamente qual camada usar."
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Previsão de recebimento por camada
// ---------------------------------------------------------------------------

export type RecebimentoPrevisto = {
  camada: string;
  certeza: string;
  mes: string;
  dataPrevista: string;
  valorCents: number;
  clienteId: number | null;
  cliente: string | null;
  origem: string;
  descricao: string | null;
  drill: Drill | null;
};

export async function getPrevisaoRecebimento(meses = 6): Promise<Contrato<RecebimentoPrevisto[]>> {
  if (!isFinanceConfigured()) return contratoIndisponivel("previsao.receber", [], "banco não configurado");
  try {
    const linhas = await query<Record<string, unknown>>(
      `SELECT * FROM fin_previsao_recebimento_v
        WHERE data_prevista <= (CURRENT_DATE + ($1::int * 31))
        ORDER BY data_prevista, amount_cents DESC`,
      [meses]
    );
    return contrato({
      dominio: "previsao.receber",
      dado: linhas.map((l) => ({
        camada: String(l.camada),
        certeza: String(l.certeza),
        mes: String(l.mes).slice(0, 10),
        dataPrevista: String(l.data_prevista).slice(0, 10),
        valorCents: Number(l.amount_cents),
        clienteId: l.counterparty_id === null ? null : Number(l.counterparty_id),
        cliente: (l.contraparte as string) ?? null,
        origem: String(l.origem_tabela),
        descricao: (l.descricao as string) ?? null,
        drill:
          l.counterparty_id === null ? null : { dominio: "receber", filtros: { cliente: Number(l.counterparty_id) } }
      })),
      ressalvas: [
        "As camadas são excludentes por contrato: uma cobrança emitida já É a parcela do contrato, e somar as duas conta duas vezes."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    return contratoIndisponivel("previsao.receber", [], mensagem);
  }
}
