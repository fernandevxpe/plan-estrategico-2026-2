import "server-only";

import {
  type FormaPagamento,
  type ParcelaCronograma,
  montarCronograma,
  normalizarCompetencia
} from "./comissao-cronograma";
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

/** Um dos seis tipos curados (0178), já resolvido até o componente da DRE. */
export type TipoComissao = {
  slug: string;
  nome: string;
  componentSlug: string;
  ordem: number;
};

export type ComissaoItem = {
  id: number;
  personId: number;
  pessoa: string;
  competencia: string;
  valorCents: number;
  descricao: string;
  nota: string | null;
  tipoSlug: string | null;
  tipoNome: string | null;
  cliente: string | null;
  serieId: number | null;
  parcela: number | null;
  parcelasTotal: number | null;
  /** Parcela 1 de uma série que tem entrada — o valor difere das demais. */
  ehEntrada: boolean;
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
  tipoSlug: string | null;
  tipoNome: string | null;
  cliente: string | null;
  entradaCents: number;
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
  tipos: TipoComissao[];
  itens: ComissaoItem[];
  series: ComissaoSerie[];
  totalPorMes: Record<string, number>;
  totalPorPessoa: Record<number, number>;
  /** Chave = slug do tipo; `"sem_tipo"` junta o que é anterior à 0178. */
  totalPorTipo: Record<string, number>;
  totalGeralCents: number;
  projetadoProximoMesCents: number;
  /**
   * O número que o cadastro existe para produzir: tudo que já está lançado com
   * competência do mês atual em diante — o compromisso de comissão que ainda
   * não saiu do caixa. Inclui as parcelas futuras das séries.
   */
  aReceberCents: number;
  /** O mesmo, aberto por mês, para a projeção da tela. */
  aReceberPorMes: Record<string, number>;
};

function vazio(): PainelComissoes {
  return {
    disponivel: false,
    mesAtual: "",
    mesSeguinte: "",
    meses: [],
    pessoas: [],
    tipos: [],
    itens: [],
    series: [],
    totalPorMes: {},
    totalPorPessoa: {},
    totalPorTipo: {},
    totalGeralCents: 0,
    projetadoProximoMesCents: 0,
    aReceberCents: 0,
    aReceberPorMes: {}
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

    const [pessoasRows, itensRows, seriesRows, tiposRows] = await Promise.all([
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
        tipo_slug: string | null;
        tipo_nome: string | null;
        cliente: string | null;
        eh_entrada: boolean;
      }>(
        // A janela vai a 24 meses à frente, não a 3: uma comissão parcelada em
        // 12× lançada hoje só é "a receber" se as 12 parcelas couberem na
        // consulta. A matriz continua desenhando só `mesesVisiveis` — quem usa
        // a cauda longa é o total a receber.
        `SELECT c.id, c.person_id, p.name AS pessoa,
                to_char(c.competencia, 'YYYY-MM-DD') AS competencia,
                c.valor_cents, c.descricao, c.nota, c.serie_id, c.parcela, c.parcelas_total,
                c.tipo_slug, t.nome AS tipo_nome, c.cliente,
                (c.parcela = 1 AND COALESCE(s.entrada_cents, 0) > 0) AS eh_entrada
           FROM fin_pessoa_comissao_declarada c
           JOIN fin_person p ON p.id = c.person_id
           JOIN fin_entity e ON e.id = c.entity_id
           LEFT JOIN fin_comissao_tipo t ON t.slug = c.tipo_slug
           LEFT JOIN fin_pessoa_comissao_serie s ON s.id = c.serie_id
          WHERE e.slug = $1
            AND c.competencia >= $2::date
            AND c.competencia <= ($3::date + interval '24 months')
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
          WHERE e.slug = $1
          ORDER BY s.primeira_competencia DESC, p.name`,
        [ENTITY]
      ),
      query<{ slug: string; nome: string; component_slug: string; ordem: number }>(
        `SELECT slug, nome, component_slug, ordem FROM fin_comissao_tipo
          WHERE ativo ORDER BY ordem, nome`
      )
    ]);

    const totalPorMes: Record<string, number> = {};
    const totalPorPessoa: Record<number, number> = {};
    const totalPorTipo: Record<string, number> = {};
    const aReceberPorMes: Record<string, number> = {};
    let totalGeralCents = 0;
    let projetadoProximoMesCents = 0;
    let aReceberCents = 0;

    const itens: ComissaoItem[] = itensRows.map((r) => {
      const cents = Number(r.valor_cents);
      if (r.competencia >= mesInicial && r.competencia <= mesAtual) {
        totalPorMes[r.competencia] = (totalPorMes[r.competencia] ?? 0) + cents;
        totalPorPessoa[r.person_id] = (totalPorPessoa[r.person_id] ?? 0) + cents;
        totalGeralCents += cents;
      }
      if (r.competencia === mesSeguinte) projetadoProximoMesCents += cents;
      // A RECEBER é o compromisso ainda não pago: competência do mês atual em
      // diante, incluindo a cauda das séries. É o número que o cadastro existe
      // para produzir, e por isso ele NÃO se limita à janela da matriz.
      if (r.competencia >= mesAtual) {
        aReceberCents += cents;
        aReceberPorMes[r.competencia] = (aReceberPorMes[r.competencia] ?? 0) + cents;
      }
      // "sem_tipo" é onde ficam as linhas anteriores à 0178. Some sozinho
      // conforme forem recebendo tipo; enquanto existir, é lacuna visível.
      const chaveTipo = r.tipo_slug ?? "sem_tipo";
      totalPorTipo[chaveTipo] = (totalPorTipo[chaveTipo] ?? 0) + cents;
      return {
        id: Number(r.id),
        personId: Number(r.person_id),
        pessoa: r.pessoa,
        competencia: r.competencia,
        valorCents: cents,
        descricao: r.descricao,
        nota: r.nota,
        tipoSlug: r.tipo_slug,
        tipoNome: r.tipo_nome,
        cliente: r.cliente,
        serieId: r.serie_id != null ? Number(r.serie_id) : null,
        parcela: r.parcela,
        parcelasTotal: r.parcelas_total,
        ehEntrada: Boolean(r.eh_entrada)
      };
    });

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
      tipos: tiposRows.map((t) => ({
        slug: t.slug,
        nome: t.nome,
        componentSlug: t.component_slug,
        ordem: t.ordem
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
        tipoSlug: s.tipo_slug,
        tipoNome: s.tipo_nome,
        cliente: s.cliente,
        entradaCents: Number(s.entrada_cents ?? 0),
        parcelasLancadas: s.parcelas_lancadas,
        projetadoRestanteCents: Number(s.projetado_restante)
      })),
      totalPorMes,
      totalPorPessoa,
      totalPorTipo,
      totalGeralCents,
      projetadoProximoMesCents,
      aReceberCents,
      aReceberPorMes
    };
  } catch (error) {
    console.error("[financeiro] painel de comissões indisponível:", error);
    return vazio();
  }
}

export type NovaComissao = {
  personId: number;
  /** Um dos seis tipos curados (0178). Opcional: linha sem tipo é legítima. */
  tipoSlug?: string | null;
  /** Cliente/obra a que a comissão se refere. Texto livre. */
  cliente?: string | null;
  descricao?: string | null;
  nota?: string | null;
  forma: FormaPagamento;
  /** Valor CHEIO da comissão — nunca o da parcela. */
  totalCents: number;
  /** Em `parcelada`, o total de parcelas; em `entrada_parcelas`, quantas DEPOIS da entrada. */
  parcelas?: number;
  entradaCents?: number;
  primeiraCompetencia: string;
};

/** Compatibilidade: o chip do perfil só lança à vista. */
export type NovaComissaoAvulsa = {
  personId: number;
  competencia: string;
  valorCents: number;
  descricao: string;
  nota?: string | null;
  tipoSlug?: string | null;
  cliente?: string | null;
};

export type ResultadoComissao = {
  serieId: number | null;
  cronograma: ParcelaCronograma[];
  totalCents: number;
};

/**
 * Cadastra uma comissão — à vista, parcelada, ou entrada + parcelas.
 *
 * UMA função para as três formas, porque o cronograma é o mesmo objeto nos três
 * casos: à vista é um cronograma de uma linha só. Enquanto eram duas funções
 * (0167), "entrada + parcelas" não tinha onde existir sem inventar a terceira.
 *
 * O cronograma sai de `montarCronograma`, a MESMA função que a tela chama para
 * desenhar a prévia. É isso que garante que o parcelamento mostrado antes de
 * salvar é exatamente o que ficou gravado — e não duas contas parecidas.
 */
export async function criarComissao(
  input: NovaComissao,
  ator: string
): Promise<{ ok: true; resultado: ResultadoComissao } | { ok: false; status: number; error: string }> {
  const plano = montarCronograma({
    totalCents: input.totalCents,
    forma: input.forma,
    parcelas: input.parcelas ?? 1,
    entradaCents: input.entradaCents ?? 0,
    primeiraCompetencia: input.primeiraCompetencia
  });
  if (!plano.ok) return { ok: false, status: 422, error: plano.erro };
  const cronograma = plano.parcelas;

  const pessoa = await query<{ entity_id: number; nome: string }>(
    `SELECT p.entity_id, p.name AS nome FROM fin_person p
       JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $1
      WHERE p.id = $2`,
    [ENTITY, input.personId]
  ).then((r) => r[0] ?? null);
  if (!pessoa) return { ok: false, status: 404, error: "pessoa não encontrada" };

  // O tipo é conferido aqui só para a mensagem sair legível. A FK do banco é a
  // garantia de verdade; esta consulta é a cortesia.
  const tipoSlug = input.tipoSlug?.trim() || null;
  if (tipoSlug) {
    const existe = await query<{ slug: string }>(
      `SELECT slug FROM fin_comissao_tipo WHERE slug = $1 AND ativo`,
      [tipoSlug]
    );
    if (!existe.length) return { ok: false, status: 422, error: `tipo de comissão "${tipoSlug}" não existe` };
  }

  const cliente = input.cliente?.trim() || null;
  const nota = input.nota?.trim() || null;
  // Descrição nunca barra o lançamento (0177): o servidor gera uma quando falta.
  const descricao =
    input.descricao?.trim() ||
    (cliente ? `Comissão — ${cliente}` : input.totalCents === 0 ? "Sem comissão no mês" : "Comissão");

  const batchId = crypto.randomUUID();
  const primeira = normalizarCompetencia(input.primeiraCompetencia) as string;

  const serieId = await transaction(async (client) => {
    let sid: number | null = null;

    // À vista não cria série: uma linha solta é mais simples de excluir e de
    // ler, e não há cronograma a guardar.
    if (cronograma.length > 1) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO fin_pessoa_comissao_serie
           (entity_id, person_id, descricao, total_cents, parcelas_total, valor_parcela_cents,
            primeira_competencia, nota, tipo_slug, cliente, entrada_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11)
         RETURNING id`,
        [
          pessoa.entity_id,
          input.personId,
          descricao,
          input.totalCents,
          cronograma.length,
          // A parcela de referência é a primeira que NÃO é entrada: é ela que
          // se repete, e é o número que a tela mostra como "3× de".
          cronograma.find((p) => !p.ehEntrada)?.valorCents ?? cronograma[0].valorCents,
          primeira,
          nota,
          tipoSlug,
          cliente,
          input.forma === "entrada_parcelas" ? (input.entradaCents ?? 0) : 0
        ]
      );
      sid = Number(rows[0].id);
      await client.query(
        `INSERT INTO fin_audit_log
            (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
         VALUES ($1, 'fin_pessoa_comissao_serie', $2, 'insert', NULL, $3::jsonb, $4::text[], $5, $6)`,
        [
          pessoa.entity_id,
          sid,
          JSON.stringify({
            descricao,
            tipoSlug,
            cliente,
            forma: input.forma,
            totalCents: input.totalCents,
            entradaCents: input.entradaCents ?? 0,
            parcelas: cronograma.length,
            primeiraCompetencia: primeira
          }),
          ["descricao", "total_cents", "parcelas_total", "tipo_slug", "cliente", "entrada_cents"],
          batchId,
          ator
        ]
      );
    }

    for (const parcela of cronograma) {
      const sufixo =
        cronograma.length === 1
          ? ""
          : parcela.ehEntrada
            ? " (entrada)"
            : ` (${parcela.parcela}/${parcela.parcelasTotal})`;
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO fin_pessoa_comissao_declarada
           (entity_id, person_id, competencia, valor_cents, descricao, nota,
            serie_id, parcela, parcelas_total, tipo_slug, cliente)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          pessoa.entity_id,
          input.personId,
          parcela.competencia,
          parcela.valorCents,
          `${descricao}${sufixo}`,
          nota,
          sid,
          sid ? parcela.parcela : null,
          sid ? parcela.parcelasTotal : null,
          tipoSlug,
          cliente
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
            valorCents: parcela.valorCents,
            competencia: parcela.competencia,
            descricao,
            tipoSlug,
            cliente,
            serieId: sid,
            parcela: sid ? parcela.parcela : null,
            ehEntrada: parcela.ehEntrada
          }),
          ["valor_cents", "competencia", "descricao", "tipo_slug", "cliente", "serie_id"],
          batchId,
          ator
        ]
      );
    }

    return sid;
  });

  return { ok: true, resultado: { serieId, cronograma, totalCents: input.totalCents } };
}

/** Atalho do chip do perfil: uma comissão à vista, num mês. */
export async function criarComissaoAvulsa(
  input: NovaComissaoAvulsa,
  ator: string
): Promise<{ ok: true; resultado: ResultadoComissao } | { ok: false; status: number; error: string }> {
  return criarComissao(
    {
      personId: input.personId,
      forma: "avista",
      totalCents: input.valorCents,
      primeiraCompetencia: input.competencia,
      descricao: input.descricao,
      nota: input.nota,
      tipoSlug: input.tipoSlug,
      cliente: input.cliente
    },
    ator
  );
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
