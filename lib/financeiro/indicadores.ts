import "server-only";

import { isFinanceConfigured, query } from "./db";
import { FATOS_DRE, type Dre } from "./dre";

/**
 * Indicadores de gestão — o painel de instrumentos ao lado da DRE.
 *
 * TRÊS REGRAS QUE VALEM PARA TODOS ELES:
 *
 * 1. NENHUM INDICADOR REDEFINE RECEITA. Tudo que depende de faturamento
 *    (crescimento, ticket, % recorrente, carga tributária) sai do MESMO CTE que
 *    a DRE usa (`FATOS_DRE`) ou do objeto `Dre` já calculado. Um painel que
 *    mostra R$ 2,11 mi na DRE e R$ 2,15 mi no cartão de "receita 12m" perde a
 *    confiança do leitor inteiro, e ele passa a conferir tudo na planilha.
 *
 * 2. `valor === null` É UM ESTADO DE PRIMEIRA CLASSE. Quando o dado não existe
 *    — runway sem despesa registrada, tendência sem série histórica — o
 *    indicador devolve null e o motivo em `indisponivelPor`. Preencher com zero
 *    ou com um número derivado de denominador vazio é o modo mais comum de uma
 *    tela financeira mentir sem ninguém perceber.
 *
 * 3. TENDÊNCIA É CONTRA A JANELA COMPARÁVEL, NÃO CONTRA ONTEM. `anterior` sai
 *    da janela que `dre.periodoAnterior` define — 12 meses contra os 12
 *    anteriores, jan–ago contra jan–ago. Comparar período parcial com período
 *    cheio produz queda de 40% todo dia 1º.
 */

const ENTITY = "xpe";

/**
 * Proxy de receita recorrente por categoria: comissionamento, medição e gestão
 * de faturas são os serviços de natureza mensal. Mesma lista de `receitas.ts` —
 * duas listas divergentes fariam a mesma pergunta ter duas respostas.
 */
const CATEGORIAS_RECORRENTES = ["3.06", "3.07", "3.09"];

export type Indicador = {
  chave: string;
  rotulo: string;
  formato: "dinheiro" | "percentual" | "meses" | "numero";
  valor: number | null;
  anterior: number | null;
  /** Para pintar o delta: em inadimplência, cair é bom. */
  melhorQuando: "sobe" | "desce" | "neutro";
  hint: string;
  indisponivelPor: string | null;
  alerta: boolean;
  /** Marca o `title` de honestidade: este número muda quando a despesa entrar. */
  dependeDeDespesa: boolean;
};

export type Indicadores = {
  disponivel: boolean;
  grupos: { titulo: string; hint: string; itens: Indicador[] }[];
  aging: { faixa: string; n: number; abertoCents: number; pctDoVencido: number }[];
  carteiraAbertaCents: number;
  topClientes: { nome: string; totalCents: number; pct: number }[];
};

function indicadoresIndisponiveis(): Indicadores {
  return { disponivel: false, grupos: [], aging: [], carteiraAbertaCents: 0, topClientes: [] };
}

/**
 * Carteira e inadimplência RECONSTRUÍDAS numa data.
 *
 * Não dá para perguntar "quanto estava vencido em 31/08/2025" olhando
 * `status`/`settled_cents`: essas colunas descrevem HOJE. A reconstrução usa a
 * data em que o dinheiro se moveu (`fin_transaction.posted_on`) para decidir o
 * que já estava pago naquele dia — que é a única forma de a tendência significar
 * alguma coisa.
 *
 * 'confirmado' fica de fora: é pagamento compensado esperando crédito (cartão
 * D+30). Chamar isso de inadimplência somaria R$ 125 mil de dinheiro que já
 * chegou, e a lista de cobrança mandaria ligar para quem já pagou.
 */
const CARTEIRA_EM = `
  SELECT COALESCE(SUM(d.amount_cents - COALESCE(liq.pago, 0)) FILTER (WHERE d.due_date < $2::date), 0) AS vencido,
         count(*) FILTER (WHERE d.due_date < $2::date)::int AS n_vencido,
         COALESCE(SUM(d.amount_cents - COALESCE(liq.pago, 0)), 0) AS carteira,
         count(*)::int AS n_carteira
    FROM fin_document d
    JOIN fin_entity e ON e.id = d.entity_id
    LEFT JOIN LATERAL (
      SELECT SUM(s.amount_cents) AS pago
        FROM fin_settlement s
        JOIN fin_transaction t ON t.id = s.transaction_id
       WHERE s.document_id = d.id AND t.posted_on <= $2::date
    ) liq ON true
   WHERE e.slug = $1 AND d.direction = 'receber'
     AND d.status NOT IN ('cancelado', 'estornado', 'confirmado')
     AND COALESCE(d.issue_date, d.competence_date) <= $2::date
     AND d.amount_cents > COALESCE(liq.pago, 0)
`;

export async function getIndicadores(dre: Dre): Promise<Indicadores> {
  if (!isFinanceConfigured() || !dre.disponivel) return indicadoresIndisponiveis();

  try {
    const { periodo, periodoAnterior } = dre;

    const [saldo, reservas, receitas, docsReceita, carteiraHoje, carteiraAntes, aging, contratos, clientes, classificacao] =
      await Promise.all([
        // Conta de empréstimo fora: saldo negativo ali é normal e somá-lo faria
        // o runway mentir. Mesma regra da visão geral.
        query<{ total: number }>(
          `SELECT COALESCE(SUM(a.current_balance_cents), 0) AS total
             FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
            WHERE e.slug = $1 AND a.is_active AND a.kind <> 'emprestimo'`,
          [ENTITY]
        ),

        // `current_cents`, não `target_cents`: alvo é dinheiro que ainda falta
        // guardar, não dinheiro comprometido.
        query<{ total: number }>(
          `SELECT COALESCE(SUM(r.current_cents), 0) AS total
             FROM fin_reserve r JOIN fin_entity e ON e.id = r.entity_id
            WHERE e.slug = $1 AND r.is_active AND r.is_committed`,
          [ENTITY]
        ),

        // Uma consulta para as quatro janelas de receita e para a despesa fixa.
        // Quatro consultas separadas seriam quatro oportunidades de o recorte de
        // data sair diferente.
        query<{
          receita_periodo: number;
          receita_anterior: number;
          despesa_fixa_12m: number;
          recorrente_12m: number;
        }>(
          `WITH fatos AS (${FATOS_DRE})
           SELECT COALESCE(SUM(impacto) FILTER (
                    WHERE dre_line = 'receita_bruta' AND comp >= $2::date AND comp <= $3::date), 0) AS receita_periodo,
                  COALESCE(SUM(impacto) FILTER (
                    WHERE dre_line = 'receita_bruta' AND comp >= $4::date AND comp <= $5::date), 0) AS receita_anterior,
                  COALESCE(SUM(impacto) FILTER (
                    WHERE dre_line IN ('despesas_comerciais', 'despesas_administrativas', 'despesas_pessoal')
                      AND comp >= $6::date AND comp <= $3::date), 0) AS despesa_fixa_12m,
                  COALESCE(SUM(impacto) FILTER (
                    WHERE code = ANY($7::text[]) AND comp >= $6::date AND comp <= $3::date), 0) AS recorrente_12m
             FROM fatos`,
          [
            ENTITY,
            periodo.de,
            periodo.ate,
            periodoAnterior.de,
            periodoAnterior.ate,
            // Despesa fixa e recorrência são sempre em 12 meses: uma média
            // mensal tirada de um período de um mês não é média de nada.
            dre.evolucao.meses[0] ?? periodo.de,
            CATEGORIAS_RECORRENTES
          ]
        ),

        // Ticket médio é por DOCUMENTO emitido, não por lançamento: uma cobrança
        // parcelada em 3× é um ticket, não três.
        query<{ n_periodo: number; n_anterior: number }>(
          `SELECT count(*) FILTER (WHERE d.competence_date >= $2::date AND d.competence_date <= $3::date)::int AS n_periodo,
                  count(*) FILTER (WHERE d.competence_date >= $4::date AND d.competence_date <= $5::date)::int AS n_anterior
             FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
            WHERE e.slug = $1 AND d.direction = 'receber' AND d.status NOT IN ('cancelado', 'estornado')`,
          [ENTITY, periodo.de, periodo.ate, periodoAnterior.de, periodoAnterior.ate]
        ),

        query<{ vencido: number; n_vencido: number; carteira: number; n_carteira: number }>(CARTEIRA_EM, [
          ENTITY,
          dre.hoje
        ]),
        query<{ vencido: number; n_vencido: number; carteira: number; n_carteira: number }>(CARTEIRA_EM, [
          ENTITY,
          periodoAnterior.ate
        ]),

        // 'vencido' é derivado de due_date, nunca do carimbo do gateway — o
        // Asaas demora a marcar OVERDUE e a régua não pode esperar por ele.
        query<{ faixa: string; total: number; n: number }>(
          `SELECT CASE WHEN $2::date - d.due_date <= 30 THEN '0-30'
                       WHEN $2::date - d.due_date <= 60 THEN '31-60'
                       WHEN $2::date - d.due_date <= 90 THEN '61-90'
                       ELSE '90+' END AS faixa,
                  COALESCE(SUM(d.amount_cents - d.settled_cents), 0) AS total, count(*)::int AS n
             FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
            WHERE e.slug = $1 AND d.direction = 'receber' AND d.status IN ('emitido', 'parcial')
              AND d.due_date < $2::date
            GROUP BY 1 ORDER BY 1`,
          [ENTITY, dre.hoje]
        ),

        query<{ n: number; mrr: number }>(
          `SELECT count(*)::int AS n, COALESCE(SUM(c.amount_cents), 0) AS mrr
             FROM fin_contract c JOIN fin_entity e ON e.id = c.entity_id
            WHERE e.slug = $1 AND c.status = 'ativo' AND c.recurrence = 'mensal' AND c.direction = 'receber'`,
          [ENTITY]
        ),

        // TODOS os clientes do período, não só o top 10: a concentração precisa
        // do denominador completo para ser verdadeira.
        query<{ nome: string; total: number }>(
          `SELECT COALESCE(cp.name, 'Sem contraparte') AS nome, COALESCE(SUM(d.amount_cents), 0) AS total
             FROM fin_document d
             JOIN fin_entity e ON e.id = d.entity_id
             LEFT JOIN fin_counterparty cp ON cp.id = d.counterparty_id
            WHERE e.slug = $1 AND d.direction = 'receber' AND d.status NOT IN ('cancelado', 'estornado')
              AND d.competence_date >= $2::date AND d.competence_date <= $3::date
            GROUP BY 1 ORDER BY 2 DESC`,
          [ENTITY, periodo.de, periodo.ate]
        ),

        // Cobertura medida em R$, não em número de linhas: uma cobrança de
        // R$ 15 mil sem categoria pesa mais que trinta de R$ 60. Transferência
        // interna sai do denominador — R$ 3,82 mi de ruído afundariam o índice
        // sem que nada estivesse errado.
        query<{ classificado: number; total: number }>(
          `SELECT COALESCE(SUM(abs(t.amount_cents)) FILTER (WHERE t.category_id IS NOT NULL), 0) AS classificado,
                  COALESCE(SUM(abs(t.amount_cents)), 0) AS total
             FROM fin_transaction t JOIN fin_entity e ON e.id = t.entity_id
            WHERE e.slug = $1 AND t.transfer_status = 'nao' AND NOT t.is_split_parent`,
          [ENTITY]
        )
      ]);

    const saldoTotalCents = saldo[0]?.total ?? 0;
    const reservasCents = reservas[0]?.total ?? 0;
    const caixaDisponivelCents = saldoTotalCents - reservasCents;

    const receitaPeriodoCents = receitas[0]?.receita_periodo ?? 0;
    const receitaAnteriorCents = receitas[0]?.receita_anterior ?? 0;
    const despesaFixa12mCents = Math.abs(receitas[0]?.despesa_fixa_12m ?? 0);
    const recorrente12mCents = receitas[0]?.recorrente_12m ?? 0;
    const despesaFixaMensalCents = Math.round(despesaFixa12mCents / 12);

    const nPeriodo = docsReceita[0]?.n_periodo ?? 0;
    const nAnterior = docsReceita[0]?.n_anterior ?? 0;

    const vencidoCents = carteiraHoje[0]?.vencido ?? 0;
    const carteiraCents = carteiraHoje[0]?.carteira ?? 0;
    const vencidoAntesCents = carteiraAntes[0]?.vencido ?? 0;
    const carteiraAntesCents = carteiraAntes[0]?.carteira ?? 0;

    const mrrCents = contratos[0]?.mrr ?? 0;
    const contratosAtivos = contratos[0]?.n ?? 0;

    const totalClientes = clientes.reduce((soma, c) => soma + c.total, 0);
    const top10Cents = clientes.slice(0, 10).reduce((soma, c) => soma + c.total, 0);
    const maiorCents = clientes[0]?.total ?? 0;

    const classificadoPct = classificacao[0]?.total
      ? (classificacao[0].classificado / classificacao[0].total) * 100
      : 0;

    const semDespesa = dre.cobertura.semDespesa;
    const motivoSemDespesa = "indisponível: sem despesa registrada";

    const grupos: Indicadores["grupos"] = [
      {
        titulo: "Caixa e fôlego",
        hint: "quanto tem, por quanto tempo dura",
        itens: [
          {
            chave: "caixa",
            rotulo: "Caixa disponível",
            formato: "dinheiro",
            valor: caixaDisponivelCents,
            // `fin_balance_snapshot` tem uma linha só: não existe série para
            // comparar. Inventar um "vs. mês passado" a partir do saldo atual
            // seria escrever ficção com aparência de indicador.
            anterior: null,
            melhorQuando: "sobe",
            hint:
              reservasCents > 0
                ? "saldo das contas ativas menos o que já está separado em reservas"
                : "saldo das contas ativas, fora a de empréstimo — nenhuma reserva com dinheiro separado ainda",
            indisponivelPor: null,
            alerta: false,
            dependeDeDespesa: false
          },
          {
            chave: "runway",
            rotulo: "Runway",
            formato: "meses",
            valor: semDespesa || despesaFixaMensalCents <= 0 ? null : caixaDisponivelCents / despesaFixaMensalCents,
            anterior: null,
            melhorQuando: "sobe",
            hint: "caixa disponível ÷ despesa fixa média mensal dos últimos 12 meses",
            indisponivelPor: semDespesa || despesaFixaMensalCents <= 0 ? motivoSemDespesa : null,
            alerta: true,
            dependeDeDespesa: true
          },
          {
            chave: "despesa-fixa",
            rotulo: "Despesa fixa média",
            formato: "dinheiro",
            valor: semDespesa ? null : despesaFixaMensalCents,
            anterior: null,
            melhorQuando: "desce",
            hint: "comercial + administrativa + pessoal, média mensal de 12 meses",
            indisponivelPor: semDespesa ? motivoSemDespesa : null,
            alerta: false,
            dependeDeDespesa: true
          }
        ]
      },
      {
        titulo: "Receita",
        hint: `por competência, ${periodo.rotulo.toLowerCase()} contra ${periodoAnterior.rotulo.toLowerCase()}`,
        itens: [
          {
            chave: "receita",
            rotulo: "Receita do período",
            formato: "dinheiro",
            valor: receitaPeriodoCents,
            anterior: receitaAnteriorCents,
            melhorQuando: "sobe",
            hint: `${nPeriodo.toLocaleString("pt-BR")} documentos emitidos`,
            indisponivelPor: null,
            alerta: false,
            dependeDeDespesa: false
          },
          {
            chave: "crescimento",
            rotulo: "Crescimento",
            formato: "percentual",
            valor: receitaAnteriorCents ? ((receitaPeriodoCents - receitaAnteriorCents) / receitaAnteriorCents) * 100 : null,
            anterior: null,
            melhorQuando: "sobe",
            hint: `contra ${periodoAnterior.rotulo.toLowerCase()}`,
            indisponivelPor: receitaAnteriorCents ? null : "sem período anterior comparável",
            alerta: false,
            dependeDeDespesa: false
          },
          {
            chave: "ticket",
            rotulo: "Ticket médio",
            formato: "dinheiro",
            valor: nPeriodo ? Math.round(receitaPeriodoCents / nPeriodo) : null,
            anterior: nAnterior ? Math.round(receitaAnteriorCents / nAnterior) : null,
            melhorQuando: "sobe",
            hint: "receita ÷ documentos emitidos no período",
            indisponivelPor: nPeriodo ? null : "nenhum documento no período",
            alerta: false,
            dependeDeDespesa: false
          },
          {
            chave: "mrr",
            rotulo: "MRR contratado",
            formato: "dinheiro",
            valor: mrrCents,
            anterior: null,
            melhorQuando: "sobe",
            hint: `${contratosAtivos} contratos mensais ativos em fin_contract — contrato cadastrado, não proxy por categoria`,
            indisponivelPor: null,
            alerta: false,
            dependeDeDespesa: false
          },
          {
            chave: "recorrente",
            rotulo: "% recorrente",
            formato: "percentual",
            // Proxy por categoria (comissionamento, medição, gestão de faturas):
            // é o que se repete sem venda nova. Não é o MRR contratual acima, e
            // os dois discordam de propósito — o contratado é o piso provado.
            //
            // Numerador e denominador são AMBOS de 12 meses, sempre, mesmo com o
            // seletor em "mês atual": recorrência medida num mês só é ruído.
            valor: dre.tributos.rbt12Cents ? (recorrente12mCents / dre.tributos.rbt12Cents) * 100 : null,
            anterior: null,
            melhorQuando: "sobe",
            hint: "proxy por categoria sobre os últimos 12 meses: comissionamento, medição e gestão de faturas",
            indisponivelPor: dre.tributos.rbt12Cents ? null : "sem receita nos últimos 12 meses",
            alerta: false,
            dependeDeDespesa: false
          }
        ]
      },
      {
        titulo: "Recebíveis",
        hint: "o dinheiro que foi ganho e ainda não entrou",
        itens: [
          {
            chave: "inadimplencia",
            rotulo: "Inadimplência",
            formato: "dinheiro",
            valor: vencidoCents,
            anterior: vencidoAntesCents,
            melhorQuando: "desce",
            hint: `${carteiraHoje[0]?.n_vencido ?? 0} cobranças vencidas e em aberto`,
            indisponivelPor: null,
            alerta: vencidoCents > 0,
            dependeDeDespesa: false
          },
          {
            chave: "inadimplencia-pct",
            rotulo: "% da carteira vencida",
            formato: "percentual",
            valor: carteiraCents ? (vencidoCents / carteiraCents) * 100 : null,
            anterior: carteiraAntesCents ? (vencidoAntesCents / carteiraAntesCents) * 100 : null,
            melhorQuando: "desce",
            hint: `sobre a carteira em aberto (${(carteiraHoje[0]?.n_carteira ?? 0).toLocaleString("pt-BR")} cobranças)`,
            indisponivelPor: carteiraCents ? null : "carteira vazia",
            alerta: true,
            dependeDeDespesa: false
          },
          {
            chave: "concentracao-top10",
            rotulo: "Concentração top 10",
            formato: "percentual",
            valor: totalClientes ? (top10Cents / totalClientes) * 100 : null,
            anterior: null,
            melhorQuando: "desce",
            hint: `de ${clientes.length.toLocaleString("pt-BR")} clientes com receita no período`,
            indisponivelPor: totalClientes ? null : "sem receita no período",
            alerta: false,
            dependeDeDespesa: false
          },
          {
            chave: "maior-cliente",
            rotulo: "Maior cliente",
            formato: "percentual",
            valor: totalClientes ? (maiorCents / totalClientes) * 100 : null,
            anterior: null,
            melhorQuando: "desce",
            hint: clientes[0]?.nome ?? "—",
            indisponivelPor: totalClientes ? null : "sem receita no período",
            alerta: totalClientes > 0 && maiorCents / totalClientes > 0.2,
            dependeDeDespesa: false
          }
        ]
      },
      {
        titulo: "Tributos e cobertura",
        hint: "quanto o governo leva e quanto do dado dá para confiar",
        itens: [
          {
            chave: "carga",
            rotulo: "Carga tributária efetiva",
            formato: "percentual",
            valor: dre.tributos.cargaEfetivaPct,
            anterior: null,
            melhorQuando: "desce",
            hint: "DAS estimado + ISS retido na fonte ÷ receita bruta — o DAS é premissa, não apuração",
            indisponivelPor: null,
            alerta: false,
            dependeDeDespesa: false
          },
          {
            chave: "cobertura-classificacao",
            rotulo: "Cobertura de classificação",
            formato: "percentual",
            valor: classificadoPct,
            anterior: null,
            melhorQuando: "sobe",
            hint: "% do R$ movimentado que tem categoria — medido em dinheiro, não em linhas",
            indisponivelPor: null,
            alerta: classificadoPct < 95,
            dependeDeDespesa: false
          },
          {
            chave: "cobertura-contas",
            rotulo: "Cobertura de contas",
            formato: "percentual",
            valor: dre.cobertura.contasTotal
              ? (dre.cobertura.contasComExtrato / dre.cobertura.contasTotal) * 100
              : null,
            anterior: null,
            melhorQuando: "sobe",
            hint: dre.cobertura.contasSemExtrato.length
              ? `sem extrato há mais de 30 dias: ${dre.cobertura.contasSemExtrato.join(", ")}`
              : "todas as contas com extrato recente",
            indisponivelPor: dre.cobertura.contasTotal ? null : "nenhuma conta cadastrada",
            alerta: dre.cobertura.contasSemExtrato.length > 0,
            dependeDeDespesa: false
          }
        ]
      }
    ];

    const vencidoTotal = aging.reduce((soma, faixa) => soma + faixa.total, 0);

    return {
      disponivel: true,
      grupos,
      aging: aging.map((faixa) => ({
        faixa: faixa.faixa,
        n: faixa.n,
        abertoCents: faixa.total,
        pctDoVencido: vencidoTotal ? (faixa.total / vencidoTotal) * 100 : 0
      })),
      carteiraAbertaCents: carteiraCents,
      topClientes: clientes.slice(0, 10).map((c) => ({
        nome: c.nome,
        totalCents: c.total,
        pct: totalClientes ? (c.total / totalClientes) * 100 : 0
      }))
    };
  } catch (error) {
    console.error("[financeiro] indicadores indisponíveis:", error);
    return indicadoresIndisponiveis();
  }
}
