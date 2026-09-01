import "server-only";

import { isFinanceConfigured, query } from "./db";
import { monthKeyLabel } from "./format";
import { sqlPessoaNaoEServicoDaCasa } from "./custo-empresa-eixos";
import { SQL_PREVISAO_CADASTRO } from "./previsao-cadastro";

/**
 * Custo com pessoas: quanto cada uma custa, de qual conta saiu, e quanto do
 * custo de gente esta tela NÃO consegue atribuir a ninguém.
 *
 * Seis decisões sustentam todo número deste arquivo. Nenhuma é óbvia lendo os
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
 * 6. LIMPEZA NÃO É FOLHA. Rita (papel Limpeza, 4.03, R$ 6.150 em 2026) está
 *    no roster porque o PIX tem CPF, mas o dono classificou como serviço do
 *    escritório. Entra em Custo da empresa; somar aqui E lá conta duas vezes.
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

/**
 * O domínio INTEIRO de `employment_type`, para o editor — não só o que já tem
 * linha.
 *
 * `vinculos` (mais abaixo) devolve apenas os vínculos PRESENTES, porque um
 * filtro que oferece opção sem linha ensina a não usar o filtro. Num combo de
 * edição a regra se inverte: oferecer só o que já existe torna impossível
 * registrar a primeira contratação CLT — que é exatamente a mudança que precisa
 * ser possível sem deploy.
 */
export const VINCULOS_DOMINIO: Opcao[] = ORDEM_VINCULO.map((slug) => ({
  slug,
  nome: ROTULO_VINCULO[slug]
}));

/** `fin_person.status`, tal como o CHECK de 0012 o define. */
export const STATUS_DOMINIO: Opcao[] = [
  { slug: "ativo", nome: "Ativo" },
  { slug: "inativo", nome: "Inativo" }
];

/**
 * Espelho do CHECK `fin_person_employment_type_check` (0026). O endpoint valida
 * também contra o `pg_get_constraintdef` real: esta lista dá a mensagem boa, o
 * banco dá a verdade. Duas listas que podem divergir seriam pior que uma — por
 * isso a daqui nunca é a última palavra.
 */
export function vinculoValido(valor: string): boolean {
  return Object.hasOwn(ROTULO_VINCULO, valor);
}

/**
 * Área é TEXTO LIVRE, e continua sendo — mas normalizada.
 *
 * O dono precisa poder criar "Pré-vendas" numa quinta-feira sem migration, o
 * que descarta enum. O que não pode acontecer é "Obras", "obras" e "obras "
 * virarem três times na mesma tabela: `TIME_SQL` compara slugs minúsculos
 * (`consultoria`, `obras`, e ainda `hardware`/`software` como alias de
 * consultoria). Um "Hardware" com maiúscula sairia do CASE e cairia em
 * "Sem time" sem erro nenhum. A normalização é o preço de manter o campo
 * aberto — mesma receita de slug da migração 0009, com `_` no lugar de `-`
 * para casar com os valores que já existem no banco.
 */
export function slugArea(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** "pre_vendas" → "Pre vendas". Só para o rótulo; o dado guardado é o slug. */
function rotuloArea(slug: string): string {
  const texto = slug.replace(/_/g, " ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Categoria de custo sugerida pelo VÍNCULO — e o silêncio deliberado onde o
 * vínculo não decide.
 *
 * Sócio não recebe salário, recebe pró-labore; bolsa de estágio é linha própria;
 * CLT é salário. Nesses três a lei já respondeu, e sugerir é seguro.
 *
 * MEI, PJ, irregular e indefinido ficam FORA do mapa de propósito. Um MEI que
 * desenvolve software o ano inteiro é custo fixo de pessoal; um MEI que executa
 * uma obra é custo variável direto daquela obra — e a diferença muda a margem
 * bruta, não só a linha. O vínculo não distingue os dois, e 12 das 33 pessoas
 * são MEI: chutar aqui seria mover a maior fatia da folha de linha na DRE com
 * base num campo que não carrega essa informação. É precisamente por isso que a
 * classificação precisa ser POR PESSOA, e não por vínculo.
 */
export const CATEGORIA_SUGERIDA_POR_VINCULO: Record<string, string> = {
  socio_adm: "6.02",
  socio: "6.02",
  estagiario: "6.06",
  clt: "6.01"
};

/**
 * A contraparte é uma instituição financeira, não uma pessoa?
 *
 * O importador do Inter preferia `nomeEmpresaRecebedor` — que num PIX é o BANCO
 * de destino — ao nome do favorecido, e colapsou 57 pessoas em 19 bancos
 * (migração 0027). Confirmar uma ligação dessas pendura o custo de meio time
 * numa pessoa só. A regra vive aqui, exportada, porque a tela precisa AVISAR e o
 * endpoint precisa RECUSAR — e duas cópias divergiriam no dia em que um banco
 * novo aparecesse.
 */
export function pareceInstituicaoFinanceira(nome: string): boolean {
  return /(banco|bco |nu pagamentos|nu financeira|santander|digio|itau|ita[uú]|caixa econ|bradesco|inter s\.a|cora scfi|picpay|stone|mercado pago|pagseguro|sicoob|sicredi|safra|c6)/i.test(
    nome
  );
}

const ROTULO_TIME: Record<string, string> = {
  consultoria: "Consultoria",
  obras: "Obras",
  administrativo: "Administrativo",
  outros: "Outros",
  software: "Software",
  hardware: "Hardware",
  sem_time: "Sem time"
};

/**
 * O select de time na matriz. Marketing e software saíram: marketing é
 * departamento (`fin_area_empresa`), software virou consultoria na 0170.
 */
const AREAS_TIME = ["consultoria", "obras", "administrativo", "outros"] as const;

/** Ordem do filtro "Por time". */
const ORDEM_TIME = ["consultoria", "obras", "administrativo", "outros", "sem_time"];

/**
 * Natureza lida do razão, com o rótulo dizendo de onde ela vem.
 *
 * 'nao_discriminado' não é uma categoria residual de conveniência: é 90% do
 * custo de gente de hoje, e chamá-la de "Fixo" seria a mentira mais cara que
 * esta tela poderia contar. O nome do rótulo declara a origem ("sem categoria no
 * extrato") para que ninguém leia o filtro como se fosse classificação.
 */
const ROTULO_BANDA: Record<string, string> = {
  salario: "Salário",
  prolabore: "Pró-labore",
  comissao: "Comissão",
  estagio: "Estágio",
  extra: "Extra",
  encargo_beneficio: "Encargo / benefício",
  reembolso: "Reembolso"
};

const ORDEM_BANDA = [
  "salario",
  "prolabore",
  "comissao",
  "estagio",
  "extra",
  "encargo_beneficio",
  "reembolso"
];

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
export const GUARDAS_SAIDA = `
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
 * Em 30/08/2026 o eixo do select fechou em quatro: consultoria, obras,
 * administrativo, outros. Software/hardware continuam caindo em consultoria
 * (0170). Marketing no campo velho não é time — é departamento — e quem ainda
 * tem esse slug no `fin_person.area` lê como outros até alguém gravar o novo.
 * Cadastro sem área (Leon, Tiago) continua sem_time.
 *
 * Espelho JS: `timeDaPessoa` em `custo-empresa-eixos.ts`. As duas têm de
 * dizer a mesma coisa — o filtro de Contas a pagar lê a função, a matriz
 * de Pessoas lê este CASE.
 */
const TIME_SQL = `
  CASE
    WHEN p.area IN ('hardware', 'software') THEN 'consultoria'
    WHEN p.area IN ('consultoria', 'obras', 'administrativo', 'outros') THEN p.area
    WHEN p.area IS NOT NULL AND btrim(p.area) <> '' THEN 'outros'
    WHEN p.default_nucleo IN ('obras', 'consultoria') THEN p.default_nucleo
    ELSE 'sem_time'
  END
`;

export type Natureza = "folha" | "variavel" | "reembolso" | "beneficio" | "nao_discriminado";

/** Uma opção de filtro. `slug` é o que o componente compara; `nome` é o que ele mostra. */
export type Opcao = { slug: string; nome: string };

export type Contraparte = {
  /** Id da LIGAÇÃO (fin_person_counterparty), não da contraparte: é o que o PATCH confirma. */
  linkId: number;
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
  /** Instituição financeira no lugar do favorecido (0027): confirmar seria erro. */
  ehBanco: boolean;
  decididoPor: string | null;
  decididoEm: string | null;
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
  // ── O que o editor precisa para EDITAR, não só para mostrar ──────────────
  /** Texto livre normalizado. `null` é pendência de cadastro, não "sem área". */
  area: string | null;
  areaRotulo: string | null;
  papel: string | null;
  defaultNucleo: string | null;
  inicio: string | null;
  fim: string | null;
  /**
   * Categoria de custo padrão desta pessoa. `null` enquanto a coluna
   * `fin_person.default_category_id` não existir (ver `categoriaPadraoDisponivel`).
   */
  categoriaPadrao: string | null;
  categoriaPadraoNome: string | null;
  /** O que o VÍNCULO sugere, quando ele decide sozinho. Nunca gravado por código. */
  categoriaSugerida: string | null;
  /**
   * Ligações ainda em 'proposto'. Separadas de `contrapartes` de propósito: só
   * link confirmado soma, e misturar as duas listas faria a contagem de
   * contrapartes da tabela principal incluir dinheiro que ninguém confirmou.
   */
  contrapartesPropostas: Contraparte[];
  /** Pendências do cadastro do app (WhatsApp, PIX, aniversário, senha). */
  cadastroApp: {
    whatsapp: boolean;
    email: boolean;
    cpf: boolean;
    pix: boolean;
    nascimento: boolean;
    senha: boolean;
  } | null;
  /**
   * Departamentos da casa (Marketing, Vendas…), N:N. Vazio é pendência, não
   * afirmação. Não confundir com `area` — aquela coluna é o time de entrega.
   */
  areasEmpresa: Opcao[];
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
 * Composição do que a pessoa recebeu no mês — a mesma conta do perfil
 * (`fin_time_remuneracao_mes_v`). Separada de `Celula` porque o extrato não
 * sabe cortar salário × pró-labore × comissão; a view reconstrói a fatia a
 * partir da base, da comissão declarada e do reembolso (competência + 1 mês).
 */
export type BandaRemuneracao = {
  personId: number;
  mes: string;
  natureza: string;
  cents: number;
};

/**
 * Previsão do mês seguinte a partir dos cadastros da pessoa — a mesma base do
 * perfil (`fin_pessoa_salario_base`, `fin_pessoa_prolabore_esperado`,
 * `fin_pessoa_comissao_declarada`, parcelas abertas de reembolso). Não é a
 * mediana observada de `fin_folha_previsao_v`.
 */
/**
 * O mês seguinte, no fuso de São Paulo — o mesmo que
 * `date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + 1 month`
 * produzia quando o cálculo morava dentro do SQL.
 */
function mesSeguinteEmSaoPaulo(): string {
  const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const proximo = new Date(agora.getFullYear(), agora.getMonth() + 1, 1);
  return `${proximo.getFullYear()}-${String(proximo.getMonth() + 1).padStart(2, "0")}`;
}

export type PrevisaoCadastro = {
  personId: number;
  /** Primeiro dia do mês previsto, no mesmo formato das bandas (`YYYY-MM-01`). */
  mes: string;
  porNatureza: Record<string, number>;
  totalCents: number;
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
  /** Id da linha de fin_person_counterparty — o alvo do confirmar/rejeitar. */
  linkId: number;
  personId: number;
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
  /** Maiores saídas sem favorecido — para a fila ver o texto do extrato. */
  saidasSemDono: SaidaSemDono[];
  suspeitos: Suspeito[];
  linksPropostos: LinkProposto[];
  pessoasSemContraparte: { id: number; nome: string; vinculo: string; vinculoRotulo: string }[];
  faturaCartaoCents: number;
  faturaCartaoN: number;
};

/** Uma saída sem contraparte, linha a linha. */
export type SaidaSemDono = {
  id: number;
  data: string;
  conta: string;
  cents: number;
  descricao: string;
};

/** Uma categoria de custo oferecível como padrão de pessoa. */
export type CategoriaOpcao = { code: string; nome: string; grupo: string; usos: number };

/**
 * Como os lançamentos JÁ confirmados de cada pessoa estão classificados hoje.
 *
 * É a prova do problema que o dono descreveu: 281 lançamentos em 6.01 Salários e
 * zero em 6.02 Pró-labore, numa empresa sem um único CLT. Sem esta lista ao lado
 * do combo, escolher a categoria padrão é escolher no escuro — o editor não teria
 * como mostrar o que a escolha contradiz.
 */
export type UsoCategoria = {
  personId: number;
  code: string | null;
  nome: string | null;
  n: number;
  cents: number;
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
  /** Tipos da composição (salário, pró-labore, comissão…). */
  tiposRemuneracao: Opcao[];
  pessoas: Pessoa[];
  celulas: Celula[];
  /** Composição por natureza — mesma fonte do perfil da pessoa. */
  bandas: BandaRemuneracao[];
  /** Mês seguinte ao corrente (fuso da empresa), chave `YYYY-MM-01`. */
  mesPrevisto: string;
  /** Previsão por pessoa a partir dos cadastros — alimenta a coluna da matriz. */
  previsaoCadastro: PrevisaoCadastro[];
  pactuado: Pactuado[];
  componentes: Componente[];
  cobertura: Cobertura;
  lacunas: { titulo: string; detalhe: string }[];
  // ── Domínios do editor ───────────────────────────────────────────────────
  /** As áreas EM USO, para sugerir no combo. O campo aceita uma nova a qualquer hora. */
  areas: Opcao[];
  /**
   * Catálogo de departamentos da empresa (`fin_area_empresa`). Independente
   * de `areas` — aquela lista é o time (consultoria/obras).
   */
  areasEmpresa: Opcao[];
  /** O CHECK inteiro de employment_type, não só o que já tem linha. */
  vinculosDominio: Opcao[];
  statusDominio: Opcao[];
  nucleos: Opcao[];
  categorias: CategoriaOpcao[];
  usoCategoria: UsoCategoria[];
  /**
   * `fin_person.default_category_id` existe neste banco?
   *
   * A coluna vem por migration, e migration não é aplicada por este módulo. Em
   * vez de a tela quebrar contra uma coluna que não existe — ou pior, de o campo
   * sumir sem explicação —, o editor mostra o combo desabilitado dizendo o que
   * falta. No dia em que a migration entrar, o campo liga sozinho.
   */
  categoriaPadraoDisponivel: boolean;
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
    tiposRemuneracao: [],
    pessoas: [],
    celulas: [],
    bandas: [],
    mesPrevisto: "",
    previsaoCadastro: [],
    pactuado: [],
    componentes: [],
    cobertura: {
      buracos: [],
      saidasSemDono: [],
      suspeitos: [],
      linksPropostos: [],
      pessoasSemContraparte: [],
      faturaCartaoCents: 0,
      faturaCartaoN: 0
    },
    lacunas: [],
    areas: [],
    areasEmpresa: [],
    vinculosDominio: VINCULOS_DOMINIO,
    statusDominio: STATUS_DOMINIO,
    nucleos: [],
    categorias: [],
    usoCategoria: [],
    categoriaPadraoDisponivel: false
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
    const [{ hoje, mes_atual: mesAtual, tem_categoria_padrao: temCategoriaPadrao }] = await query<{
      hoje: string;
      mes_atual: string;
      tem_categoria_padrao: boolean;
    }>(
      `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS hoje,
              to_char(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-01') AS mes_atual,
              EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'fin_person' AND column_name = 'default_category_id')
                AS tem_categoria_padrao`
    );

    // Interpolação de CONSTANTE, nunca de valor de usuário — mesma prática de
    // GUARDAS_SAIDA. Sem isto, a consulta referenciaria uma coluna inexistente e
    // a tela inteira cairia no catch, virando "banco indisponível" por causa de
    // uma migration pendente.
    const SQL_CATEGORIA_PADRAO = temCategoriaPadrao
      ? "cp.code AS categoria_padrao, cp.name AS categoria_padrao_nome"
      : "NULL::text AS categoria_padrao, NULL::text AS categoria_padrao_nome";
    const JOIN_CATEGORIA_PADRAO = temCategoriaPadrao
      ? "LEFT JOIN fin_category cp ON cp.id = p.default_category_id"
      : "";

    const [
      pessoasRows,
      linksRows,
      celulasRows,
      bandasRows,
      pactuadoRows,
      componentesRows,
      buracoRows,
      saidasSemDonoRows,
      suspeitoRows,
      faturaRows,
      contasRows,
      categoriasRows,
      nucleosRows,
      usoCategoriaRows,
      previsaoCadastroRows
    ] = await Promise.all([
        query<{
          id: number;
          nome: string;
          nome_legal: string | null;
          vinculo: string;
          time: string;
          status: string;
          area: string | null;
          papel: string | null;
          default_nucleo: string | null;
          inicio: string | null;
          fim: string | null;
          categoria_padrao: string | null;
          categoria_padrao_nome: string | null;
        }>(
          `SELECT p.id, p.name AS nome, p.legal_name AS nome_legal, p.employment_type AS vinculo,
                  ${TIME_SQL} AS time, p.status,
                  p.area, p.role AS papel, p.default_nucleo,
                  to_char(p.start_date, 'YYYY-MM-DD') AS inicio,
                  to_char(p.end_date, 'YYYY-MM-DD') AS fim,
                  ${SQL_CATEGORIA_PADRAO}
             FROM fin_person p
             JOIN fin_entity e ON e.id = p.entity_id
             ${JOIN_CATEGORIA_PADRAO}
            WHERE e.slug = $1
              AND ${sqlPessoaNaoEServicoDaCasa("p")}
            ORDER BY p.name`,
          [ENTITY]
        ),

        // Contrapartes de cada pessoa COM o realizado de cada uma. É esta coluna
        // que torna visível o motivo da tabela existir: para o Igor ela mostra
        // duas linhas, CNPJ e CPF, e a soma de uma só é metade do custo dele.
        query<{
          link_id: number;
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
          decidido_por: string | null;
          decidido_em: string | null;
        }>(
          `SELECT l.id AS link_id, l.person_id, c.id, c.name AS nome, c.document_number AS documento,
                  l.is_primary AS primaria, l.confidence::text AS confianca, l.method AS metodo, l.status,
                  l.confirmed_by AS decidido_por,
                  to_char(l.confirmed_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS decidido_em,
                  COALESCE(SUM(-t.amount_cents), 0) AS realizado,
                  count(t.id)::int AS n
             FROM fin_person_counterparty l
             JOIN fin_counterparty c ON c.id = l.counterparty_id
             JOIN fin_entity e ON e.id = l.entity_id
             LEFT JOIN fin_transaction t ON t.counterparty_id = c.id AND ${GUARDAS_SAIDA}
            WHERE e.slug = $1
            GROUP BY l.id, l.person_id, c.id, c.name, c.document_number, l.is_primary, l.confidence,
                     l.method, l.status, l.confirmed_by, l.confirmed_at
            ORDER BY l.is_primary DESC, realizado DESC`,
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
             JOIN fin_person pserv ON pserv.id = l.person_id AND ${sqlPessoaNaoEServicoDaCasa("pserv")}
             LEFT JOIN fin_category cat ON cat.id = t.category_id
            WHERE e.slug = $1 AND ${GUARDAS_SAIDA}
            GROUP BY 1, 2, 3, 4`,
          [ENTITY]
        ),

        // Mesma composição do perfil (/financeiro/pessoas/[id]): salário,
        // pró-labore, comissão, reembolso… O mês é o do PIX; o reembolso entra
        // como competência + 1 mês. Sem isso a matriz só tinha "tudo que saiu"
        // e não batia com a conta pessoal.
        query<{ person_id: number; mes: string; natureza: string; valor_cents: number }>(
          `SELECT r.person_id,
                  to_char(r.mes, 'YYYY-MM-01') AS mes,
                  r.natureza,
                  r.valor_cents
             FROM fin_time_remuneracao_mes_v r
             JOIN fin_entity e ON e.id = r.entity_id
            WHERE e.slug = $1
            ORDER BY r.mes, r.person_id, r.natureza`,
          [ENTITY]
        ).catch(() => [] as { person_id: number; mes: string; natureza: string; valor_cents: number }[]),

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

        // As saídas sem dono, uma a uma — o texto do extrato é o que a fila
        // precisa para decidir se é gente, fornecedor ou fatura mal etiquetada.
        // Top 40 por valor: cobre o buraco típico sem despejar o ledger inteiro.
        query<{ id: number; data: string; conta: string; cents: number; descricao: string }>(
          `SELECT t.id,
                  to_char(t.posted_on, 'YYYY-MM-DD') AS data,
                  a.slug AS conta,
                  (-t.amount_cents)::bigint AS cents,
                  left(coalesce(t.description_raw, t.description_norm, ''), 160) AS descricao
             FROM fin_transaction t
             JOIN fin_entity e ON e.id = t.entity_id
             JOIN fin_account a ON a.id = t.account_id
            WHERE e.slug = $1 AND ${GUARDAS_SAIDA}
              AND t.counterparty_id IS NULL
              AND a.kind = 'conta_corrente'
            ORDER BY (-t.amount_cents) DESC, t.posted_on DESC
            LIMIT 40`,
          [ENTITY]
        ),

        query<{ person_id: number; pessoa: string; mes: string; conta: string; cents: number; n: number; amostra: string }>(
          `WITH chave AS (
             SELECT DISTINCT p.id AS person_id, p.name AS pessoa, left(c.normalized_name, 18) AS prefixo
               FROM fin_person p
               JOIN fin_person_counterparty l ON l.person_id = p.id AND l.status = 'confirmado'
               JOIN fin_counterparty c ON c.id = l.counterparty_id
               JOIN fin_entity e ON e.id = p.entity_id
              WHERE e.slug = $1 AND length(c.normalized_name) >= 12
                AND ${sqlPessoaNaoEServicoDaCasa("p")}),
           -- DISTINCT por (pessoa, transação) antes de somar.
           --
           -- O CTE "chave" produz uma linha por CONTRAPARTE, e seis pessoas do time
           -- têm duas (recebem no CPF e no CNPJ). Sem este passo, o LIKE casa a
           -- mesma transação com os dois prefixos da MESMA pessoa e o GROUP BY
           -- soma as duas cópias — o painel chegou a imprimir um subconjunto
           -- maior que o conjunto ("38 saídas, R$ 47.763,62; destas,
           -- R$ 51.849,07 são do roster"), com R$ 15.985,00 contados em dobro
           -- em 4 transações.
           casado AS (
             SELECT DISTINCT k.person_id, k.pessoa, t.id AS tx_id,
                    t.posted_on, t.amount_cents, a.slug AS conta, t.description_raw
               FROM fin_transaction t
               JOIN fin_entity e ON e.id = t.entity_id
               JOIN fin_account a ON a.id = t.account_id
               JOIN chave k ON t.description_norm LIKE '%' || k.prefixo || '%'
              WHERE e.slug = $1 AND ${GUARDAS_SAIDA}
                AND t.counterparty_id IS NULL
                AND a.kind = 'conta_corrente')
           SELECT person_id, pessoa,
                  to_char(date_trunc('month', posted_on), 'YYYY-MM-01') AS mes,
                  conta,
                  SUM(-amount_cents) AS cents,
                  count(*)::int AS n,
                  (array_agg(description_raw ORDER BY amount_cents))[1] AS amostra
             FROM casado
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
        ),

        // As categorias oferecíveis como padrão de uma PESSOA.
        //
        // O filtro por `kind` não é cosmético: `fin_counterparty.default_category_id`
        // não tem dimensão de direção, e herdar uma categoria 3.xx num pagamento
        // lança despesa como receita (é a guarda `recusaPorDirecao` de
        // scripts/semear-categoria-padrao.mjs). Aqui a direção é conhecida — todo
        // pagamento a pessoa é saída —, então a lista já nasce sem receita,
        // dedução, imposto e movimentação financeira.
        //
        // 5.99 "Despesa a classificar" fica de fora pelo mesmo motivo do script:
        // cadastrar o balde como padrão é registrar a dívida de classificação em
        // vez de pagá-la, e faz o lançamento sair da fila parecendo resolvido.
        query<{ code: string; nome: string; grupo: string; usos: number }>(
          `SELECT c.code, c.name AS nome, c.kind AS grupo,
                  (SELECT count(*)::int FROM fin_transaction t WHERE t.category_id = c.id) AS usos
             FROM fin_category c JOIN fin_entity e ON e.id = c.entity_id
            WHERE e.slug = $1 AND c.is_active
              AND c.kind IN ('pessoal', 'custo_variavel_direto', 'despesa_operacional')
              AND c.code <> '5.99'
            ORDER BY c.code`,
          [ENTITY]
        ),

        query<{ slug: string; nome: string }>(
          `SELECT slug, name AS nome FROM fin_nucleo WHERE is_active ORDER BY slug`
        ),

        // Como o dinheiro JÁ confirmado de cada pessoa está classificado hoje.
        // Mesmas guardas e mesma junção das células: o editor precisa comparar a
        // escolha nova com o que está lá, e comparar contra outro recorte seria
        // comparar com outro número.
        query<{ person_id: number; code: string | null; nome: string | null; n: number; cents: number }>(
          `SELECT l.person_id, cat.code, cat.name AS nome, count(*)::int AS n, SUM(-t.amount_cents) AS cents
             FROM fin_transaction t
             JOIN fin_entity e ON e.id = t.entity_id
             JOIN fin_person_counterparty l ON l.counterparty_id = t.counterparty_id AND l.status = 'confirmado'
             JOIN fin_person pserv ON pserv.id = l.person_id AND ${sqlPessoaNaoEServicoDaCasa("pserv")}
             LEFT JOIN fin_category cat ON cat.id = t.category_id
            WHERE e.slug = $1 AND ${GUARDAS_SAIDA}
            GROUP BY 1, 2, 3
            ORDER BY 5 DESC`,
          [ENTITY]
        ),

        // Previsão do mês seguinte pelos cadastros.
        //
        // O SQL NÃO MORA MAIS AQUI. Ele é `SQL_PREVISAO_CADASTRO`, em
        // `lib/financeiro/previsao-cadastro.ts`, e a aba de Contas a pagar usa
        // exatamente o mesmo — por decisão do dono em 31/08/2026: "custo com
        // pessoas e custos da empresa deve ser a exata mesma base de dados".
        //
        // Duas cópias divergiam no primeiro ajuste, e já estavam divergindo:
        // esta consulta pegava a vigência mais recente sem olhar data, então um
        // reajuste cadastrado para outubro entraria já em setembro. O módulo
        // resolve a vigência PARA O MÊS PEDIDO, que é a regra que o app da
        // pessoa segue desde 29/08 (`vigenteEm`, time.ts:2116). Medido hoje: 0
        // linhas com vigência futura, então nenhum número muda agora.
        query<{
          person_id: number;
          mes: string;
          salario_cents: number;
          prolabore_cents: number;
          comissao_cents: number;
          reembolso_cents: number;
        }>(SQL_PREVISAO_CADASTRO, [ENTITY, mesSeguinteEmSaoPaulo()])
      ]);

    // ── Roster com as contrapartes penduradas ──────────────────────────────
    const paraContraparte = (linha: (typeof linksRows)[number]): Contraparte => ({
      linkId: linha.link_id,
      id: linha.id,
      nome: linha.nome,
      documento: linha.documento,
      primaria: linha.primaria,
      confianca: Number(linha.confianca),
      metodo: linha.metodo,
      status: linha.status,
      realizadoCents: linha.realizado,
      n: linha.n,
      ehBanco: pareceInstituicaoFinanceira(linha.nome),
      decididoPor: linha.decidido_por,
      decididoEm: linha.decidido_em
    });

    const linksPorPessoa = new Map<number, Contraparte[]>();
    const propostosPorPessoa = new Map<number, Contraparte[]>();
    for (const linha of linksRows) {
      // 'rejeitado' não entra em nenhuma das duas: é memória para o importador
      // não propor de novo o que um humano já recusou, não pendência aberta.
      const destino =
        linha.status === "confirmado"
          ? linksPorPessoa
          : linha.status === "proposto"
            ? propostosPorPessoa
            : null;
      if (!destino) continue;
      const lista = destino.get(linha.person_id) ?? [];
      lista.push(paraContraparte(linha));
      destino.set(linha.person_id, lista);
    }

    let flagsApp = new Map<number, import("@/lib/financeiro/pessoa-cadastro-app").CadastroAppFlags>();
    try {
      const { flagsCadastroAppPorPessoa } = await import("@/lib/financeiro/pessoa-cadastro-app");
      flagsApp = await flagsCadastroAppPorPessoa();
    } catch {
      /* migration 0175 ainda não aplicada — cadastro app fica neutro */
    }

    let areasEmpresaCatalogo: Opcao[] = [];
    const areasEmpresaPorPessoa = new Map<number, Opcao[]>();
    try {
      const [catalogoRows, ligacaoRows] = await Promise.all([
        query<{ slug: string; nome: string }>(
          `SELECT a.slug, a.nome
             FROM fin_area_empresa a
             JOIN fin_entity e ON e.id = a.entity_id
            WHERE e.slug = $1 AND a.ativo
            ORDER BY a.ordem, a.nome`,
          [ENTITY]
        ),
        query<{ person_id: number; slug: string; nome: string }>(
          `SELECT l.person_id, a.slug, a.nome
             FROM fin_pessoa_area_empresa l
             JOIN fin_area_empresa a ON a.id = l.area_id
             JOIN fin_entity e ON e.id = a.entity_id
            WHERE e.slug = $1 AND a.ativo
            ORDER BY a.ordem, a.nome`,
          [ENTITY]
        )
      ]);
      areasEmpresaCatalogo = catalogoRows.map((r) => ({ slug: r.slug, nome: r.nome }));
      for (const linha of ligacaoRows) {
        const lista = areasEmpresaPorPessoa.get(linha.person_id) ?? [];
        lista.push({ slug: linha.slug, nome: linha.nome });
        areasEmpresaPorPessoa.set(linha.person_id, lista);
      }
    } catch {
      /* migration 0180 ainda não aplicada — áreas da empresa ficam vazias */
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
      contrapartes: linksPorPessoa.get(linha.id) ?? [],
      area: linha.area,
      areaRotulo: linha.area ? (ROTULO_TIME[linha.area] ?? rotuloArea(linha.area)) : null,
      papel: linha.papel,
      defaultNucleo: linha.default_nucleo,
      inicio: linha.inicio,
      fim: linha.fim,
      categoriaPadrao: linha.categoria_padrao,
      categoriaPadraoNome: linha.categoria_padrao_nome,
      categoriaSugerida: CATEGORIA_SUGERIDA_POR_VINCULO[linha.vinculo] ?? null,
      contrapartesPropostas: propostosPorPessoa.get(linha.id) ?? [],
      cadastroApp: flagsApp.get(linha.id) ?? null,
      areasEmpresa: areasEmpresaPorPessoa.get(linha.id) ?? []
    }));

    const celulas: Celula[] = celulasRows.map((linha) => ({
      personId: linha.person_id,
      mes: linha.mes,
      conta: linha.conta,
      natureza: linha.natureza as Natureza,
      cents: linha.cents,
      n: linha.n
    }));

    const bandas: BandaRemuneracao[] = bandasRows.map((linha) => ({
      personId: Number(linha.person_id),
      mes: linha.mes,
      natureza: linha.natureza,
      cents: Number(linha.valor_cents)
    }));

    const previsaoCadastro: PrevisaoCadastro[] = previsaoCadastroRows.map((linha) => {
      const porNatureza: Record<string, number> = {};
      const salario = Number(linha.salario_cents);
      const prolabore = Number(linha.prolabore_cents);
      const comissao = Number(linha.comissao_cents);
      const reembolso = Number(linha.reembolso_cents);
      if (salario > 0) porNatureza.salario = salario;
      if (prolabore > 0) porNatureza.prolabore = prolabore;
      if (comissao > 0) porNatureza.comissao = comissao;
      if (reembolso > 0) porNatureza.reembolso = reembolso;
      return {
        personId: Number(linha.person_id),
        mes: linha.mes,
        porNatureza,
        totalCents: salario + prolabore + comissao + reembolso
      };
    });
    // Mês seguinte a `mesAtual` (`YYYY-MM-01`) — mesmo fuso da query acima.
    const mesPrevisto = (() => {
      if (previsaoCadastro[0]?.mes) return previsaoCadastro[0].mes;
      const [y, m] = mesAtual.slice(0, 7).split("-").map(Number);
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      return `${ny}-${String(nm).padStart(2, "0")}-01`;
    })();

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
    for (const linha of bandas) mesesSet.add(linha.mes);
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

    const saidasSemDono: SaidaSemDono[] = saidasSemDonoRows.map((linha) => ({
      id: Number(linha.id),
      data: linha.data,
      conta: linha.conta,
      cents: Number(linha.cents),
      descricao: linha.descricao
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
    // pendência vem marcada, e não só listada. A regra vive em
    // `pareceInstituicaoFinanceira` porque o endpoint de confirmação usa a MESMA:
    // avisar na tela e recusar no servidor não podem discordar.
    const nomePorPessoa = new Map(pessoasRows.map((p) => [p.id, p.nome]));
    const linksPropostos: LinkProposto[] = linksRows
      .filter((linha) => linha.status === "proposto")
      .map((linha) => ({
        linkId: linha.link_id,
        personId: linha.person_id,
        pessoa: nomePorPessoa.get(linha.person_id) ?? "—",
        contraparte: linha.nome,
        confianca: Number(linha.confianca),
        metodo: linha.metodo,
        saidaCents: linha.realizado,
        n: linha.n,
        ehBanco: pareceInstituicaoFinanceira(linha.nome)
      }))
      .sort((a, b) => b.saidaCents - a.saidaCents);

    const pessoasSemContraparte = pessoas
      .filter((p) => p.status === "ativo" && !p.contrapartes.length)
      .map((p) => ({ id: p.id, nome: p.nome, vinculo: p.vinculo, vinculoRotulo: p.vinculoRotulo }));

    const cobertura: Cobertura = {
      buracos,
      saidasSemDono,
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

    const tiposPresentes = new Set(bandas.map((b) => b.natureza));
    const tiposRemuneracao: Opcao[] = ORDEM_BANDA.filter((slug) => tiposPresentes.has(slug)).map((slug) => ({
      slug,
      nome: ROTULO_BANDA[slug] ?? slug
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

    const areas: Opcao[] = AREAS_TIME.map((slug) => ({
      slug,
      nome: ROTULO_TIME[slug]
    }));

    const nucleos: Opcao[] = nucleosRows.map((n) => ({ slug: n.slug, nome: n.nome }));

    const categorias: CategoriaOpcao[] = categoriasRows.map((c) => ({
      code: c.code,
      nome: c.nome,
      grupo: c.grupo,
      usos: c.usos
    }));

    const usoCategoria: UsoCategoria[] = usoCategoriaRows.map((linha) => ({
      personId: linha.person_id,
      code: linha.code,
      nome: linha.nome,
      n: linha.n,
      cents: linha.cents
    }));

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
      tiposRemuneracao,
      pessoas,
      celulas,
      bandas,
      mesPrevisto,
      previsaoCadastro,
      pactuado,
      componentes,
      cobertura,
      lacunas,
      areas,
      areasEmpresa: areasEmpresaCatalogo,
      vinculosDominio: VINCULOS_DOMINIO,
      statusDominio: STATUS_DOMINIO,
      nucleos,
      categorias,
      usoCategoria,
      categoriaPadraoDisponivel: temCategoriaPadrao
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
  natureza: ROTULO_NATUREZA,
  banda: ROTULO_BANDA
};
