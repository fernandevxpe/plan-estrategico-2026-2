import "server-only";

import { query } from "@/lib/financeiro/db";

const ENTITY = "xpe";

function formatarWhatsappPerfil(stored: string | null): string | null {
  if (!stored) return null;
  const d = stored.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return stored;
}

function formatarCpfPerfil(stored: string | null): string | null {
  if (!stored) return null;
  const d = stored.replace(/\D/g, "");
  if (d.length !== 11) return stored;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * O perfil financeiro de UMA pessoa: quanto recebeu, de quê, por onde, e para
 * onde vai o dinheiro dela daqui para frente.
 *
 * ---------------------------------------------------------------------------
 * ELE NÃO GUARDA NADA — E ISSO É O PONTO
 * ---------------------------------------------------------------------------
 * O pedido foi "histórico de salário, comissão, extras, reembolso, tudo por
 * pessoa, para rastrear e prever". A resposta óbvia seria criar tabelas. Seria
 * errado: cada um desses pagamentos já é uma linha de `fin_transaction`, ligada
 * à pessoa por `fin_person.counterparty_id` — preenchido nas 26 pessoas ativas.
 *
 * Guardar de novo criaria duas verdades sobre o mesmo pagamento, e a cópia
 * envelheceria em silêncio na primeira correção feita no ledger.
 *
 * O único dado NOVO é para onde pagar (`fin_person_pagamento`, 0159), porque
 * esse a casa realmente não tinha em lugar nenhum — vinha de conversa.
 *
 * ---------------------------------------------------------------------------
 * SOBRE A PREVISÃO
 * ---------------------------------------------------------------------------
 * `mediaRecorrenteCents` usa a MEDIANA dos meses com pagamento recorrente, não
 * a média. Medido no Fernando: os oito meses vão de R$ 2.386 a R$ 7.644, e a
 * média é puxada pelos extremos. A mediana responde melhor "quanto costuma
 * sair", que é a pergunta de quem programa o mês seguinte.
 *
 * E ela cobre só salário, pró-labore e estágio: comissão varia com venda e
 * reembolso é devolução, não remuneração. Somar os três daria um número maior
 * e menos útil.
 *
 * ---------------------------------------------------------------------------
 * POR QUE "POR MÊS" E "POR NATUREZA" NÃO VÊM MAIS DE `fin_pessoa_remuneracao_v`
 * ---------------------------------------------------------------------------
 * Aquela view (0160) classifica cada TRANSAÇÃO pela própria categoria — não
 * sabe nada de salário-base nem de comissão declarada (0164/0165). Antes desta
 * mudança, esta tela mostrava o pró-labore do Fernando inteiro sem separar o
 * salário, e a Audrey (que recebe tudo no mesmo PIX) apareceria com "salário"
 * = o PIX inteiro, sem comissão nem reembolso separados — dois números que
 * DIVERGIRIAM do que a pessoa vê em Meu Perfil no app do time, que já usa
 * `fin_time_remuneracao_mes_v`.
 *
 * A régua da casa é: o que o admin vê tem de ser 100% a mesma conta que a
 * pessoa vê na própria tela. Por isso "por mês" e "por natureza" agora somam
 * `fin_time_remuneracao_mes_v` — a mesma view, a mesma fonte. `pagamentos`
 * continua vindo de `fin_pessoa_remuneracao_v`: é o extrato bruto, linha a
 * linha, útil para conferir "de qual conta saiu" — não precisa (e não deveria)
 * saber separar natureza.
 */

export type PagamentoPessoa = {
  transactionId: number;
  data: string;
  mes: string;
  valorCents: number;
  natureza: string;
  categoria: string | null;
  conta: string;
  descricao: string;
};

export type ContaDaPessoa = {
  metodo: string;
  pixTipo: string | null;
  pixChave: string | null;
  bancoNome: string | null;
  agencia: string | null;
  conta: string | null;
  titularEhAPessoa: boolean;
  titularNome: string | null;
  titularDocumento: string | null;
  recebeSalario: boolean;
  recebeReembolso: boolean;
  observacao: string | null;
  conferidoEm: string | null;
  atualizadoEm: string | null;
} | null;

export type SalarioBaseLinha = { id: number; valorCents: number; vigenteDesde: string; nota: string | null };
export type ProlaboreEsperadoLinha = { id: number; valorCents: number; vigenteDesde: string; nota: string | null };
export type ComissaoDeclaradaLinha = {
  id: number;
  valorCents: number;
  competencia: string;
  descricao: string;
  nota: string | null;
  tipoSlug: string | null;
  tipoNome: string | null;
};

/**
 * Série parcelada em `fin_reembolso_saldo_unificado_v` (0179) — o que falta e o
 * que já caiu, da planilha E do app.
 *
 * Era `fin_reembolso_saldo_v`, que só conhece a planilha: um reembolso pedido
 * pelo aplicativo aparecia para a pessoa no /time e sumia aqui, para quem paga.
 */
export type ReembolsoSerie = {
  slug: string;
  descricao: string;
  categoria: string | null;
  parcela: number;
  parcelasTotal: number;
  parcelasRestantes: number;
  valorParcelaCents: number;
  /** Já pago = parcela × valor (última parcela vista). */
  pagoCents: number;
  saldoCents: number;
  quitado: boolean;
  ultimaCompetencia: string;
  /** Primeira competência da série na planilha. */
  desde: string | null;
  /** Data do primeiro registro em `fin_reembolso_item`. */
  cadastradoEm: string | null;
};

/** Pedido mensal em `fin_reimbursement` (fluxo rascunho → pago). */
export type ReembolsoPedido = {
  id: number;
  mes: string;
  status: string;
  totalCents: number;
  cadastradoEm: string;
};

export type PerfilPessoa = {
  id: number;
  nome: string;
  email: string | null;
  cpf: string | null;
  cnpj: string | null;
  vinculo: string | null;
  area: string | null;
  papel: string | null;
  status: string;
  desde: string | null;
  admin: boolean;
  whatsapp: string | null;
  dataNascimento: string | null;
  conta: ContaDaPessoa;
  totalCents: number;
  porNatureza: { natureza: string; cents: number; n: number }[];
  porMes: { mes: string; cents: number; porNatureza: Record<string, number> }[];
  porConta: { conta: string; cents: number; n: number }[];
  mediaRecorrenteCents: number;
  ultimoPagamento: string | null;
  reembolsoAbertoCents: number;
  /**
   * Reembolso previsto para o mês seguinte (parcelas restantes >= 1).
   * Isso é "o que ainda falta cair" de cada série, sem chute de avulsos.
   */
  reembolsoPrevistoProximoMesCents: number;
  /** Séries cadastradas (abertas e quitadas recentes). */
  reembolsoSeries: ReembolsoSerie[];
  /** Pedidos mensais (fin_reimbursement) — status e total. */
  reembolsoPedidos: ReembolsoPedido[];
  pagamentos: PagamentoPessoa[];
  salarioBaseAtual: SalarioBaseLinha | null;
  salarioBaseHistorico: SalarioBaseLinha[];
  prolaboreEsperadoAtual: ProlaboreEsperadoLinha | null;
  prolaboreEsperadoHistorico: ProlaboreEsperadoLinha[];
  comissaoDeclarada: ComissaoDeclaradaLinha[];
};

/** As naturezas que se repetem todo mês — a base da previsão. */
const RECORRENTES = new Set(["salario", "prolabore", "estagio"]);

export async function getPerfilPessoa(personId: number): Promise<PerfilPessoa | null> {
  const [pessoa] = await query<Record<string, unknown>>(
    `SELECT p.id, p.name, p.email, p.cpf, p.cnpj, p.employment_type, p.area, p.role,
            p.status, p.start_date, p.is_admin, p.whatsapp,
            to_char(p.birth_date, 'YYYY-MM-DD') AS birth_date
       FROM fin_person p
       JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $1
      WHERE p.id = $2`,
    [ENTITY, personId]
  );
  if (!pessoa) return null;

  const [pagamentos, conta, saldo, bandas, salarioBase, prolaboreEsperado, comissaoDeclarada, reembolsoPedidosRows] =
    await Promise.all([
    query<Record<string, unknown>>(
      `SELECT transaction_id, data, to_char(mes, 'YYYY-MM') AS mes, valor_cents,
              natureza, categoria, conta, descricao
         FROM fin_pessoa_remuneracao_v
        WHERE person_id = $1
        ORDER BY data DESC, transaction_id DESC`,
      [personId]
    ),
    query<Record<string, unknown>>(
      `SELECT metodo, pix_tipo, pix_chave, banco_nome, agencia, conta, conta_tipo,
              titular_e_a_pessoa, titular_nome, titular_documento,
              recebe_salario, recebe_reembolso, observacao, conferido_em, atualizado_em
         FROM fin_person_pagamento WHERE person_id = $1`,
      [personId]
    ).catch(() => []),
    query<{
      slug: string;
      descricao: string;
      categoria_livre: string | null;
      valor_parcela_cents: string | number;
      parcela: string | number;
      parcelas_total: string | number;
      parcelas_restantes: string | number;
      saldo_cents: string | number;
      quitado: boolean;
      ultima_competencia: string;
      desde: string | null;
      cadastrado_em: string | null;
    }>(
      `SELECT s.slug, s.descricao, s.categoria_livre,
              s.valor_parcela_cents, s.parcela, s.parcelas_total, s.parcelas_restantes,
              s.saldo_cents, s.quitado,
              to_char(s.ultima_competencia, 'YYYY-MM') AS ultima_competencia,
              (SELECT to_char(min(i.competencia), 'YYYY-MM')
                 FROM fin_reembolso_item i
                WHERE i.person_id = s.person_id AND i.slug = s.slug) AS desde,
              (SELECT to_char(min(i.criado_em), 'YYYY-MM-DD')
                 FROM fin_reembolso_item i
                WHERE i.person_id = s.person_id AND i.slug = s.slug) AS cadastrado_em
         FROM fin_reembolso_saldo_unificado_v s
        WHERE s.person_id = $1
        ORDER BY s.quitado ASC, s.saldo_cents DESC, s.descricao`,
      [personId]
    ).catch(() => []),
    // A MESMA view que /time/perfil usa — ver o comentário no topo do arquivo.
    query<{ mes: string; natureza: string; valor_cents: string }>(
      `SELECT to_char(mes, 'YYYY-MM') AS mes, natureza, valor_cents
         FROM fin_time_remuneracao_mes_v
        WHERE person_id = $1
        ORDER BY mes`,
      [personId]
    ),
    query<{ id: number; valor_cents: string; vigente_desde: string; nota: string | null }>(
      `SELECT id, valor_cents, to_char(vigente_desde, 'YYYY-MM-DD') AS vigente_desde, nota
         FROM fin_pessoa_salario_base WHERE person_id = $1 ORDER BY vigente_desde DESC`,
      [personId]
    ),
    query<{ id: number; valor_cents: string; vigente_desde: string; nota: string | null }>(
      `SELECT id, valor_cents, to_char(vigente_desde, 'YYYY-MM-DD') AS vigente_desde, nota
         FROM fin_pessoa_prolabore_esperado WHERE person_id = $1 ORDER BY vigente_desde DESC`,
      [personId]
    ).catch(() => []),
    query<{
      id: number;
      valor_cents: string;
      competencia: string;
      descricao: string;
      nota: string | null;
      tipo_slug: string | null;
      tipo_nome: string | null;
    }>(
      `SELECT cd.id, cd.valor_cents, to_char(cd.competencia, 'YYYY-MM') AS competencia,
              cd.descricao, cd.nota, cd.tipo_slug, t.nome AS tipo_nome
         FROM fin_pessoa_comissao_declarada cd
         LEFT JOIN fin_comissao_tipo t ON t.slug = cd.tipo_slug
        WHERE cd.person_id = $1
        ORDER BY cd.competencia DESC, cd.id DESC`,
      [personId]
    ),
    query<{ id: number; mes: string; status: string; total_cents: string; cadastrado_em: string }>(
      `SELECT id, to_char(reference_month, 'YYYY-MM') AS mes, status, total_cents,
              to_char(created_at, 'YYYY-MM-DD') AS cadastrado_em
         FROM fin_reimbursement
        WHERE person_id = $1
        ORDER BY reference_month DESC`,
      [personId]
    ).catch(() => [])
  ]);

  const linhas: PagamentoPessoa[] = pagamentos.map((l) => ({
    transactionId: Number(l.transaction_id),
    data: String(l.data).slice(0, 10),
    mes: String(l.mes),
    valorCents: Number(l.valor_cents),
    natureza: String(l.natureza),
    categoria: (l.categoria as string) ?? null,
    conta: String(l.conta),
    descricao: String(l.descricao ?? "")
  }));

  const somarPagamentos = <T extends string>(chave: (p: PagamentoPessoa) => T) => {
    const m = new Map<T, { cents: number; n: number }>();
    for (const p of linhas) {
      const k = chave(p);
      const a = m.get(k) ?? { cents: 0, n: 0 };
      m.set(k, { cents: a.cents + p.valorCents, n: a.n + 1 });
    }
    return [...m.entries()].sort((a, b) => b[1].cents - a[1].cents);
  };

  // "Por natureza" e "por mês" vêm das BANDAS (fin_time_remuneracao_mes_v),
  // não do extrato bruto — é o que faz este número bater com o app do time.
  const natMap = new Map<string, { cents: number; n: number }>();
  const mesMap = new Map<string, { cents: number; porNatureza: Record<string, number> }>();
  for (const b of bandas) {
    const cents = Number(b.valor_cents);
    const a = natMap.get(b.natureza) ?? { cents: 0, n: 0 };
    natMap.set(b.natureza, { cents: a.cents + cents, n: a.n + 1 });

    const m = mesMap.get(b.mes) ?? { cents: 0, porNatureza: {} };
    m.cents += cents;
    m.porNatureza[b.natureza] = (m.porNatureza[b.natureza] ?? 0) + cents;
    mesMap.set(b.mes, m);
  }
  const porNatureza = [...natMap.entries()]
    .sort((a, b) => b[1].cents - a[1].cents)
    .map(([natureza, v]) => ({ natureza, ...v }));
  const porMes = [...mesMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mes, v]) => ({ mes, ...v }));
  const totalBandasCents = bandas.reduce((s, b) => s + Number(b.valor_cents), 0);

  // A mediana dos meses recorrentes. Com número par de meses, a média dos dois
  // do meio — o padrão, e o que evita saltar para um dos extremos.
  const recorrentePorMes = porMes
    .map((m) =>
      Object.entries(m.porNatureza)
        .filter(([nat]) => RECORRENTES.has(nat))
        .reduce((s, [, v]) => s + v, 0)
    )
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const meio = Math.floor(recorrentePorMes.length / 2);
  const mediaRecorrenteCents =
    recorrentePorMes.length === 0
      ? 0
      : recorrentePorMes.length % 2
        ? recorrentePorMes[meio]
        : Math.round((recorrentePorMes[meio - 1] + recorrentePorMes[meio]) / 2);

  const c = conta[0];
  const reembolsoSeries: ReembolsoSerie[] = saldo.map((r) => {
    const parcela = Number(r.parcela);
    const parcelasTotal = Number(r.parcelas_total);
    const valorParcela = Number(r.valor_parcela_cents);
    const restantes = Number(r.parcelas_restantes);
    return {
      slug: r.slug,
      descricao: r.descricao,
      categoria: r.categoria_livre,
      parcela,
      parcelasTotal,
      parcelasRestantes: restantes,
      valorParcelaCents: valorParcela,
      pagoCents: parcela * valorParcela,
      saldoCents: Number(r.saldo_cents),
      quitado: Boolean(r.quitado),
      ultimaCompetencia: r.ultima_competencia,
      desde: r.desde,
      cadastradoEm: r.cadastrado_em
    };
  });
  const reembolsoAbertoCents = reembolsoSeries
    .filter((s) => !s.quitado)
    .reduce((t, s) => t + s.saldoCents, 0);
  const reembolsoPrevistoProximoMesCents = reembolsoSeries
    .filter((s) => !s.quitado && s.parcelasRestantes >= 1)
    .reduce((t, s) => t + s.valorParcelaCents, 0);
  const reembolsoPedidos: ReembolsoPedido[] = reembolsoPedidosRows.map((r) => ({
    id: Number(r.id),
    mes: r.mes,
    status: r.status,
    totalCents: Number(r.total_cents),
    cadastradoEm: r.cadastrado_em
  }));
  return {
    id: Number(pessoa.id),
    nome: String(pessoa.name),
    email: (pessoa.email as string) ?? null,
    cpf: formatarCpfPerfil((pessoa.cpf as string) ?? null),
    cnpj: (pessoa.cnpj as string) ?? null,
    vinculo: (pessoa.employment_type as string) ?? null,
    area: (pessoa.area as string) ?? null,
    papel: (pessoa.role as string) ?? null,
    status: String(pessoa.status),
    desde: pessoa.start_date ? String(pessoa.start_date).slice(0, 10) : null,
    admin: Boolean(pessoa.is_admin),
    whatsapp: formatarWhatsappPerfil((pessoa.whatsapp as string) ?? null),
    dataNascimento: pessoa.birth_date ? String(pessoa.birth_date).slice(0, 10) : null,
    conta: c
      ? {
          metodo: String(c.metodo),
          pixTipo: (c.pix_tipo as string) ?? null,
          pixChave: (c.pix_chave as string) ?? null,
          bancoNome: (c.banco_nome as string) ?? null,
          agencia: (c.agencia as string) ?? null,
          conta: (c.conta as string) ?? null,
          titularEhAPessoa: Boolean(c.titular_e_a_pessoa),
          titularNome: (c.titular_nome as string) ?? null,
          titularDocumento: (c.titular_documento as string) ?? null,
          recebeSalario: Boolean(c.recebe_salario),
          recebeReembolso: Boolean(c.recebe_reembolso),
          observacao: (c.observacao as string) ?? null,
          conferidoEm: c.conferido_em ? new Date(c.conferido_em as string).toISOString() : null,
          atualizadoEm: c.atualizado_em ? new Date(c.atualizado_em as string).toISOString() : null
        }
      : null,
    totalCents: totalBandasCents,
    porNatureza,
    porMes,
    porConta: somarPagamentos((p) => p.conta).map(([conta, v]) => ({ conta, ...v })),
    mediaRecorrenteCents,
    ultimoPagamento: linhas[0]?.data ?? null,
    reembolsoAbertoCents,
    reembolsoPrevistoProximoMesCents,
    reembolsoSeries,
    reembolsoPedidos,
    pagamentos: linhas.slice(0, 200),
    salarioBaseAtual: salarioBase[0]
      ? { id: salarioBase[0].id, valorCents: Number(salarioBase[0].valor_cents), vigenteDesde: salarioBase[0].vigente_desde, nota: salarioBase[0].nota }
      : null,
    salarioBaseHistorico: salarioBase.map((s) => ({
      id: s.id,
      valorCents: Number(s.valor_cents),
      vigenteDesde: s.vigente_desde,
      nota: s.nota
    })),
    prolaboreEsperadoAtual: prolaboreEsperado[0]
      ? {
          id: prolaboreEsperado[0].id,
          valorCents: Number(prolaboreEsperado[0].valor_cents),
          vigenteDesde: prolaboreEsperado[0].vigente_desde,
          nota: prolaboreEsperado[0].nota
        }
      : null,
    prolaboreEsperadoHistorico: prolaboreEsperado.map((p) => ({
      id: p.id,
      valorCents: Number(p.valor_cents),
      vigenteDesde: p.vigente_desde,
      nota: p.nota
    })),
    comissaoDeclarada: comissaoDeclarada.map((c) => ({
      id: c.id,
      valorCents: Number(c.valor_cents),
      competencia: c.competencia,
      descricao: c.descricao,
      nota: c.nota,
      tipoSlug: c.tipo_slug,
      tipoNome: c.tipo_nome
    }))
  };
}

/** A lista para escolher de quem ver o perfil. */
export async function listarPessoasComResumo(): Promise<
  { id: number; nome: string; status: string; vinculo: string | null; totalCents: number; temConta: boolean }[]
> {
  const linhas = await query<Record<string, unknown>>(
    `SELECT p.id, p.name, p.status, p.employment_type,
            coalesce((SELECT sum(r.valor_cents) FROM fin_pessoa_remuneracao_v r WHERE r.person_id = p.id), 0) AS total,
            EXISTS (SELECT 1 FROM fin_person_pagamento pp WHERE pp.person_id = p.id) AS tem_conta
       FROM fin_person p
       JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $1
      WHERE p.status = 'ativo'
      ORDER BY total DESC, p.name`,
    [ENTITY]
  );
  return linhas.map((l) => ({
    id: Number(l.id),
    nome: String(l.name),
    status: String(l.status),
    vinculo: (l.employment_type as string) ?? null,
    totalCents: Number(l.total ?? 0),
    temConta: Boolean(l.tem_conta)
  }));
}
