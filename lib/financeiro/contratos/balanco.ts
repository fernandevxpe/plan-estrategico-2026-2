import "server-only";

import { isFinanceConfigured, query } from "../db";
import { contrato, contratoIndisponivel, ENTIDADE, type Contrato, type Medida, type Pendencia } from "./base";

/**
 * Balanço patrimonial e apuração tributária.
 *
 * Estes dois domínios existiam só como view e só respondiam por `psql`. O motivo
 * de terem ficado por último não é técnico: os dois são os que mais sabem o que
 * NÃO sabem, e expor um deles achatado seria pior que não expor.
 *
 * O CASO DO BALANÇO, que é o desenho inteiro desta frente em uma linha:
 *
 *   `fin_balanco_v` devolve `Empréstimos = 0`, com `observacao =
 *   'NÃO MODELADO: conta caixa-emprestimo sem lançamentos; Pronampe fora da base'`.
 *
 *   Uma API que devolve `{ linha: "Empréstimos", valorCents: 0 }` afirma que a
 *   empresa não deve nada a banco. Ela deve: `fin_balanco_lacuna_v` registra
 *   R$ 147.062,10 de Pronampe conhecidos e fora da base. O zero é a soma que a
 *   demonstração usou, não a dívida.
 *
 * Por isso `LinhaBalanco` carrega TRÊS coisas onde uma API comum carregaria uma:
 *
 *   `valor`                    Medida — null com motivo quando a linha é não modelada
 *   `valorNaDemonstracaoCents` o número que a view somou nos totais (o zero)
 *   `lacuna`                   a linha de `fin_balanco_lacuna_v`, com viés e caminho
 *
 * A tela pode mostrar "—" com um asterisco e, no asterisco, "sabe-se de
 * R$ 147.062,10; falta o extrato da conta Caixa". Nenhuma dessas três some.
 */

// ---------------------------------------------------------------------------
// Balanço
// ---------------------------------------------------------------------------

const DOMINIO_BALANCO = "balanco";

/** Prefixo com que a 0078 marca a linha que a demonstração não sabe medir. */
const MARCA_NAO_MODELADO = /^n[ãa]o modelado/i;

/** Uma lacuna declarada do balanço: o que falta, para que lado, e por onde se resolve. */
export type LacunaBalanco = {
  lacuna: string;
  lado: string;
  /** Para que lado o número mente enquanto a lacuna existir. */
  vies: string;
  motivo: string;
  /**
   * O que já se sabe do valor ausente, quando se sabe alguma coisa.
   *
   * Não é o valor da linha: é o pedaço conhecido por fora do ledger (a planilha
   * do dono, o contrato do Pronampe). Zero aqui significa "nem isso se sabe".
   */
  valorConhecidoCents: number;
  /** O que precisa acontecer para a lacuna fechar. */
  caminho: string;
};

export type LinhaBalanco = {
  secao: string;
  ordem: number;
  linha: string;
  /** Null COM motivo quando a linha é não modelada. Nunca zero disfarçado de saldo. */
  valor: Medida;
  /**
   * O número que a view usou para fechar os totais.
   *
   * Existe porque `Ativo total` e `Passivo total` foram calculados com ele. Sem
   * expô-lo, o leitor somaria as linhas e não bateria com o total — e concluiria
   * que a API errou, quando o que existe é uma lacuna declarada.
   */
  valorNaDemonstracaoCents: number;
  observacao: string | null;
  naoModelado: boolean;
  lacuna: LacunaBalanco | null;
};

export type MesBalanco = {
  mes: string;
  ativoTotalCents: number;
  passivoTotalCents: number;
  plApuradoCents: number;
  plExplicadoCents: number;
  /** PL apurado − PL explicado. Diferença sem nome; tem de ser zero. */
  naoConciliadoCents: number;
  fecha: boolean;
};

export type Balanco = {
  mes: string | null;
  dataCorte: string | null;
  linhas: LinhaBalanco[];
  lacunas: LacunaBalanco[];
  ativoTotalCents: number | null;
  passivoTotalCents: number | null;
  plApuradoCents: number | null;
  naoConciliadoCents: number | null;
  /** O balanço fecha quando a diferença sem nome é zero. */
  fecha: boolean;
  /** Quantas linhas a demonstração não sabe medir. */
  linhasNaoModeladas: number;
  serie: MesBalanco[];
};

const BALANCO_VAZIO: Balanco = {
  mes: null,
  dataCorte: null,
  linhas: [],
  lacunas: [],
  ativoTotalCents: null,
  passivoTotalCents: null,
  plApuradoCents: null,
  naoConciliadoCents: null,
  fecha: false,
  linhasNaoModeladas: 0,
  serie: []
};

/**
 * Balanço de um mês, com a série mensal ao lado.
 *
 * `mes` ausente devolve o mês mais recente que a view cobre — abrir a tela sem
 * mês selecionado obrigaria um clique para ver qualquer coisa, e o mês mais
 * recente é o que quase toda pergunta quer.
 */
export async function getBalanco(opcoes: { mes?: string; meses?: number } = {}): Promise<Contrato<Balanco>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO_BALANCO, BALANCO_VAZIO, "banco financeiro não configurado");
  }

  const janela = Math.min(Math.max(opcoes.meses ?? 24, 1), 120);

  try {
    const [alvo] = await query<{ mes: string | null }>(
      `SELECT to_char(COALESCE($2::date, MAX(b.mes)), 'YYYY-MM-DD') AS mes
         FROM fin_balanco_v b JOIN fin_entity e ON e.id = b.entity_id
        WHERE e.slug = $1`,
      [ENTIDADE, opcoes.mes ?? null]
    );
    const mes = alvo?.mes ?? null;

    const [linhas, lacunas, serie] = await Promise.all([
      mes
        ? query<Record<string, unknown>>(
            `SELECT b.* FROM fin_balanco_v b JOIN fin_entity e ON e.id = b.entity_id
              WHERE e.slug = $1 AND b.mes = $2::date ORDER BY b.ordem`,
            [ENTIDADE, mes]
          )
        : Promise.resolve([] as Record<string, unknown>[]),
      query<Record<string, unknown>>(
        `SELECT * FROM fin_balanco_lacuna_v ORDER BY abs(valor_conhecido_cents) DESC, lacuna`
      ),
      query<Record<string, unknown>>(
        `SELECT m.* FROM fin_balanco_mensal_v m JOIN fin_entity e ON e.id = m.entity_id
          WHERE e.slug = $1 ORDER BY m.mes DESC LIMIT $2`,
        [ENTIDADE, janela]
      )
    ]);

    const lista: LacunaBalanco[] = lacunas.map((l) => ({
      lacuna: String(l.lacuna),
      lado: String(l.lado),
      vies: String(l.vies),
      motivo: String(l.motivo),
      valorConhecidoCents: Number(l.valor_conhecido_cents ?? 0),
      caminho: String(l.caminho)
    }));
    const porSlug = new Map(lista.map((l) => [l.lacuna, l]));

    const mapeadas: LinhaBalanco[] = linhas.map((b) => {
      const nome = String(b.linha);
      const observacao = (b.observacao as string) ?? null;
      const naoModelado = Boolean(observacao && MARCA_NAO_MODELADO.test(observacao));
      const bruto = Number(b.valor_cents ?? 0);
      return {
        secao: String(b.secao),
        ordem: Number(b.ordem),
        linha: nome,
        // A regra desta frente, em uma expressão: medida pode ser nula, nunca
        // sem motivo. O motivo é a própria observação que a 0078 escreveu.
        valor: naoModelado ? { valorCents: null, motivo: observacao } : { valorCents: bruto, motivo: null },
        valorNaDemonstracaoCents: bruto,
        observacao,
        naoModelado,
        // Casamento por slug EXATO. Aproximar por nome parecido ligaria a linha
        // errada à lacuna errada, e uma lacuna mal endereçada é pior que
        // nenhuma: manda a pessoa procurar o dado no lugar errado.
        lacuna: porSlug.get(slug(nome)) ?? null
      };
    });

    const valorDe = (ordem: number) => {
      const linha = mapeadas.find((l) => l.ordem === ordem);
      return linha ? linha.valorNaDemonstracaoCents : null;
    };
    const naoConciliado = valorDe(399);

    const pendencias: Pendencia[] = [];
    const naoModeladas = mapeadas.filter((l) => l.naoModelado);
    if (naoModeladas.length) {
      pendencias.push({
        chave: "balanco_linha_nao_modelada",
        titulo: "Linhas do balanço que a base não sabe medir",
        quantidade: naoModeladas.length,
        valorCents: naoModeladas.reduce((s, l) => s + Math.abs(l.lacuna?.valorConhecidoCents ?? 0), 0),
        severidade: "alerta",
        telaDeDecisao: null
      });
    }
    if (naoConciliado !== null && naoConciliado !== 0) {
      pendencias.push({
        chave: "balanco_nao_conciliado",
        titulo: "Diferença de patrimônio sem nome",
        quantidade: 1,
        valorCents: naoConciliado,
        severidade: "bloqueante",
        telaDeDecisao: null
      });
    }

    return contrato({
      dominio: DOMINIO_BALANCO,
      dado: {
        mes,
        dataCorte: linhas[0]?.data_corte ? String(linhas[0].data_corte).slice(0, 10) : null,
        linhas: mapeadas,
        lacunas: lista,
        ativoTotalCents: valorDe(99),
        passivoTotalCents: valorDe(199),
        plApuradoCents: valorDe(210),
        naoConciliadoCents: naoConciliado,
        fecha: naoConciliado === 0,
        linhasNaoModeladas: naoModeladas.length,
        serie: serie.map((m) => {
          const nc = Number(m.nao_conciliado_cents ?? 0);
          return {
            mes: String(m.mes).slice(0, 10),
            ativoTotalCents: Number(m.ativo_total_cents ?? 0),
            passivoTotalCents: Number(m.passivo_total_cents ?? 0),
            plApuradoCents: Number(m.pl_apurado_cents ?? 0),
            plExplicadoCents: Number(m.pl_explicado_cents ?? 0),
            naoConciliadoCents: nc,
            fecha: nc === 0
          };
        })
      },
      ressalvas: [
        "`valor` é null COM motivo nas linhas não modeladas; `valorNaDemonstracaoCents` é o zero que a view somou nos totais. Somar `valor` e comparar com o total NÃO fecha — e é assim que se enxerga a lacuna.",
        "Passivo é sistematicamente SUBESTIMADO: fornecedores, folha e impostos a pagar valem zero por ausência de dado, não por ausência de dívida. Logo o PL apurado é otimista.",
        "`naoConciliadoCents` é a diferença de patrimônio que ninguém sabe nomear. Zero é a única leitura aceitável; qualquer outro valor invalida o balanço inteiro.",
        "A seção `conciliacao` NÃO faz parte do balanço: é a decomposição do PL, e somá-la ao ativo ou ao passivo conta o mesmo dinheiro duas vezes."
      ],
      pendencias
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:balanco]", mensagem);
    return contratoIndisponivel(DOMINIO_BALANCO, BALANCO_VAZIO, mensagem);
  }
}

/** `Fornecedores a pagar` → `fornecedores_a_pagar`, para casar com o slug da lacuna. */
function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ---------------------------------------------------------------------------
// Apuração tributária
// ---------------------------------------------------------------------------

const DOMINIO_APURACAO = "apuracao";

export type MesApuracao = {
  mes: string;
  /** Receita como o extrato a viu. */
  receitaLedgerCents: number;
  /** Receita como a nota fiscal a declarou. */
  receitaNotaCents: number;
  notasEmitidas: number;
  /**
   * Nota − ledger. Não é erro por si: nota emitida e não recebida, ou recebida e
   * não faturada, produzem divergência legítima. É o número que diz de quanto.
   */
  divergenciaCents: number;
  impostoPagoCents: number;
  pagamentosImposto: number;
  folhaCents: number;
  /**
   * Imposto pago neste mês sobre a receita do mês ANTERIOR.
   *
   * É carga MEDIDA, não alíquota declarada: o DAS do Simples vence no mês
   * seguinte ao fato gerador, então dividir pelo próprio mês daria um número
   * que não corresponde a nada.
   */
  cargaSobreMesAnteriorPct: number | null;
  /**
   * Receita bruta dos últimos 12 meses. Null COM motivo quando a janela do
   * ledger não tem 12 meses — a RBT12 é o que define a faixa do Simples, e uma
   * RBT12 parcial apresentada como completa escolhe a alíquota errada.
   */
  rbt12: Medida;
  mesesNaJanela: number;
};

export type Apuracao = {
  meses: MesApuracao[];
  /**
   * O anexo do Simples e a alíquota nominal NÃO estão na base.
   *
   * Declarado como medida nula com motivo, e não omitido: a diferença entre
   * "esta API não fala de anexo" e "o anexo não está cadastrado" é a diferença
   * entre procurar noutro lugar e cadastrar aqui.
   */
  anexoDoSimples: Medida;
  aliquotaNominalPct: Medida;
  mesesSemRbt12Completa: number;
  divergenciaAcumuladaCents: number;
};

const APURACAO_VAZIA: Apuracao = {
  meses: [],
  anexoDoSimples: { valorCents: null, motivo: "banco não consultado" },
  aliquotaNominalPct: { valorCents: null, motivo: "banco não consultado" },
  mesesSemRbt12Completa: 0,
  divergenciaAcumuladaCents: 0
};

export async function getApuracaoTributaria(
  opcoes: { ano?: number; de?: string; ate?: string } = {}
): Promise<Contrato<Apuracao>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO_APURACAO, APURACAO_VAZIA, "banco financeiro não configurado");
  }

  try {
    const linhas = await query<Record<string, unknown>>(
      `SELECT * FROM fin_apuracao_tributaria_v
        WHERE ($1::int IS NULL OR EXTRACT(year FROM mes) = $1::int)
          AND ($2::date IS NULL OR mes >= $2::date)
          AND ($3::date IS NULL OR mes <= $3::date)
        ORDER BY mes`,
      [opcoes.ano ?? null, opcoes.de ?? null, opcoes.ate ?? null]
    );

    const meses: MesApuracao[] = linhas.map((l) => {
      const completa = Boolean(l.rbt12_completo);
      const naJanela = Number(l.meses_na_janela ?? 0);
      return {
        mes: String(l.mes).slice(0, 10),
        receitaLedgerCents: Number(l.receita_ledger_cents ?? 0),
        receitaNotaCents: Number(l.receita_nota_cents ?? 0),
        notasEmitidas: Number(l.notas_emitidas ?? 0),
        divergenciaCents: Number(l.divergencia_cents ?? 0),
        impostoPagoCents: Number(l.imposto_pago_cents ?? 0),
        pagamentosImposto: Number(l.pagamentos_imposto ?? 0),
        folhaCents: Number(l.folha_cents ?? 0),
        cargaSobreMesAnteriorPct:
          l.carga_sobre_mes_anterior_pct === null ? null : Number(l.carga_sobre_mes_anterior_pct),
        rbt12: completa
          ? { valorCents: Number(l.rbt12_parcial_cents ?? 0), motivo: null }
          : {
              valorCents: null,
              motivo: `a janela tem ${naJanela} de 12 meses: a RBT12 parcial (${Number(
                l.rbt12_parcial_cents ?? 0
              )} centavos) não determina faixa do Simples`
            },
        mesesNaJanela: naJanela
      };
    });

    const incompletas = meses.filter((m) => m.rbt12.valorCents === null).length;

    return contrato({
      dominio: DOMINIO_APURACAO,
      dado: {
        meses,
        anexoDoSimples: {
          valorCents: null,
          motivo:
            "não existe coluna de anexo nem de alíquota nominal em fin_apuracao_tributaria_v: o regime não está cadastrado nesta base"
        },
        aliquotaNominalPct: {
          valorCents: null,
          motivo:
            "só há carga MEDIDA (imposto pago ÷ receita do mês anterior). Alíquota nominal exige anexo e RBT12 fechada"
        },
        mesesSemRbt12Completa: incompletas,
        divergenciaAcumuladaCents: meses.reduce((s, m) => s + m.divergenciaCents, 0)
      },
      pendencias: incompletas
        ? [
            {
              chave: "apuracao_rbt12_parcial",
              titulo: "Meses cuja RBT12 não fecha 12 meses de janela",
              quantidade: incompletas,
              valorCents: null,
              severidade: "alerta",
              telaDeDecisao: null
            }
          ]
        : [],
      ressalvas: [
        "`cargaSobreMesAnteriorPct` é carga medida, NÃO alíquota: o DAS vence no mês seguinte ao fato gerador, e dividir pelo próprio mês produziria um número sem significado.",
        "`divergenciaCents` = nota − ledger. Divergência positiva costuma ser nota emitida e ainda não recebida; negativa, recebimento sem nota no mês. Nenhuma das duas é, por si, irregularidade.",
        "Esta view NÃO apura imposto devido. Ela mede o que foi pago contra o que foi faturado — provisionar exige anexo, RBT12 fechada e competência, e os três faltam.",
        "O passivo 'Impostos a recolher' do balanço vale zero por causa disto: sem apuração por competência não há como provisionar o DAS do mês corrente."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:apuracao]", mensagem);
    return contratoIndisponivel(DOMINIO_APURACAO, APURACAO_VAZIA, mensagem);
  }
}
