import "server-only";

import { isFinanceConfigured, query, transaction } from "./db";

/**
 * Comissão declarada — a tela `/financeiro/comissoes`.
 *
 * NÃO confundir com `fin_comissao_prevista` (0076): aquela é % sobre contrato
 * de venda. Aqui é o que o financeiro AFIRMA que a pessoa recebe de variável
 * no mês (0165/0167), para separar do salário-base dentro do PIX misturado.
 *
 * Regras que não podem cair:
 *  · Várias linhas por pessoa×mês (somam) — cada uma com descrição.
 *  · Parcelada = série + N linhas ligadas; à vista = uma linha sem série.
 *  · `fin_time_remuneracao_mes_v` soma as declarações do mês (com teto no pago).
 *  · Não inventar valor: campo vazio volta null; descrição é obrigatória.
 */

const ENTITY = "xpe";
const MESES_MATRIZ = 12;

export type PessoaOpcao = {
  id: number;
  nome: string;
  vinculo: string;
  status: string;
  temSalarioBase: boolean;
};

export type ComissaoItem = {
  id: number;
  personId: number;
  pessoa: string;
  competencia: string;
  valorCents: number;
  descricao: string;
  nota: string | null;
  serieId: number | null;
  parcela: number | null;
  parcelasTotal: number | null;
};

export type ComissaoSerie = {
  id: number;
  personId: number;
  pessoa: string;
  descricao: string;
  totalCents: number;
  parcelasTotal: number;
  valorParcelaCents: number;
  primeiraCompetencia: string;
  nota: string | null;
  parcelasLancadas: number;
  /** Soma das parcelas com competência >= mês atual. */
  projetadoRestanteCents: number;
};

export type PainelComissoes = {
  disponivel: boolean;
  mesAtual: string;
  mesSeguinte: string;
  meses: string[];
  pessoas: PessoaOpcao[];
  itens: ComissaoItem[];
  series: ComissaoSerie[];
  totalPorMes: Record<string, number>;
  totalPorPessoa: Record<number, number>;
  totalGeralCents: number;
  projetadoProximoMesCents: number;
};

function vazio(): PainelComissoes {
  return {
    disponivel: false,
    mesAtual: "",
    mesSeguinte: "",
    meses: [],
    pessoas: [],
    itens: [],
    series: [],
    totalPorMes: {},
    totalPorPessoa: {},
    totalGeralCents: 0,
    projetadoProximoMesCents: 0
  };
}

function competenciaValida(valor: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-01)?$/.exec(valor);
  if (!m) return null;
  const n = Number(m[2]);
  if (n < 1 || n > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

function avancarMes(iso: string, n: number): string {
  const [ano, mes] = iso.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/** Divide total em N parcelas; a última absorve o resto dos centavos. */
export function repartirParcelas(totalCents: number, parcelas: number): number[] {
  if (parcelas < 1) return [];
  const base = Math.floor(totalCents / parcelas);
  const resto = totalCents - base * parcelas;
  return Array.from({ length: parcelas }, (_, i) => base + (i === parcelas - 1 ? resto : 0));
}

export async function getPainelComissoes(): Promise<PainelComissoes> {
  if (!isFinanceConfigured()) return vazio();

  try {
    const hoje = await query<{ mes_atual: string; mes_seguinte: string; mes_inicial: string }>(
      `SELECT to_char(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS mes_atual,
              to_char(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month', 'YYYY-MM-DD') AS mes_seguinte,
              to_char(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '${MESES_MATRIZ - 1} months', 'YYYY-MM-DD') AS mes_inicial`
    );
    const { mes_atual: mesAtual, mes_seguinte: mesSeguinte, mes_inicial: mesInicial } = hoje[0];

    const meses: string[] = [];
    {
      const [ano, mes] = mesInicial.slice(0, 7).split("-").map(Number);
      for (let i = 0; i < MESES_MATRIZ + 3; i += 1) {
        meses.push(avancarMes(`${ano}-${String(mes).padStart(2, "0")}-01`, i));
      }
    }

    const [pessoasRows, itensRows, seriesRows] = await Promise.all([
      query<{
        id: number;
        nome: string;
        vinculo: string;
        status: string;
        tem_base: boolean;
      }>(
        `SELECT p.id, p.name AS nome, p.employment_type AS vinculo, p.status,
                EXISTS (SELECT 1 FROM fin_pessoa_salario_base sb WHERE sb.person_id = p.id) AS tem_base
           FROM fin_person p
           JOIN fin_entity e ON e.id = p.entity_id
          WHERE e.slug = $1
          ORDER BY p.status DESC, p.name`,
        [ENTITY]
      ),
      query<{
        id: number;
        person_id: number;
        pessoa: string;
        competencia: string;
        valor_cents: number;
        descricao: string;
        nota: string | null;
        serie_id: number | null;
        parcela: number | null;
        parcelas_total: number | null;
      }>(
        `SELECT c.id, c.person_id, p.name AS pessoa,
                to_char(c.competencia, 'YYYY-MM-DD') AS competencia,
                c.valor_cents, c.descricao, c.nota, c.serie_id, c.parcela, c.parcelas_total
           FROM fin_pessoa_comissao_declarada c
           JOIN fin_person p ON p.id = c.person_id
           JOIN fin_entity e ON e.id = c.entity_id
          WHERE e.slug = $1
            AND c.competencia >= $2::date
            AND c.competencia <= ($3::date + interval '3 months')
          ORDER BY c.competencia DESC, p.name, c.id`,
        [ENTITY, mesInicial, mesAtual]
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
        parcelas_lancadas: number;
        projetado_restante: number;
      }>(
        `SELECT s.id, s.person_id, p.name AS pessoa, s.descricao, s.total_cents,
                s.parcelas_total, s.valor_parcela_cents,
                to_char(s.primeira_competencia, 'YYYY-MM-DD') AS primeira_competencia,
                s.nota,
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
          WHERE e.slug = $1
          ORDER BY s.primeira_competencia DESC, p.name`,
        [ENTITY]
      )
    ]);

    const totalPorMes: Record<string, number> = {};
    const totalPorPessoa: Record<number, number> = {};
    let totalGeralCents = 0;
    let projetadoProximoMesCents = 0;

    const itens: ComissaoItem[] = itensRows.map((r) => {
      const cents = Number(r.valor_cents);
      if (r.competencia >= mesInicial && r.competencia <= mesAtual) {
        totalPorMes[r.competencia] = (totalPorMes[r.competencia] ?? 0) + cents;
        totalPorPessoa[r.person_id] = (totalPorPessoa[r.person_id] ?? 0) + cents;
        totalGeralCents += cents;
      }
      if (r.competencia === mesSeguinte) projetadoProximoMesCents += cents;
      return {
        id: Number(r.id),
        personId: Number(r.person_id),
        pessoa: r.pessoa,
        competencia: r.competencia,
        valorCents: cents,
        descricao: r.descricao,
        nota: r.nota,
        serieId: r.serie_id != null ? Number(r.serie_id) : null,
        parcela: r.parcela,
        parcelasTotal: r.parcelas_total
      };
    });

    // Parcelas futuras já lançadas além do mesSeguinte entram no projetado do
    // mês seguinte só se competência = mesSeguinte (acima). Séries com saldo
    // restante aparecem no painel de séries.

    return {
      disponivel: true,
      mesAtual,
      mesSeguinte,
      meses,
      pessoas: pessoasRows.map((p) => ({
        id: Number(p.id),
        nome: p.nome,
        vinculo: p.vinculo,
        status: p.status,
        temSalarioBase: Boolean(p.tem_base)
      })),
      itens,
      series: seriesRows.map((s) => ({
        id: Number(s.id),
        personId: Number(s.person_id),
        pessoa: s.pessoa,
        descricao: s.descricao,
        totalCents: Number(s.total_cents),
        parcelasTotal: s.parcelas_total,
        valorParcelaCents: Number(s.valor_parcela_cents),
        primeiraCompetencia: s.primeira_competencia,
        nota: s.nota,
        parcelasLancadas: s.parcelas_lancadas,
        projetadoRestanteCents: Number(s.projetado_restante)
      })),
      totalPorMes,
      totalPorPessoa,
      totalGeralCents,
      projetadoProximoMesCents
    };
  } catch (error) {
    console.error("[financeiro] painel de comissões indisponível:", error);
    return vazio();
  }
}

export type NovaComissaoAvulsa = {
  personId: number;
  competencia: string;
  valorCents: number;
  descricao: string;
  nota?: string | null;
};

export type NovaComissaoParcelada = {
  personId: number;
  primeiraCompetencia: string;
  totalCents: number;
  parcelas: number;
  descricao: string;
  nota?: string | null;
};

export async function criarComissaoAvulsa(
  input: NovaComissaoAvulsa,
  ator: string
): Promise<{ ok: true; item: ComissaoItem } | { ok: false; status: number; error: string }> {
  const competencia = competenciaValida(input.competencia);
  if (!competencia) return { ok: false, status: 422, error: "competencia precisa ser AAAA-MM" };
  if (!Number.isInteger(input.valorCents) || input.valorCents <= 0) {
    return { ok: false, status: 422, error: "valorCents precisa ser inteiro positivo" };
  }
  const descricao = input.descricao?.trim();
  if (!descricao) return { ok: false, status: 422, error: "descricao é obrigatória — a que se refere?" };
  const nota = input.nota?.trim() || null;

  const pessoa = await query<{ entity_id: number; nome: string }>(
    `SELECT p.entity_id, p.name AS nome FROM fin_person p
       JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $1
      WHERE p.id = $2`,
    [ENTITY, input.personId]
  ).then((r) => r[0] ?? null);
  if (!pessoa) return { ok: false, status: 404, error: "pessoa não encontrada" };

  const batchId = crypto.randomUUID();
  const linha = await transaction(async (client) => {
    const { rows } = await client.query<{
      id: number;
      valor_cents: string;
      competencia: string;
      descricao: string;
      nota: string | null;
    }>(
      `INSERT INTO fin_pessoa_comissao_declarada
         (entity_id, person_id, competencia, valor_cents, descricao, nota)
       VALUES ($1, $2, $3::date, $4, $5, $6)
       RETURNING id, valor_cents, to_char(competencia, 'YYYY-MM-DD') AS competencia, descricao, nota`,
      [pessoa.entity_id, input.personId, competencia, input.valorCents, descricao, nota]
    );
    const g = rows[0];
    await client.query(
      `INSERT INTO fin_audit_log
          (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
       VALUES ($1, 'fin_pessoa_comissao_declarada', $2, 'insert', NULL, $3::jsonb, $4::text[], $5, $6)`,
      [
        pessoa.entity_id,
        g.id,
        JSON.stringify({
          valorCents: Number(g.valor_cents),
          competencia: g.competencia,
          descricao: g.descricao,
          nota: g.nota
        }),
        ["valor_cents", "competencia", "descricao", "nota"],
        batchId,
        ator
      ]
    );
    return g;
  });

  return {
    ok: true,
    item: {
      id: Number(linha.id),
      personId: input.personId,
      pessoa: pessoa.nome,
      competencia: linha.competencia,
      valorCents: Number(linha.valor_cents),
      descricao: linha.descricao,
      nota: linha.nota,
      serieId: null,
      parcela: null,
      parcelasTotal: null
    }
  };
}

export async function criarComissaoParcelada(
  input: NovaComissaoParcelada,
  ator: string
): Promise<{ ok: true; serieId: number; itens: number } | { ok: false; status: number; error: string }> {
  const primeira = competenciaValida(input.primeiraCompetencia);
  if (!primeira) return { ok: false, status: 422, error: "primeiraCompetencia precisa ser AAAA-MM" };
  if (!Number.isInteger(input.totalCents) || input.totalCents <= 0) {
    return { ok: false, status: 422, error: "totalCents precisa ser inteiro positivo" };
  }
  if (!Number.isInteger(input.parcelas) || input.parcelas < 2 || input.parcelas > 60) {
    return { ok: false, status: 422, error: "parcelas entre 2 e 60 (à vista use o modo avulso)" };
  }
  const descricao = input.descricao?.trim();
  if (!descricao) return { ok: false, status: 422, error: "descricao é obrigatória — a que se refere?" };
  const nota = input.nota?.trim() || null;

  const valores = repartirParcelas(input.totalCents, input.parcelas);
  const valorParcela = valores[0];

  const pessoa = await query<{ entity_id: number }>(
    `SELECT p.entity_id FROM fin_person p
       JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $1
      WHERE p.id = $2`,
    [ENTITY, input.personId]
  ).then((r) => r[0] ?? null);
  if (!pessoa) return { ok: false, status: 404, error: "pessoa não encontrada" };

  const batchId = crypto.randomUUID();
  const serieId = await transaction(async (client) => {
    const { rows: serieRows } = await client.query<{ id: number }>(
      `INSERT INTO fin_pessoa_comissao_serie
         (entity_id, person_id, descricao, total_cents, parcelas_total, valor_parcela_cents, primeira_competencia, nota)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8)
       RETURNING id`,
      [
        pessoa.entity_id,
        input.personId,
        descricao,
        input.totalCents,
        input.parcelas,
        valorParcela,
        primeira,
        nota
      ]
    );
    const sid = Number(serieRows[0].id);

    for (let i = 0; i < valores.length; i += 1) {
      const comp = avancarMes(primeira, i);
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO fin_pessoa_comissao_declarada
           (entity_id, person_id, competencia, valor_cents, descricao, nota, serie_id, parcela, parcelas_total)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          pessoa.entity_id,
          input.personId,
          comp,
          valores[i],
          `${descricao} (${i + 1}/${input.parcelas})`,
          nota,
          sid,
          i + 1,
          input.parcelas
        ]
      );
      await client.query(
        `INSERT INTO fin_audit_log
            (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
         VALUES ($1, 'fin_pessoa_comissao_declarada', $2, 'insert', NULL, $3::jsonb, $4::text[], $5, $6)`,
        [
          pessoa.entity_id,
          rows[0].id,
          JSON.stringify({
            serieId: sid,
            parcela: i + 1,
            valorCents: valores[i],
            competencia: comp,
            descricao
          }),
          ["serie_id", "valor_cents", "competencia", "descricao"],
          batchId,
          ator
        ]
      );
    }

    await client.query(
      `INSERT INTO fin_audit_log
          (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
       VALUES ($1, 'fin_pessoa_comissao_serie', $2, 'insert', NULL, $3::jsonb, $4::text[], $5, $6)`,
      [
        pessoa.entity_id,
        sid,
        JSON.stringify({
          descricao,
          totalCents: input.totalCents,
          parcelas: input.parcelas,
          primeiraCompetencia: primeira
        }),
        ["descricao", "total_cents", "parcelas_total"],
        batchId,
        ator
      ]
    );

    return sid;
  });

  return { ok: true, serieId, itens: valores.length };
}

export async function excluirComissaoItem(
  id: number,
  ator: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const linhas = await query<{
    id: number;
    entity_id: number;
    serie_id: number | null;
    valor_cents: number;
    descricao: string;
    competencia: string;
  }>(
    `SELECT id, entity_id, serie_id, valor_cents, descricao, to_char(competencia, 'YYYY-MM-DD') AS competencia
       FROM fin_pessoa_comissao_declarada WHERE id = $1`,
    [id]
  );
  const linha = linhas[0];
  if (!linha) return { ok: false, status: 404, error: "comissão não encontrada" };
  if (linha.serie_id != null) {
    return {
      ok: false,
      status: 409,
      error: "esta linha é parcela de uma série — exclua a série inteira"
    };
  }

  await transaction(async (client) => {
    await client.query(`DELETE FROM fin_pessoa_comissao_declarada WHERE id = $1`, [id]);
    await client.query(
      `INSERT INTO fin_audit_log
          (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
       VALUES ($1, 'fin_pessoa_comissao_declarada', $2, 'delete', $3::jsonb, NULL, $4::text[], $5, $6)`,
      [
        linha.entity_id,
        id,
        JSON.stringify({
          valorCents: Number(linha.valor_cents),
          competencia: linha.competencia,
          descricao: linha.descricao
        }),
        ["valor_cents", "competencia", "descricao"],
        crypto.randomUUID(),
        ator
      ]
    );
  });
  return { ok: true };
}

export async function excluirComissaoSerie(
  id: number,
  ator: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const linhas = await query<{ id: number; entity_id: number; descricao: string; total_cents: number }>(
    `SELECT id, entity_id, descricao, total_cents FROM fin_pessoa_comissao_serie WHERE id = $1`,
    [id]
  );
  const serie = linhas[0];
  if (!serie) return { ok: false, status: 404, error: "série não encontrada" };

  await transaction(async (client) => {
    // CASCADE nas parcelas.
    await client.query(`DELETE FROM fin_pessoa_comissao_serie WHERE id = $1`, [id]);
    await client.query(
      `INSERT INTO fin_audit_log
          (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
       VALUES ($1, 'fin_pessoa_comissao_serie', $2, 'delete', $3::jsonb, NULL, $4::text[], $5, $6)`,
      [
        serie.entity_id,
        id,
        JSON.stringify({ descricao: serie.descricao, totalCents: Number(serie.total_cents) }),
        ["descricao", "total_cents"],
        crypto.randomUUID(),
        ator
      ]
    );
  });
  return { ok: true };
}
