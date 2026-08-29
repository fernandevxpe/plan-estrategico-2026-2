import "server-only";

import { isFinanceConfigured, query } from "@/lib/financeiro/db";
import type { ComissaoSerie } from "@/lib/financeiro/comissoes";
import {
  getPerfilPessoa,
  type ComissaoDeclaradaLinha,
  type ProlaboreEsperadoLinha,
  type ReembolsoSerie,
  type SalarioBaseLinha
} from "@/lib/financeiro/pessoa-perfil";

const ENTITY = "xpe";

export type TipoReembolsoOpcao = {
  slug: string;
  name: string;
  categoriaCode: string | null;
  requiresNfe: boolean;
  allowsInstallment: boolean;
};

export type ComissaoDeclaradaMes = ComissaoDeclaradaLinha & {
  parcela: number | null;
  parcelasTotal: number | null;
  serieId: number | null;
};

export type CadastroPrevisaoPessoa = {
  id: number;
  nome: string;
  vinculo: string | null;
  mesPrevisto: string;
  mesPrevistoRotulo: string;
  previsaoPorNatureza: Record<string, number>;
  previsaoTotalCents: number;
  salarioBaseAtual: SalarioBaseLinha | null;
  salarioBaseHistorico: SalarioBaseLinha[];
  prolaboreEsperadoAtual: ProlaboreEsperadoLinha | null;
  prolaboreEsperadoHistorico: ProlaboreEsperadoLinha[];
  comissaoDoMes: ComissaoDeclaradaMes[];
  comissaoHistorico: ComissaoDeclaradaLinha[];
  comissaoSeries: ComissaoSerie[];
  reembolsoSeries: ReembolsoSerie[];
  reembolsoPrevistoMesCents: number;
  reembolsoAbertoCents: number;
  tiposReembolso: TipoReembolsoOpcao[];
  temSalarioBase: boolean;
};

function normalizarMesPrevisto(valor: string | null | undefined): string | null {
  if (!valor?.trim()) return null;
  const m = /^(\d{4})-(\d{2})(?:-01)?$/.exec(valor.trim());
  if (!m) return null;
  const n = Number(m[2]);
  if (n < 1 || n > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

function chaveMes(competencia: string): string {
  return competencia.slice(0, 7);
}

function montarPrevisao(args: {
  salario: SalarioBaseLinha | null;
  prolabore: ProlaboreEsperadoLinha | null;
  comissaoDoMes: ComissaoDeclaradaLinha[];
  reembolsoPrevistoMesCents: number;
}): Record<string, number> {
  const por: Record<string, number> = {};
  if (args.salario?.valorCents) por.salario = args.salario.valorCents;
  if (args.prolabore?.valorCents) por.prolabore = args.prolabore.valorCents;
  const com = args.comissaoDoMes.reduce((s, c) => s + c.valorCents, 0);
  if (com > 0) por.comissao = com;
  if (args.reembolsoPrevistoMesCents > 0) por.reembolso = args.reembolsoPrevistoMesCents;
  return por;
}

/**
 * Cadastro vigente + previsão de UM mês — mesma base do perfil e da coluna
 * "previsto" da matriz de Pessoas, num payload só para o popup rápido.
 */
export async function getCadastroPrevisaoPessoa(
  personId: number,
  mesPrevistoParam?: string | null
): Promise<CadastroPrevisaoPessoa | null> {
  if (!isFinanceConfigured()) return null;

  const perfil = await getPerfilPessoa(personId);
  if (!perfil) return null;

  const mesRow = await query<{ mes: string }>(
    `SELECT to_char(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month', 'YYYY-MM-01') AS mes`
  );
  const mesPrevisto = normalizarMesPrevisto(mesPrevistoParam) ?? mesRow[0]?.mes ?? "";
  if (!mesPrevisto) return null;
  const mesChave = chaveMes(mesPrevisto);

  const [tiposRows, seriesRows, comissaoMesRows] = await Promise.all([
    query<{
      slug: string;
      name: string;
      categoria_code: string | null;
      requires_nfe: boolean;
      allows_installment: boolean;
    }>(
      `SELECT t.slug, t.name, c.code AS categoria_code, t.requires_nfe, t.allows_installment
         FROM fin_reimbursement_type t
         LEFT JOIN fin_category c ON c.id = t.category_id
        WHERE t.is_active
        ORDER BY t.sort_order`
    ),
    query<{
      id: number;
      person_id: number;
      pessoa: string;
      descricao: string;
      total_cents: number;
      parcelas_total: number;
      valor_parcela_cents: number;
      primeira_competencia: string;
      nota: string | null;
      tipo_slug: string | null;
      tipo_nome: string | null;
      cliente: string | null;
      entrada_cents: number;
      parcelas_lancadas: number;
      projetado_restante: number;
    }>(
      `SELECT s.id, s.person_id, p.name AS pessoa, s.descricao, s.total_cents,
              s.parcelas_total, s.valor_parcela_cents,
              to_char(s.primeira_competencia, 'YYYY-MM-DD') AS primeira_competencia,
              s.nota, s.tipo_slug, t.nome AS tipo_nome, s.cliente, s.entrada_cents,
              (SELECT count(*)::int FROM fin_pessoa_comissao_declarada d WHERE d.serie_id = s.id) AS parcelas_lancadas,
              COALESCE((
                SELECT sum(d.valor_cents)::bigint
                  FROM fin_pessoa_comissao_declarada d
                 WHERE d.serie_id = s.id
                   AND d.competencia >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date
              ), 0) AS projetado_restante
         FROM fin_pessoa_comissao_serie s
         JOIN fin_person p ON p.id = s.person_id
         JOIN fin_entity e ON e.id = s.entity_id
         LEFT JOIN fin_comissao_tipo t ON t.slug = s.tipo_slug
        WHERE e.slug = $1 AND s.person_id = $2
        ORDER BY s.primeira_competencia DESC`,
      [ENTITY, personId]
    ),
    query<{
      id: number;
      valor_cents: number;
      competencia: string;
      descricao: string;
      nota: string | null;
      serie_id: number | null;
      parcela: number | null;
      parcelas_total: number | null;
    }>(
      `SELECT id, valor_cents,
              to_char(competencia, 'YYYY-MM-DD') AS competencia,
              descricao, nota, serie_id, parcela, parcelas_total
         FROM fin_pessoa_comissao_declarada
        WHERE person_id = $1
          AND competencia >= $2::date
          AND competencia < ($2::date + interval '1 month')
        ORDER BY id`,
      [personId, mesPrevisto]
    )
  ]);

  const comissaoDoMes: ComissaoDeclaradaMes[] = comissaoMesRows.map((c) => ({
    id: Number(c.id),
    valorCents: Number(c.valor_cents),
    competencia: c.competencia,
    descricao: c.descricao,
    nota: c.nota,
    parcela: c.parcela !== null ? Number(c.parcela) : null,
    parcelasTotal: c.parcelas_total !== null ? Number(c.parcelas_total) : null,
    serieId: c.serie_id !== null ? Number(c.serie_id) : null
  }));
  const reembolsoPrevistoMesCents = perfil.reembolsoSeries
    .filter((s) => !s.quitado && s.parcelasRestantes >= 1)
    .reduce((t, s) => t + s.valorParcelaCents, 0);

  const previsaoPorNatureza = montarPrevisao({
    salario: perfil.salarioBaseAtual,
    prolabore: perfil.prolaboreEsperadoAtual,
    comissaoDoMes,
    reembolsoPrevistoMesCents
  });
  const previsaoTotalCents = Object.values(previsaoPorNatureza).reduce((s, v) => s + v, 0);

  const comissaoSeries: ComissaoSerie[] = seriesRows.map((r) => ({
    id: Number(r.id),
    personId: Number(r.person_id),
    pessoa: r.pessoa,
    descricao: r.descricao,
    totalCents: Number(r.total_cents),
    parcelasTotal: Number(r.parcelas_total),
    valorParcelaCents: Number(r.valor_parcela_cents),
    primeiraCompetencia: r.primeira_competencia,
    nota: r.nota,
    tipoSlug: r.tipo_slug,
    tipoNome: r.tipo_nome,
    cliente: r.cliente,
    entradaCents: Number(r.entrada_cents ?? 0),
    parcelasLancadas: Number(r.parcelas_lancadas),
    projetadoRestanteCents: Number(r.projetado_restante)
  }));

  const d = new Date(mesPrevisto.slice(0, 7) + "-15T12:00:00");
  const mesPrevistoRotulo = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });

  return {
    id: perfil.id,
    nome: perfil.nome,
    vinculo: perfil.vinculo,
    mesPrevisto,
    mesPrevistoRotulo,
    previsaoPorNatureza,
    previsaoTotalCents,
    salarioBaseAtual: perfil.salarioBaseAtual,
    salarioBaseHistorico: perfil.salarioBaseHistorico,
    prolaboreEsperadoAtual: perfil.prolaboreEsperadoAtual,
    prolaboreEsperadoHistorico: perfil.prolaboreEsperadoHistorico,
    comissaoDoMes,
    comissaoHistorico: perfil.comissaoDeclarada,
    comissaoSeries,
    reembolsoSeries: perfil.reembolsoSeries,
    reembolsoPrevistoMesCents,
    reembolsoAbertoCents: perfil.reembolsoAbertoCents,
    tiposReembolso: tiposRows.map((t) => ({
      slug: t.slug,
      name: t.name,
      categoriaCode: t.categoria_code,
      requiresNfe: t.requires_nfe,
      allowsInstallment: t.allows_installment
    })),
    temSalarioBase: Boolean(perfil.salarioBaseAtual)
  };
}
