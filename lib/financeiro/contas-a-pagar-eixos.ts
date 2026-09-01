/**
 * Os eixos de Contas a pagar — a parte que não fala com banco.
 *
 * Vive separado de `contas-a-pagar.ts` pelo mesmo motivo que
 * `custo-empresa-eixos.ts` vive separado de `custos-empresa.ts`: aquele arquivo
 * abre com `import "server-only"`, e um módulo com essa linha não pode ser
 * carregado por `scripts/`. Sem esta separação a classificação seria testável
 * só através do banco de produção — que é o único banco que existe aqui.
 */

/** O corte de topo. `empresa` é o que a matriz de Custo da empresa classifica. */
export type GrupoContas = "empresa" | "folha" | "das" | "cartao";

/*
 * PESSOAS PRIMEIRO — a ordem é a do caixa, não a da contabilidade.
 *
 * Começou com "Custo da empresa" no topo, espelhando a matriz ao lado. Estava
 * errado para esta tela: quem abre "Contas a pagar" está montando o pagamento
 * do mês, e a folha é a maior saída por uma margem larga — R$ 439.556,81
 * projetados contra R$ 40.044,75 de recorrentes em set/26. Enterrar a maior
 * saída no terceiro bloco obriga a rolar a tela para achar o que se veio
 * fazer.
 *
 * A matriz continua com custo primeiro, e está certa lá: a pergunta dela é
 * "com o que a empresa gasta", e pessoa é justamente o que ela exclui.
 */
export const GRUPOS: { slug: GrupoContas; nome: string; ondeJaEConta: string | null; dica: string }[] = [
  {
    slug: "folha",
    nome: "Pessoas",
    ondeJaEConta: "/financeiro/pessoas",
    dica: "A folha do mês, quebrada por natureza — cada parte vira um PIX, para a conferência depois bater sozinha."
  },
  {
    slug: "empresa",
    nome: "Custo da empresa",
    ondeJaEConta: null,
    dica: "O que sai e não é pessoa — nos mesmos blocos da matriz ao lado."
  },
  {
    slug: "das",
    nome: "Simples Nacional (DAS)",
    ondeJaEConta: "/financeiro/mei",
    dica: "Imposto sobre a receita do mês anterior."
  },
  {
    slug: "cartao",
    nome: "Fatura de cartão",
    ondeJaEConta: "/financeiro/cartoes",
    dica: "O caixa da fatura. Os itens dentro dela já aparecem como custo no mês da compra."
  }
];

export type Certeza = "firme" | "provavel" | "observado" | "atrasado" | "indeterminado";

/** Por que uma linha não pode virar ordem de pagamento. Null = pode. */
export type ImpedimentoPagar =
  | "ja_realizado"
  | "duplicada"
  | "sem_favorecido"
  | "sem_chave_pix"
  | "valor_invalido"
  | null;

export const MOTIVO_IMPEDIMENTO: Record<Exclude<ImpedimentoPagar, null>, string> = {
  ja_realizado: "já saiu do caixa",
  duplicada: "outra linha desta tela já conta este dinheiro",
  sem_favorecido: "sem favorecido identificado",
  sem_chave_pix: "sem chave PIX cadastrada para o favorecido",
  valor_invalido: "sem valor"
};

/**
 * De que camada da agenda vem cada grupo.
 *
 * As camadas são as da `fin_previsao_evento_v` (0079) e chegam aqui pela
 * `fin_agenda_dia_v`. `pagar_folha`, `pagar_tributo_das` e as três de cartão
 * são exatamente as que `custos-empresa.ts` declara como camadas EXCLUÍDAS da
 * matriz — por isso elas ganham grupo próprio em vez de bloco.
 *
 * A CATEGORIA ENTRA NA DECISÃO POR CAUSA DAS RECORRENTES 6.x
 *
 * Uma recorrente de categoria 6.01/6.02/6.05 é pagamento de PESSOA, não custo
 * da empresa — e é ela que carrega a composição que a tela precisa mostrar.
 * Medido em 31/08/2026: das 55 recorrentes de pagamento, 24 são 6.x, uma por
 * (pessoa × natureza). Fernando aparece na 388 com R$ 5.365,52 de pró-labore;
 * Igor, nas 408 e 395, com R$ 11.509,13 e R$ 1.231,42.
 *
 * É exatamente a quebra que faz o pagamento bater na conferência depois: cada
 * natureza é uma linha, e cada linha vira um PIX. Deixá-las em "Custo da
 * empresa" as escondia no bloco errado — e a matriz ao lado já as exclui de
 * propósito, porque gente é contado em Pessoas.
 *
 * O `pagar_folha` continua vindo para cá também, e os dois convivem de
 * propósito: um é a projeção agregada da 0077, o outro é a composição real. A
 * divergência entre eles é grande (R$ 439.556,81 contra R$ 40.044,75 no total
 * de recorrentes em set/26) e está registrada em AGENTS.md — quem decide qual
 * vale é o dono, não esta função.
 */
export function grupoDaCamada(camada: string, categoriaCode?: string | null): GrupoContas {
  if (camada.startsWith("pagar_cartao")) return "cartao";
  if (camada === "pagar_tributo_das") return "das";
  if (camada === "pagar_folha" || camada === CAMADA_COMPOSICAO) return "folha";
  /*
   * 6.x É GENTE, VENHA DE ONDE VIER — e a exceção por camada era um bug.
   *
   * Isto dizia `camada === "pagar_recorrente" && ehCategoriaDePessoa(...)`, e
   * deixava passar o resto. Medido em set/2026: 3 documentos do ClickUp
   * ("Folha 09/2026 — Denilson", "— Tallany", "— Adryan"), R$ 5.900 que SOMAM,
   * caíam em "Custo da empresa" — um bloco que jura não contar pessoa — e as
   * mesmas pessoas já apareciam na composição da folha, com R$ 2.100 e
   * R$ 2.200. O mesmo dinheiro, contado nos dois blocos.
   *
   * A regra passa a ser a categoria, não a camada, porque é a categoria que
   * responde "isto é pagamento de gente?". Camada é procedência, e procedência
   * nova aparecendo amanhã não pode reabrir o buraco.
   */
  if (ehCategoriaDePessoa(categoriaCode)) return "folha";
  return "empresa";
}

/**
 * A camada das linhas que esta tela sintetiza a partir do cadastro da pessoa.
 *
 * Não vem de `fin_previsao_evento_v` — é nossa, montada em `contas-a-pagar.ts`
 * a partir de `fin_time_remuneracao_mes_v`. Fica nomeada aqui, e não como
 * string solta lá, porque `grupoDaCamada` precisa reconhecê-la: um corte que
 * existe em dois arquivos é um corte que diverge.
 */
export const CAMADA_COMPOSICAO = "pagar_folha_composicao";

/**
 * 6.x é gente: salário, pró-labore, encargo, benefício, reembolso, estágio.
 *
 * Mesmo corte que `custos-empresa.ts` usa para EXCLUIR gente da matriz
 * (`c.code NOT LIKE '6.%'`). Escrito aqui de novo em vez de importado porque
 * lá ele mora dentro de uma string SQL, e um corte que existe em dois idiomas
 * é um corte que diverge.
 */
export function ehCategoriaDePessoa(categoriaCode: string | null | undefined): boolean {
  return typeof categoriaCode === "string" && categoriaCode.startsWith("6.");
}

/**
 * A natureza do pagamento, no vocabulário de `fin_time_remuneracao_mes_v`
 * (0163) — que já emite seis: salário, pró-labore, comissão, reembolso, extra
 * e estágio.
 *
 * O mapa é por código de categoria porque é o que a agenda entrega. Comissão
 * não aparece aqui: ela vive em `fin_comissao_prevista`, e as 309 previsões
 * (R$ 84.946,77) estão com `person_id` NULO — não há como atribuí-las a
 * ninguém. Enquanto isso não mudar, comissão não é uma natureza pagável, e
 * inventar um rateio seria pior que a ausência.
 */
/*
 * DE CATEGORIA PARA NATUREZA — e os RÓTULOS SÃO OS MESMOS de NATUREZA_DA_VIEW.
 *
 * Isto mapeava para "Encargos" e "Benefícios" separados, enquanto a view emite
 * a banda única `encargo_beneficio` → "Encargos e benefícios". Resultado, visto
 * na tela em 31/08/2026: TRÊS chips de filtro para a mesma coisa — "Encargos
 * (1) R$ 704", "Benefícios (3) R$ 705" e o da view. Quem quisesse pagar os
 * encargos teria de marcar dois ou três, sem nada dizendo que são o mesmo eixo.
 *
 * O mapa aponta para SLUG, e o rótulo sai de `NATUREZA_DA_VIEW` — assim os dois
 * caminhos (categoria do ledger e banda da view) não podem divergir, porque o
 * texto tem uma fonte só. 6.03 e 6.04 caem na mesma banda de propósito: é o que
 * a view já faz (`FILTER (WHERE cat.code IN ('6.03','6.04'))`).
 */
export const SLUG_POR_CATEGORIA: Record<string, string> = {
  "6.01": "salario",
  "6.02": "prolabore",
  "6.03": "encargo_beneficio",
  "6.04": "encargo_beneficio",
  "6.05": "reembolso",
  "6.06": "estagio"
};

/** O slug da natureza, ou null quando não é gente. Estável para ordenar. */
export function naturezaSlugDe(categoriaCode: string | null | undefined): string | null {
  if (!ehCategoriaDePessoa(categoriaCode)) return null;
  return SLUG_POR_CATEGORIA[categoriaCode as string] ?? "extra";
}

export function naturezaDe(categoriaCode: string | null | undefined): string | null {
  const slug = naturezaSlugDe(categoriaCode);
  if (!slug) return null;
  return NATUREZA_DA_VIEW[slug] ?? "Outros";
}

/**
 * O vocabulário de `fin_time_remuneracao_mes_v` em português de tela.
 *
 * A view foi redefinida SEIS vezes; a que vale é a da **0171**, não a 0163.
 * Importa saber disso: a partir da 0164 ela passou a ler
 * `fin_pessoa_salario_base` num LATERAL com `vigente_desde <= mes`, então ela
 * separa salário de pró-labore mesmo quando o ledger põe tudo em 6.02. Eu tinha
 * lido a 0163 e concluído o contrário — o AGENTS.md item 00 também descreve o
 * estado antigo e está desatualizado.
 *
 * (O que confundiu: o Belo aparece sem banda de salário em AGOSTO. Não é a
 * view — o salário base dele foi cadastrado em 29/08/2026, e agosto é
 * `2026-08-01`. Em setembro a vigência já vale e a banda aparece.)
 *
 * São as partes que compõem o pagamento de uma pessoa, e é por elas que a folha
 * é quebrada em N PIX. `extra` vira "Outros" porque é o que a 0160
 * descreve: não é categoria, é o que sobra — "qualquer outro pagamento à
 * pessoa cai em extra, e vê-lo separado é o ponto: é ali que mora o que
 * ninguém programou".
 *
 * A ORDEM É A DO PAGAMENTO, não alfabética: salário e pró-labore primeiro
 * porque são o compromisso fixo; reembolso por último porque é devolução, não
 * remuneração.
 */
export const NATUREZAS_DA_FOLHA = [
  "salario",
  "prolabore",
  "comissao",
  "estagio",
  "encargo_beneficio",
  "extra",
  "reembolso"
] as const;

export const NATUREZA_DA_VIEW: Record<string, string> = {
  salario: "Salário",
  prolabore: "Pró-labore",
  comissao: "Comissão",
  estagio: "Estágio",
  // A view sabe emitir esta banda (6.03 INSS/FGTS + 6.04 benefícios) e hoje não
  // há nenhuma linha dela. Fica nomeada mesmo assim: banda que aparece sem
  // rótulo vira slug cru na tela de pagamento, e slug cru numa tela de dinheiro
  // é onde alguém aprova sem entender o que está aprovando.
  encargo_beneficio: "Encargos e benefícios",
  extra: "Outros",
  reembolso: "Reembolso"
};

/**
 * De onde veio a comissão. Os dois pacotes que o dono paga separado são
 * consultoria e obras (`vendas_consultoria` / `vendas_obras` em
 * `fin_comissao_tipo`, 0178). O resto — diárias, lotes, gestão, sem tipo —
 * aparece como parte própria se tiver valor, nunca misturado nos dois
 * principais.
 *
 * NULL e slug desconhecido caem em `outras`. Carimbar obras ou consultoria
 * num lançamento sem tipo seria inventar a origem — a 0178 deixou as linhas
 * antigas NULL de propósito.
 */
export type PacoteComissao = "consultoria" | "obras" | "diarias" | "lotes" | "gestao" | "outras";

export const PACOTE_DO_TIPO: Record<string, PacoteComissao> = {
  vendas_consultoria: "consultoria",
  vendas_obras: "obras",
  diarias_servico: "diarias",
  vendas_lotes: "lotes",
  gestao: "gestao",
  outros: "outras"
};

export const ROTULO_PACOTE: Record<PacoteComissao, string> = {
  consultoria: "consultoria",
  obras: "obras",
  diarias: "diárias",
  lotes: "lotes",
  gestao: "gestão",
  outras: "outras"
};

export const ORDEM_PACOTE: PacoteComissao[] = [
  "consultoria",
  "obras",
  "diarias",
  "lotes",
  "gestao",
  "outras"
];

export function pacoteDaComissao(tipoSlug: string | null | undefined): PacoteComissao {
  if (!tipoSlug) return "outras";
  return PACOTE_DO_TIPO[tipoSlug] ?? "outras";
}

/**
 * Um lançamento de `fin_pessoa_comissao_declarada` neste mês. A linha de
 * contas a pagar CONTINUA UM PIX por pacote — estes pedaços só explicam de
 * onde o total veio. Virar obrigação cada um reabriria o PIX em dobro.
 */
export type PedacoComissao = {
  id: number;
  personId: number;
  pacote: PacoteComissao;
  descricao: string;
  cliente: string | null;
  tipoNome: string | null;
  parcela: number | null;
  parcelasTotal: number | null;
  serieId: number | null;
  ehEntrada: boolean;
  valorCents: number;
};

/**
 * Pedaços que batem nesta banda. Pacote null (mês passado, ou ordem antiga
 * na chave sem corte) leva todos; com pacote, só os daquela origem.
 */
export function pedacosDaComissao(
  natureza: string,
  pacote: PacoteComissao | null,
  todos: PedacoComissao[]
): PedacoComissao[] {
  if (natureza !== "comissao") return [];
  if (!pacote) return todos;
  return todos.filter((p) => p.pacote === pacote);
}

/**
 * Os três recortes da tela de Comissões. Consultoria e obras são os PIX que o
 * dono paga separado; diárias, lotes, gestão e sem tipo caem juntos em
 * `outras` — somá-los nos dois principais era o número único que a tela
 * mostrava.
 */
export type PacoteFiltroComissao = "consultoria" | "obras" | "outras";

export function pacoteFiltroDaOrigem(tipoSlug: string | null | undefined): PacoteFiltroComissao {
  const p = pacoteDaComissao(tipoSlug);
  return p === "consultoria" || p === "obras" ? p : "outras";
}

export function rotuloDaBanda(b: { natureza: string; pacote: PacoteComissao | null }): string {
  const base = NATUREZA_DA_VIEW[b.natureza] ?? b.natureza;
  if (b.natureza === "comissao" && b.pacote) return `Comissão · ${ROTULO_PACOTE[b.pacote]}`;
  return base;
}

/** Posição na ordem de pagamento. Natureza nova cai no fim, não some. */
export function ordemDaNatureza(natureza: string): number {
  const i = (NATUREZAS_DA_FOLHA as readonly string[]).indexOf(natureza);
  return i === -1 ? NATUREZAS_DA_FOLHA.length : i;
}

export function certezaDe(valor: unknown): Certeza {
  const s = String(valor ?? "");
  return s === "firme" || s === "provavel" || s === "observado" || s === "atrasado" ? s : "indeterminado";
}

/**
 * Mostra o suficiente para reconhecer a chave, nunca o bastante para usá-la.
 *
 * A tela é admin (o middleware tranca `/financeiro` por prefixo), então o risco
 * não é o visitante — é o print de tela e o compartilhamento de janela, que
 * acontecem toda semana numa casa que decide pagamento em reunião. Quem confere
 * quer saber "é o CNPJ certo?", e para isso os últimos dígitos bastam.
 *
 * A chave inteira nunca sai do servidor: quem paga é a rota, com o
 * `payee_account_id`, e ela relê a coordenada do banco na hora.
 */
export function mascararChave(chave: string | null, tipo: string | null): string | null {
  if (!chave) return null;
  const limpa = chave.trim();
  if (!limpa) return null;

  if (tipo === "EMAIL") {
    const corte = limpa.indexOf("@");
    if (corte <= 0) return `${limpa.slice(0, 2)}…`;
    return `${limpa.slice(0, Math.min(2, corte))}…${limpa.slice(corte)}`;
  }
  // CPF, CNPJ, telefone e EVP: os últimos 4 identificam sem reconstruir.
  if (limpa.length <= 4) return `…${limpa}`;
  return `…${limpa.slice(-4)}`;
}

/**
 * "Não soma" são DOIS estados, e tratá-los como um esvaziou a tela.
 *
 * Medido em 31/08/2026, competência 2026-09: 31 linhas de R$ 40.044,75 —
 * Ancora (aluguel), Compesa, Neoenergia, Claro, Embrasul, Localiza,
 * Dimensional — vinham com `entra_no_total = false` e a tela dizia "outra
 * linha já conta este dinheiro". Era FALSO: a consulta de disputa de chave
 * mostrou "vencedora: NENHUMA" para todas as 31. O motivo verdadeiro da view é
 * outro — "recorrente ainda não confirmada: só entra no cenário conservador".
 *
 * A diferença decide o produto:
 *
 *   DUPLICADA        outra linha desta tela conta o mesmo dinheiro. Pagar as
 *                    duas paga em dobro. Bloquear é a única saída correta.
 *   NÃO CONFIRMADA   ninguém conta. É conta de verdade, do mês, esperando
 *                    alguém dizer "sim, isso sai". Bloquear é esconder a
 *                    própria fila que a tela existe para mostrar.
 *
 * `naoConfirmada` NÃO é impedimento: é rótulo. O que ainda barra a linha é a
 * falta de favorecido ou de chave PIX — e essa é a fila de cadastro, não de
 * decisão.
 *
 * A distinção NÃO é feita lendo o texto do motivo (frase de view muda; a 0104
 * já reescreveu a dela uma vez). Vem de `outraLinhaConta`, que o SQL calcula
 * com `bool_or(entra_no_total) OVER (PARTITION BY chave_dedupe)`: se alguma
 * linha da mesma chave soma, esta é duplicada; se nenhuma soma, o dinheiro
 * está solto.
 *
 * A ordem das checagens é a mensagem. "Já saiu do caixa" precisa vencer "sem
 * chave PIX": invertido, a linha que já foi paga pediria cadastro de
 * favorecido, e alguém cadastraria — trabalho inventado sobre fato encerrado.
 */
export function impedimentoDe(l: {
  realizadoEm: string | null;
  entraNoTotal: boolean;
  outraLinhaConta: boolean;
  counterpartyId: number | null;
  payeeAccountId: number | null;
  valorCents: number;
}): ImpedimentoPagar {
  if (l.realizadoEm) return "ja_realizado";
  if (!l.entraNoTotal && l.outraLinhaConta) return "duplicada";
  if (l.valorCents <= 0) return "valor_invalido";
  if (l.counterpartyId == null) return "sem_favorecido";
  if (l.payeeAccountId == null) return "sem_chave_pix";
  return null;
}

/**
 * Conta de verdade que ninguém está contando: não soma, e nenhuma outra linha
 * da mesma chave soma por ela. É a fila de decisão do dono.
 */
export function naoConfirmadaDe(l: {
  realizadoEm: string | null;
  entraNoTotal: boolean;
  outraLinhaConta: boolean;
}): boolean {
  return !l.realizadoEm && !l.entraNoTotal && !l.outraLinhaConta;
}

/** Saiu do caixa — Inter, Nubank ou Asaas. O extrato vence o status da ordem. */
export function jaSaiuDoCaixa(l: {
  ordem: { pagoCents: number } | null;
  impedimento: ImpedimentoPagar;
  realizadoEm: string | null;
  realizadoCents: number;
}): boolean {
  if (l.ordem && l.ordem.pagoCents > 0) return true;
  if (l.impedimento === "ja_realizado") return true;
  return Boolean(l.realizadoEm && l.realizadoCents > 0);
}

export type EstadoCiclo =
  | "paga"
  | "aguardando"
  | "programada"
  | "em_curso"
  | "falta_cadastro"
  | "a_confirmar"
  | "pronta";

export function estadoDoCiclo(l: {
  ordem: { status: string; pagoCents: number } | null;
  impedimento: ImpedimentoPagar;
  entraNoTotal: boolean;
  realizadoEm: string | null;
  realizadoCents: number;
}): EstadoCiclo {
  if (jaSaiuDoCaixa(l)) return "paga";
  const o = l.ordem;
  if (o) {
    if (o.status === "aguardando_autorizacao") return "aguardando";
    if (o.status === "rascunho") return "programada";
    return "em_curso";
  }
  if (l.impedimento !== null) return "falta_cadastro";
  if (!l.entraNoTotal) return "a_confirmar";
  return "pronta";
}

/**
 * Identidade do FAVORITO. É a contraparte, não a linha do mês.
 *
 * Ancora continua estrela em outubro: o boleto é do mês (`chave_dedupe`), o
 * "eu sempre pago isto" é do fornecedor. Sem `counterparty_id` cai no nome
 * normalizado — homônimo funde, e é o custo de não ter cadastro.
 */
export function chaveFavorito(l: {
  counterpartyId: number | null;
  contraparte: string | null;
}): string | null {
  if (l.counterpartyId != null) return `cp:${l.counterpartyId}`;
  const nome = (l.contraparte ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return nome ? `nome:${nome}` : null;
}

export type FaixaPrazo = "atrasada" | "hoje" | "semana" | "mes" | "depois";

/** Dias civis entre duas datas ISO (`YYYY-MM-DD`). Sem fuso — data pura. */
export function diasEntre(de: string, ate: string): number {
  const [a1, m1, d1] = de.slice(0, 10).split("-").map(Number);
  const [a2, m2, d2] = ate.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

export function faixaPrazo(dia: string, hoje: string, vencido: boolean | null): FaixaPrazo {
  if (vencido || dia.slice(0, 10) < hoje.slice(0, 10)) return "atrasada";
  if (dia.slice(0, 10) === hoje.slice(0, 10)) return "hoje";
  const n = diasEntre(hoje, dia);
  if (n <= 7) return "semana";
  if (dia.slice(0, 7) === hoje.slice(0, 7)) return "mes";
  return "depois";
}

/**
 * "em 4 dias" / "1 dia de atraso". É o número que a pessoa usa para decidir
 * se pega o boleto hoje ou na sexta.
 */
export function rotuloPrazo(dia: string, hoje: string, vencido: boolean | null): string {
  const n = diasEntre(hoje.slice(0, 10), dia.slice(0, 10));
  if (vencido || n < 0) {
    const atraso = Math.abs(n);
    if (atraso === 0) return "venceu hoje";
    return atraso === 1 ? "1 dia de atraso" : `${atraso} dias de atraso`;
  }
  if (n === 0) return "vence hoje";
  if (n === 1) return "vence amanhã";
  return `em ${n} dias`;
}

export type MetodoPagamento = "pix" | "boleto" | "cartao" | "indefinido";

/** Os dois documentos que a fila de previstos pede. */
export type KindCobranca = "boleto" | "nota_fiscal";

/**
 * Como esta conta SAI, pelo que a linha já sabe — nunca pelo que a gente
 * gostaria que soubesse. Cartão vence fatura; PIX cadastrado vence boleto
 * na hora de pagar; boleto anexado só aparece quando o arquivo está lá.
 */
export function metodoDaLinha(l: {
  grupo: GrupoContas;
  pixMascarado: string | null;
  anexos: { kind: string }[];
}): MetodoPagamento {
  if (l.grupo === "cartao") return "cartao";
  if ((l.anexos ?? []).some((a) => a.kind === "boleto")) return "boleto";
  if (l.pixMascarado) return "pix";
  return "indefinido";
}
