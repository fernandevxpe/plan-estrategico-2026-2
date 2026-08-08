import "server-only";

import { isFinanceConfigured, query } from "./db";

/**
 * O que ainda falta qualificar — e onde clicar para resolver.
 *
 * A visão geral não pode só mostrar indicadores: ela precisa apontar o caminho
 * para o trabalho. Um número que diz "93% classificado" sem dizer QUAIS 7%
 * faltam e quanto valem transforma cobertura em curiosidade, não em tarefa.
 *
 * Tudo aqui é ordenado por R$ em jogo, não por contagem: 46 cobranças de
 * R$ 1.086 do mesmo shopping valem mais atenção que 119 de R$ 154 de um posto —
 * e resolver as duas leva o mesmo tempo, porque a decisão é por CLIENTE, não
 * por linha.
 */

const ENTITY = "xpe";

export type LacunaContraparte = {
  contraparteId: number | null;
  nome: string;
  n: number;
  valorCents: number;
  /** Categoria dominante do histórico já classificado desse cliente, se houver. */
  sugestao: { code: string; name: string; share: number } | null;
};

export type Qualificacao = {
  disponivel: boolean;
  semCategoria: { n: number; valorCents: number; porContraparte: LacunaContraparte[] };
  semNucleo: { n: number; valorCents: number };
  semContraparte: { n: number; valorCents: number };
  lancamentosSemCategoria: { n: number; valorCents: number };
  contasSemExtrato: { slug: string; nome: string; diasSemExtrato: number | null }[];
  pagaveisSemPlano: { n: number; valorCents: number };
};

export async function getQualificacao(): Promise<Qualificacao> {
  const vazio: Qualificacao = {
    disponivel: false,
    semCategoria: { n: 0, valorCents: 0, porContraparte: [] },
    semNucleo: { n: 0, valorCents: 0 },
    semContraparte: { n: 0, valorCents: 0 },
    lancamentosSemCategoria: { n: 0, valorCents: 0 },
    contasSemExtrato: [],
    pagaveisSemPlano: { n: 0, valorCents: 0 }
  };
  if (!isFinanceConfigured()) return vazio;

  try {
    const [semCategoria, porContraparte, semNucleo, semContraparte, lancamentos, contas, pagaveis] = await Promise.all([
      query<{ n: number; v: number }>(
        `SELECT count(*)::int AS n, COALESCE(SUM(d.amount_cents), 0) AS v
           FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
          WHERE e.slug = $1 AND d.category_id IS NULL AND d.status <> 'cancelado'`,
        [ENTITY]
      ),

      // Uma linha por cliente, com a categoria dominante do histórico dele ao
      // lado — é a diferença entre "resolva 382 cobranças" e "confirme 15
      // palpites". O LATERAL evita N+1.
      query<{
        contraparte_id: number | null;
        nome: string;
        n: number;
        v: number;
        code: string | null;
        cat_nome: string | null;
        share: number | null;
      }>(
        `WITH lacunas AS (
           SELECT d.counterparty_id, COALESCE(cp.name, '(sem contraparte)') AS nome,
                  count(*)::int AS n, COALESCE(SUM(d.amount_cents), 0) AS v
             FROM fin_document d
             JOIN fin_entity e ON e.id = d.entity_id
             LEFT JOIN fin_counterparty cp ON cp.id = d.counterparty_id
            WHERE e.slug = $1 AND d.category_id IS NULL AND d.status <> 'cancelado'
            GROUP BY 1, 2
         )
         SELECT l.counterparty_id AS contraparte_id, l.nome, l.n, l.v,
                s.code, s.name AS cat_nome, s.share
           FROM lacunas l
           LEFT JOIN LATERAL (
             SELECT c.code, c.name,
                    round(count(*)::numeric * 100 / SUM(count(*)) OVER (), 1) AS share
               FROM fin_document d2
               JOIN fin_category c ON c.id = d2.category_id
              WHERE d2.counterparty_id = l.counterparty_id AND d2.category_id IS NOT NULL
              GROUP BY c.code, c.name
              ORDER BY count(*) DESC
              LIMIT 1
           ) s ON true
          ORDER BY l.v DESC
          LIMIT 20`,
        [ENTITY]
      ),

      query<{ n: number; v: number }>(
        `SELECT count(*)::int AS n, COALESCE(SUM(d.amount_cents), 0) AS v
           FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
          WHERE e.slug = $1 AND d.nucleo IS NULL AND d.direction = 'receber' AND d.status <> 'cancelado'`,
        [ENTITY]
      ),

      query<{ n: number; v: number }>(
        `SELECT count(*)::int AS n, COALESCE(SUM(d.amount_cents), 0) AS v
           FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
          WHERE e.slug = $1 AND d.counterparty_id IS NULL AND d.status <> 'cancelado'`,
        [ENTITY]
      ),

      query<{ n: number; v: number }>(
        `SELECT count(*)::int AS n, COALESCE(SUM(abs(t.amount_cents)), 0) AS v
           FROM fin_transaction t JOIN fin_entity e ON e.id = t.entity_id
          WHERE e.slug = $1 AND t.category_id IS NULL
            AND t.transfer_status = 'nao' AND NOT t.is_split_parent`,
        [ENTITY]
      ),

      query<{ slug: string; name: string; dias: number | null }>(
        `SELECT a.slug, a.name,
                CASE WHEN a.last_statement_at IS NULL THEN NULL
                     ELSE EXTRACT(DAY FROM now() - a.last_statement_at)::int END AS dias
           FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
          WHERE e.slug = $1 AND a.is_active AND a.kind <> 'emprestimo'
            AND (a.last_statement_at IS NULL OR a.last_statement_at < now() - interval '7 days')
          ORDER BY a.sort_order`,
        [ENTITY]
      ),

      // Saída que aconteceu sem ter sido planejada: é o componente do índice
      // que mede se a empresa sabe o que vai gastar antes de gastar.
      //
      // Tarifa bancária fica FORA. São 8.743 lançamentos de centavos que somam
      // R$ 11 mil no histórico — ninguém planeja tarifa de boleto, e deixá-las
      // aqui fazia a linha dizer "8.743 saídas não planejadas", número que
      // afoga a informação real (aluguel, folha, fornecedor) e ensina a ignorar
      // o painel. Mesma lógica para movimentação financeira neutra.
      query<{ n: number; v: number }>(
        `SELECT count(*)::int AS n, COALESCE(SUM(abs(t.amount_cents)), 0) AS v
           FROM fin_transaction t
           JOIN fin_entity e ON e.id = t.entity_id
           LEFT JOIN fin_category c ON c.id = t.category_id
          WHERE e.slug = $1 AND t.amount_cents < 0
            AND t.transfer_status = 'nao' AND NOT t.is_split_parent
            AND COALESCE(c.toc_class, '') <> 'neutro'
            AND COALESCE(c.code, '') <> '4.05'
            AND NOT EXISTS (SELECT 1 FROM fin_settlement s WHERE s.transaction_id = t.id)`,
        [ENTITY]
      )
    ]);

    return {
      disponivel: true,
      semCategoria: {
        n: semCategoria[0]?.n ?? 0,
        valorCents: semCategoria[0]?.v ?? 0,
        porContraparte: porContraparte.map((linha) => ({
          contraparteId: linha.contraparte_id,
          nome: linha.nome,
          n: linha.n,
          valorCents: linha.v,
          sugestao:
            linha.code && linha.cat_nome
              ? { code: linha.code, name: linha.cat_nome, share: Number(linha.share ?? 0) }
              : null
        }))
      },
      semNucleo: { n: semNucleo[0]?.n ?? 0, valorCents: semNucleo[0]?.v ?? 0 },
      semContraparte: { n: semContraparte[0]?.n ?? 0, valorCents: semContraparte[0]?.v ?? 0 },
      lancamentosSemCategoria: { n: lancamentos[0]?.n ?? 0, valorCents: lancamentos[0]?.v ?? 0 },
      contasSemExtrato: contas.map((linha) => ({ slug: linha.slug, nome: linha.name, diasSemExtrato: linha.dias })),
      pagaveisSemPlano: { n: pagaveis[0]?.n ?? 0, valorCents: pagaveis[0]?.v ?? 0 }
    };
  } catch (error) {
    console.error("[financeiro] qualificação indisponível:", error);
    return vazio;
  }
}
