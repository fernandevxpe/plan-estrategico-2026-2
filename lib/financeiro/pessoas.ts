import "server-only";

import { isFinanceConfigured, query } from "./db";
import { monthKeyLabel } from "./format";

/**
 * Custo com pessoas: quanto cada uma custa, de qual conta saiu, e quanto do
 * custo de gente esta tela NÃO consegue atribuir a ninguém.
 *
 * Cinco decisões sustentam todo número deste arquivo. Nenhuma é óbvia lendo os
 * tipos, e cada uma corrigiu um erro que já existiu na planilha do dono:
 *
 * 1. "GENTE" É A LIGAÇÃO PESSOA↔CONTRAPARTE, NUNCA A CATEGORIA 6.01.
 *    A regra 42 do módulo de classificação joga pagamento a EMPRESA em Salários:
 *    dos R$ 188.523,85 que hoje estão em 6.01, só R$ 54.774,00 saíram para
 *    alguém do roster. Somar a categoria inflaria a folha em 3,4×. A definição
 *    correta é a única que o schema sustenta: a contraparte do lançamento está
 *    ligada a uma linha de `fin_person` por `fin_person_counterparty`.
 *
 * 2. SÓ LINK 'confirmado' SOMA. Dos quatro links 'proposto' de hoje, dois são
 *    contrapartes de BANCO — "BCO SANTANDER (BRASIL) S.A." e "Itau Unibanco
 *    S.A." — onde o importador do Inter guardou a instituição de destino no
 *    lugar do favorecido. Cada uma carrega lançamentos de várias pessoas
 *    misturadas. Somá-las penduraria o custo de meio time em uma pessoa só.
 *    Eles aparecem na seção de cobertura, com o valor, como pendência.
 *
 * 3. UMA PESSOA, N CONTRAPARTES. Seis MEIs recebem no CNPJ e no CPF (Igor,
 *    Diogo, Cleber, Flavio, Evera, Igor A). São 26 contrapartes confirmadas para
 *    20 pessoas. Agrupar por contraparte perderia metade do custo de cada um sem
 *    erro nenhum — só um número menor. Toda soma aqui é por `person_id`.
 *
 * 4. AS TRÊS GUARDAS DO LEDGER, MAIS UMA.
 *      · `transfer_status = 'nao'`  — transferência entre contas próprias não é
 *        custo; 508 lançamentos e R$ 2,7 mi marcados 'em_transito' ficam fora.
 *      · `NOT is_split_parent`      — senão o rateio conta duas vezes.
 *      · fatura de cartão fora      — "Pagamento Fatura - FERNANDO DE SIQUEIRA
 *        CAMPOS SILVA" soma R$ 36.671,35 em 8 lançamentos e "Pagamento de
 *        fatura" do Nubank outros R$ 66.738,34. É a fatura do cartão CORPORATIVO
 *        no nome do sócio: contar isso como custo dele adicionaria cerca de
 *        R$ 5.238/mês fictícios ao pró-labore e faria a pessoa mais cara da
 *        empresa ser a errada. Nenhum desses lançamentos tem contraparte hoje,
 *        então a guarda é redundante — e é exatamente por isso que ela precisa
 *        estar escrita: no dia em que a fila de revisão atribuir a contraparte
 *        "Fernando" a essa linha, a guarda é o que impede o erro de entrar.
 *
 * 5. A COBERTURA É PARTE DO RESULTADO, NÃO UMA NOTA DE RODAPÉ. 107 saídas do
 *    Inter e 68 do Nubank não têm favorecido nenhum. Um total que ignora isso
 *    vem menor e ninguém percebe — e o caso de abril/2026 prova o tamanho do
 *    dano: o custo atribuído do mês despenca para R$ 25.035,41 (contra ~R$ 70
 *    mil nos meses vizinhos) porque R$ 50.949,07 de PIX para gente do roster
 *    entraram sem contraparte. Quem olhasse só o total concluiria que a folha
 *    caiu 64% em abril. Por isso `cobertura` volta junto com os totais.
 *
 * O que este arquivo NÃO tenta fazer: dizer se um PIX de R$ 5.000 foi fixo ou
 * comissão. O extrato não sabe — 100% dos lançamentos de gente do Inter estão
 * sem categoria e 100% dos do Nubank caíram em 6.01 por regra automática.
 * Fixo × variável vem de `fin_person_compensation` (a planilha de
 * comissionamento) e é devolvido em campo separado, nunca fundido com o
 * realizado. Fundir os dois seria transformar uma pactuação em observação.
 */

const ENTITY = "xpe";

/**
 * Vínculo tal como o CHECK de `fin_person.employment_type` o define (0026).
 * 'clt' está no domínio e hoje não tem nenhuma linha: a empresa não tem
 * empregado registrado, e a prova está no ledger (zero FGTS, zero INSS
 * patronal). Fica no mapa porque o rótulo não pode sumir no dia da primeira
 * contratação.
 */
const ROTULO_VINCULO: Record<string, string> = {
  socio_adm: "Sócio adm.",
  socio: "Sócio",
  mei: "MEI",
  estagiario: "Estágio",
  irregular: "Irregular",
  pj: "PJ",
  clt: "CLT",
  indefinido: "Indefinido"
};

/**
 * Ordem de exibição do vínculo: da estrutura societária para a pendência, que é
 * a ordem em que o dono decide. Alfabética poria "Estágio" antes de "Sócio adm."
 * e faria a linha mais cara da folha aparecer no meio da lista.
 */
const ORDEM_VINCULO = ["socio_adm", "socio", "mei", "estagiario", "irregular", "pj", "clt", "indefinido"];

const ROTULO_TIME: Record<string, string> = {
  consultoria: "Consultoria",
  obras: "Obras",
  software: "Software",
  hardware: "Hardware",
  sem_time: "Sem time"
};

const ORDEM_TIME = ["consultoria", "obras", "software", "hardware", "sem_time"];

/**
 * Natureza lida do razão, com o rótulo dizendo de onde ela vem.
 *
 * 'nao_discriminado' não é uma categoria residual de conveniência: é 90% do
 * custo de gente de hoje, e chamá-la de "Fixo" seria a mentira mais cara que
 * esta tela poderia contar. O nome do rótulo declara a origem ("sem categoria no
 * extrato") para que ninguém leia o filtro como se fosse classificação.
 */
const ROTULO_NATUREZA: Record<string, string> = {
  folha: "Folha (salário / pró-labore)",
  variavel: "Variável (comissão / obra / deslocamento)",
  reembolso: "Reembolso",
  beneficio: "Benefício",
  nao_discriminado: "Sem categoria no extrato"
};

const ORDEM_NATUREZA = ["folha", "variavel", "reembolso", "beneficio", "nao_discriminado"];

/**
 * As guardas, num só lugar.
 *
 * Repetir esta lista em cada consulta é como duas telas do módulo param de
 * bater: basta alguém esquecer `is_split_parent` numa delas. As três consultas
 * de dinheiro deste arquivo interpolam esta constante — e ela nunca recebe valor
 * de usuário, então não abre caminho para injeção.
 */
const GUARDAS_SAIDA = `
      t.amount_cents < 0
  AND t.transfer_status = 'nao'
  AND NOT t.is_split_parent
  AND t.description_norm NOT LIKE '%pagamento fatura%'
  AND t.description_norm NOT LIKE '%pagamento de fatura%'
  AND t.description_norm NOT LIKE '%fatura cartao%'
`;

/**
 * Time da pessoa, derivado em SQL para que a tabela, a matriz e a cobertura
 * usem literalmente a mesma expressão.
 *
 * `area` vence `default_nucleo` porque são coisas diferentes: Diogo tem
 * area='hardware' e default_nucleo='consultoria' — ele constrói medidor e é PAGO
 * pela via de Consultoria. A pergunta do dono ("quanto custa Hardware?") é sobre
 * onde a pessoa trabalha, não sobre por qual conta o dinheiro passa. Obras só
 * existe em `default_nucleo`, e era exatamente o time que não existia na
 * planilha dele.
 */
const TIME_SQL = `
  CASE
    WHEN p.area IN ('hardware', 'software') THEN p.area
    WHEN p.default_nucleo IN ('obras', 'consultoria') THEN p.default_nucleo
    ELSE 'sem_time'
  END
`;

export type Natureza = "folha" | "variavel" | "reembolso" | "beneficio" | "nao_discriminado";

/** Uma opção de filtro. `slug` é o que o componente compara; `nome` é o que ele mostra. */
export type Opcao = { slug: string; nome: string };

export type Contraparte = {
  id: number;
  nome: string;
  documento: string | null;
  primaria: boolean;
  confianca: number;
  metodo: string;
  status: string;
  /** Quanto saiu por ESTA contraparte. É o que mostra que somar uma só perde metade. */
  realizadoCents: number;
  n: number;
};

export type Pessoa = {
  id: number;
  nome: string;
  nomeLegal: string | null;
  vinculo: string;
  vinculoRotulo: string;
  time: string;
  timeRotulo: string;
  status: string;
  contrapartes: Contraparte[];
};

/**
 * A unidade de dinheiro realizado: pessoa × mês × conta × natureza.
 *
 * Grão único de propósito. Toda soma da tela — KPI, linha da tabela, célula da
 * matriz, rodapé — sai deste mesmo array filtrado pelos mesmos filtros. Foi o
 * que impediu, no módulo de reembolso, a soma da linha discordar da soma da
 * gaveta quando um filtro era esquecido em uma das duas consultas.
 */
export type Celula = {
  personId: number;
  mes: string;
  conta: string;
  natureza: Natureza;
  cents: number;
  n: number;
};

/**
 * O pactuado da planilha de comissionamento: pessoa × mês.
 *
 * Separado do realizado porque são medidas de coisas diferentes. `contratado` é
 * o combinado ("Via de Pagamento"); `apurado` é a lista do mês ("Falta pagar").
 * As duas abas da MESMA planilha já discordam entre si — R$ 65.900 contra
 * R$ 70.557,30 em ago/26 —, então fundi-las apagaria a pergunta.
 */
export type Pactuado = {
  personId: number;
  mes: string;
  fixoContratadoCents: number;
  variavelContratadoCents: number;
  fixoApuradoCents: number;
  variavelApuradoCents: number;
  deducaoCents: number;
};

export type Componente = {
  personId: number;
  mes: string;
  componente: string;
  componenteNome: string;
  tipo: "fixo" | "variavel" | "deducao";
  kind: "contratado" | "apurado";
  cents: number;
  nucleo: string | null;
};

/** Saída de conta corrente sem favorecido nenhum: o buraco, medido. */
export type BuracoMes = {
  mes: string;
  conta: string;
  semContraparteCents: number;
  semContraparteN: number;
};

/**
 * Lançamento sem contraparte cujo texto do extrato contém o nome de alguém do
 * roster. Não vira soma — vira acusação com valor ao lado.
 *
 * O casamento é por PREFIXO de 18 caracteres do nome da contraparte confirmada,
 * porque o Inter trunca o favorecido no meio ("Igor Dalton Guilherme Da Sil").
 * Nome inteiro não casa com nada; prefixo curto casaria com qualquer um. E a
 * varredura exclui o Asaas: lá "Everaldo Ferreira De…" aparece em 44 tarifas de
 * cartão de um CLIENTE homônimo, R$ 47,91 que não são custo de ninguém.
 */
export type Suspeito = {
  personId: number;
  pessoa: string;
  mes: string;
  conta: string;
  cents: number;
  n: number;
  amostra: string;
};

export type LinkProposto = {
  pessoa: string;
  contraparte: string;
  confianca: number;
  metodo: string;
  saidaCents: number;
  n: number;
  /** Contraparte que é instituição financeira, não pessoa: confirmar seria erro. */
  ehBanco: boolean;
};

export type Cobertura = {
  buracos: BuracoMes[];
  suspeitos: Suspeito[];
  linksPropostos: LinkProposto[];
  pessoasSemContraparte: { id: number; nome: string; vinculo: string; vinculoRotulo: string }[];
  faturaCartaoCents: number;
  faturaCartaoN: number;
};

export type CustoPessoas = {
  disponivel: boolean;
  hoje: string;
  mesAtual: string;
  /** Último mês com lançamento de gente. É o padrão do filtro "mês recente". */
  mesRecente: string;
  meses: string[];
  contas: Opcao[];
  times: Opcao[];
  vinculos: Opcao[];
  naturezas: Opcao[];
  pessoas: Pessoa[];
  celulas: Celula[];
  pactuado: Pactuado[];
  componentes: Componente[];
  cobertura: Cobertura;
  lacunas: { titulo: string; detalhe: string }[];
};

function indisponivel(): CustoPessoas {
  return {
    disponivel: false,
    hoje: "",
    mesAtual: "",
    mesRecente: "",
    meses: [],
    contas: [],
    times: [],
    vinculos: [],
    naturezas: [],
    pessoas: [],
    celulas: [],
    pactuado: [],
    componentes: [],
    cobertura: {
      buracos: [],
      suspeitos: [],
      linksPropostos: [],
      pessoasSemContraparte: [],
      faturaCartaoCents: 0,
      faturaCartaoN: 0
    },
    lacunas: []
  };
}

/** Centavos → "R$ 1.350" dentro das frases derivadas. Mesma régua de painel.ts. */
function brl(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function getCustoPessoas(): Promise<CustoPessoas> {
  if (!isFinanceConfigured()) return indisponivel();

  try {
    // "Hoje" vem do SQL já no fuso da empresa: em produção o servidor roda em
    // UTC e, entre 21h e meia-noite, o mês corrente de lá não é o daqui — e o
    // filtro "mês recente" apontaria para o mês errado a noite inteira.
    const [{ hoje, mes_atual: mesAtual }] = await query<{ hoje: string; mes_atual: string }>(
      `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS hoje,
              to_char(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-01') AS mes_atual`
    );

    const [pessoasRows, linksRows, celulasRows, pactuadoRows, componentesRows, buracoRows, suspeitoRows, faturaRows, contasRows] =
      await Promise.all([
        query<{
          id: number;
          nome: string;
          nome_legal: string | null;
          vinculo: string;
          time: string;
          status: string;
        }>(
          `SELECT p.id, p.name AS nome, p.legal_name AS nome_legal, p.employment_type AS vinculo,
                  ${TIME_SQL} AS time, p.status
             FROM fin_person p JOIN fin_entity e ON e.id = p.entity_id
            WHERE e.slug = $1
            ORDER BY p.name`,
          [ENTITY]
        ),

        // Contrapartes de cada pessoa COM o realizado de cada uma. É esta coluna
        // que torna visível o motivo da tabela existir: para o Igor ela mostra
        // duas linhas, CNPJ e CPF, e a soma de uma só é metade do custo dele.
        query<{
          person_id: number;
          id: number;
          nome: string;
          documento: string | null;
          primaria: boolean;
          confianca: string;
          metodo: string;
          status: string;
          realizado: number;
          n: number;
        }>(
          `SELECT l.person_id, c.id, c.name AS nome, c.document_number AS documento,
                  l.is_primary AS primaria, l.confidence::text AS confianca, l.method AS metodo, l.status,
                  COALESCE(SUM(-t.amount_cents), 0) AS realizado,
                  count(t.id)::int AS n
             FROM fin_person_counterparty l
             JOIN fin_counterparty c ON c.id = l.counterparty_id
             JOIN fin_entity e ON e.id = l.entity_id
             LEFT JOIN fin_transaction t ON t.counterparty_id = c.id AND ${GUARDAS_SAIDA}
            WHERE e.slug = $1
            GROUP BY l.person_id, c.id, c.name, c.document_number, l.is_primary, l.confidence, l.method, l.status
            ORDER BY l.is_primary DESC, 9 DESC`,
          [ENTITY]
        ),

        // O grão do dinheiro realizado. A natureza sai da categoria do razão
        // quando ela existe; quando não existe, a tela diz que não existe em vez
        // de chutar "fixo".
        query<{ person_id: number; mes: string; conta: string; natureza: string; cents: number; n: number }>(
          `SELECT l.person_id,
                  to_char(date_trunc('month', t.posted_on), 'YYYY-MM-01') AS mes,
                  a.slug AS conta,
                  CASE
                    WHEN cat.code = '6.05' THEN 'reembolso'
                    WHEN cat.code = '6.04' THEN 'beneficio'
                    WHEN cat.code IN ('4.01', '4.02', '4.03', '4.04') THEN 'variavel'
                    WHEN cat.code IN ('6.01', '6.02', '6.03', '6.06', '6.07', '6.08') THEN 'folha'
                    ELSE 'nao_discriminado'
                  END AS natureza,
                  SUM(-t.amount_cents) AS cents,
                  count(*)::int AS n
             FROM fin_transaction t
             JOIN fin_entity e ON e.id = t.entity_id
             JOIN fin_account a ON a.id = t.account_id
             JOIN fin_person_counterparty l ON l.counterparty_id = t.counterparty_id AND l.status = 'confirmado'
             LEFT JOIN fin_category cat ON cat.id = t.category_id
            WHERE e.slug = $1 AND ${GUARDAS_SAIDA}
            GROUP BY 1, 2, 3, 4`,
          [ENTITY]
        ),

        query<{
          person_id: number;
          mes: string;
          fixo_contratado: number;
          variavel_contratado: number;
          fixo_apurado: number;
          variavel_apurado: number;
          deducao: number;
        }>(
          `SELECT pc.person_id,
                  to_char(pc.reference_month, 'YYYY-MM-01') AS mes,
                  COALESCE(SUM(pc.amount_cents) FILTER (WHERE cc.kind = 'fixo'     AND pc.kind = 'contratado'), 0) AS fixo_contratado,
                  COALESCE(SUM(pc.amount_cents) FILTER (WHERE cc.kind = 'variavel' AND pc.kind = 'contratado'), 0) AS variavel_contratado,
                  COALESCE(SUM(pc.amount_cents) FILTER (WHERE cc.kind = 'fixo'     AND pc.kind = 'apurado'),    0) AS fixo_apurado,
                  COALESCE(SUM(pc.amount_cents) FILTER (WHERE cc.kind = 'variavel' AND pc.kind = 'apurado'),    0) AS variavel_apurado,
                  COALESCE(SUM(pc.amount_cents) FILTER (WHERE cc.kind = 'deducao'), 0) AS deducao
             FROM fin_person_compensation pc
             JOIN fin_entity e ON e.id = pc.entity_id
             JOIN fin_compensation_component cc ON cc.slug = pc.component
            WHERE e.slug = $1
            GROUP BY 1, 2`,
          [ENTITY]
        ),

        query<{
          person_id: number;
          mes: string;
          componente: string;
          componente_nome: string;
          tipo: string;
          kind: string;
          cents: number;
          nucleo: string | null;
        }>(
          `SELECT pc.person_id,
                  to_char(pc.reference_month, 'YYYY-MM-01') AS mes,
                  pc.component AS componente, cc.name AS componente_nome, cc.kind AS tipo,
                  pc.kind, pc.amount_cents AS cents, pc.nucleo
             FROM fin_person_compensation pc
             JOIN fin_entity e ON e.id = pc.entity_id
             JOIN fin_compensation_component cc ON cc.slug = pc.component
            WHERE e.slug = $1
            ORDER BY cc.sort_order, pc.component`,
          [ENTITY]
        ),

        // O buraco: saída de CONTA CORRENTE sem favorecido nenhum. O gateway
        // fica fora porque lá "sem contraparte" é a taxa do Asaas e a
        // transferência para o banco, não gente sem nome.
        query<{ mes: string; conta: string; cents: number; n: number }>(
          `SELECT to_char(date_trunc('month', t.posted_on), 'YYYY-MM-01') AS mes,
                  a.slug AS conta,
                  SUM(-t.amount_cents) AS cents,
                  count(*)::int AS n
             FROM fin_transaction t
             JOIN fin_entity e ON e.id = t.entity_id
             JOIN fin_account a ON a.id = t.account_id
            WHERE e.slug = $1 AND ${GUARDAS_SAIDA}
              AND t.counterparty_id IS NULL
              AND a.kind = 'conta_corrente'
            GROUP BY 1, 2`,
          [ENTITY]
        ),

        query<{ person_id: number; pessoa: string; mes: string; conta: string; cents: number; n: number; amostra: string }>(
          `WITH chave AS (
             SELECT DISTINCT p.id AS person_id, p.name AS pessoa, left(c.normalized_name, 18) AS prefixo
               FROM fin_person p
               JOIN fin_person_counterparty l ON l.person_id = p.id AND l.status = 'confirmado'
               JOIN fin_counterparty c ON c.id = l.counterparty_id
               JOIN fin_entity e ON e.id = p.entity_id
              WHERE e.slug = $1 AND length(c.normalized_name) >= 12)
           SELECT k.person_id, k.pessoa,
                  to_char(date_trunc('month', t.posted_on), 'YYYY-MM-01') AS mes,
                  a.slug AS conta,
                  SUM(-t.amount_cents) AS cents,
                  count(*)::int AS n,
                  (array_agg(t.description_raw ORDER BY t.amount_cents))[1] AS amostra
             FROM fin_transaction t
             JOIN fin_entity e ON e.id = t.entity_id
             JOIN fin_account a ON a.id = t.account_id
             JOIN chave k ON t.description_norm LIKE '%' || k.prefixo || '%'
            WHERE e.slug = $1 AND ${GUARDAS_SAIDA}
              AND t.counterparty_id IS NULL
              AND a.kind = 'conta_corrente'
            GROUP BY 1, 2, 3, 4
            ORDER BY 5 DESC`,
          [ENTITY]
        ),

        // A fatura excluída, medida. Declarar o valor que se decidiu NÃO contar
        // é o que separa uma escolha de uma omissão.
        query<{ cents: number; n: number }>(
          `SELECT COALESCE(SUM(-t.amount_cents), 0) AS cents, count(*)::int AS n
             FROM fin_transaction t
             JOIN fin_entity e ON e.id = t.entity_id
            WHERE e.slug = $1
              AND t.amount_cents < 0 AND t.transfer_status = 'nao' AND NOT t.is_split_parent
              AND (t.description_norm LIKE '%pagamento fatura%'
                OR t.description_norm LIKE '%pagamento de fatura%'
                OR t.description_norm LIKE '%fatura cartao%')`,
          [ENTITY]
        ),

        query<{ slug: string; nome: string }>(
          `SELECT a.slug, a.name AS nome FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
            WHERE e.slug = $1 AND a.is_active AND a.kind IN ('conta_corrente', 'gateway')
            ORDER BY a.sort_order`,
          [ENTITY]
        )
      ]);

    // ── Roster com as contrapartes penduradas ──────────────────────────────
    const linksPorPessoa = new Map<number, Contraparte[]>();
    for (const linha of linksRows) {
      if (linha.status !== "confirmado") continue;
      const lista = linksPorPessoa.get(linha.person_id) ?? [];
      lista.push({
        id: linha.id,
        nome: linha.nome,
        documento: linha.documento,
        primaria: linha.primaria,
        confianca: Number(linha.confianca),
        metodo: linha.metodo,
        status: linha.status,
        realizadoCents: linha.realizado,
        n: linha.n
      });
      linksPorPessoa.set(linha.person_id, lista);
    }

    const pessoas: Pessoa[] = pessoasRows.map((linha) => ({
      id: linha.id,
      nome: linha.nome,
      nomeLegal: linha.nome_legal,
      vinculo: linha.vinculo,
      vinculoRotulo: ROTULO_VINCULO[linha.vinculo] ?? linha.vinculo,
      time: linha.time,
      timeRotulo: ROTULO_TIME[linha.time] ?? linha.time,
      status: linha.status,
      contrapartes: linksPorPessoa.get(linha.id) ?? []
    }));

    const celulas: Celula[] = celulasRows.map((linha) => ({
      personId: linha.person_id,
      mes: linha.mes,
      conta: linha.conta,
      natureza: linha.natureza as Natureza,
      cents: linha.cents,
      n: linha.n
    }));

    const pactuado: Pactuado[] = pactuadoRows.map((linha) => ({
      personId: linha.person_id,
      mes: linha.mes,
      fixoContratadoCents: linha.fixo_contratado,
      variavelContratadoCents: linha.variavel_contratado,
      fixoApuradoCents: linha.fixo_apurado,
      variavelApuradoCents: linha.variavel_apurado,
      deducaoCents: linha.deducao
    }));

    const componentes: Componente[] = componentesRows.map((linha) => ({
      personId: linha.person_id,
      mes: linha.mes,
      componente: linha.componente,
      componenteNome: linha.componente_nome,
      tipo: linha.tipo as Componente["tipo"],
      kind: linha.kind as Componente["kind"],
      cents: linha.cents,
      nucleo: linha.nucleo
    }));

    // ── Eixo do tempo ──────────────────────────────────────────────────────
    //
    // Os meses saem do DADO, não de um intervalo fixo de 12: o ledger de conta
    // corrente começa em jan/2026 e um seletor com out/2025 ofereceria um mês
    // que não existe. Quando o Nubank de 2025 for importado, o seletor cresce
    // sozinho.
    const mesesSet = new Set<string>(celulas.map((c) => c.mes));
    for (const linha of buracoRows) mesesSet.add(linha.mes);
    for (const linha of pactuado) mesesSet.add(linha.mes);
    const meses = [...mesesSet].sort();
    const mesesComCusto = [...new Set(celulas.map((c) => c.mes))].sort();
    const mesRecente = mesesComCusto[mesesComCusto.length - 1] ?? mesAtual;

    // ── Cobertura ──────────────────────────────────────────────────────────
    const buracos: BuracoMes[] = buracoRows.map((linha) => ({
      mes: linha.mes,
      conta: linha.conta,
      semContraparteCents: linha.cents,
      semContraparteN: linha.n
    }));

    const suspeitos: Suspeito[] = suspeitoRows.map((linha) => ({
      personId: linha.person_id,
      pessoa: linha.pessoa,
      mes: linha.mes,
      conta: linha.conta,
      cents: linha.cents,
      n: linha.n,
      amostra: linha.amostra
    }));

    // Contraparte de banco: o nome é a INSTITUIÇÃO de destino do PIX, guardada
    // no lugar do favorecido pelo importador do Inter. Confirmar um link desses
    // penduraria os lançamentos de várias pessoas em uma só — por isso a
    // pendência vem marcada, e não só listada.
    const ehBanco = (nome: string) =>
      /(banco|bco |nu pagamentos|santander|digio|itau|ita[uú]|caixa econ|bradesco|inter s\.a)/i.test(nome);

    const nomePorPessoa = new Map(pessoasRows.map((p) => [p.id, p.nome]));
    const linksPropostos: LinkProposto[] = linksRows
      .filter((linha) => linha.status === "proposto")
      .map((linha) => ({
        pessoa: nomePorPessoa.get(linha.person_id) ?? "—",
        contraparte: linha.nome,
        confianca: Number(linha.confianca),
        metodo: linha.metodo,
        saidaCents: linha.realizado,
        n: linha.n,
        ehBanco: ehBanco(linha.nome)
      }))
      .sort((a, b) => b.saidaCents - a.saidaCents);

    const pessoasSemContraparte = pessoas
      .filter((p) => p.status === "ativo" && !p.contrapartes.length)
      .map((p) => ({ id: p.id, nome: p.nome, vinculo: p.vinculo, vinculoRotulo: p.vinculoRotulo }));

    const cobertura: Cobertura = {
      buracos,
      suspeitos,
      linksPropostos,
      pessoasSemContraparte,
      faturaCartaoCents: faturaRows[0]?.cents ?? 0,
      faturaCartaoN: faturaRows[0]?.n ?? 0
    };

    // ── Opções de filtro, derivadas do que EXISTE ──────────────────────────
    //
    // Filtro que oferece opção sem linha é a mesma armadilha da aba que leva a
    // tela vazia: ensina o usuário a não usar o filtro. As contas vêm da tabela
    // (todas, inclusive o Asaas com zero) porque o dono pediu o eixo por nome —
    // e ver "Asaas R$ 0,00" é informação: nenhum pagamento a gente sai do
    // gateway.
    const contas: Opcao[] = contasRows.map((c) => ({ slug: c.slug, nome: c.nome }));

    const timesPresentes = new Set(pessoas.map((p) => p.time));
    const times: Opcao[] = ORDEM_TIME.filter((slug) => timesPresentes.has(slug)).map((slug) => ({
      slug,
      nome: ROTULO_TIME[slug]
    }));

    const vinculosPresentes = new Set(pessoas.map((p) => p.vinculo));
    const vinculos: Opcao[] = ORDEM_VINCULO.filter((slug) => vinculosPresentes.has(slug)).map((slug) => ({
      slug,
      nome: ROTULO_VINCULO[slug]
    }));

    const naturezasPresentes = new Set(celulas.map((c) => c.natureza as string));
    const naturezas: Opcao[] = ORDEM_NATUREZA.filter((slug) => naturezasPresentes.has(slug)).map((slug) => ({
      slug,
      nome: ROTULO_NATUREZA[slug]
    }));

    // ── Lacunas declaradas ─────────────────────────────────────────────────
    //
    // Derivadas do dado, como no painel executivo: um texto fixo ("faltam 107
    // lançamentos") vira mentira na primeira importação e uma tela que mente
    // sobre a própria cobertura é pior que uma tela sem a seção.
    const totalAtribuido = celulas.reduce((s, c) => s + c.cents, 0);
    const totalBuraco = buracos.reduce((s, b) => s + b.semContraparteCents, 0);
    const nBuraco = buracos.reduce((s, b) => s + b.semContraparteN, 0);
    const totalSuspeito = suspeitos.reduce((s, x) => s + x.cents, 0);
    const semNatureza = celulas
      .filter((c) => c.natureza === "nao_discriminado")
      .reduce((s, c) => s + c.cents, 0);
    // Só mês com fixo CONTRATADO conta como "pactuado": há linhas que trazem só
    // o apurado (Dantre, Sandro, Lorena entraram na planilha pela lista do mês,
    // sem valor combinado). Tratar essas como fixo de R$ 0,00 faria a tela
    // afirmar que o realizado inteiro delas está "acima do fixo", que é uma
    // conclusão sobre um combinado que ninguém registrou.
    const mesesComPactuado = [
      ...new Set(pactuado.filter((p) => p.fixoContratadoCents > 0).map((p) => p.mes))
    ].sort();
    const pctSemNatureza = totalAtribuido ? (semNatureza / totalAtribuido) * 100 : 0;

    const lacunas = [
      {
        titulo: `Fixo × variável: ${mesesComPactuado.length} de ${mesesComCusto.length} meses com o pactuado carregado`,
        detalhe: `A separação entre fixo e variável não está no extrato: ${pctSemNatureza.toFixed(0)}% do custo atribuído (${brl(semNatureza)}) chega sem categoria no razão, e o que tem categoria caiu em 6.01 por regra automática — a mesma regra que também classifica pagamento a empresa como Salários. A única fonte confiável de fixo × variável é a planilha de comissionamento, e ela está carregada apenas para ${mesesComPactuado.length ? mesesComPactuado.map(monthKeyLabel).join(", ") : "nenhum mês"}. Nos demais meses a coluna "acima do fixo" vem vazia — não zerada, porque zero seria uma afirmação que não temos como fazer.`
      },
      {
        titulo: `Sem favorecido: ${nBuraco} saídas de conta corrente, ${brl(totalBuraco)}`,
        detalhe: `Essas saídas não têm contraparte nenhuma, então não podem ser atribuídas a ninguém — nem a gente, nem a fornecedor. ${
          totalSuspeito > 0
            ? `Destas, ${brl(totalSuspeito)} trazem no texto do extrato o nome de alguém do roster: é custo de gente que o total desta tela NÃO conta. `
            : ""
        }Rodar a fila de revisão sobre esses lançamentos é o que fecha a diferença.`
      },
      {
        titulo: `Encargo e imposto sobre a folha: fora da conta`,
        detalhe:
          "O que esta tela mede é o dinheiro que saiu para a pessoa. INSS patronal, FGTS e IRRF não aparecem — e nesta empresa isso é coerente, porque não há CLT e o ledger não registra um único recolhimento patronal. No dia da primeira contratação, o custo real de quem for CLT passará a ser maior que o número desta tabela, e o cálculo terá de mudar junto."
      },
      {
        titulo: "Rateio por projeto: não existe",
        detalhe:
          "O time (Consultoria, Obras, Software, Hardware) vem do cadastro da pessoa, não do trabalho que ela fez no mês. Quem atua nos dois lados aparece inteiro num só. Para custear obra por obra faltaria apontamento de horas ou dias — que não existe em nenhuma tabela deste banco."
      },
      {
        titulo: `Histórico: o ledger de conta corrente começa em ${mesesComCusto[0] ? monthKeyLabel(mesesComCusto[0]) : "—"}`,
        detalhe:
          "Aumento de salário só é visível a partir do primeiro mês importado. Comparações com 2025 exigem o extrato de 2025 do Inter e do Nubank, que ainda não entrou. Até lá, a coluna de variação mede o intervalo que existe, e diz qual é."
      }
    ];

    return {
      disponivel: true,
      hoje,
      mesAtual,
      mesRecente,
      meses,
      contas,
      times,
      vinculos,
      naturezas,
      pessoas,
      celulas,
      pactuado,
      componentes,
      cobertura,
      lacunas
    };
  } catch (error) {
    console.error("[financeiro] custo com pessoas indisponível:", error);
    return indisponivel();
  }
}

/** Rótulos exportados para a tela não reinventar a tradução dos slugs. */
export const ROTULOS = {
  vinculo: ROTULO_VINCULO,
  time: ROTULO_TIME,
  natureza: ROTULO_NATUREZA
};
