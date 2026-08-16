import "server-only";

import { isFinanceConfigured, query } from "../db";
import {
  Condicoes,
  contrato,
  contratoIndisponivel,
  ENTIDADE,
  type Contrato,
  type Drill,
  type Medida,
  type Pendencia
} from "./base";

/**
 * As views gerenciais que só respondiam por SQL.
 *
 * Folha prevista, comissão, recorrentes, contratos e parcelas, DRE por dimensão,
 * fluxo por conta e receita por grupo. Todas existiam, todas estavam medidas, e
 * nenhuma tinha endereço HTTP — o que na prática significava que só quem tinha
 * `psql` no terminal conseguia lê-las.
 *
 * O QUE ELAS TÊM EM COMUM, e por isso estão no mesmo arquivo: cada uma carrega
 * uma coluna que NÃO é número — `fixo_base`, `motivo`, `conflito_camada`,
 * `documento_match`, `certeza`, `papel_conflita`. É a coluna que diz de onde o
 * número veio ou por que ele não existe. Um mapeamento que pega só as colunas
 * `*_cents` produz uma API mais limpa e uma tela que mente.
 *
 * Regra única deste arquivo: se a view escreveu um motivo, o motivo sai no JSON.
 */

// ---------------------------------------------------------------------------
// Folha prevista
// ---------------------------------------------------------------------------

const DOMINIO_FOLHA = "folha";

/** Um componente previsto da folha, com de onde veio a previsão. */
export type ComponenteFolha = {
  valorCents: number;
  /** `contratado`, `observado`, `estimado`. Não é adjetivo: muda o que se pode afirmar. */
  confianca: string;
  /** A frase que a view escreveu explicando a base do cálculo. */
  base: string | null;
};

export type PessoaNaFolha = {
  pessoaId: number;
  pessoa: string;
  vinculo: string | null;
  nucleo: string | null;
  /** O que o cadastro diz: `ativo` / `inativo`. */
  situacaoCadastro: string | null;
  /** O que a folha observou: pode contradizer o cadastro, e a contradição é o dado. */
  situacaoNaFolha: string | null;
  mesesPagos: number;
  ultimoPagamento: string | null;
  fixo: ComponenteFolha;
  variavel: ComponenteFolha;
  reembolso: ComponenteFolha;
  totalCents: number;
  drill: Drill;
};

export type FolhaPrevista = {
  mesPrevisto: string | null;
  pessoasAtivas: number;
  /** Pessoas que a previsão exclui — e a razão está em cada linha de `pessoas`. */
  pessoasFora: number;
  fixoContratadoCents: number;
  /** Fixo que ninguém contratou: mediana observada. Previsão, não obrigação. */
  fixoObservadoCents: number;
  fixoTotalCents: number;
  variavelCents: number;
  reembolsoCents: number;
  totalCents: number;
  pessoas: PessoaNaFolha[];
  /** Quanto do fixo previsto tem contrato por trás. */
  pctFixoContratado: number | null;
};

const FOLHA_VAZIA: FolhaPrevista = {
  mesPrevisto: null,
  pessoasAtivas: 0,
  pessoasFora: 0,
  fixoContratadoCents: 0,
  fixoObservadoCents: 0,
  fixoTotalCents: 0,
  variavelCents: 0,
  reembolsoCents: 0,
  totalCents: 0,
  pessoas: [],
  pctFixoContratado: null
};

/**
 * A folha do próximo mês, pessoa a pessoa.
 *
 * Não confundir com `getPessoas`, que entrega folha PACTUADA × REALIZADA (o que
 * foi combinado contra o que saiu). Esta aqui é PREVISÃO: o que vai sair no mês
 * que ainda não começou, com a base de cada previsão declarada.
 */
export async function getFolhaPrevisao(): Promise<Contrato<FolhaPrevista>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO_FOLHA, FOLHA_VAZIA, "banco financeiro não configurado");

  try {
    const [totais, pessoas] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT t.* FROM fin_folha_previsao_total_v t JOIN fin_entity e ON e.id = t.entity_id
          WHERE e.slug = $1 ORDER BY t.mes_previsto DESC LIMIT 1`,
        [ENTIDADE]
      ),
      query<Record<string, unknown>>(
        `SELECT p.* FROM fin_folha_previsao_v p JOIN fin_entity e ON e.id = p.entity_id
          WHERE e.slug = $1 ORDER BY p.total_cents DESC`,
        [ENTIDADE]
      )
    ]);

    const t = totais[0];
    const fixoTotal = Number(t?.fixo_total_cents ?? 0);
    const fixoContratado = Number(t?.fixo_contratado_cents ?? 0);

    const lista: PessoaNaFolha[] = pessoas.map((p) => ({
      pessoaId: Number(p.person_id),
      pessoa: String(p.pessoa),
      vinculo: (p.vinculo as string) ?? null,
      nucleo: (p.nucleo as string) ?? null,
      situacaoCadastro: (p.situacao_cadastro as string) ?? null,
      situacaoNaFolha: (p.situacao_na_folha as string) ?? null,
      mesesPagos: Number(p.meses_pagos ?? 0),
      ultimoPagamento: p.ultimo_pagamento ? String(p.ultimo_pagamento).slice(0, 10) : null,
      fixo: {
        valorCents: Number(p.fixo_cents ?? 0),
        confianca: String(p.fixo_confianca ?? "indeterminado"),
        base: (p.fixo_base as string) ?? null
      },
      variavel: {
        valorCents: Number(p.variavel_cents ?? 0),
        confianca: String(p.variavel_confianca ?? "indeterminado"),
        base: (p.variavel_base as string) ?? null
      },
      reembolso: {
        valorCents: Number(p.reembolso_cents ?? 0),
        confianca: String(p.reembolso_confianca ?? "indeterminado"),
        base: (p.reembolso_base as string) ?? null
      },
      totalCents: Number(p.total_cents ?? 0),
      drill: { dominio: "pessoas", filtros: { pessoa: Number(p.person_id) } }
    }));

    // Cadastro e folha discordando é fato conhecido, não bug: gente ativa que
    // não recebeu, e gente inativa que ainda aparece. Vira pendência porque
    // alguém tem de dizer qual dos dois está certo.
    const divergentes = lista.filter(
      (p) =>
        (p.situacaoCadastro === "ativo" && p.situacaoNaFolha !== "ativo na folha") ||
        (p.situacaoCadastro === "inativo" && p.situacaoNaFolha === "ativo na folha")
    );

    const pendencias: Pendencia[] = [];
    if (divergentes.length) {
      pendencias.push({
        chave: "folha_cadastro_diverge",
        titulo: "Pessoas em que o cadastro e a folha discordam",
        quantidade: divergentes.length,
        valorCents: divergentes.reduce((s, p) => s + p.totalCents, 0),
        severidade: "alerta",
        telaDeDecisao: "/financeiro/pessoas"
      });
    }

    return contrato({
      dominio: DOMINIO_FOLHA,
      dado: {
        mesPrevisto: t?.mes_previsto ? String(t.mes_previsto).slice(0, 10) : null,
        pessoasAtivas: Number(t?.pessoas_ativas ?? 0),
        pessoasFora: Number(t?.pessoas_fora ?? 0),
        fixoContratadoCents: fixoContratado,
        fixoObservadoCents: Number(t?.fixo_observado_cents ?? 0),
        fixoTotalCents: fixoTotal,
        variavelCents: Number(t?.variavel_cents ?? 0),
        reembolsoCents: Number(t?.reembolso_cents ?? 0),
        totalCents: Number(t?.total_cents ?? 0),
        pessoas: lista,
        pctFixoContratado: fixoTotal > 0 ? (fixoContratado / fixoTotal) * 100 : null
      },
      pendencias,
      ressalvas: [
        "`fixoObservadoCents` é mediana dos últimos 6 meses, não contrato. É a melhor previsão disponível para quem não tem remuneração declarada — e ninguém deve a ninguém esse valor.",
        "`variavel` é SEMPRE estimado: comissão contratada só se realiza se a receita vier. Tratá-lo como despesa certa antecipa um custo que pode não existir.",
        "`situacaoCadastro` e `situacaoNaFolha` podem discordar de propósito. Quando discordam, um dos dois está errado — e a previsão usa o observado."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:folha]", mensagem);
    return contratoIndisponivel(DOMINIO_FOLHA, FOLHA_VAZIA, mensagem);
  }
}

// ---------------------------------------------------------------------------
// Comissão
// ---------------------------------------------------------------------------

const DOMINIO_COMISSAO = "comissao";

export type ComissaoMedida = {
  contratoErpId: number;
  titulo: string;
  eixo: string | null;
  valorContratadoCents: number | null;
  dataAssinatura: string | null;
  papel: string;
  pessoa: string;
  pagoCents: number;
  pctSobreContrato: number | null;
  primeiraComissao: string | null;
  ultimaComissao: string | null;
  /**
   * Dias entre a assinatura e a primeira comissão. NEGATIVO significa comissão
   * paga antes de o contrato ser assinado — não é impossível (adiantamento), mas
   * é o tipo de coisa que ninguém deve descobrir por acaso.
   */
  diasAposAssinatura: number | null;
  /** A alíquota implícita não bate com o papel que o ERP dá à pessoa. */
  papelConflita: boolean;
};

export type ComissaoIndeterminada = {
  tipo: string;
  refId: number | null;
  data: string | null;
  valorCents: number;
  quem: string | null;
  /** Por que este pagamento não pôde virar comissão medida. */
  motivo: string;
};

export type Comissao = {
  medidas: ComissaoMedida[];
  indeterminados: ComissaoIndeterminada[];
  porTipoIndeterminado: { tipo: string; itens: number; valorCents: number; motivos: string[] }[];
  medidoCents: number;
  indeterminadoCents: number;
  /** Quanto do dinheiro rotulado como comissão a base consegue atribuir a um contrato. */
  coberturaPct: number | null;
  conflitosDePapel: number;
};

const COMISSAO_VAZIA: Comissao = {
  medidas: [],
  indeterminados: [],
  porTipoIndeterminado: [],
  medidoCents: 0,
  indeterminadoCents: 0,
  coberturaPct: null,
  conflitosDePapel: 0
};

export async function getComissao(): Promise<Contrato<Comissao>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO_COMISSAO, COMISSAO_VAZIA, "banco financeiro não configurado");
  }

  try {
    const [medidas, indeterminados] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT * FROM fin_comissao_medida_v ORDER BY pago_cents DESC, erp_contrato_id`
      ),
      query<Record<string, unknown>>(
        `SELECT * FROM fin_comissao_indeterminado_v ORDER BY valor_cents DESC NULLS LAST`
      )
    ]);

    const lista: ComissaoMedida[] = medidas.map((m) => ({
      contratoErpId: Number(m.erp_contrato_id),
      titulo: String(m.titulo),
      eixo: (m.eixo as string) ?? null,
      valorContratadoCents: m.valor_contratado_cents === null ? null : Number(m.valor_contratado_cents),
      dataAssinatura: m.data_assinatura ? String(m.data_assinatura).slice(0, 10) : null,
      papel: String(m.papel),
      pessoa: String(m.pessoa),
      pagoCents: Number(m.pago_cents ?? 0),
      pctSobreContrato: m.pct_sobre_contrato === null ? null : Number(m.pct_sobre_contrato) * 100,
      primeiraComissao: m.primeira_comissao ? String(m.primeira_comissao).slice(0, 10) : null,
      ultimaComissao: m.ultima_comissao ? String(m.ultima_comissao).slice(0, 10) : null,
      diasAposAssinatura: m.dias_apos_assinatura === null ? null : Number(m.dias_apos_assinatura),
      papelConflita: Boolean(m.papel_conflita)
    }));

    const naoAtribuidos: ComissaoIndeterminada[] = indeterminados.map((i) => ({
      tipo: String(i.tipo),
      refId: i.ref_id === null ? null : Number(i.ref_id),
      data: i.data ? String(i.data).slice(0, 10) : null,
      valorCents: Number(i.valor_cents ?? 0),
      quem: (i.quem as string) ?? null,
      motivo: String(i.motivo)
    }));

    const porTipo = new Map<string, { tipo: string; itens: number; valorCents: number; motivos: Set<string> }>();
    for (const i of naoAtribuidos) {
      const atual = porTipo.get(i.tipo) ?? { tipo: i.tipo, itens: 0, valorCents: 0, motivos: new Set<string>() };
      atual.itens += 1;
      atual.valorCents += i.valorCents;
      atual.motivos.add(i.motivo);
      porTipo.set(i.tipo, atual);
    }

    const medido = lista.reduce((s, m) => s + m.pagoCents, 0);
    const indeterminado = naoAtribuidos.reduce((s, i) => s + i.valorCents, 0);
    const universo = medido + indeterminado;
    const conflitos = lista.filter((m) => m.papelConflita).length;

    const pendencias: Pendencia[] = [];
    if (naoAtribuidos.length) {
      pendencias.push({
        chave: "comissao_indeterminada",
        titulo: "Pagamentos de comissão que não casaram com um contrato",
        quantidade: naoAtribuidos.length,
        valorCents: indeterminado,
        severidade: "alerta",
        telaDeDecisao: "/financeiro/qualificar"
      });
    }
    if (conflitos) {
      pendencias.push({
        chave: "comissao_papel_conflita",
        titulo: "Comissões cuja alíquota não bate com o papel declarado no ERP",
        quantidade: conflitos,
        valorCents: lista.filter((m) => m.papelConflita).reduce((s, m) => s + m.pagoCents, 0),
        severidade: "alerta",
        telaDeDecisao: null
      });
    }

    return contrato({
      dominio: DOMINIO_COMISSAO,
      dado: {
        medidas: lista,
        indeterminados: naoAtribuidos,
        porTipoIndeterminado: [...porTipo.values()]
          .map((t) => ({ tipo: t.tipo, itens: t.itens, valorCents: t.valorCents, motivos: [...t.motivos] }))
          .sort((a, b) => b.valorCents - a.valorCents),
        medidoCents: medido,
        indeterminadoCents: indeterminado,
        coberturaPct: universo > 0 ? (medido / universo) * 100 : null,
        conflitosDePapel: conflitos
      },
      pendencias,
      ressalvas: [
        "`medidas` é comissão que casou com um contrato do ERP. `indeterminados` é dinheiro rotulado como comissão que NÃO casou — e some da leitura de quem olhar só a primeira lista.",
        "`pctSobreContrato` é alíquota IMPLÍCITA (pago ÷ valor contratado), não a regra. Quando `papelConflita` é verdadeiro, a implícita e a regra do papel discordam.",
        "`diasAposAssinatura` negativo é comissão paga antes da assinatura do contrato. Pode ser adiantamento legítimo; não pode passar despercebido.",
        "Nenhuma linha daqui autoriza pagamento. É medição do que já saiu."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:comissao]", mensagem);
    return contratoIndisponivel(DOMINIO_COMISSAO, COMISSAO_VAZIA, mensagem);
  }
}

// ---------------------------------------------------------------------------
// Recorrentes
// ---------------------------------------------------------------------------

const DOMINIO_RECORRENTES = "recorrentes";

export type Recorrente = {
  id: number;
  camada: string;
  procedencia: string;
  rotulo: string;
  direcao: string;
  status: string;
  confianca: string;
  /** Preenchido quando a mesma obrigação já é projetada por outra camada. Somar dobraria. */
  conflitoCamada: string | null;
  contraparte: string | null;
  categoriaCode: string | null;
  categoria: string | null;
  nucleo: string | null;
  conta: string | null;
  cadencia: string | null;
  diaDoMes: number | null;
  regraDeVencimento: string | null;
  valorCents: number;
  /** O que foi declarado por alguém, quando existe. Confronta com o observado. */
  declaradoCents: number | null;
  divergenciaDeclaradaCents: number | null;
  inicio: string | null;
  fim: string | null;
  ocorrencias: number;
  spanMeses: number | null;
  /** Regularidade observada: perto de 1 é mensal certinho; baixo é ruído. */
  densidade: number | null;
  dispersao: number | null;
  concentracaoNoDia: number | null;
  ultimaOcorrencia: string | null;
  drill: Drill;
};

export type PainelRecorrentes = {
  itens: Recorrente[];
  porStatus: { status: string; direcao: string; itens: number; totalCents: number }[];
  ativoMensalCents: { pagar: number; receber: number };
  propostoMensalCents: { pagar: number; receber: number };
  comConflitoDeCamada: number;
  comDivergenciaDeclarada: number;
};

const RECORRENTES_VAZIO: PainelRecorrentes = {
  itens: [],
  porStatus: [],
  ativoMensalCents: { pagar: 0, receber: 0 },
  propostoMensalCents: { pagar: 0, receber: 0 },
  comConflitoDeCamada: 0,
  comDivergenciaDeclarada: 0
};

export async function getRecorrentes(
  filtros: { status?: string; direcao?: string; confianca?: string } = {}
): Promise<Contrato<PainelRecorrentes>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO_RECORRENTES, RECORRENTES_VAZIO, "banco financeiro não configurado");
  }

  const cond = new Condicoes(["e.slug = $1"], [ENTIDADE]);
  cond.add("r.status = $?", filtros.status);
  cond.add("r.direction = $?", filtros.direcao);
  cond.add("r.confidence = $?", filtros.confianca);

  try {
    const linhas = await query<Record<string, unknown>>(
      `SELECT r.* FROM fin_recorrente_v r JOIN fin_entity e ON e.id = r.entity_id
        WHERE ${cond.where}
        ORDER BY r.status, r.direction, r.amount_cents DESC`,
      cond.params
    );

    const itens: Recorrente[] = linhas.map((r) => ({
      id: Number(r.id),
      camada: String(r.camada),
      procedencia: String(r.procedencia),
      rotulo: String(r.label),
      direcao: String(r.direction),
      status: String(r.status),
      confianca: String(r.confidence),
      // String vazia é "sem conflito" na view; deixá-la passar como texto faria a
      // tela desenhar um selo de conflito vazio.
      conflitoCamada: r.conflito_camada ? String(r.conflito_camada) : null,
      contraparte: (r.contraparte as string) ?? null,
      categoriaCode: (r.categoria_code as string) ?? null,
      categoria: (r.categoria as string) ?? null,
      nucleo: (r.nucleo as string) ?? null,
      conta: (r.conta as string) ?? null,
      cadencia: (r.cadence as string) ?? null,
      diaDoMes: r.day_of_month === null ? null : Number(r.day_of_month),
      regraDeVencimento: (r.due_day_rule as string) ?? null,
      valorCents: Number(r.amount_cents ?? 0),
      declaradoCents: r.declarado_cents === null ? null : Number(r.declarado_cents),
      divergenciaDeclaradaCents:
        r.divergencia_declarada_cents === null ? null : Number(r.divergencia_declarada_cents),
      inicio: r.start_month ? String(r.start_month).slice(0, 10) : null,
      fim: r.end_month ? String(r.end_month).slice(0, 10) : null,
      ocorrencias: Number(r.ocorrencias ?? 0),
      spanMeses: r.span_meses === null ? null : Number(r.span_meses),
      densidade: r.densidade === null ? null : Number(r.densidade),
      dispersao: r.dispersao === null ? null : Number(r.dispersao),
      concentracaoNoDia: r.day_concentration === null ? null : Number(r.day_concentration),
      ultimaOcorrencia: r.last_seen_on ? String(r.last_seen_on).slice(0, 10) : null,
      drill: { dominio: "lancamentos", filtros: { recorrente: Number(r.id) } }
    }));

    const somar = (status: string, direcao: string) =>
      itens.filter((i) => i.status === status && i.direcao === direcao).reduce((s, i) => s + i.valorCents, 0);

    const porStatus = new Map<string, { status: string; direcao: string; itens: number; totalCents: number }>();
    for (const i of itens) {
      const chave = `${i.status}|${i.direcao}`;
      const atual = porStatus.get(chave) ?? { status: i.status, direcao: i.direcao, itens: 0, totalCents: 0 };
      atual.itens += 1;
      atual.totalCents += i.valorCents;
      porStatus.set(chave, atual);
    }

    const propostos = itens.filter((i) => i.status === "proposto").length;

    return contrato({
      dominio: DOMINIO_RECORRENTES,
      dado: {
        itens,
        porStatus: [...porStatus.values()].sort((a, b) => b.totalCents - a.totalCents),
        ativoMensalCents: { pagar: somar("ativo", "pagar"), receber: somar("ativo", "receber") },
        propostoMensalCents: { pagar: somar("proposto", "pagar"), receber: somar("proposto", "receber") },
        comConflitoDeCamada: itens.filter((i) => i.conflitoCamada !== null).length,
        comDivergenciaDeclarada: itens.filter(
          (i) => i.divergenciaDeclaradaCents !== null && i.divergenciaDeclaradaCents !== 0
        ).length
      },
      pendencias: propostos
        ? [
            {
              chave: "recorrente_proposta",
              titulo: "Recorrentes detectadas aguardando confirmação humana",
              quantidade: propostos,
              valorCents: itens.filter((i) => i.status === "proposto").reduce((s, i) => s + i.valorCents, 0),
              severidade: "alerta",
              telaDeDecisao: "/financeiro/qualificar"
            }
          ]
        : [],
      ressalvas: [
        "`proposto` é detecção do histórico, não obrigação: ninguém confirmou que a série continua. Somá-lo ao `ativo` afirma um compromisso que não existe.",
        "`conflitoCamada` preenchido significa que a mesma obrigação também é projetada como fatura de cartão ou conta a pagar. Somar as camadas conta a mesma despesa duas vezes.",
        "`densidade` e `dispersao` são a evidência da recorrência, não enfeite: densidade baixa com muitas ocorrências é ruído sendo lido como assinatura mensal."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:recorrentes]", mensagem);
    return contratoIndisponivel(DOMINIO_RECORRENTES, RECORRENTES_VAZIO, mensagem);
  }
}

// ---------------------------------------------------------------------------
// Contratos e parcelas
// ---------------------------------------------------------------------------

const DOMINIO_CONTRATOS = "contratos";

export type ContratoEspelhado = {
  erpId: number;
  codigo: string | null;
  titulo: string;
  clienteRazaoSocial: string | null;
  clienteDocumento: string | null;
  contraparteId: number | null;
  /** Como a contraparte foi casada, ou por que não foi. */
  contraparteMatch: string | null;
  contraparteNomeDiverge: boolean;
  eixo: string | null;
  nucleo: string | null;
  valorContratadoCents: number | null;
  /** Soma das parcelas. Diverge do contratado quando o cronograma está incompleto. */
  valorParcelasCents: number | null;
  divergenciaCronogramaCents: Medida;
  dataAssinatura: string | null;
  dataInicio: string | null;
  dataFimPrevista: string | null;
  vendedor: string | null;
  statusErp: string | null;
  statusLedger: string | null;
  parcelas: number;
  parcelasComCobranca: number;
  drill: Drill;
};

export type ParcelaEspelhada = {
  id: number;
  contratoErpId: number;
  numero: number | null;
  descricao: string | null;
  valorCents: number;
  vencimento: string | null;
  statusErp: string | null;
  /** `asaas_payment_id` = tem cobrança emitida; `sem_cobranca` = não tem lastro. */
  documentoMatch: string | null;
  temCobranca: boolean;
  documentoId: number | null;
};

export type CoberturaContratos = {
  contratos: number;
  contratosComContraparte: number;
  contratosCnpjDaCasa: number;
  contratosSemNucleo: number;
  contratosSemCronograma: number;
  contratosParcelasNaoBatem: number;
  parcelas: number;
  parcelasSemVencimento: number;
  parcelasComCobranca: number;
  parcelasComNota: number;
  parcelasPaymentOrfao: number;
  alocacoes: number;
  alocacoesComCentroCusto: number;
  parcelasAlocacaoNaoBate: number;
};

export type IndeterminadoContrato = {
  assunto: string;
  contratoErpId: number | null;
  referencia: string | null;
  motivo: string;
  valorCents: number | null;
  /** A pergunta literal que precisa de resposta humana. */
  pergunta: string;
};

export type PainelContratos = {
  contratos: ContratoEspelhado[];
  parcelas: ParcelaEspelhada[];
  cobertura: CoberturaContratos | null;
  indeterminados: IndeterminadoContrato[];
  /** Contratos que existem no ledger financeiro (`fin_contract`), não no espelho do ERP. */
  contratosNoLedger: number;
  totalContratadoCents: number;
  totalParcelasCents: number;
  /** Parcelas em aberto sem cobrança emitida: receita prevista sem lastro. */
  previstoSemCobrancaCents: number;
};

const CONTRATOS_VAZIO: PainelContratos = {
  contratos: [],
  parcelas: [],
  cobertura: null,
  indeterminados: [],
  contratosNoLedger: 0,
  totalContratadoCents: 0,
  totalParcelasCents: 0,
  previstoSemCobrancaCents: 0
};

/**
 * Contratos e parcelas, do espelho do ERP.
 *
 * ATENÇÃO À FONTE: `erp_contrato` e `erp_contrato_parcela` são o ESPELHO do
 * erp-obras dentro do banco financeiro do Railway. Esta função nunca toca o
 * Supabase do Adryan — o espelho é a fronteira, e ela é de leitura dos dois
 * lados. `fin_contract` é outra coisa: o registro de contrato do próprio ledger,
 * usado para projeção de recorrência. Os dois números aparecem separados porque
 * somá-los contaria o mesmo contrato duas vezes.
 */
export async function getContratosEParcelas(
  filtros: { contratoErpId?: number; statusErp?: string; semCobranca?: boolean; limite?: number } = {}
): Promise<Contrato<PainelContratos>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO_CONTRATOS, CONTRATOS_VAZIO, "banco financeiro não configurado");
  }

  const limite = Math.min(Math.max(filtros.limite ?? 500, 1), 2000);

  const condC = new Condicoes();
  condC.add("c.erp_id = $?", filtros.contratoErpId);
  condC.add("c.status_erp = $?", filtros.statusErp);

  const condP = new Condicoes();
  condP.add("p.erp_contrato_id = $?", filtros.contratoErpId);
  if (filtros.semCobranca) condP.raw("p.documento_match = 'sem_cobranca'");

  try {
    const limiteC = condC.proximo(limite);
    const limiteP = condP.proximo(limite);

    const [contratos, parcelas, cobertura, indeterminados, noLedger] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT c.*,
                (SELECT count(*) FROM erp_contrato_parcela p WHERE p.erp_contrato_id = c.erp_id)::text AS n_parcelas,
                (SELECT count(*) FROM erp_contrato_parcela p
                  WHERE p.erp_contrato_id = c.erp_id AND p.asaas_payment_id IS NOT NULL)::text AS n_com_cobranca
           FROM erp_contrato c
          WHERE ${condC.where}
          ORDER BY c.valor_contratado_cents DESC NULLS LAST, c.erp_id
          LIMIT ${limiteC}`,
        condC.params
      ),
      query<Record<string, unknown>>(
        `SELECT p.* FROM erp_contrato_parcela p
          WHERE ${condP.where}
          ORDER BY p.data_vencimento NULLS LAST, p.erp_contrato_id, p.numero
          LIMIT ${limiteP}`,
        condP.params
      ),
      query<Record<string, unknown>>(`SELECT * FROM erp_contrato_cobertura_v LIMIT 1`),
      query<Record<string, unknown>>(
        `SELECT * FROM erp_contrato_indeterminado_v ORDER BY valor_cents DESC NULLS LAST LIMIT 200`
      ),
      query<{ n: string }>(
        `SELECT count(*)::text AS n FROM fin_contract c JOIN fin_entity e ON e.id = c.entity_id WHERE e.slug = $1`,
        [ENTIDADE]
      )
    ]);

    const listaContratos: ContratoEspelhado[] = contratos.map((c) => {
      const contratado = c.valor_contratado_cents === null ? null : Number(c.valor_contratado_cents);
      const emParcelas = c.valor_parcelas_cents === null ? null : Number(c.valor_parcelas_cents);
      return {
        erpId: Number(c.erp_id),
        codigo: (c.codigo as string) ?? null,
        titulo: String(c.titulo),
        clienteRazaoSocial: (c.cliente_razao_social as string) ?? null,
        clienteDocumento: (c.cliente_documento as string) ?? null,
        contraparteId: c.counterparty_id === null ? null : Number(c.counterparty_id),
        contraparteMatch: (c.counterparty_match as string) ?? null,
        contraparteNomeDiverge: Boolean(c.counterparty_nome_diverge),
        eixo: (c.eixo as string) ?? null,
        nucleo: (c.nucleo as string) ?? null,
        valorContratadoCents: contratado,
        valorParcelasCents: emParcelas,
        // Sem um dos dois lados não há divergência a afirmar — e zero aqui diria
        // "o cronograma bate", que é justamente o que não se sabe.
        divergenciaCronogramaCents:
          contratado === null || emParcelas === null
            ? {
                valorCents: null,
                motivo:
                  contratado === null
                    ? "contrato sem valor declarado no ERP"
                    : "contrato sem cronograma de parcelas no ERP"
              }
            : { valorCents: emParcelas - contratado, motivo: null },
        dataAssinatura: c.data_assinatura ? String(c.data_assinatura).slice(0, 10) : null,
        dataInicio: c.data_inicio ? String(c.data_inicio).slice(0, 10) : null,
        dataFimPrevista: c.data_fim_prevista ? String(c.data_fim_prevista).slice(0, 10) : null,
        vendedor: (c.vendedor as string) ?? null,
        statusErp: (c.status_erp as string) ?? null,
        statusLedger: (c.status_ledger as string) ?? null,
        parcelas: Number(c.n_parcelas ?? 0),
        parcelasComCobranca: Number(c.n_com_cobranca ?? 0),
        drill: { dominio: "receber", filtros: { contrato: Number(c.erp_id) } }
      };
    });

    const listaParcelas: ParcelaEspelhada[] = parcelas.map((p) => ({
      id: Number(p.id),
      contratoErpId: Number(p.erp_contrato_id),
      numero: p.numero === null ? null : Number(p.numero),
      descricao: (p.descricao as string) ?? null,
      valorCents: Number(p.valor_cents ?? 0),
      vencimento: p.data_vencimento ? String(p.data_vencimento).slice(0, 10) : null,
      statusErp: (p.status_erp as string) ?? null,
      documentoMatch: (p.documento_match as string) ?? null,
      temCobranca: p.asaas_payment_id !== null && p.asaas_payment_id !== undefined,
      documentoId: p.fin_document_id === null ? null : Number(p.fin_document_id)
    }));

    const cov = cobertura[0];
    const semCobranca = listaParcelas
      .filter((p) => !p.temCobranca && p.statusErp !== "PAGA")
      .reduce((s, p) => s + p.valorCents, 0);

    const indets: IndeterminadoContrato[] = indeterminados.map((i) => ({
      assunto: String(i.assunto),
      contratoErpId: i.contrato_erp_id === null ? null : Number(i.contrato_erp_id),
      referencia: (i.referencia as string) ?? null,
      motivo: String(i.motivo),
      valorCents: i.valor_cents === null ? null : Number(i.valor_cents),
      pergunta: String(i.pergunta)
    }));

    return contrato({
      dominio: DOMINIO_CONTRATOS,
      dado: {
        contratos: listaContratos,
        parcelas: listaParcelas,
        cobertura: cov
          ? {
              contratos: Number(cov.contratos ?? 0),
              contratosComContraparte: Number(cov.contratos_com_contraparte ?? 0),
              contratosCnpjDaCasa: Number(cov.contratos_cnpj_da_casa ?? 0),
              contratosSemNucleo: Number(cov.contratos_sem_nucleo ?? 0),
              contratosSemCronograma: Number(cov.contratos_sem_cronograma ?? 0),
              contratosParcelasNaoBatem: Number(cov.contratos_parcelas_nao_batem ?? 0),
              parcelas: Number(cov.parcelas ?? 0),
              parcelasSemVencimento: Number(cov.parcelas_sem_vencimento ?? 0),
              parcelasComCobranca: Number(cov.parcelas_com_cobranca ?? 0),
              parcelasComNota: Number(cov.parcelas_com_nota ?? 0),
              parcelasPaymentOrfao: Number(cov.parcelas_payment_orfao ?? 0),
              alocacoes: Number(cov.alocacoes ?? 0),
              alocacoesComCentroCusto: Number(cov.alocacoes_com_centro_custo ?? 0),
              parcelasAlocacaoNaoBate: Number(cov.parcelas_alocacao_nao_bate ?? 0)
            }
          : null,
        indeterminados: indets,
        contratosNoLedger: Number(noLedger[0]?.n ?? 0),
        totalContratadoCents: listaContratos.reduce((s, c) => s + (c.valorContratadoCents ?? 0), 0),
        totalParcelasCents: listaParcelas.reduce((s, p) => s + p.valorCents, 0),
        previstoSemCobrancaCents: semCobranca
      },
      pendencias: indets.length
        ? [
            {
              chave: "contrato_indeterminado",
              titulo: "Contratos que precisam de decisão humana",
              quantidade: indets.length,
              valorCents: indets.reduce((s, i) => s + (i.valorCents ?? 0), 0),
              severidade: "alerta",
              telaDeDecisao: "/financeiro/qualificar"
            }
          ]
        : [],
      ressalvas: [
        "Fonte: espelho do erp-obras dentro do banco financeiro (`erp_contrato*`). O Supabase do erp-obras NÃO é consultado por esta rota.",
        "`contratosNoLedger` conta `fin_contract`, que é outro registro (projeção de recorrência do próprio ledger). Somar com o espelho contaria o mesmo contrato duas vezes.",
        "Parcela sem cobrança emitida é receita PREVISTA, não faturada. Ela não pode entrar no a receber junto com a cobrança emitida — seria a mesma receita duas vezes.",
        "`indeterminados` traz a pergunta literal que trava cada caso. Casar cliente por nome parecido é proibido nesta base: só documento resolve."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:contratos]", mensagem);
    return contratoIndisponivel(DOMINIO_CONTRATOS, CONTRATOS_VAZIO, mensagem);
  }
}

// ---------------------------------------------------------------------------
// DRE por dimensão
// ---------------------------------------------------------------------------

const DOMINIO_DIMENSAO = "resultado.dimensao";

export type Dimensao = "nucleo" | "cliente" | "centro_custo";

/**
 * Como cada dimensão vira chave e rótulo no SQL.
 *
 * Lista branca porque o nome vem da URL. Interpolar `?dimensao=` direto seria
 * injeção; aceitar só estes três é o que torna a interpolação segura.
 */
const EIXOS: Record<Dimensao, { chave: string; rotulo: string }> = {
  nucleo: { chave: "d.nucleo", rotulo: "d.nucleo" },
  cliente: { chave: "d.counterparty_id::text", rotulo: "d.cliente" },
  centro_custo: { chave: "d.cost_center_id::text", rotulo: "d.centro_custo" }
};

const MOTIVO_SEM_ATRIBUICAO: Record<Dimensao, string> = {
  nucleo: "lançamento sem núcleo atribuído",
  cliente: "lançamento sem contraparte identificada",
  centro_custo: "lançamento sem centro de custo (o projeto vem do erp-obras e ainda não cobre tudo)"
};

export type LinhaDimensao = {
  chave: string | null;
  rotulo: string | null;
  /** Falso quando a dimensão não foi atribuída. O motivo vem junto. */
  atribuido: boolean;
  motivoNaoAtribuido: string | null;
  receitaBrutaCents: number;
  deducoesCents: number;
  custosDiretosCents: number;
  despesasPessoalCents: number;
  despesasComerciaisCents: number;
  despesasAdministrativasCents: number;
  resultadoFinanceiroCents: number;
  lucroLiquidoCents: number;
  capexCents: number;
  /** O que o ledger não explica dentro desta fatia. */
  lacunasCents: number;
  lancamentos: number;
  drill: Drill;
};

export type DrePorDimensao = {
  visao: "caixa" | "competencia";
  dimensao: Dimensao;
  de: string | null;
  ate: string | null;
  linhas: LinhaDimensao[];
  /** Quanto do resultado do recorte não tem a dimensão atribuída. */
  pctNaoAtribuido: number | null;
  lacunasTotaisCents: number;
};

const DIMENSAO_VAZIA: DrePorDimensao = {
  visao: "caixa",
  dimensao: "nucleo",
  de: null,
  ate: null,
  linhas: [],
  pctNaoAtribuido: null,
  lacunasTotaisCents: 0
};

export async function getDrePorDimensao(
  opcoes: { visao?: "caixa" | "competencia"; dimensao?: Dimensao; de?: string; ate?: string; ano?: number } = {}
): Promise<Contrato<DrePorDimensao>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO_DIMENSAO, DIMENSAO_VAZIA, "banco financeiro não configurado");
  }

  const visao = opcoes.visao === "competencia" ? "competencia" : "caixa";
  const dimensao: Dimensao = opcoes.dimensao && opcoes.dimensao in EIXOS ? opcoes.dimensao : "nucleo";
  const eixo = EIXOS[dimensao];

  const cond = new Condicoes(["e.slug = $1", "d.visao = $2"], [ENTIDADE, visao]);
  cond.add("d.mes >= $?", opcoes.de);
  cond.add("d.mes <= $?", opcoes.ate);
  cond.add("EXTRACT(year FROM d.mes) = $?::int", opcoes.ano);

  try {
    const linhas = await query<Record<string, unknown>>(
      `SELECT ${eixo.chave} AS chave, MIN(${eixo.rotulo}) AS rotulo,
              SUM(d.receita_bruta_cents)             AS receita_bruta_cents,
              SUM(d.deducoes_cents)                  AS deducoes_cents,
              SUM(d.custos_diretos_cents)            AS custos_diretos_cents,
              SUM(d.despesas_pessoal_cents)          AS despesas_pessoal_cents,
              SUM(d.despesas_comerciais_cents)       AS despesas_comerciais_cents,
              SUM(d.despesas_administrativas_cents)  AS despesas_administrativas_cents,
              SUM(d.resultado_financeiro_cents)      AS resultado_financeiro_cents,
              SUM(d.lucro_liquido_cents)             AS lucro_liquido_cents,
              SUM(d.capex_cents)                     AS capex_cents,
              SUM(d.lacunas_cents)                   AS lacunas_cents,
              SUM(d.lancamentos)                     AS lancamentos
         FROM fin_dre_dimensao_v d JOIN fin_entity e ON e.id = d.entity_id
        WHERE ${cond.where}
        GROUP BY 1
        ORDER BY SUM(d.receita_bruta_cents) DESC NULLS LAST, 1`,
      cond.params
    );

    const itens: LinhaDimensao[] = linhas.map((l) => {
      const chave = l.chave === null || l.chave === undefined ? null : String(l.chave);
      return {
        chave,
        rotulo: (l.rotulo as string) ?? null,
        atribuido: chave !== null,
        motivoNaoAtribuido: chave === null ? MOTIVO_SEM_ATRIBUICAO[dimensao] : null,
        receitaBrutaCents: Number(l.receita_bruta_cents ?? 0),
        deducoesCents: Number(l.deducoes_cents ?? 0),
        custosDiretosCents: Number(l.custos_diretos_cents ?? 0),
        despesasPessoalCents: Number(l.despesas_pessoal_cents ?? 0),
        despesasComerciaisCents: Number(l.despesas_comerciais_cents ?? 0),
        despesasAdministrativasCents: Number(l.despesas_administrativas_cents ?? 0),
        resultadoFinanceiroCents: Number(l.resultado_financeiro_cents ?? 0),
        lucroLiquidoCents: Number(l.lucro_liquido_cents ?? 0),
        capexCents: Number(l.capex_cents ?? 0),
        lacunasCents: Number(l.lacunas_cents ?? 0),
        lancamentos: Number(l.lancamentos ?? 0),
        drill: { dominio: "lancamentos", filtros: { [dimensao]: chave, de: opcoes.de ?? null } }
      };
    });

    const totalAbs = itens.reduce((s, i) => s + Math.abs(i.lucroLiquidoCents), 0);
    const naoAtribuidoAbs = itens
      .filter((i) => !i.atribuido)
      .reduce((s, i) => s + Math.abs(i.lucroLiquidoCents), 0);

    return contrato({
      dominio: DOMINIO_DIMENSAO,
      dado: {
        visao,
        dimensao,
        de: opcoes.de ?? null,
        ate: opcoes.ate ?? null,
        linhas: itens,
        pctNaoAtribuido: totalAbs > 0 ? (naoAtribuidoAbs / totalAbs) * 100 : null,
        lacunasTotaisCents: itens.reduce((s, i) => s + i.lacunasCents, 0)
      },
      ressalvas: [
        "A fatia com `atribuido: false` NÃO é 'outros': é o que não tem a dimensão preenchida. Escondê-la faria as demais fatias parecerem o todo.",
        "O centro de custo vem do erp-obras e cobre uma minoria dos lançamentos. Ler margem por projeto sem olhar `pctNaoAtribuido` é ler uma amostra como se fosse o universo.",
        "`lacunasCents` é o que o ledger não explica dentro da fatia — ele não entra no lucro da linha e some se ignorado."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:dimensao]", mensagem);
    return contratoIndisponivel(DOMINIO_DIMENSAO, DIMENSAO_VAZIA, mensagem);
  }
}

// ---------------------------------------------------------------------------
// Fluxo de caixa por conta
// ---------------------------------------------------------------------------

const DOMINIO_FLUXO_CONTA = "fluxo.conta";

export type MesFluxoConta = {
  contaId: number;
  conta: string;
  tipoConta: string | null;
  mes: string;
  saldoInicialCents: number;
  /** Saldo de abertura declarado. Entra no saldo final e NÃO no movimento. */
  aberturaCents: number;
  operacionalCents: number;
  investimentoCents: number;
  financiamentoCents: number;
  transferenciaInternaCents: number;
  saidaSemHistoricoCents: number;
  naoClassificadoCents: number;
  movimentoCents: number;
  saldoFinalCents: number;
  /** saldo inicial + abertura + movimento − saldo final. Tem de ser zero. */
  residuoCents: number;
  fecha: boolean;
  lancamentos: number;
};

export async function getFluxoPorConta(
  opcoes: { ano?: number; conta?: string } = {}
): Promise<Contrato<MesFluxoConta[]>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO_FLUXO_CONTA, [], "banco financeiro não configurado");
  }

  const cond = new Condicoes(["e.slug = $1"], [ENTIDADE]);
  cond.add("EXTRACT(year FROM f.mes) = $?::int", opcoes.ano);
  cond.add("f.conta = $?", opcoes.conta);

  try {
    const linhas = await query<Record<string, unknown>>(
      `SELECT f.* FROM fin_fluxo_caixa_conta_v f JOIN fin_entity e ON e.id = f.entity_id
        WHERE ${cond.where} ORDER BY f.mes DESC, f.conta`,
      cond.params
    );

    const itens: MesFluxoConta[] = linhas.map((f) => {
      const inicial = Number(f.saldo_inicial_cents ?? 0);
      const abertura = Number(f.abertura_cents ?? 0);
      const movimento = Number(f.movimento_cents ?? 0);
      const final = Number(f.saldo_final_cents ?? 0);
      // A identidade é `inicial + abertura + movimento = final`. A abertura fica
      // FORA do movimento de propósito: declarar saldo inicial não é movimentar
      // dinheiro, e somá-la ao movimento inventaria uma entrada operacional no
      // primeiro mês de cada conta.
      const residuo = inicial + abertura + movimento - final;
      return {
        contaId: Number(f.account_id),
        conta: String(f.conta),
        tipoConta: (f.conta_kind as string) ?? null,
        mes: String(f.mes).slice(0, 10),
        saldoInicialCents: inicial,
        aberturaCents: abertura,
        operacionalCents: Number(f.operacional_cents ?? 0),
        investimentoCents: Number(f.investimento_cents ?? 0),
        financiamentoCents: Number(f.financiamento_cents ?? 0),
        transferenciaInternaCents: Number(f.transferencia_interna_cents ?? 0),
        saidaSemHistoricoCents: Number(f.saida_sem_historico_cents ?? 0),
        naoClassificadoCents: Number(f.nao_classificado_cents ?? 0),
        movimentoCents: movimento,
        saldoFinalCents: final,
        residuoCents: residuo,
        fecha: residuo === 0,
        lancamentos: Number(f.lancamentos ?? 0)
      };
    });

    const quebradas = itens.filter((i) => !i.fecha);

    return contrato({
      dominio: DOMINIO_FLUXO_CONTA,
      dado: itens,
      pendencias: quebradas.length
        ? [
            {
              chave: "fluxo_conta_nao_fecha",
              titulo: "Meses de conta cujo saldo não reconstrói",
              quantidade: quebradas.length,
              valorCents: quebradas.reduce((s, i) => s + i.residuoCents, 0),
              severidade: "bloqueante",
              telaDeDecisao: "/financeiro/contas"
            }
          ]
        : [],
      ressalvas: [
        "Identidade da linha: saldo inicial + abertura + movimento = saldo final. `aberturaCents` fica fora do movimento porque declarar saldo não é movimentar dinheiro.",
        "`naoClassificadoCents` é caixa que andou sem natureza declarada: ele entra no saldo (o dinheiro andou mesmo) e não entra na DRE.",
        "Somar as contas mês a mês reproduz o fluxo consolidado, MENOS a transferência interna, que se cancela entre contas. Comparar as duas leituras sem descontá-la acusa uma diferença que não existe."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:fluxo.conta]", mensagem);
    return contratoIndisponivel(DOMINIO_FLUXO_CONTA, [], mensagem);
  }
}

// ---------------------------------------------------------------------------
// Receita por grupo
// ---------------------------------------------------------------------------

const DOMINIO_RECEITA_GRUPO = "receita.grupo";

export type ReceitaGrupo = {
  mes: string;
  grupo: string;
  /** De onde vem a confiança do número: nota, cobrança liquidada, presunção. */
  certeza: string;
  itens: number;
  clientes: number;
  totalCents: number;
  pctDoMes: number | null;
  drill: Drill;
};

export async function getReceitaPorGrupo(
  opcoes: { ano?: number; mes?: string } = {}
): Promise<Contrato<ReceitaGrupo[]>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO_RECEITA_GRUPO, [], "banco financeiro não configurado");
  }

  try {
    const linhas = await query<Record<string, unknown>>(
      `SELECT * FROM fin_receita_por_grupo_v
        WHERE ($1::int IS NULL OR EXTRACT(year FROM mes) = $1::int)
          AND ($2::date IS NULL OR mes = $2::date)
        ORDER BY mes DESC, total_cents DESC`,
      [opcoes.ano ?? null, opcoes.mes ?? null]
    );

    return contrato({
      dominio: DOMINIO_RECEITA_GRUPO,
      dado: linhas.map((l) => ({
        mes: String(l.mes).slice(0, 10),
        grupo: String(l.grupo),
        certeza: String(l.certeza),
        itens: Number(l.itens ?? 0),
        clientes: Number(l.clientes ?? 0),
        totalCents: Number(l.total_cents ?? 0),
        pctDoMes: l.pct_do_mes === null ? null : Number(l.pct_do_mes),
        drill: { dominio: "receber", filtros: { grupo: String(l.grupo), de: String(l.mes).slice(0, 10) } }
      })),
      ressalvas: [
        "`certeza` diz o que sustenta cada grupo. Grupos de certeza diferente na mesma pizza dão a impressão de que todos valem o mesmo — e não valem.",
        "`pctDoMes` é participação DENTRO do mês. Comparar percentuais entre meses de tamanhos diferentes não diz nada sobre crescimento."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:receita.grupo]", mensagem);
    return contratoIndisponivel(DOMINIO_RECEITA_GRUPO, [], mensagem);
  }
}
