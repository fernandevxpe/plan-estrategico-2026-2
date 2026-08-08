import "server-only";

import { isFinanceConfigured, query } from "./db";

/**
 * DRE por competência e os tributos estimados sobre ela.
 *
 * TRÊS DECISÕES QUE EXPLICAM O ARQUIVO INTEIRO:
 *
 * 1. COMPETÊNCIA, NÃO CAIXA. As outras telas do módulo somam por data de
 *    pagamento, porque é o número que o negócio conhece de cor (é o que o painel
 *    do Asaas mostra). DRE é outra pergunta: "quanto foi GANHO no mês", não
 *    "quanto entrou". Por isso aqui a data é `competence_date`, e por isso este
 *    arquivo devolve um total de 12 meses diferente do de `receitas.ts` — não é
 *    divergência, é regime contábil diferente, e a tela diz isso.
 *
 * 2. DOCUMENTO PRIMEIRO, LANÇAMENTO SÓ SE ÓRFÃO. Cada cobrança do Asaas existe
 *    duas vezes no banco: como `fin_document` (competência) e como
 *    `fin_transaction` (caixa), ligadas por `fin_settlement`. Somar as duas
 *    camadas dobra a receita. A regra única, escrita uma vez em FATOS_DRE: todo
 *    documento entra; um lançamento só entra se NÃO tiver liquidação — é o caso
 *    da tarifa bancária e do PIX avulso, que nunca tiveram documento.
 *
 * 3. SINAL = IMPACTO NO RESULTADO. Cada fato carrega um `impacto` já assinado:
 *    positivo aumenta o resultado, negativo diminui. Com isso todo subtotal da
 *    DRE (receita líquida, lucro bruto, EBITDA, resultado líquido) é a soma
 *    corrida dos grupos acima dele — não há regra de sinal espalhada por doze
 *    lugares para alguém errar em um deles.
 */

const ENTITY = "xpe";

/**
 * A definição ÚNICA de "o que entra em cada linha da DRE".
 *
 * Fica numa constante e não copiada em cada consulta de propósito: a DRE do
 * período, a evolução mensal, o RBT12 e os indicadores de `indicadores.ts` têm
 * de somar a MESMA coisa. Duas definições que convergem hoje divergem em
 * silêncio na primeira correção. É exportada por isso — quem precisar de receita
 * ou despesa por competência usa este CTE, não escreve o seu.
 *
 * Espera `$1` = slug da entidade. Quem usa acrescenta o recorte de data.
 *
 * Documento sem categoria vira `receita_bruta` quando é a receber: `direction`
 * já prova que é faturamento, e o que falta é só saber QUAL serviço. Jogar
 * R$ 161 mil fora por causa de uma etiqueta ausente seria pior. O detalhe do
 * grupo mostra a linha "Sem categoria" com a contagem, então a lacuna continua
 * visível em vez de virar um número redondo e falso.
 *
 * Documento a pagar e lançamento sem categoria caem em `nao_classificado`, que
 * NÃO é uma linha da DRE: aparece no rodapé "fora da DRE". Chutar uma linha de
 * despesa para eles seria inventar resultado.
 */
export const FATOS_DRE = `
  SELECT COALESCE(c.dre_line,
                  CASE WHEN d.direction = 'receber' THEN 'receita_bruta' ELSE 'nao_classificado' END) AS dre_line,
         c.code AS code,
         c.name AS categoria,
         c.sort_order AS sort_order,
         COALESCE(d.nucleo, 'sem-nucleo') AS escopo,
         d.competence_date AS comp,
         -- Dedução de receita chega como valor positivo em fin_document; o que
         -- ela faz com o resultado é subtrair.
         CASE WHEN c.kind = 'deducao_receita' THEN -d.amount_cents
              WHEN d.direction = 'receber' THEN d.amount_cents
              ELSE -d.amount_cents END AS impacto
    FROM fin_document d
    JOIN fin_entity e ON e.id = d.entity_id
    LEFT JOIN fin_category c ON c.id = d.category_id
   WHERE e.slug = $1 AND d.status NOT IN ('cancelado', 'estornado')

  UNION ALL

  SELECT COALESCE(c.dre_line, 'nao_classificado'),
         c.code, c.name, c.sort_order,
         COALESCE(t.nucleo, 'sem-nucleo'),
         -- Sem documento não há competência declarada; a data do caixa é a
         -- melhor aproximação disponível, e é o que o extrato afirma.
         COALESCE(t.competence_date, t.posted_on),
         -- amount_cents já vem assinado pelo sentido do dinheiro.
         t.amount_cents
    FROM fin_transaction t
    JOIN fin_entity e ON e.id = t.entity_id
    LEFT JOIN fin_category c ON c.id = t.category_id
   WHERE e.slug = $1
     -- Os dois invariantes do ledger. Sem eles, R$ 3,82 mi de transferência e
     -- todo rateio contam em dobro.
     AND t.transfer_status <> 'pareado'
     AND NOT t.is_split_parent
     AND NOT EXISTS (SELECT 1 FROM fin_settlement s WHERE s.transaction_id = t.id)
`;

/**
 * A estrutura da DRE, em ordem de leitura.
 *
 * Subtotal é sempre a soma corrida dos grupos acima — nenhum subtotal tem
 * fórmula própria, o que impede que "EBITDA" e "lucro bruto" usem conjuntos
 * ligeiramente diferentes de linhas.
 */
type ItemEstrutura =
  | { tipo: "grupo"; linha: string; rotulo: string; hint: string }
  | { tipo: "subtotal"; chave: string; rotulo: string; margem: boolean };

const ESTRUTURA: ItemEstrutura[] = [
  { tipo: "grupo", linha: "receita_bruta", rotulo: "(+) Receita bruta", hint: "faturamento por competência" },
  { tipo: "grupo", linha: "deducoes", rotulo: "(−) Deduções sobre a receita", hint: "estornos e devoluções" },
  { tipo: "subtotal", chave: "receita_liquida", rotulo: "(=) Receita líquida", margem: false },
  { tipo: "grupo", linha: "custos_servicos", rotulo: "(−) Custos dos serviços", hint: "custo totalmente variável" },
  { tipo: "subtotal", chave: "lucro_bruto", rotulo: "(=) Lucro bruto", margem: true },
  { tipo: "grupo", linha: "despesas_comerciais", rotulo: "(−) Despesas comerciais", hint: "marketing, viagens" },
  { tipo: "grupo", linha: "despesas_administrativas", rotulo: "(−) Despesas administrativas", hint: "estrutura" },
  { tipo: "grupo", linha: "despesas_pessoal", rotulo: "(−) Despesas com pessoal", hint: "folha, pró-labore, encargos" },
  { tipo: "subtotal", chave: "ebitda", rotulo: "(=) EBITDA", margem: true },
  { tipo: "grupo", linha: "resultado_financeiro", rotulo: "(±) Resultado financeiro", hint: "juros pagos e recebidos" },
  { tipo: "grupo", linha: "impostos", rotulo: "(−) Impostos", hint: "DAS, ISS e retenções efetivamente pagos" },
  { tipo: "subtotal", chave: "resultado_liquido", rotulo: "(=) Resultado líquido", margem: true }
];

/** Linhas que existem no plano de contas mas ficam FORA da DRE, com o motivo. */
const FORA_DA_DRE: { linha: string; rotulo: string; porque: string }[] = [
  {
    linha: "investimentos",
    rotulo: "Investimentos (CAPEX)",
    porque: "vira ativo, não despesa do período — entra na DRE depois, como depreciação"
  },
  {
    linha: "nao_operacional",
    rotulo: "Não operacional",
    porque: "transferência entre contas próprias, aporte e amortização: move caixa, não resultado"
  },
  {
    linha: "nao_classificado",
    rotulo: "Sem categoria",
    porque: "não dá para saber em que linha entra — é o que a fila de revisão existe para resolver"
  }
];

/**
 * TABELA DO SIMPLES NACIONAL — ANEXO III. PREMISSA, NÃO APURAÇÃO.
 *
 * Duas coisas aqui são suposição e a tela precisa dizer as duas:
 *
 *   (a) ANEXO III supõe fator R ≥ 28% (folha sobre receita). A folha não está no
 *       banco — nenhuma conta além do Asaas foi importada — então o fator R é
 *       incalculável hoje. Se na verdade for Anexo V, a alíquota da mesma faixa
 *       sobe de ~15% para ~20% e o DAS estimado erra por ~R$ 100 mil/ano.
 *   (b) O DAS real é apurado sobre a receita do MÊS com a alíquota derivada do
 *       RBT12 do mês anterior, e ainda tem retenções e ISS por fora conforme o
 *       município. Aqui aplica-se uma alíquota efetiva única sobre o período.
 *
 * PARA AJUSTAR: troque a tabela abaixo (ou o anexo) e nada mais no código muda —
 * a tela lê a faixa aplicada, a alíquota nominal e a parcela a deduzir daqui.
 * Valores em centavos, como todo dinheiro deste módulo.
 */
const ANEXO_SIMPLES = {
  nome: "Anexo III",
  premissa: "supõe fator R ≥ 28%; a folha não está no banco, então não dá para verificar",
  faixas: [
    { ate: 18_000_000, nominalPct: 6.0, deducaoCents: 0 },
    { ate: 36_000_000, nominalPct: 11.2, deducaoCents: 936_000 },
    { ate: 72_000_000, nominalPct: 13.5, deducaoCents: 1_764_000 },
    { ate: 180_000_000, nominalPct: 16.0, deducaoCents: 3_564_000 },
    { ate: 360_000_000, nominalPct: 21.0, deducaoCents: 12_564_000 },
    { ate: 480_000_000, nominalPct: 33.0, deducaoCents: 64_800_000 }
  ]
};

export type DreEscopo = { slug: string; nome: string };

export type DreCategoria = {
  code: string | null;
  nome: string;
  porEscopo: Record<string, number>;
  totalCents: number;
  n: number;
  pctDoGrupo: number;
  pctDaReceita: number;
};

export type DreGrupo = {
  linha: string;
  rotulo: string;
  hint: string;
  porEscopo: Record<string, number>;
  totalCents: number;
  n: number;
  pctDaReceita: number;
  categorias: DreCategoria[];
};

export type DreSubtotal = {
  chave: string;
  rotulo: string;
  porEscopo: Record<string, number>;
  totalCents: number;
  margem: boolean;
  margemPct: number;
};

export type DreItem = { tipo: "grupo"; grupo: DreGrupo } | { tipo: "subtotal"; subtotal: DreSubtotal };

export type DrePeriodo = { chave: string; rotulo: string; de: string; ate: string };

export type DreTributos = {
  rbt12Cents: number;
  receitaPeriodoCents: number;
  anexo: string;
  premissaAnexo: string;
  faixaRotulo: string;
  aliquotaNominalPct: number;
  deducaoCents: number;
  aliquotaEfetivaPct: number;
  dasEstimadoCents: number;
  issDestacadoCents: number;
  issRetidoCents: number;
  nNotas: number;
  cargaEfetivaPct: number;
};

export type DreCobertura = {
  receitaCents: number;
  despesaCents: number;
  razaoPct: number;
  contasComExtrato: number;
  contasTotal: number;
  contasSemExtrato: string[];
  semDespesa: boolean;
};

export type Dre = {
  disponivel: boolean;
  hoje: string;
  periodo: DrePeriodo;
  periodoAnterior: DrePeriodo;
  opcoesPeriodo: { chave: string; rotulo: string }[];
  escopos: DreEscopo[];
  nucleoFoco: string | null;
  itens: DreItem[];
  receitaBrutaCents: number;
  evolucao: { meses: string[]; linhas: { linha: string; rotulo: string; porMes: Record<string, number> }[] };
  tributos: DreTributos;
  cobertura: DreCobertura;
  foraDaDre: { rotulo: string; porque: string; totalCents: number; n: number }[];
};

// ---------------------------------------------------------------------------
// Aritmética de mês em texto puro
// ---------------------------------------------------------------------------
// Sem `new Date(iso)` de propósito, pelo mesmo motivo do resto do módulo: uma
// competência '2026-08-01' virada em Date à meia-noite UTC e lida em BRT é 31/07
// às 21h, e o mês inteiro migra sozinho. Aqui só se soma inteiro e se formata
// texto; `Date.UTC` aparece uma vez, só para descobrir quantos dias tem o mês.

function addMeses(mesIso: string, delta: number): string {
  const [ano, mes] = mesIso.slice(0, 7).split("-").map(Number);
  const total = ano * 12 + (mes - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

function fimDoMes(mesIso: string): string {
  const [ano, mes] = mesIso.slice(0, 7).split("-").map(Number);
  const dias = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${mesIso.slice(0, 7)}-${String(dias).padStart(2, "0")}`;
}

/**
 * Traduz `?periodo=` em duas janelas: a do período e a comparável anterior.
 *
 * A janela anterior NÃO é "a mesma largura deslocada para trás" em todos os
 * casos. Para um ano corrente parcial (jan–ago), deslocar oito meses compararia
 * jan–ago de 2026 com mai–dez de 2025 — oito meses contra oito meses, mas
 * sazonalidades diferentes. O comparável certo é jan–ago do ano anterior.
 */
function resolverPeriodo(chave: string | undefined, mesAtual: string, hoje: string) {
  const anoAtual = Number(mesAtual.slice(0, 4));
  const alvo = chave && chave.trim() ? chave.trim() : "12m";

  if (alvo === "mes-atual") {
    const anterior = addMeses(mesAtual, -1);
    return {
      periodo: { chave: "mes-atual", rotulo: "Mês atual", de: mesAtual, ate: fimDoMes(mesAtual) },
      anterior: { chave: "anterior", rotulo: "Mês anterior", de: anterior, ate: fimDoMes(anterior) }
    };
  }

  if (alvo === "ano") {
    const mm = mesAtual.slice(5, 7);
    return {
      periodo: { chave: "ano", rotulo: `Ano corrente (${anoAtual})`, de: `${anoAtual}-01-01`, ate: hoje },
      anterior: {
        chave: "anterior",
        rotulo: `${anoAtual - 1} até o mesmo mês`,
        de: `${anoAtual - 1}-01-01`,
        ate: fimDoMes(`${anoAtual - 1}-${mm}-01`)
      }
    };
  }

  if (/^\d{4}$/.test(alvo)) {
    const ano = Number(alvo);
    return {
      periodo: { chave: alvo, rotulo: `Ano de ${ano}`, de: `${ano}-01-01`, ate: `${ano}-12-31` },
      anterior: { chave: "anterior", rotulo: `Ano de ${ano - 1}`, de: `${ano - 1}-01-01`, ate: `${ano - 1}-12-31` }
    };
  }

  // Default: 12 meses fechados até o mês corrente (inclusive, parcial).
  return {
    periodo: {
      chave: "12m",
      rotulo: "Últimos 12 meses",
      de: addMeses(mesAtual, -11),
      ate: fimDoMes(mesAtual)
    },
    anterior: {
      chave: "anterior",
      rotulo: "12 meses anteriores",
      de: addMeses(mesAtual, -23),
      ate: fimDoMes(addMeses(mesAtual, -12))
    }
  };
}

/** Alíquota efetiva do Simples a partir do RBT12. Premissa, não apuração. */
export function aliquotaEfetivaSimples(rbt12Cents: number) {
  const faixa =
    ANEXO_SIMPLES.faixas.find((f) => rbt12Cents <= f.ate) ??
    ANEXO_SIMPLES.faixas[ANEXO_SIMPLES.faixas.length - 1];
  const indice = ANEXO_SIMPLES.faixas.indexOf(faixa);
  const efetiva = rbt12Cents > 0 ? ((rbt12Cents * (faixa.nominalPct / 100) - faixa.deducaoCents) / rbt12Cents) * 100 : 0;
  return {
    anexo: ANEXO_SIMPLES.nome,
    premissa: ANEXO_SIMPLES.premissa,
    faixaRotulo: `${indice + 1}ª faixa`,
    nominalPct: faixa.nominalPct,
    deducaoCents: faixa.deducaoCents,
    // Sem receita não existe alíquota; devolver a nominal seria inventar.
    efetivaPct: Math.max(0, efetiva)
  };
}

function dreIndisponivel(): Dre {
  const vazio = { chave: "12m", rotulo: "Últimos 12 meses", de: "", ate: "" };
  return {
    disponivel: false,
    hoje: "",
    periodo: vazio,
    periodoAnterior: vazio,
    opcoesPeriodo: [],
    escopos: [],
    nucleoFoco: null,
    itens: [],
    receitaBrutaCents: 0,
    evolucao: { meses: [], linhas: [] },
    tributos: {
      rbt12Cents: 0,
      receitaPeriodoCents: 0,
      anexo: ANEXO_SIMPLES.nome,
      premissaAnexo: ANEXO_SIMPLES.premissa,
      faixaRotulo: "—",
      aliquotaNominalPct: 0,
      deducaoCents: 0,
      aliquotaEfetivaPct: 0,
      dasEstimadoCents: 0,
      issDestacadoCents: 0,
      issRetidoCents: 0,
      nNotas: 0,
      cargaEfetivaPct: 0
    },
    cobertura: {
      receitaCents: 0,
      despesaCents: 0,
      razaoPct: 0,
      contasComExtrato: 0,
      contasTotal: 0,
      contasSemExtrato: [],
      semDespesa: true
    },
    foraDaDre: []
  };
}

type LinhaFato = {
  dre_line: string;
  code: string | null;
  categoria: string | null;
  sort_order: number | null;
  escopo: string;
  total: number;
  n: number;
};

export async function getDre(opcoes: { periodo?: string; nucleo?: string } = {}): Promise<Dre> {
  if (!isFinanceConfigured()) return dreIndisponivel();

  try {
    // Calendário e núcleos vêm ANTES do resto de propósito: `?nucleo=` só pode
    // virar filtro de SQL depois de conferido contra a lista real. Um slug
    // inventado na URL entraria na consulta e devolveria uma DRE toda zerada,
    // que parece empresa parada em vez de parâmetro errado.
    const [calendarioRows, nucleos] = await Promise.all([
      query<{ hoje: string; mes_atual: string; primeiro_ano: number }>(
        `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS hoje,
                to_char(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-01') AS mes_atual,
                COALESCE(EXTRACT(YEAR FROM min(d.competence_date))::int,
                         EXTRACT(YEAR FROM now() AT TIME ZONE 'America/Sao_Paulo')::int) AS primeiro_ano
           FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
          WHERE e.slug = $1`,
        [ENTITY]
      ),
      query<{ slug: string; name: string }>(`SELECT slug, name FROM fin_nucleo WHERE is_active ORDER BY sort_order`)
    ]);

    const calendario = calendarioRows[0];
    if (!calendario) return dreIndisponivel();

    const { hoje, mes_atual: mesAtual } = calendario;
    const nucleoFoco = opcoes.nucleo && nucleos.some((n) => n.slug === opcoes.nucleo) ? opcoes.nucleo : null;
    const { periodo, anterior } = resolverPeriodo(opcoes.periodo, mesAtual, hoje);

    const anoAtual = Number(mesAtual.slice(0, 4));
    const anosFechados: string[] = [];
    for (let ano = anoAtual - 1; ano >= Math.max(calendario.primeiro_ano, anoAtual - 4); ano--) {
      anosFechados.push(String(ano));
    }
    const opcoesPeriodo = [
      { chave: "mes-atual", rotulo: "Mês atual" },
      { chave: "12m", rotulo: "12 meses" },
      { chave: "ano", rotulo: `${anoAtual}` },
      ...anosFechados.map((ano) => ({ chave: ano, rotulo: ano }))
    ];

    // Os 12 meses da evolução vêm do calendário, não do dado: um mês sem
    // movimento tem de aparecer vazio, não sumir da tabela.
    const mesesEvolucao: string[] = [];
    for (let i = 11; i >= 0; i--) mesesEvolucao.push(addMeses(mesAtual, -i));

    const [fatos, evolucaoRows, rbt12Row, issRow, contas] = await Promise.all([
      query<LinhaFato>(
        `WITH fatos AS (${FATOS_DRE})
         SELECT dre_line, code, categoria, sort_order, escopo,
                COALESCE(SUM(impacto), 0) AS total, count(*)::int AS n
           FROM fatos
          WHERE comp >= $2::date AND comp <= $3::date
          GROUP BY 1, 2, 3, 4, 5`,
        [ENTITY, periodo.de, periodo.ate]
      ),

      query<{ dre_line: string; mes: string; total: number }>(
        `WITH fatos AS (${FATOS_DRE})
         SELECT dre_line, to_char(date_trunc('month', comp), 'YYYY-MM-01') AS mes,
                COALESCE(SUM(impacto), 0) AS total
           FROM fatos
          WHERE comp >= $2::date AND comp <= $3::date
            ${nucleoFoco ? "AND escopo = $4" : ""}
          GROUP BY 1, 2`,
        nucleoFoco
          ? [ENTITY, mesesEvolucao[0], fimDoMes(mesAtual), nucleoFoco]
          : [ENTITY, mesesEvolucao[0], fimDoMes(mesAtual)]
      ),

      // RBT12 é sempre a receita bruta dos ÚLTIMOS 12 MESES, independentemente
      // do período escolhido na tela: é assim que a alíquota do Simples é
      // determinada, e deixá-lo seguir o seletor faria a alíquota mudar de faixa
      // ao clicar em "mês atual".
      query<{ total: number }>(
        `WITH fatos AS (${FATOS_DRE})
         SELECT COALESCE(SUM(impacto), 0) AS total
           FROM fatos
          WHERE dre_line = 'receita_bruta' AND comp >= $2::date AND comp <= $3::date`,
        [ENTITY, mesesEvolucao[0], fimDoMes(mesAtual)]
      ),

      // ISS real das notas autorizadas do período. Nota cancelada e nota com
      // erro ficam de fora: imposto de nota que não vale não foi devido.
      query<{ iss: number; retido: number; n: number }>(
        `SELECT COALESCE(SUM(f.iss_cents), 0) AS iss,
                COALESCE(SUM(f.iss_cents) FILTER (WHERE f.iss_withheld), 0) AS retido,
                count(*)::int AS n
           FROM fin_fiscal_document f JOIN fin_entity e ON e.id = f.entity_id
          WHERE e.slug = $1 AND f.status = 'AUTHORIZED'
            AND f.competence_date >= $2::date AND f.competence_date <= $3::date`,
        [ENTITY, periodo.de, periodo.ate]
      ),

      query<{ name: string; coberta: boolean }>(
        `SELECT a.name, (c.id IS NOT NULL) AS coberta
           FROM fin_account a
           JOIN fin_entity e ON e.id = a.entity_id
           LEFT JOIN LATERAL (
             SELECT 1 AS id FROM fin_statement_coverage sc
              WHERE sc.account_id = a.id AND sc.period_end >= CURRENT_DATE - 30 LIMIT 1
           ) c ON true
          WHERE e.slug = $1 AND a.is_active ORDER BY a.sort_order`,
        [ENTITY]
      )
    ]);

    // ------------------------------------------------------------------
    // Colunas de escopo
    // ------------------------------------------------------------------
    // "Sem núcleo" entra como coluna própria porque hoje são R$ 163 mil: sem
    // ela as colunas não somam o global e quem conferir vai achar que a tela
    // perdeu dinheiro.
    const todosEscopos: DreEscopo[] = [
      { slug: "global", nome: "Global" },
      ...nucleos.map((n) => ({ slug: n.slug, nome: n.name })),
      { slug: "sem-nucleo", nome: "Sem núcleo" }
    ];
    // Com `?nucleo=`, a tabela fica em duas colunas: o global continua para o
    // número do núcleo ter contra o que ser lido.
    const escopos = nucleoFoco ? todosEscopos.filter((e) => e.slug === "global" || e.slug === nucleoFoco) : todosEscopos;

    const somaEscopos = (fn: (fato: LinhaFato) => boolean) => {
      const porEscopo: Record<string, number> = {};
      for (const escopo of escopos) porEscopo[escopo.slug] = 0;
      for (const fato of fatos) {
        if (!fn(fato)) continue;
        porEscopo.global += fato.total;
        // Só as colunas visíveis. Com `?nucleo=obras`, o que é de consultoria
        // continua somando no global e não vira coluna.
        if (fato.escopo in porEscopo) porEscopo[fato.escopo] += fato.total;
      }
      return porEscopo;
    };

    // Receita bruta é o denominador de toda porcentagem da tela. Calculada uma
    // vez, sobre o escopo global.
    const receitaBrutaCents = fatos
      .filter((f) => f.dre_line === "receita_bruta")
      .reduce((soma, f) => soma + f.total, 0);
    const pctDaReceita = (valor: number) => (receitaBrutaCents ? (valor / receitaBrutaCents) * 100 : 0);

    // ------------------------------------------------------------------
    // Grupos e subtotais
    // ------------------------------------------------------------------
    const itens: DreItem[] = [];
    // Subtotal é sempre a soma corrida — o acumulador atravessa a estrutura e
    // cada `(=)` só tira uma foto dele.
    const acumulado: Record<string, number> = Object.fromEntries(escopos.map((e) => [e.slug, 0]));

    for (const item of ESTRUTURA) {
      if (item.tipo === "grupo") {
        const doGrupo = fatos.filter((f) => f.dre_line === item.linha);
        const porEscopo = somaEscopos((f) => f.dre_line === item.linha);
        const totalCents = porEscopo.global;

        // Uma categoria pode aparecer em vários núcleos; o detalhe agrupa por
        // categoria e guarda a quebra por escopo.
        const porCategoria = new Map<string, DreCategoria>();
        for (const fato of doGrupo) {
          const chave = fato.code ?? "sem-categoria";
          const alvo =
            porCategoria.get(chave) ??
            ({
              code: fato.code,
              nome: fato.categoria ?? "Sem categoria",
              porEscopo: Object.fromEntries(escopos.map((e) => [e.slug, 0])),
              totalCents: 0,
              n: 0,
              pctDoGrupo: 0,
              pctDaReceita: 0
            } satisfies DreCategoria);
          alvo.totalCents += fato.total;
          alvo.n += fato.n;
          alvo.porEscopo.global += fato.total;
          if (fato.escopo in alvo.porEscopo) alvo.porEscopo[fato.escopo] += fato.total;
          porCategoria.set(chave, alvo);
        }

        const categorias = [...porCategoria.values()]
          .map((cat) => ({
            ...cat,
            pctDoGrupo: totalCents ? (cat.totalCents / totalCents) * 100 : 0,
            pctDaReceita: pctDaReceita(cat.totalCents)
          }))
          // Por peso absoluto: numa linha de despesa os valores são negativos e
          // ordenar por valor cru poria a menor primeira.
          .sort((a, b) => Math.abs(b.totalCents) - Math.abs(a.totalCents));

        for (const escopo of escopos) acumulado[escopo.slug] += porEscopo[escopo.slug];

        itens.push({
          tipo: "grupo",
          grupo: {
            linha: item.linha,
            rotulo: item.rotulo,
            hint: item.hint,
            porEscopo,
            totalCents,
            n: doGrupo.reduce((soma, f) => soma + f.n, 0),
            pctDaReceita: pctDaReceita(totalCents),
            categorias
          }
        });
      } else {
        const porEscopo = { ...acumulado };
        itens.push({
          tipo: "subtotal",
          subtotal: {
            chave: item.chave,
            rotulo: item.rotulo,
            porEscopo,
            totalCents: porEscopo.global,
            margem: item.margem,
            margemPct: pctDaReceita(porEscopo.global)
          }
        });
      }
    }

    // ------------------------------------------------------------------
    // Evolução mensal
    // ------------------------------------------------------------------
    const evolucaoPorLinha = new Map<string, Record<string, number>>();
    for (const row of evolucaoRows) {
      const alvo = evolucaoPorLinha.get(row.dre_line) ?? {};
      alvo[row.mes] = (alvo[row.mes] ?? 0) + row.total;
      evolucaoPorLinha.set(row.dre_line, alvo);
    }
    const evolucaoLinhas = ESTRUTURA.filter((i) => i.tipo === "grupo")
      .map((i) => i as Extract<ItemEstrutura, { tipo: "grupo" }>)
      .map((i) => ({ linha: i.linha, rotulo: i.rotulo, porMes: evolucaoPorLinha.get(i.linha) ?? {} }))
      // Linha inteiramente vazia em 12 meses só ocupa espaço.
      .filter((linha) => mesesEvolucao.some((mes) => (linha.porMes[mes] ?? 0) !== 0));

    // Resultado mês a mês: a soma de TODAS as linhas da DRE naquele mês.
    const resultadoPorMes: Record<string, number> = {};
    for (const mes of mesesEvolucao) {
      resultadoPorMes[mes] = ESTRUTURA.filter((i) => i.tipo === "grupo")
        .map((i) => i as Extract<ItemEstrutura, { tipo: "grupo" }>)
        .reduce((soma, i) => soma + (evolucaoPorLinha.get(i.linha)?.[mes] ?? 0), 0);
    }
    evolucaoLinhas.push({ linha: "resultado_liquido", rotulo: "(=) Resultado líquido", porMes: resultadoPorMes });

    // ------------------------------------------------------------------
    // Tributos
    // ------------------------------------------------------------------
    const rbt12Cents = rbt12Row[0]?.total ?? 0;
    const simples = aliquotaEfetivaSimples(rbt12Cents);
    const dasEstimadoCents = Math.round(receitaBrutaCents * (simples.efetivaPct / 100));
    const issDestacadoCents = issRow[0]?.iss ?? 0;
    const issRetidoCents = issRow[0]?.retido ?? 0;

    // ISS destacado NÃO entra na carga somado ao DAS: no Simples Nacional ele já
    // está DENTRO da guia. Somar os dois contaria o mesmo imposto duas vezes e
    // inflaria a carga em ~3,5 pontos. Só a parcela RETIDA na fonte é dinheiro
    // adicional que a empresa não viu — e essa entra.
    const cargaEfetivaPct = receitaBrutaCents
      ? ((dasEstimadoCents + issRetidoCents) / receitaBrutaCents) * 100
      : 0;

    // ------------------------------------------------------------------
    // Cobertura de despesa — o portão de honestidade
    // ------------------------------------------------------------------
    const linhasDespesa = [
      "custos_servicos",
      "despesas_comerciais",
      "despesas_administrativas",
      "despesas_pessoal",
      "impostos"
    ];
    const despesaCents = Math.abs(
      fatos.filter((f) => linhasDespesa.includes(f.dre_line)).reduce((soma, f) => soma + f.total, 0)
    );
    const razaoPct = receitaBrutaCents ? (despesaCents / receitaBrutaCents) * 100 : 0;
    const contasSemExtrato = contas.filter((c) => !c.coberta).map((c) => c.name);

    // "Sem despesa" não é despesa === 0. Hoje há R$ 3 mil de tarifa bancária
    // lançada contra R$ 2,1 mi de receita: literalmente diferente de zero e
    // materialmente igual a zero. O corte em 10% da receita é arbitrário e está
    // aqui para ser editado — nenhuma empresa de serviço opera com 10% de custo
    // total, então abaixo disso o que a tela mostra é cobertura, não resultado.
    const semDespesa = razaoPct < 10 || contasSemExtrato.length > 0;

    const foraDaDre = FORA_DA_DRE.map((linha) => {
      const doGrupo = fatos.filter((f) => f.dre_line === linha.linha);
      return {
        rotulo: linha.rotulo,
        porque: linha.porque,
        totalCents: doGrupo.reduce((soma, f) => soma + f.total, 0),
        n: doGrupo.reduce((soma, f) => soma + f.n, 0)
      };
    }).filter((linha) => linha.n > 0);

    return {
      disponivel: true,
      hoje,
      periodo,
      periodoAnterior: anterior,
      opcoesPeriodo,
      escopos,
      nucleoFoco,
      itens,
      receitaBrutaCents,
      evolucao: { meses: mesesEvolucao, linhas: evolucaoLinhas },
      tributos: {
        rbt12Cents,
        receitaPeriodoCents: receitaBrutaCents,
        anexo: simples.anexo,
        premissaAnexo: simples.premissa,
        faixaRotulo: simples.faixaRotulo,
        aliquotaNominalPct: simples.nominalPct,
        deducaoCents: simples.deducaoCents,
        aliquotaEfetivaPct: simples.efetivaPct,
        dasEstimadoCents,
        issDestacadoCents,
        issRetidoCents,
        nNotas: issRow[0]?.n ?? 0,
        cargaEfetivaPct
      },
      cobertura: {
        receitaCents: receitaBrutaCents,
        despesaCents,
        razaoPct,
        contasComExtrato: contas.filter((c) => c.coberta).length,
        contasTotal: contas.length,
        contasSemExtrato,
        semDespesa
      },
      foraDaDre
    };
  } catch (error) {
    console.error("[financeiro] DRE indisponível:", error);
    return dreIndisponivel();
  }
}
