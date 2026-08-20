import "server-only";

import { isFinanceConfigured, query } from "../db";
import { contrato, contratoIndisponivel, ENTIDADE, type Contrato } from "./base";

/**
 * A leitura gerencial da DRE — percentual, crescimento e composição.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE CONTRATO NÃO CALCULA NADA
 * ---------------------------------------------------------------------------
 * Todo percentual, variação e média móvel vem pronto de `fin_analise_*_v`
 * (0131). A tentação de calcular margem no TypeScript é grande — é uma
 * divisão. O problema aparece depois: uma tela divide por receita bruta, um
 * relatório divide por líquida, e as duas dizem "margem" sem que ninguém
 * perceba a diferença até alguém comparar.
 *
 * A view é o único lugar onde o denominador é escolhido, e a pós-condição da
 * migration prova que a soma bate com a DRE — coisa que nenhum cálculo de tela
 * consegue provar.
 *
 * ---------------------------------------------------------------------------
 * NULL É RESPOSTA, NÃO FALHA
 * ---------------------------------------------------------------------------
 * Mês sem receita devolve `null` em todos os percentuais. Isso sobe até a tela
 * como `null` e é desenhado como "—", nunca como 0%. Um mês sem faturamento
 * não tem margem de zero por cento: não tem margem.
 */

export type VisaoAnalise = "caixa" | "competencia";

export type LinhaAnaliseMensal = {
  mes: string;
  receitaBrutaCents: number;
  receitaLiquidaCents: number;
  custosDiretosCents: number;
  margemContribuicaoCents: number;
  pessoalCents: number;
  comerciaisCents: number;
  administrativasCents: number;
  custoOperacionalCents: number;
  ebitdaCents: number;
  impostosCents: number;
  lucroLiquidoCents: number;
  capexCents: number;
  cartaoCents: number;
  resultadoCaixaCents: number;
  lacunasCents: number;
  lancamentos: number;
  pctCustosDiretos: number | null;
  pctPessoal: number | null;
  pctComerciais: number | null;
  pctAdministrativas: number | null;
  pctCustoOperacional: number | null;
  pctImpostos: number | null;
  margemContribuicaoPct: number | null;
  margemEbitdaPct: number | null;
  margemLiquidaPct: number | null;
  receitaVariacaoPct: number | null;
  custoVariacaoPct: number | null;
  ebitdaVariacaoPct: number | null;
  receitaYoyPct: number | null;
  receitaMedia3Cents: number | null;
  ebitdaMedia3Cents: number | null;
};

export type LinhaAnaliseNucleo = {
  mes: string;
  nucleo: string;
  nucleoNome: string | null;
  isOverhead: boolean;
  receitaCents: number;
  custoCents: number;
  resultadoCents: number;
  lancamentos: number;
  participacaoReceitaPct: number | null;
  participacaoCustoPct: number | null;
  margemPct: number | null;
};

export type LinhaAnaliseReceita = {
  mes: string;
  categoriaCode: string | null;
  categoriaNome: string | null;
  linhaProduto: string | null;
  receitaCents: number;
  lancamentos: number;
  clientes: number;
  participacaoPct: number | null;
  mesAnteriorCents: number | null;
  mesesComReceitaEm6: number;
};

export type Analise = {
  visao: VisaoAnalise;
  de: string;
  ate: string;
  mensal: LinhaAnaliseMensal[];
  nucleos: LinhaAnaliseNucleo[];
  receitas: LinhaAnaliseReceita[];
};

const VAZIO: Analise = { visao: "caixa", de: "", ate: "", mensal: [], nucleos: [], receitas: [] };

const num = (v: unknown): number => Number(v ?? 0);
const opc = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** "2026-01" e "2026-01-01" entram; sai sempre "2026-01-01". */
function primeiroDia(mes: string): string {
  return /^\d{4}-\d{2}$/.test(mes) ? `${mes}-01` : mes;
}

export async function getAnalise(args: {
  de: string;
  ate: string;
  visao?: VisaoAnalise;
}): Promise<Contrato<Analise>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel("analise", VAZIO, "banco do financeiro não configurado");
  }
  const visao: VisaoAnalise = args.visao === "competencia" ? "competencia" : "caixa";
  const de = primeiroDia(args.de);
  const ate = primeiroDia(args.ate);

  try {
    const [mensal, nucleos, receitas] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT to_char(a.mes,'YYYY-MM') AS mes, a.*
           FROM fin_analise_mensal_v a JOIN fin_entity e ON e.id = a.entity_id
          WHERE e.slug = $1 AND a.visao = $2 AND a.mes >= $3::date AND a.mes <= $4::date
          ORDER BY a.mes`,
        [ENTIDADE, visao, de, ate]
      ),
      query<Record<string, unknown>>(
        `SELECT to_char(n.mes,'YYYY-MM') AS mes, n.*
           FROM fin_analise_nucleo_v n JOIN fin_entity e ON e.id = n.entity_id
          WHERE e.slug = $1 AND n.visao = $2 AND n.mes >= $3::date AND n.mes <= $4::date
          ORDER BY n.mes, n.receita_cents DESC`,
        [ENTIDADE, visao, de, ate]
      ),
      query<Record<string, unknown>>(
        `SELECT to_char(r.mes,'YYYY-MM') AS mes, r.*
           FROM fin_analise_receita_v r JOIN fin_entity e ON e.id = r.entity_id
          WHERE e.slug = $1 AND r.visao = $2 AND r.mes >= $3::date AND r.mes <= $4::date
          ORDER BY r.mes, r.receita_cents DESC`,
        [ENTIDADE, visao, de, ate]
      )
    ]);

    const dado: Analise = {
      visao,
      de,
      ate,
      mensal: mensal.map((r) => ({
        mes: String(r.mes),
        receitaBrutaCents: num(r.receita_bruta_cents),
        receitaLiquidaCents: num(r.receita_liquida_cents),
        custosDiretosCents: num(r.custos_diretos_cents),
        margemContribuicaoCents: num(r.margem_contribuicao_cents),
        pessoalCents: num(r.pessoal_cents),
        comerciaisCents: num(r.comerciais_cents),
        administrativasCents: num(r.administrativas_cents),
        custoOperacionalCents: num(r.custo_operacional_cents),
        ebitdaCents: num(r.ebitda_cents),
        impostosCents: num(r.impostos_cents),
        lucroLiquidoCents: num(r.lucro_liquido_cents),
        capexCents: num(r.capex_cents),
        cartaoCents: num(r.cartao_cents),
        resultadoCaixaCents: num(r.resultado_caixa_cents),
        lacunasCents: num(r.lacunas_cents),
        lancamentos: num(r.lancamentos),
        pctCustosDiretos: opc(r.pct_custos_diretos),
        pctPessoal: opc(r.pct_pessoal),
        pctComerciais: opc(r.pct_comerciais),
        pctAdministrativas: opc(r.pct_administrativas),
        pctCustoOperacional: opc(r.pct_custo_operacional),
        pctImpostos: opc(r.pct_impostos),
        margemContribuicaoPct: opc(r.margem_contribuicao_pct),
        margemEbitdaPct: opc(r.margem_ebitda_pct),
        margemLiquidaPct: opc(r.margem_liquida_pct),
        receitaVariacaoPct: opc(r.receita_variacao_pct),
        custoVariacaoPct: opc(r.custo_variacao_pct),
        ebitdaVariacaoPct: opc(r.ebitda_variacao_pct),
        receitaYoyPct: opc(r.receita_yoy_pct),
        receitaMedia3Cents: opc(r.receita_media3_cents),
        ebitdaMedia3Cents: opc(r.ebitda_media3_cents)
      })),
      nucleos: nucleos.map((r) => ({
        mes: String(r.mes),
        nucleo: String(r.nucleo),
        nucleoNome: r.nucleo_nome === null ? null : String(r.nucleo_nome),
        isOverhead: r.is_overhead === true,
        receitaCents: num(r.receita_cents),
        custoCents: num(r.custo_cents),
        resultadoCents: num(r.resultado_cents),
        lancamentos: num(r.lancamentos),
        participacaoReceitaPct: opc(r.participacao_receita_pct),
        participacaoCustoPct: opc(r.participacao_custo_pct),
        margemPct: opc(r.margem_pct)
      })),
      receitas: receitas.map((r) => ({
        mes: String(r.mes),
        categoriaCode: r.categoria_code === null ? null : String(r.categoria_code),
        categoriaNome: r.categoria_nome === null ? null : String(r.categoria_nome),
        linhaProduto: r.linha_produto === null ? null : String(r.linha_produto),
        receitaCents: num(r.receita_cents),
        lancamentos: num(r.lancamentos),
        clientes: num(r.clientes),
        participacaoPct: opc(r.participacao_pct),
        mesAnteriorCents: opc(r.mes_anterior_cents),
        mesesComReceitaEm6: num(r.meses_com_receita_em_6)
      }))
    };

    // Lacuna é o que a análise NÃO consegue atribuir. Some-a e diga, porque um
    // painel que esconde o que não sabe classificar é um painel que mente por
    // omissão — e a margem sai otimista na exata medida da lacuna.
    const lacuna = dado.mensal.reduce((s, m) => s + Math.abs(m.lacunasCents), 0);
    const ressalvas: string[] = [];
    if (lacuna > 0) {
      ressalvas.push(
        `${(lacuna / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} em lançamentos sem categoria ` +
          `no período — entram no total, mas não em nenhuma linha da análise.`
      );
    }
    if (visao === "competencia") {
      ressalvas.push(
        "Visão competência: inclui itens de cartão pela data da compra e exclui o pagamento da fatura."
      );
    } else {
      ressalvas.push(
        "Visão caixa: conta a fatura do cartão quando ela é paga, não as compras individuais."
      );
    }

    return contrato({ dominio: "analise", dado, ressalvas });
  } catch (error) {
    return contratoIndisponivel(
      "analise",
      VAZIO,
      error instanceof Error ? error.message : "falha ao ler a análise"
    );
  }
}
