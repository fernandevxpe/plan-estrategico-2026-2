import "server-only";

import { isFinanceConfigured, query } from "../db";
import { contrato, contratoIndisponivel, ENTIDADE, type Contrato, type Drill, type Medida } from "./base";

/**
 * Tesouraria: caixa livre, reservas comprometidas, aplicações e runway.
 *
 * A armadilha que este contrato existe para evitar já derrubou a primeira linha
 * da tela uma vez: usar a META da reserva para calcular o disponível produziu
 * −R$ 180 mil, porque as reservas somam R$ 230 mil de alvo contra R$ 49 mil em
 * conta. Alvo não é dinheiro comprometido — é dinheiro que ainda falta guardar,
 * e a diferença entre as duas coisas é a distância entre "estou no vermelho" e
 * "tenho uma meta a cumprir".
 */

const DOMINIO = "tesouraria";

export type Reserva = {
  slug: string;
  nome: string;
  contaSlug: string | null;
  alvoCents: number;
  atualCents: number;
  faltaCents: number;
  comprometida: boolean;
  coberturaPct: number | null;
};

export type Aplicacao = {
  contaSlug: string;
  saldoContaCents: number;
  somaPosicoesCents: number;
  deltaCents: number;
  posicoesAtivas: number;
  principalCents: number;
  rendimentoBrutoCents: number;
  impostosProvisionadosCents: number;
  lidoEm: string | null;
  proximoVencimento: string | null;
  /** O saldo da conta bate com a soma das posições? Delta ≠ 0 é dado a explicar. */
  bate: boolean;
};

export type Tesouraria = {
  caixaTotalCents: number;
  reservadoCents: number;
  /** Caixa − reservas JÁ separadas (nunca a meta). */
  livreCents: number;
  reservaFaltaCents: number;
  reservas: Reserva[];
  aplicacoes: Aplicacao[];
  /** Meses de operação que o caixa livre cobre, na média de saída dos últimos 6 meses. */
  runwayMeses: Medida;
  saidaMediaMensalCents: number | null;
  drillCaixa: Drill;
};

const VAZIO: Tesouraria = {
  caixaTotalCents: 0,
  reservadoCents: 0,
  livreCents: 0,
  reservaFaltaCents: 0,
  reservas: [],
  aplicacoes: [],
  runwayMeses: { valorCents: null, motivo: "banco não consultado" },
  saidaMediaMensalCents: null,
  drillCaixa: { dominio: "bancos", filtros: {} }
};

export async function getTesouraria(): Promise<Contrato<Tesouraria>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");

  try {
    const [contas, reservas, aplicacoes, saida] = await Promise.all([
      query<{ total: string }>(
        `SELECT COALESCE(SUM(a.current_balance_cents), 0)::text AS total
           FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
          WHERE e.slug = $1 AND a.is_active AND a.kind <> 'emprestimo'`,
        [ENTIDADE]
      ),
      query<{ slug: string; name: string; conta: string | null; target: string; current: string; committed: boolean }>(
        `SELECT r.slug, r.name, a.slug AS conta, r.target_cents::text AS target,
                r.current_cents::text AS current, r.is_committed AS committed
           FROM fin_reserve r
           JOIN fin_entity e ON e.id = r.entity_id
           LEFT JOIN fin_account a ON a.id = r.account_id
          WHERE e.slug = $1 AND r.is_active ORDER BY r.sort_order`,
        [ENTIDADE]
      ),
      query<Record<string, unknown>>(`SELECT * FROM fin_investment_posicao ORDER BY account_slug`),
      // Média de saída dos últimos 6 meses fechados. O mês corrente fica fora:
      // um mês pela metade puxaria a média para baixo e inflaria o runway.
      query<{ media: string | null; meses: string }>(
        `SELECT AVG(saida)::text AS media, count(*)::text AS meses
           FROM (
             SELECT date_trunc('month', t.posted_on) AS mes, SUM(-t.amount_cents) AS saida
               FROM fin_transaction t JOIN fin_entity e ON e.id = t.entity_id
              WHERE e.slug = $1 AND t.amount_cents < 0
                AND t.transfer_status = 'nao' AND NOT t.is_split_parent
                AND t.posted_on >= (date_trunc('month', CURRENT_DATE) - interval '6 months')::date
                AND t.posted_on < date_trunc('month', CURRENT_DATE)::date
              GROUP BY 1
           ) m`,
        [ENTIDADE]
      )
    ]);

    const caixaTotal = Number(contas[0]?.total ?? 0);
    const listaReservas: Reserva[] = reservas.map((r) => {
      const alvo = Number(r.target);
      const atual = Number(r.current);
      return {
        slug: r.slug,
        nome: r.name,
        contaSlug: r.conta,
        alvoCents: alvo,
        atualCents: atual,
        faltaCents: Math.max(0, alvo - atual),
        comprometida: r.committed,
        coberturaPct: alvo > 0 ? (atual / alvo) * 100 : null
      };
    });

    // Só o que está DE FATO separado sai do caixa livre.
    const reservado = listaReservas.filter((r) => r.comprometida).reduce((s, r) => s + r.atualCents, 0);
    const livre = caixaTotal - reservado;
    const mediaSaida = saida[0]?.media === null || saida[0]?.media === undefined ? null : Number(saida[0].media);
    const meses = Number(saida[0]?.meses ?? 0);

    return contrato({
      dominio: DOMINIO,
      dado: {
        caixaTotalCents: caixaTotal,
        reservadoCents: reservado,
        livreCents: livre,
        reservaFaltaCents: listaReservas.reduce((s, r) => s + r.faltaCents, 0),
        reservas: listaReservas,
        aplicacoes: aplicacoes.map((a) => ({
          contaSlug: String(a.account_slug),
          saldoContaCents: Number(a.saldo_conta_cents),
          somaPosicoesCents: Number(a.soma_posicoes_cents ?? 0),
          deltaCents: Number(a.delta_cents ?? 0),
          posicoesAtivas: Number(a.posicoes_ativas ?? 0),
          principalCents: Number(a.principal_cents ?? 0),
          rendimentoBrutoCents: Number(a.rendimento_bruto_cents ?? 0),
          impostosProvisionadosCents: Number(a.impostos_provisionados_cents ?? 0),
          lidoEm: a.lido_em ? String(a.lido_em).slice(0, 10) : null,
          proximoVencimento: a.proximo_vencimento ? String(a.proximo_vencimento).slice(0, 10) : null,
          bate: Number(a.delta_cents ?? 0) === 0
        })),
        runwayMeses:
          mediaSaida && mediaSaida > 0 && meses >= 3
            ? { valorCents: Math.round((livre / mediaSaida) * 100), motivo: null }
            : {
                valorCents: null,
                motivo:
                  meses < 3
                    ? `só ${meses} mês(es) fechado(s) de histórico de saída — média instável demais para virar runway`
                    : "sem saída registrada no período: o ledger não tem despesa suficiente para estimar"
              },
        saidaMediaMensalCents: mediaSaida === null ? null : Math.round(mediaSaida),
        drillCaixa: { dominio: "bancos", filtros: {} }
      },
      ressalvas: [
        "Livre = caixa − reservas JÁ SEPARADAS. A meta da reserva é lacuna a cumprir, não dívida contra o saldo.",
        "runwayMeses vem em centésimos de mês (valorCents/100 = meses), para não perder precisão no transporte."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:tesouraria]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}
