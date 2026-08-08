import "server-only";

import { query, transaction, isFinanceConfigured } from "./db";
import { readProcessed } from "@/lib/data/processed-store";

/**
 * Planejamento global: da meta comercial ao resultado projetado.
 *
 * A meta NÃO se digita aqui. Ela vem do pipe (Pipedrive), via o mesmo
 * `analysis.json` que alimenta /planejamento — é fato comercial, e ter duas
 * metas divergentes em duas telas é pior que não ter meta.
 *
 * O que este módulo faz é derivar o que a meta IMPLICA: quanto de imposto,
 * quanto de custo operacional, quantos vendedores, quanto sobra. As relações
 * vêm da Projeção Financeira v3.1, que já era o modelo mental da empresa —
 * adotá-las é mais honesto que inventar percentuais novos.
 *
 * Toda premissa é editável e todo valor derivado aceita sobrescrita manual. Sem
 * isso, a primeira exceção manda a pessoa de volta para a planilha, e aí passam
 * a existir duas verdades.
 */

const ENTITY = "xpe";

/** Percentuais vivem em base 10.000 no banco: 16% = 1600. */
const bps = (valor: number) => valor / 10_000;

export type Premissa = {
  slug: string;
  name: string;
  grupo: string;
  unidade: "bps" | "cents" | "unidade";
  valor: number;
  origem: string;
  descricao: string | null;
  nucleo: string | null;
};

export type LinhaPlano = {
  linha: string;
  rotulo: string;
  /** Sinal econômico: entrada aumenta o resultado, saída reduz. */
  tipo: "receita" | "deducao" | "custo" | "despesa" | "resultado";
  /** Percentual da receita bruta, para leitura vertical da DRE. */
  pctReceita: number;
  porMes: number[];
  total: number;
  /** Verdadeiro quando algum mês foi escrito à mão em vez de derivado. */
  temOverride: boolean;
  formula: string | null;
};

export type PlanoEscopo = {
  escopo: string;
  rotulo: string;
  meses: string[];
  metaPorMes: number[];
  realizadoPorMes: number[];
  linhas: LinhaPlano[];
  equipe: { vendedoresNecessarios: number; fechamentosMes: number; pessoasEstimadas: number };
};

export type Planejamento = {
  disponivel: boolean;
  ano: number;
  premissas: Premissa[];
  escopos: PlanoEscopo[];
  fonteMeta: string;
  avisos: string[];
};

type LinhaPipe = {
  month: string;
  label: string;
  scope: string;
  targetRevenue: number | null;
  actualRevenue: number | null;
  forecastRevenue: number | null;
  targetWonDeals: number | null;
};

const ROTULO_ESCOPO: Record<string, string> = {
  collective: "Consolidado",
  consultoria: "Consultoria",
  obras: "Obras"
};

export async function getPlanejamento(): Promise<Planejamento> {
  if (!isFinanceConfigured()) {
    return { disponivel: false, ano: new Date().getFullYear(), premissas: [], escopos: [], fonteMeta: "", avisos: [] };
  }

  const avisos: string[] = [];

  // A meta vem do artefato comercial — a mesma fonte de /planejamento.
  const analysis = await readProcessed<{ commercialPlanningByScope?: Record<string, LinhaPipe[]> }>(
    "analysis.json",
    {}
  ).catch(() => ({}) as { commercialPlanningByScope?: Record<string, LinhaPipe[]> });

  const porEscopo = analysis.commercialPlanningByScope ?? {};
  if (!Object.keys(porEscopo).length) {
    avisos.push("As metas do pipe não estão disponíveis — rode o sync comercial para atualizá-las.");
  }

  const premissas = await query<Premissa & { valor: number }>(
    `SELECT p.slug, p.name, p.grupo, p.unidade, p.valor, p.origem, p.descricao, p.nucleo
       FROM fin_planning_param p JOIN fin_entity e ON e.id = p.entity_id
      WHERE e.slug = $1 ORDER BY p.sort_order, p.slug`,
    [ENTITY]
  );
  const valorDe = (slug: string) => premissas.find((item) => item.slug === slug)?.valor ?? 0;

  const overrides = await query<{ ano: number; mes: number; linha: string; nucleo: string | null; valor_cents: number }>(
    `SELECT o.ano, o.mes, o.linha, o.nucleo, o.valor_cents
       FROM fin_planning_override o JOIN fin_entity e ON e.id = o.entity_id
      WHERE e.slug = $1`,
    [ENTITY]
  );

  const anoRef = (() => {
    const qualquer = Object.values(porEscopo).find((linhas) => linhas?.length);
    return qualquer?.[0]?.month ? Number(qualquer[0].month.slice(0, 4)) : new Date().getFullYear();
  })();

  const impostoPct = bps(valorDe("imposto-efetivo"));
  const custoOperacionalPct = bps(valorDe("custo-operacional"));
  const custoVendasPct = bps(valorDe("custo-vendas"));
  const marketingPct = bps(valorDe("marketing-cs"));
  const custoFixoMes = valorDe("custo-fixo-mensal");
  const ticketMedio = valorDe("ticket-medio");
  const faturamentoPorVendedor = valorDe("faturamento-vendedor");
  const custoPorPessoa = valorDe("custo-por-pessoa");

  const escopos: PlanoEscopo[] = [];

  for (const escopo of ["collective", "consultoria", "obras"]) {
    const linhas = porEscopo[escopo];
    if (!linhas?.length) continue;

    const meses = linhas.map((linha) => linha.month);
    // A meta do mês é o alvo do pipe; quando o mês já fechou e o realizado
    // superou, o realizado passa a ser o piso — planejar para baixo do que já
    // aconteceu produz um plano que ninguém leva a sério.
    const metaPorMes = linhas.map((linha) => {
      const meta = Math.round((linha.targetRevenue ?? 0) * 100);
      const real = Math.round((linha.actualRevenue ?? 0) * 100);
      return Math.max(meta, real);
    });
    const realizadoPorMes = linhas.map((linha) => Math.round((linha.actualRevenue ?? 0) * 100));

    // O custo fixo é da EMPRESA, não do núcleo. Rateá-lo entre consultoria e
    // obras produziria um "lucro por núcleo" que soma mais que o lucro real —
    // por isso ele só aparece inteiro no consolidado, e os núcleos param no
    // resultado antes da estrutura. É a mesma disciplina do doc 17.
    const aplicaFixo = escopo === "collective";

    const derivar = (nome: string, fn: (metaMes: number, indice: number) => number) =>
      metaPorMes.map((meta, indice) => {
        const chave = overrides.find(
          (o) =>
            o.linha === nome &&
            o.ano === anoRef &&
            o.mes === indice + 1 &&
            (o.nucleo ?? "collective") === escopo
        );
        return chave ? chave.valor_cents : fn(meta, indice);
      });

    const temOverrideDe = (nome: string) =>
      overrides.some((o) => o.linha === nome && o.ano === anoRef && (o.nucleo ?? "collective") === escopo);

    const receita = metaPorMes;
    const imposto = derivar("imposto", (meta) => Math.round(meta * impostoPct));
    const custoOperacional = derivar("custo_operacional", (meta) => Math.round(meta * custoOperacionalPct));
    const custoVendas = derivar("custo_vendas", (meta) => Math.round(meta * custoVendasPct));
    const marketing = derivar("marketing", (meta) => Math.round(meta * marketingPct));
    const fixo = derivar("custo_fixo", () => (aplicaFixo ? custoFixoMes : 0));

    const margemBruta = receita.map(
      (valor, i) => valor - imposto[i] - custoOperacional[i] - custoVendas[i] - marketing[i]
    );
    const resultado = margemBruta.map((valor, i) => valor - fixo[i]);

    const totalReceita = receita.reduce((soma, valor) => soma + valor, 0);
    const pct = (total: number) => (totalReceita ? (total / totalReceita) * 100 : 0);
    const soma = (serie: number[]) => serie.reduce((total, valor) => total + valor, 0);

    const montar = (
      linha: string,
      rotulo: string,
      tipo: LinhaPlano["tipo"],
      serie: number[],
      formula: string | null
    ): LinhaPlano => ({
      linha,
      rotulo,
      tipo,
      porMes: serie,
      total: soma(serie),
      pctReceita: pct(soma(serie)),
      temOverride: temOverrideDe(linha),
      formula
    });

    const mediaMensalReceita = totalReceita / (receita.length || 1);

    escopos.push({
      escopo,
      rotulo: ROTULO_ESCOPO[escopo] ?? escopo,
      meses,
      metaPorMes,
      realizadoPorMes,
      linhas: [
        montar("receita", "Receita (meta do pipe)", "receita", receita, "meta do Pipedrive, piso no realizado"),
        montar("imposto", "Impostos", "deducao", imposto, `${(impostoPct * 100).toFixed(1)}% da receita`),
        montar("custo_operacional", "Custo operacional", "custo", custoOperacional, `${(custoOperacionalPct * 100).toFixed(1)}% da receita`),
        montar("custo_vendas", "Custo de vendas", "custo", custoVendas, `${(custoVendasPct * 100).toFixed(1)}% da receita`),
        montar("marketing", "Marketing, CS e relacionamento", "despesa", marketing, `${(marketingPct * 100).toFixed(1)}% da receita`),
        montar("margem_bruta", "Margem bruta", "resultado", margemBruta, "receita − impostos − custos − marketing"),
        ...(aplicaFixo
          ? [montar("custo_fixo", "Custo fixo da estrutura", "despesa", fixo, "valor mensal fixo, não rateado por núcleo")]
          : []),
        montar(
          "resultado",
          aplicaFixo ? "Resultado projetado" : "Contribuição do núcleo",
          "resultado",
          resultado,
          aplicaFixo ? "margem bruta − custo fixo" : "margem bruta (estrutura fica no consolidado)"
        )
      ],
      equipe: {
        vendedoresNecessarios: faturamentoPorVendedor ? mediaMensalReceita / faturamentoPorVendedor : 0,
        fechamentosMes: ticketMedio ? mediaMensalReceita / ticketMedio : 0,
        pessoasEstimadas: custoPorPessoa ? soma(custoOperacional) / (custoPorPessoa * (receita.length || 1)) : 0
      }
    });
  }

  if (!escopos.length) avisos.push("Nenhum escopo com meta disponível no artefato comercial.");

  return {
    disponivel: true,
    ano: anoRef,
    premissas,
    escopos,
    fonteMeta: "Pipedrive · commercialPlanningByScope",
    avisos
  };
}

/** Edita uma premissa. É o que faz o plano inteiro se refazer. */
export async function salvarPremissa(slug: string, valor: number, autor = "ui") {
  return transaction(async (client) => {
    const {
      rows: [entidade]
    } = await client.query<{ id: number }>(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTITY]);
    if (!entidade) throw new Error("empresa não encontrada");

    const {
      rows: [antes]
    } = await client.query(`SELECT valor FROM fin_planning_param WHERE entity_id = $1 AND slug = $2`, [
      entidade.id,
      slug
    ]);
    if (!antes) throw new Error("premissa não encontrada");

    await client.query(
      `UPDATE fin_planning_param SET valor = $3, origem = 'manual', updated_by = $4
        WHERE entity_id = $1 AND slug = $2`,
      [entidade.id, slug, valor, autor]
    );
    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
       VALUES ($1, 'fin_planning_param', 0, 'update', $2::jsonb, $3::jsonb, ARRAY['valor'], $4)`,
      [entidade.id, JSON.stringify({ slug, valor: antes.valor }), JSON.stringify({ slug, valor }), autor]
    );
    return { slug, valor };
  });
}

/** Escreve um valor à mão para um mês/linha, sem apagar a fórmula. */
export async function salvarOverride(
  ano: number,
  mes: number,
  linha: string,
  nucleo: string | null,
  valorCents: number | null,
  motivo: string | null,
  autor = "ui"
) {
  return transaction(async (client) => {
    const {
      rows: [entidade]
    } = await client.query<{ id: number }>(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTITY]);
    if (!entidade) throw new Error("empresa não encontrada");

    // Valor nulo REMOVE a sobrescrita e devolve a linha à fórmula — é como se
    // desfaz uma exceção sem precisar lembrar qual era o número calculado.
    if (valorCents === null) {
      await client.query(
        `DELETE FROM fin_planning_override
          WHERE entity_id = $1 AND ano = $2 AND mes = $3 AND linha = $4
            AND nucleo IS NOT DISTINCT FROM $5`,
        [entidade.id, ano, mes, linha, nucleo]
      );
      return { removido: true };
    }

    await client.query(
      `INSERT INTO fin_planning_override (entity_id, ano, mes, linha, nucleo, valor_cents, motivo, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (entity_id, ano, mes, linha, nucleo)
       DO UPDATE SET valor_cents = EXCLUDED.valor_cents, motivo = EXCLUDED.motivo,
                     updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [entidade.id, ano, mes, linha, nucleo, valorCents, motivo, autor]
    );
    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, actor)
       VALUES ($1, 'fin_planning_override', 0, 'update', $2::jsonb, $3)`,
      [entidade.id, JSON.stringify({ ano, mes, linha, nucleo, valorCents, motivo }), autor]
    );
    return { ok: true };
  });
}
