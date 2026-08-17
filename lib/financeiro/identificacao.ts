import "server-only";

import { conferirDocumento } from "@/scripts/lib/fin-documento.mjs";

import { query, transaction } from "./db";

/**
 * O inventário do que está sem identificação — leitura e os três cadastros.
 *
 * POR QUE ESTE MÓDULO NÃO ESTÁ EM `contratos/`
 *
 * `lib/financeiro/contratos/http.ts` declara, no cabeçalho: "SOMENTE LEITURA.
 * Nenhuma função daqui escreve, e nenhuma rota que a usa expõe verbo além de
 * GET." Esta frente precisa escrever — cadastrar contraparte, vincular pessoa,
 * registrar resolução — e enfiar isso lá dentro esvaziaria a promessa que
 * protege 32 rotas. O módulo mora fora, e os validadores de parâmetro de
 * `http.ts` (que são genéricos e não escrevem nada) continuam sendo reusados
 * pelas rotas.
 *
 * AS TRÊS COISAS QUE ESTE MÓDULO SE RECUSA A FAZER
 *
 * 1. NÃO EXISTE "RESOLVER TUDO". Nenhuma função aceita uma lista de casos e os
 *    fecha em lote. O inventário tem 27.281 casos e um botão que "resolve tudo"
 *    produziria 27.281 afirmações que ninguém fez.
 * 2. NÃO CASA POR SEMELHANÇA DE NOME. Cadastro exige documento; vínculo exige
 *    ids explícitos dos dois lados. Nome parecido já criou contraparte duplicada
 *    nesta base, e por isso os pares suspeitos são SUGESTÃO na leitura e nunca
 *    entrada de escrita.
 * 3. NÃO CRIA DUPLICATA. Se o documento já existe, a função vincula ao cadastro
 *    existente e devolve `criada: false`. A A4 exige documento único em
 *    `fin_counterparty`, e o caminho que a viola é sempre o mesmo: um cadastro
 *    "novo" com um documento que já estava lá.
 */

// ---------------------------------------------------------------------------
// Documento: CPF e CNPJ com dígito verificador
//
// A conferência mora em `scripts/lib/fin-documento.mjs` pelo mesmo arranjo de
// `fin-types.mjs` e `fin-rules.mjs`: o teste é .mjs e esta rota é TypeScript, e
// os dois precisam rodar o MESMO código. Duas cópias significariam que o teste
// prova a cópia dele — e o dia em que divergissem seria o dia em que um
// documento inválido entra no cadastro com a suíte verde.
// ---------------------------------------------------------------------------

export { conferirDocumento } from "@/scripts/lib/fin-documento.mjs";
export type { DocumentoConferido } from "@/scripts/lib/fin-documento.mjs";

// ---------------------------------------------------------------------------
// Leitura do inventário
// ---------------------------------------------------------------------------

export const CAMINHOS = [
  "cadastrar_contraparte",
  "classificar",
  "vincular_pessoa",
  "pedir_extrato",
  "decisao_humana",
  "sem_fonte"
] as const;

export const UNIVERSOS = [
  "fin_transaction",
  "fin_document",
  "fin_card_transaction",
  "fin_counterparty",
  "fin_person",
  "fin_contract",
  "erp_contrato",
  "transferencia",
  "fin_account",
  "fin_rule"
] as const;

export type FiltroInventario = {
  universo?: string;
  tipo?: string;
  caminho?: string;
  valorMinCents?: number;
  valorMaxCents?: number;
  alcancavelAgora?: boolean;
  em2026?: boolean;
  pagina: number;
  porPagina: number;
};

export type CasoDeIdentificacao = {
  universo: string;
  id: number;
  tipoDePendencia: string;
  descricao: string;
  valorCents: number;
  data: string | null;
  oQueFalta: string;
  caminhoDeCorrecao: string;
  bloqueadoPor: number | null;
  evidenciaDisponivel: string;
  alcancavelAgora: boolean;
  emEscopo2026: boolean;
  causaComum: string;
};

/**
 * A lista de casos.
 *
 * A ordenação padrão é `alcancavel_agora DESC, valor_cents DESC`, e a ordem dos
 * dois critérios é a entrega desta frente. Ordenar só por valor põe R$ 2,4
 * milhões de perna sem extrato no topo — casos em que a única ação possível é
 * esperar o Fernando conseguir um extrato de 2022. Quem atacar a lista de cima
 * para baixo perde a manhã antes de chegar no primeiro caso que dá para
 * resolver. O bloqueado continua na lista, com `alcancavelAgora: false` e o
 * número da dúvida, porque escondê-lo seria a outra metade do mesmo erro.
 */
export async function listarInventario(f: FiltroInventario): Promise<{
  casos: CasoDeIdentificacao[];
  total: number;
  totalValorCents: number;
}> {
  const cond: string[] = [];
  const args: unknown[] = [];
  const p = (v: unknown): string => `$${args.push(v)}`;

  if (f.universo) cond.push(`universo = ${p(f.universo)}`);
  if (f.tipo) cond.push(`tipo_de_pendencia = ${p(f.tipo)}`);
  if (f.caminho) cond.push(`caminho_de_correcao = ${p(f.caminho)}`);
  if (f.valorMinCents !== undefined) cond.push(`valor_cents >= ${p(f.valorMinCents)}`);
  if (f.valorMaxCents !== undefined) cond.push(`valor_cents <= ${p(f.valorMaxCents)}`);
  if (f.alcancavelAgora !== undefined) cond.push(`alcancavel_agora = ${p(f.alcancavelAgora)}`);
  if (f.em2026 !== undefined) cond.push(`em_escopo_2026 = ${p(f.em2026)}`);
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";

  const totais = await query<{ n: string; v: string | null }>(
    `SELECT count(*) n, coalesce(sum(valor_cents), 0) v FROM fin_pendencia_identificacao_v ${where}`,
    args
  );

  const limite = p(f.porPagina);
  const salto = p((f.pagina - 1) * f.porPagina);
  const linhas = await query<Record<string, unknown>>(
    `SELECT universo, id, tipo_de_pendencia, descricao, valor_cents, data,
            o_que_falta, caminho_de_correcao, bloqueado_por, evidencia_disponivel,
            alcancavel_agora, em_escopo_2026, causa_comum
       FROM fin_pendencia_identificacao_v ${where}
      ORDER BY alcancavel_agora DESC, valor_cents DESC, universo, id
      LIMIT ${limite} OFFSET ${salto}`,
    args
  );

  return {
    total: Number(totais[0]?.n ?? 0),
    totalValorCents: Number(totais[0]?.v ?? 0),
    casos: linhas.map((l) => ({
      universo: String(l.universo),
      id: Number(l.id),
      tipoDePendencia: String(l.tipo_de_pendencia),
      descricao: String(l.descricao ?? ""),
      valorCents: Number(l.valor_cents ?? 0),
      data: l.data ? String(l.data).slice(0, 10) : null,
      oQueFalta: String(l.o_que_falta),
      caminhoDeCorrecao: String(l.caminho_de_correcao),
      bloqueadoPor: l.bloqueado_por === null ? null : Number(l.bloqueado_por),
      evidenciaDisponivel: String(l.evidencia_disponivel ?? ""),
      alcancavelAgora: Boolean(l.alcancavel_agora),
      emEscopo2026: Boolean(l.em_escopo_2026),
      causaComum: String(l.causa_comum)
    }))
  };
}

export type GrupoDeCausa = {
  universo: string;
  tipoDePendencia: string;
  caminhoDeCorrecao: string;
  alcancavelAgora: boolean;
  bloqueadoPor: number | null;
  itens: number;
  decisoesDistintas: number;
  itensPorDecisao: number;
  valorCents: number;
  itens2026: number;
  oQueFalta: string;
};

/** O agrupamento por causa comum: itens (tamanho do problema) × decisões (tamanho do trabalho). */
export async function listarGrupos(): Promise<GrupoDeCausa[]> {
  const linhas = await query<Record<string, unknown>>(
    `SELECT universo, tipo_de_pendencia, caminho_de_correcao, alcancavel_agora, bloqueado_por,
            itens, decisoes_distintas, itens_por_decisao, valor_cents, itens_2026, o_que_falta
       FROM fin_pendencia_identificacao_grupo_v
      ORDER BY alcancavel_agora DESC, valor_cents DESC`
  );
  return linhas.map((l) => ({
    universo: String(l.universo),
    tipoDePendencia: String(l.tipo_de_pendencia),
    caminhoDeCorrecao: String(l.caminho_de_correcao),
    alcancavelAgora: Boolean(l.alcancavel_agora),
    bloqueadoPor: l.bloqueado_por === null ? null : Number(l.bloqueado_por),
    itens: Number(l.itens),
    decisoesDistintas: Number(l.decisoes_distintas),
    itensPorDecisao: Number(l.itens_por_decisao),
    valorCents: Number(l.valor_cents ?? 0),
    itens2026: Number(l.itens_2026),
    oQueFalta: String(l.o_que_falta)
  }));
}

/** As populações deliberadamente fora do inventário, com o motivo. */
export async function listarExcluidos(): Promise<
  { universo: string; populacao: string; itens: number; valorCents: number; porQueFora: string }[]
> {
  const linhas = await query<Record<string, unknown>>(
    `SELECT universo, populacao, itens, valor_cents, por_que_fora
       FROM fin_pendencia_identificacao_excluido_v ORDER BY itens DESC`
  );
  return linhas.map((l) => ({
    universo: String(l.universo),
    populacao: String(l.populacao),
    itens: Number(l.itens),
    valorCents: Number(l.valor_cents ?? 0),
    porQueFora: String(l.por_que_fora)
  }));
}

// ---------------------------------------------------------------------------
// Escrita 1: cadastrar contraparte a partir de um caso
// ---------------------------------------------------------------------------

export class RecusaDeEscrita extends Error {
  constructor(readonly motivo: string, readonly detalhe?: unknown) {
    super(motivo);
    this.name = "RecusaDeEscrita";
  }
}

export type CadastroDeContraparte = {
  nome: string;
  documento: string;
  kind: string;
  ator: string;
  /** Caso de origem, para a trilha dizer de onde veio o cadastro. */
  universo?: string;
  alvoId?: number;
};

export type ResultadoCadastro = {
  criada: boolean;
  counterpartyId: number;
  nome: string;
  documento: string;
  tipoDocumento: "cpf" | "cnpj";
  observacao: string;
};

const KINDS_DE_CONTRAPARTE = [
  "cliente",
  "fornecedor",
  "socio",
  "colaborador",
  "governo",
  "instituicao_financeira",
  "outro"
];

/**
 * Cadastra a contraparte, ou devolve a que já existe com aquele documento.
 *
 * As duas recusas não são validação de formulário — são invariantes do ledger:
 *
 * - **CNPJ da própria casa (A1/A2).** Foi assim que R$ 151.977,33 de
 *   transferência interna viraram despesa de fornecedor: alguém criou "XP
 *   ENERGY" como contraparte e nenhuma tela acusou, porque a linha fica
 *   perfeita — nome, documento e categoria. A recusa é aqui e não na tela.
 * - **Documento repetido (A4).** Contraparte partida em duas divide o
 *   histórico, e o classificador por precedente passa a errar nas DUAS metades.
 *   Por isso o caminho feliz de um documento já existente é vincular, não
 *   criar — e a resposta diz `criada: false` para que a tela não anuncie um
 *   cadastro que não houve.
 *
 * A escrita e a trilha vão na MESMA transação. Cadastro sem trilha é cadastro
 * cuja origem ninguém consegue reconstruir depois.
 */
export async function cadastrarContraparte(e: CadastroDeContraparte): Promise<ResultadoCadastro> {
  const nome = e.nome?.trim() ?? "";
  if (nome.length < 3) throw new RecusaDeEscrita("nome da contraparte precisa de ao menos 3 caracteres");
  if (!KINDS_DE_CONTRAPARTE.includes(e.kind)) {
    throw new RecusaDeEscrita(`kind deve ser um de: ${KINDS_DE_CONTRAPARTE.join(", ")}`);
  }
  if (!e.ator || e.ator.trim().length < 3) throw new RecusaDeEscrita("ator é obrigatório na trilha");

  const doc = conferirDocumento(e.documento);
  if (!doc.valido) throw new RecusaDeEscrita(doc.motivo);

  return transaction(async (c) => {
    const ent = await c.query<{ id: string; cnpj: string | null }>(
      `SELECT id, regexp_replace(coalesce(cnpj,''), '[^0-9]', '', 'g') cnpj
         FROM fin_entity WHERE slug = 'xpe'`
    );
    const entidade = ent.rows[0];
    if (!entidade) throw new RecusaDeEscrita("entidade xpe não encontrada");

    if (entidade.cnpj && entidade.cnpj === doc.digitos) {
      throw new RecusaDeEscrita(
        `${doc.digitos} é o CNPJ da própria XPE. Cadastrar contraparte com ele viola os invariantes A1 e A2: ` +
          `o lançamento passaria a ser despesa contra si mesma. A outra ponta aqui é uma conta da casa — ` +
          `isto é transferência própria, não contraparte.`
      );
    }

    const existente = await c.query<{ id: string; name: string }>(
      `SELECT id, name FROM fin_counterparty
        WHERE regexp_replace(coalesce(document_number,''), '[^0-9]', '', 'g') = $1
        LIMIT 1`,
      [doc.digitos]
    );
    if (existente.rows[0]) {
      return {
        criada: false,
        counterpartyId: Number(existente.rows[0].id),
        nome: existente.rows[0].name,
        documento: doc.digitos,
        tipoDocumento: doc.tipo,
        observacao:
          `O documento já está cadastrado em "${existente.rows[0].name}" (id ${existente.rows[0].id}). ` +
          `Nada foi criado: um segundo cadastro com o mesmo documento violaria a A4 e partiria o histórico em dois.`
      };
    }

    const nova = await c.query<{ id: string }>(
      `INSERT INTO fin_counterparty (entity_id, kind, name, normalized_name, document_type, document_number, is_active)
       VALUES ($1, $2, $3, upper(btrim($3)), $4, $5, true)
       RETURNING id`,
      [entidade.id, e.kind, nome, doc.tipo, doc.digitos]
    );
    const id = Number(nova.rows[0].id);

    await c.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
       VALUES ($1, 'fin_counterparty', $2, 'insert', NULL, $3, ARRAY['name','document_number','kind'], $4)`,
      [
        entidade.id,
        id,
        JSON.stringify({
          name: nome,
          document_number: doc.digitos,
          document_type: doc.tipo,
          kind: e.kind,
          origem: "api:identificacao",
          caso: e.universo && e.alvoId ? `${e.universo}#${e.alvoId}` : null
        }),
        e.ator.trim()
      ]
    );

    return {
      criada: true,
      counterpartyId: id,
      nome,
      documento: doc.digitos,
      tipoDocumento: doc.tipo,
      observacao: `Contraparte criada com ${doc.tipo.toUpperCase()} conferido no dígito verificador.`
    };
  });
}

// ---------------------------------------------------------------------------
// Escrita 2: vincular pessoa ↔ contraparte
// ---------------------------------------------------------------------------

export type VinculoDePessoa = {
  personId: number;
  counterpartyId: number;
  ator: string;
  motivo: string;
  principal?: boolean;
};

/**
 * Liga uma pessoa a uma contraparte, por decisão humana registrada.
 *
 * O `method` gravado é `humano` e não `nome_token` de propósito: a tabela já
 * distingue os dois, e o vínculo feito por esta rota tem alguém assinando. Um
 * vínculo criado aqui e carimbado como se tivesse sido inferido faria a próxima
 * auditoria confiar nele mais — ou menos — do que deve.
 *
 * `status` nasce `confirmado` porque quem chama esta rota está confirmando; a
 * evidência guarda quem foi e por quê.
 */
export async function vincularPessoaContraparte(v: VinculoDePessoa): Promise<{
  vinculoId: number;
  criado: boolean;
  observacao: string;
}> {
  if (!v.ator || v.ator.trim().length < 3) throw new RecusaDeEscrita("ator é obrigatório na trilha");
  if (!v.motivo || v.motivo.trim().length < 12) {
    throw new RecusaDeEscrita("motivo precisa de ao menos 12 caracteres: vínculo sem razão escrita vira folclore");
  }

  return transaction(async (c) => {
    const pes = await c.query<{ id: string; entity_id: string; name: string }>(
      `SELECT id, entity_id, name FROM fin_person WHERE id = $1`,
      [v.personId]
    );
    if (!pes.rows[0]) throw new RecusaDeEscrita(`pessoa ${v.personId} não existe`);

    const cp = await c.query<{ id: string; name: string }>(
      `SELECT id, name FROM fin_counterparty WHERE id = $1`,
      [v.counterpartyId]
    );
    if (!cp.rows[0]) throw new RecusaDeEscrita(`contraparte ${v.counterpartyId} não existe`);

    const ja = await c.query<{ id: string; status: string }>(
      `SELECT id, status FROM fin_person_counterparty WHERE person_id = $1 AND counterparty_id = $2`,
      [v.personId, v.counterpartyId]
    );
    if (ja.rows[0]) {
      return {
        vinculoId: Number(ja.rows[0].id),
        criado: false,
        observacao: `O vínculo já existia com status "${ja.rows[0].status}". Nada foi criado nem sobrescrito.`
      };
    }

    const novo = await c.query<{ id: string }>(
      `INSERT INTO fin_person_counterparty
         (entity_id, person_id, counterparty_id, is_primary, confidence, method, status, evidence, confirmed_by, confirmed_at)
       VALUES ($1, $2, $3, $4, 1.0, 'humano', 'confirmado', $5, $6, now())
       RETURNING id`,
      [
        pes.rows[0].entity_id,
        v.personId,
        v.counterpartyId,
        v.principal ?? false,
        JSON.stringify({ origem: "api:identificacao", motivo: v.motivo.trim(), ator: v.ator.trim() }),
        v.ator.trim()
      ]
    );

    await c.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
       VALUES ($1, 'fin_person_counterparty', $2, 'insert', NULL, $3, ARRAY['person_id','counterparty_id','status'], $4)`,
      [
        pes.rows[0].entity_id,
        Number(novo.rows[0].id),
        JSON.stringify({
          person_id: v.personId,
          person: pes.rows[0].name,
          counterparty_id: v.counterpartyId,
          counterparty: cp.rows[0].name,
          method: "humano",
          motivo: v.motivo.trim()
        }),
        v.ator.trim()
      ]
    );

    return {
      vinculoId: Number(novo.rows[0].id),
      criado: true,
      observacao: `"${pes.rows[0].name}" ligada a "${cp.rows[0].name}" por decisão humana registrada.`
    };
  });
}

// ---------------------------------------------------------------------------
// Escrita 3: resolver um caso com motivo declarado
// ---------------------------------------------------------------------------

export const DECISOES = ["sem_fonte", "nao_se_aplica", "resolvido"] as const;

export type ResolucaoDeCaso = {
  universo: string;
  alvoId: number;
  tipo: string;
  decisao: (typeof DECISOES)[number];
  motivo: string;
  ator: string;
};

/**
 * Fecha UM caso, com motivo escrito.
 *
 * `sem_fonte` é resposta legítima e é a razão de esta função existir. Um caso
 * que ninguém pode resolver e que ninguém pode fechar fica na lista para
 * sempre, e uma lista que nunca encolhe é uma lista que as pessoas param de
 * ler. A diferença entre "resolvido" e "sem_fonte" é preservada porque as duas
 * afirmam coisas diferentes sobre o mundo: uma diz que o dado chegou, a outra
 * diz que ele não existe.
 *
 * É deliberadamente singular. Não há versão em lote, e a unicidade parcial em
 * `fin_pendencia_resolucao` garante um registro vivo por caso.
 */
export async function resolverCaso(r: ResolucaoDeCaso): Promise<{
  resolucaoId: number;
  observacao: string;
}> {
  if (!DECISOES.includes(r.decisao)) {
    throw new RecusaDeEscrita(`decisao deve ser um de: ${DECISOES.join(", ")}`);
  }
  if (!r.motivo || r.motivo.trim().length < 12) {
    throw new RecusaDeEscrita(
      'motivo precisa de ao menos 12 caracteres. "ok" não é motivo — o que ficar aqui é o que a próxima pessoa vai ler.'
    );
  }
  if (!r.ator || r.ator.trim().length < 3) throw new RecusaDeEscrita("ator é obrigatório na trilha");

  return transaction(async (c) => {
    const tipo = await c.query<{ tipo: string; universo: string }>(
      `SELECT tipo, universo FROM fin_pendencia_tipo WHERE tipo = $1`,
      [r.tipo]
    );
    if (!tipo.rows[0]) throw new RecusaDeEscrita(`tipo "${r.tipo}" não existe no vocabulário de pendência`);
    if (tipo.rows[0].universo !== r.universo) {
      throw new RecusaDeEscrita(
        `o tipo "${r.tipo}" pertence ao universo "${tipo.rows[0].universo}", não a "${r.universo}"`
      );
    }

    const existe = await c.query<{ n: string }>(
      `SELECT count(*) n FROM fin_pendencia_identificacao_v
        WHERE universo = $1 AND id = $2 AND tipo_de_pendencia = $3`,
      [r.universo, r.alvoId, r.tipo]
    );
    if (Number(existe.rows[0]?.n ?? 0) === 0) {
      throw new RecusaDeEscrita(
        `não há caso aberto (${r.universo} #${r.alvoId} / ${r.tipo}). Ou ele já foi resolvido, ou o dado que faltava chegou e ele saiu do inventário sozinho.`
      );
    }

    const ent = await c.query<{ id: string }>(`SELECT id FROM fin_entity WHERE slug = 'xpe'`);
    const entityId = ent.rows[0]?.id;
    if (!entityId) throw new RecusaDeEscrita("entidade xpe não encontrada");

    const ins = await c.query<{ id: string }>(
      `INSERT INTO fin_pendencia_resolucao (entity_id, universo, alvo_id, tipo, decisao, motivo, ator)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [entityId, r.universo, r.alvoId, r.tipo, r.decisao, r.motivo.trim(), r.ator.trim()]
    );

    await c.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
       VALUES ($1, 'fin_pendencia_resolucao', $2, 'insert', NULL, $3, ARRAY['decisao','motivo'], $4)`,
      [
        entityId,
        Number(ins.rows[0].id),
        JSON.stringify({
          universo: r.universo,
          alvo_id: r.alvoId,
          tipo: r.tipo,
          decisao: r.decisao,
          motivo: r.motivo.trim()
        }),
        r.ator.trim()
      ]
    );

    return {
      resolucaoId: Number(ins.rows[0].id),
      observacao:
        r.decisao === "sem_fonte"
          ? "Caso fechado como SEM FONTE. Ele sai do inventário e o motivo fica registrado — não é o mesmo que resolvido."
          : r.decisao === "nao_se_aplica"
            ? "Caso fechado como NÃO SE APLICA: a base classificou como pendência algo que não é."
            : "Caso fechado como RESOLVIDO."
    };
  });
}
