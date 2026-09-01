import "server-only";

import {
  certezaDe,
  chaveFavorito,
  grupoDaCamada,
  impedimentoDe,
  mascararChave,
  naoConfirmadaDe,
  naturezaDe,
  pedacosDaComissao,
  CAMADA_COMPOSICAO,
  ordemDaNatureza,
  type Certeza,
  type GrupoContas,
  type ImpedimentoPagar,
  type PedacoComissao
} from "./contas-a-pagar-eixos";
import { chaveCusto, timeDaPessoa, timeDe, type TimeCusto } from "./custo-empresa-eixos";
import {
  parteDaSubparte,
  subparteCustoDe,
  subparteExibida,
  subparteValida,
  type ParteCusto,
  type SubparteCusto
} from "./custo-empresa-partes";
import { isFinanceConfigured, query } from "./db";
import { listarAnexosPorChave, listarFavoritos, type AnexoCobranca } from "./conta-cobranca";
import {
  bandasParaPagar,
  getPrevisaoCadastro,
  listarPedacosComissao,
  rotuloDaBanda,
  ROTULO_PACOTE,
  type PacoteComissao
} from "./previsao-cadastro";

/**
 * CONTAS A PAGAR — o mês inteiro que vai sair, arrumado pelos blocos de Custo
 * da empresa.
 *
 * ---------------------------------------------------------------------------
 * POR QUE A FONTE É `fin_agenda_dia_v`, E NÃO UMA CONSULTA NOVA
 * ---------------------------------------------------------------------------
 * Porque a pergunta "o que está programado a pagar no mês" tem CINCO respostas
 * na base — folha, DAS, recorrente, documento e fatura de cartão — e três
 * delas descrevem o mesmo dinheiro por caminhos diferentes. Somar as cinco
 * conta a mesma obrigação até três vezes.
 *
 * A 0104 já resolveu isso, e resolveu com prova: `fin_agenda_dia_v` dá UMA
 * linha por (dia, item), decide quem ganha a `chave_dedupe` pela ordem
 * `item > documento > projetado`, e marca a perdedora com `entra_no_total =
 * false` e o motivo escrito. `fin_agenda_prova_v` confere a soma contra
 * `fin_previsao_evento_v` e acusa `delta_explicado = false` se alguém contar
 * duas vezes. Escrever consulta própria aqui seria refazer essa aritmética por
 * fora da prova — e é exatamente assim que R$ 1,27 milhão falso apareceu uma
 * vez (0100 §1).
 *
 * Então esta camada NÃO decide o que soma. Ela lê `entra_no_total` e obedece.
 *
 * ---------------------------------------------------------------------------
 * A PONTE QUE NÃO EXISTIA
 * ---------------------------------------------------------------------------
 * `fin_custo_empresa` (0182) identifica um custo pelo par (contraparte ×
 * categoria). `fin_agenda_dia_v` expõe `counterparty_id` e `category_id` nas
 * suas linhas. Ninguém tinha ligado os dois: a classificação de área e bloco
 * que o dono fez na matriz não alcançava o que está por pagar.
 *
 * O LEFT JOIN abaixo é essa ponte, e ela não custa migration nenhuma.
 *
 * A cobertura é PARCIAL, e isso é esperado: `pagar_cartao_*` não tem
 * `category_id`, e não deveria mesmo achar bloco — fatura de cartão é caixa,
 * não custo da empresa, e a matriz a exclui de propósito.
 *
 * (Correção de 31/08: eu tinha escrito aqui que `pagar_folha` também vem sem
 * `category_id`, citando a 0100:662-667. Medido, é falso — 12 das 26 linhas de
 * folha de set/26 trazem 6.x, sendo 9 em 6.02 e 3 em 6.06. A afirmação
 * importava porque é ela que decide se folha acha bloco, e ela estava errada.)
 *
 * ---------------------------------------------------------------------------
 * O QUE NÃO SE SOMA COM O QUÊ
 * ---------------------------------------------------------------------------
 * `custos-empresa.ts` declara três camadas como excluídas da matriz — pessoa,
 * DAS e fatura de cartão — com o link de onde cada uma é contada. Aqui elas
 * VOLTAM, porque a pergunta é de caixa ("quanto sai em setembro") e não de
 * custo ("quanto a empresa gasta com o quê").
 *
 * Voltam em grupo próprio, com o total separado. O KPI mostra os dois números
 * e nunca um só: somar o custo da empresa com a folha nesta tela produziria um
 * total que não bate com NENHUMA outra tela da casa.
 */

const ENTITY = "xpe";

/** Só para texto de motivo. Valor de tela usa `brlPrecise`/`brlCents` no cliente. */
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/*
 * SÓ TIPO SAI DAQUI PARA O CLIENTE — e a tentação de reexportar valor já
 * custou uma correção.
 *
 * Este arquivo abre com `import "server-only"`, que o Next resolve para um
 * módulo cujo corpo é um `throw`, e ainda puxa `./db` com o `pg` junto. Um
 * `export { GRUPOS } from "./contas-a-pagar-eixos"` aqui COMPILA no `tsc` e
 * quebra no build: o componente cliente que importasse `GRUPOS` arrastaria a
 * cadeia inteira para o bundle do navegador.
 *
 * `import type` desaparece na compilação e por isso atravessa. Valor, não.
 * Quem precisar de `GRUPOS` ou `MOTIVO_IMPEDIMENTO` importa de
 * `./contas-a-pagar-eixos` direto — que existe exatamente para isso.
 */
export type { Certeza, GrupoContas, ImpedimentoPagar } from "./contas-a-pagar-eixos";

export type Opcao = { slug: string; nome: string };

/**
 * A ordem de pagamento desta linha, se já existe — e onde ela está no ciclo.
 *
 * O ciclo inteiro, que a coluna Situação precisa mostrar:
 *
 *   (sem ordem)             ainda não programada — ou falta cadastro
 *   rascunho                programada aqui, ainda NÃO entregue ao banco
 *   aguardando_autorizacao  entregue; esperando VOCÊ aprovar no app do Inter
 *   pago / pago_parcial     o dinheiro saiu, com data e end-to-end
 *
 * `pagoCents` vem de `fin_payment_request.paid_cents`, que é mantido por
 * GATILHO a partir de `fin_payment_execution` (0075:219) — nunca escrito à mão.
 * É por isso que ele é confiável como "saiu de verdade": só existe se houver um
 * registro de execução por trás.
 */
export type OrdemExistente = {
  id: number;
  code: string;
  status: string;
  scheduledFor: string | null;
  pagoCents: number;
  pagoEm: string | null;
  endToEndId: string | null;
};

export type ContaAPagar = {
  /**
   * A identidade da obrigação NO MÊS, vinda da 0104. É o que vai para
   * `fin_payment_request.source_id`, e é o que impede programar o mesmo
   * compromisso duas vezes — o índice único (entity_id, source, source_id)
   * transforma o clique repetido em no-op em vez de pagamento em dobro.
   */
  chaveDedupe: string;
  dia: string;
  competencia: string;
  tempo: "passado" | "hoje" | "futuro";
  diasAFrente: number;
  procedencia: "documento" | "item" | "projetado";
  estado: string | null;
  camada: string;
  descricao: string;
  counterpartyId: number | null;
  contraparte: string | null;
  categoryId: number | null;
  categoriaCode: string | null;
  categoriaNome: string | null;
  nucleo: string | null;
  valorCents: number;
  realizadoCents: number;
  realizadoEm: string | null;
  vencido: boolean | null;
  certeza: Certeza;
  origemTabela: string | null;
  origemId: number | null;
  origemRef: string | null;
  entraNoTotal: boolean;
  motivoNaoSoma: string | null;
  /**
   * Não soma E ninguém soma por ela. É conta real esperando confirmação — a
   * fila de decisão do dono, não uma duplicata. Ver `naoConfirmadaDe`.
   */
  naoConfirmada: boolean;

  grupo: GrupoContas;
  /**
   * A natureza do pagamento de pessoa — Salário, Pró-labore, Reembolso… — no
   * vocabulário de `fin_time_remuneracao_mes_v`. Null quando não é gente.
   *
   * É o que permite uma pessoa receber N PIX no mês, um por natureza, em vez
   * de um valor só: cada linha destas já tem `chaveDedupe` própria, então N
   * ordens de pagamento nascem sem nenhum trabalho extra — e a conferência
   * depois bate natureza a natureza contra o ledger.
   */
  natureza: string | null;
  /** Só em `grupo === "empresa"`. Nas outras a matriz não classifica. */
  parte: ParteCusto | null;
  subparte: SubparteCusto | null;
  time: TimeCusto;
  areasEmpresa: Opcao[];

  /** Coordenada PIX do favorecido. A chave vai MASCARADA — ver `mascararChave`. */
  payeeAccountId: number | null;
  pixTipo: string | null;
  pixMascarado: string | null;
  impedimento: ImpedimentoPagar;
  ordem: OrdemExistente | null;
  /**
   * Estrela da CONTRAPARTE, não da linha. Ancora marcada em setembro continua
   * marcada em outubro. Ver `chaveFavorito` em contas-a-pagar-eixos.
   */
  favorito: boolean;
  /** Boleto e NF-e DESTE mês. Vazio = ainda não anexou. */
  anexos: AnexoCobranca[];
  /**
   * Lançamentos que somam esta linha, só em comissão do cadastro. Vazio = não
   * há o que detalhar (salário, agenda, um único item). Não são obrigações:
   * o PIX continua sendo a linha, não cada pedaço.
   */
  pedacos: PedacoComissao[];
};

export type ContasAPagar = {
  disponivel: boolean;
  /** Competências com alguma saída, para o seletor. */
  meses: string[];
  competencia: string;
  hoje: string;
  linhas: ContaAPagar[];
  areasEmpresa: Opcao[];
  /**
   * De que mês veio a composição da folha. Igual à competência = fechamento
   * real; diferente = molde do último mês fechado, e a tela precisa dizer.
   */
  folhaMolde: string | null;
  /** Por que a tela pode estar vazia sem ser erro. */
  ressalva: string | null;
};

function vazio(competencia: string, ressalva: string | null): ContasAPagar {
  return {
    disponivel: false,
    meses: [],
    competencia,
    hoje: "",
    linhas: [],
    areasEmpresa: [],
    folhaMolde: null,
    ressalva
  };
}

/**
 * O mês inteiro que sai, com a classificação da matriz colada por cima.
 *
 * `competencia` é 'YYYY-MM'. Sem ela, o mês corrente em São Paulo.
 */
export async function getContasAPagar(competenciaPedida?: string | null): Promise<ContasAPagar> {
  const pedida = competenciaPedida && /^\d{4}-\d{2}$/.test(competenciaPedida) ? competenciaPedida : null;

  if (!isFinanceConfigured()) return vazio(pedida ?? "", "sem conexão com o banco do financeiro");

  try {
    const hojeRows = await query<{ hoje: string; mes: string }>(
      `SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS hoje,
              to_char(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS mes`
    );
    const hoje = hojeRows[0]?.hoje ?? "";
    const competencia = pedida ?? hojeRows[0]?.mes ?? "";
    if (!competencia) return vazio("", "não foi possível resolver a competência");

    const temClassificacao = (
      await query<{ tem: boolean }>(`SELECT to_regclass('fin_custo_empresa') IS NOT NULL AS tem`)
    )[0]?.tem;

    const joinClass = temClassificacao
      ? `LEFT JOIN fin_custo_empresa cls
              ON cls.entity_id = v.entity_id
             AND cls.category_id = v.category_id
             AND cls.counterparty_id IS NOT DISTINCT FROM v.counterparty_id`
      : "";

    const [linhasRows, mesesRows, areasCatRows, areasItemRows] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT v.dia::text                                  AS dia,
                to_char(v.competencia, 'YYYY-MM')            AS competencia,
                v.tempo,
                v.dias_a_frente,
                v.procedencia,
                v.estado,
                v.camada,
                v.descricao,
                v.counterparty_id,
                v.contraparte,
                v.category_id,
                v.categoria_code,
                v.categoria,
                v.nucleo,
                v.valor_cents,
                v.realizado_cents,
                v.realizado_em::text                         AS realizado_em,
                v.vencido,
                v.certeza,
                v.origem_tabela,
                v.origem_id,
                v.origem_ref,
                v.chave_dedupe,
                v.entra_no_total,
                v.motivo_nao_soma,
                -- Alguem conta este dinheiro?
                --
                -- Separa as duas razoes de entra_no_total = false, que a tela
                -- precisa tratar de forma oposta: se OUTRA linha da mesma chave
                -- soma, esta e duplicata e pagar as duas paga em dobro; se
                -- nenhuma soma, e conta real esperando confirmacao (medido em
                -- 31/08: 31 linhas, R$ 40.044,75 em set/26, todas sem
                -- vencedora). Por janela, e nao lendo o texto de
                -- motivo_nao_soma, que e frase de view e ja mudou uma vez.
                --
                -- Sem crase neste comentario: ele mora DENTRO de um template
                -- literal, e uma crase aqui fecha a string. Custou um TS1005.
                bool_or(v.entra_no_total)
                  OVER (PARTITION BY v.entity_id, v.chave_dedupe) AS chave_tem_vencedora,
                ${temClassificacao ? "cls.area" : "NULL::text"}  AS time_gravado,
                ${temClassificacao ? "cls.bloco" : "NULL::text"} AS bloco_gravado,
                pa.id                                        AS payee_account_id,
                pa.pix_address_key_type,
                pa.pix_address_key,
                pr.id                                        AS ordem_id,
                pr.code                                      AS ordem_code,
                pr.status                                    AS ordem_status,
                pr.scheduled_for::text                       AS ordem_scheduled,
                pr.paid_cents                                AS ordem_pago_cents,
                ex.paid_on::text                             AS ordem_pago_em,
                ex.end_to_end_id                             AS ordem_e2e
           FROM fin_agenda_dia_v v
           JOIN fin_entity e ON e.id = v.entity_id AND e.slug = $1
           ${joinClass}
           LEFT JOIN fin_payee_account pa
                  ON pa.counterparty_id = v.counterparty_id
                 AND pa.is_default
                 AND pa.is_active
           LEFT JOIN fin_payment_request pr
                  ON pr.entity_id = v.entity_id
                 AND pr.source_id = v.chave_dedupe
                 AND pr.status NOT IN ('rejeitada', 'cancelada')
           -- A execução mais recente da ordem: é ela que prova que o dinheiro saiu.
           LEFT JOIN LATERAL (
             SELECT e.paid_on, e.end_to_end_id
               FROM fin_payment_execution e
              WHERE e.payment_request_id = pr.id
              ORDER BY e.paid_on DESC, e.id DESC
              LIMIT 1
           ) ex ON TRUE
          WHERE v.direcao = 'pagar'
            AND v.dia >= to_date($2, 'YYYY-MM')
            AND v.dia <  (to_date($2, 'YYYY-MM') + interval '1 month')
          ORDER BY v.dia, v.valor_cents DESC`,
        [ENTITY, competencia]
      ),
      /*
       * A janela do seletor é curta de propósito: −6 a +12 meses. A agenda
       * alcança 365 dias à frente, mas oferecer 2028 numa tela de pagamento
       * convida a programar PIX para um mês que ainda vai mudar inteiro.
       */
      query<{ mes: string }>(
        `SELECT DISTINCT to_char(v.competencia, 'YYYY-MM') AS mes
           FROM fin_agenda_dia_v v
           JOIN fin_entity e ON e.id = v.entity_id AND e.slug = $1
          WHERE v.direcao = 'pagar'
            AND v.dia >= (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '6 months')
            AND v.dia <  (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '13 months')
          ORDER BY 1`,
        [ENTITY]
      ),
      query<{ slug: string; nome: string }>(
        `SELECT a.slug, a.nome
           FROM fin_area_empresa a
           JOIN fin_entity e ON e.id = a.entity_id AND e.slug = $1
          WHERE a.ativo
          ORDER BY a.ordem, a.nome`,
        [ENTITY]
      ).catch(() => [] as { slug: string; nome: string }[]),
      temClassificacao
        ? query<{ counterparty_id: number | null; category_id: number; slug: string; nome: string }>(
            `SELECT cls.counterparty_id, cls.category_id, a.slug, a.nome
               FROM fin_custo_empresa cls
               JOIN fin_entity e ON e.id = cls.entity_id AND e.slug = $1
               JOIN fin_custo_empresa_area l ON l.custo_id = cls.id
               JOIN fin_area_empresa a ON a.id = l.area_id
              ORDER BY a.ordem, a.nome`,
            [ENTITY]
          )
        : Promise.resolve([] as { counterparty_id: number | null; category_id: number; slug: string; nome: string }[])
    ]);

    /*
     * A FOLHA VEM DO CADASTRO DA PESSOA — a MESMA base de "Custo com pessoas".
     *
     * Decisão do dono, 31/08/2026: "custo com pessoas e custos da empresa deve
     * ser a exata mesma base de dados". E antes disso, a correção do número:
     * "os valores a serem pagos por pessoa são justamente os previstos que
     * temos no app pessoal e no cadastro pessoal de cada um".
     *
     * Eu tinha usado a composição REALIZADA do último mês fechado como molde
     * do mês seguinte. Errado, e medido: 15 das 26 pessoas divergiam em set/26.
     * A Audrey saía R$ 800,98 acima porque o molde arrastava o reembolso de
     * agosto (R$ 1.025,98) e uma comissão avulsa (R$ 417); o Belo aparecia com
     * pró-labore de R$ 4.470 e NENHUMA linha de salário, porque o ledger põe
     * tudo dos sócios em 6.02 e a view deriva a natureza da categoria.
     *
     * O cadastro resolve os dois: ele separa o salário base do pró-labore
     * esperado por declaração, não por dedução.
     *
     * PASSADO É OUTRA PERGUNTA. Para uma competência já fechada, o que vale é o
     * que SAIU, e aí a fonte certa é o ledger — `fin_time_remuneracao_mes_v`,
     * com as seis naturezas que ele sabe distinguir. Cadastro responde "vai
     * receber"; ledger responde "recebeu". Misturar os dois foi o erro.
     */
    const mesCorrente = hojeRows[0]?.mes ?? competencia;
    const competenciaPassada = competencia < mesCorrente;

    const [previsaoCadastro, folhaRealizadaRows, pedacosMes] = await Promise.all([
      competenciaPassada ? Promise.resolve([] as Awaited<ReturnType<typeof getPrevisaoCadastro>>) : getPrevisaoCadastro(ENTITY, competencia),
      competenciaPassada
        ? query<Record<string, unknown>>(
            `SELECT p.id                      AS person_id,
                    p.name                    AS pessoa,
                    p.counterparty_id,
                    v.natureza,
                    v.valor_cents,
                    to_char(v.mes, 'YYYY-MM') AS mes_molde
               FROM fin_time_remuneracao_mes_v v
               JOIN fin_entity e ON e.id = v.entity_id AND e.slug = $1
               JOIN fin_person p ON p.id = v.person_id
              WHERE v.mes = to_date($2, 'YYYY-MM')
                AND v.valor_cents > 0
              ORDER BY p.name, v.natureza`,
            [ENTITY, competencia]
          ).catch(() => [] as Record<string, unknown>[])
        : Promise.resolve([] as Record<string, unknown>[]),
      listarPedacosComissao(ENTITY, competencia)
    ]);

    const pedacosPorPessoa = new Map<number, PedacoComissao[]>();
    for (const p of pedacosMes) {
      const lista = pedacosPorPessoa.get(p.personId) ?? [];
      lista.push(p);
      pedacosPorPessoa.set(p.personId, lista);
    }

    /*
     * A coordenada de pagamento da pessoa — POR QUALQUER CONTRAPARTE DELA.
     *
     * Isto olhava só `fin_person.counterparty_id`, e escondia gente que tem
     * coordenada cadastrada. A 0169 permite N contrapartes por pessoa
     * (`fin_person_counterparty`), e é o caso comum aqui: o MEI recebe no CNPJ
     * e a pessoa também aparece no CPF. Medido em 31/08/2026: Gabriel tem 8
     * PIX com chave e Igor tem 24, todos numa contraparte que NÃO é a primária
     * — e os dois apareciam como "sem chave PIX cadastrada".
     *
     * `counterparty_id` sai daqui junto, e não do cadastro da pessoa, porque é
     * ele que vai na ordem: `pagar-programar.ts` resolve o favorecido por
     * contraparte, e mandar a primária quando a conta está na secundária faria
     * o pagamento ser recusado por "sem conta favorecida padrão".
     *
     * `status = 'confirmado'` porque vínculo proposto é palpite do casador
     * automático — e palpite não escolhe para onde o dinheiro vai.
     */
    const payeeRows = await query<Record<string, unknown>>(
      `SELECT DISTINCT ON (p.id)
              p.id           AS person_id,
              pa.counterparty_id,
              pa.id          AS payee_account_id,
              pa.pix_address_key_type,
              pa.pix_address_key
         FROM fin_person p
         JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $1
         JOIN fin_payee_account pa
           ON pa.is_default
          AND pa.is_active
          AND (
            pa.counterparty_id = p.counterparty_id
            OR pa.counterparty_id IN (
              SELECT l.counterparty_id FROM fin_person_counterparty l
               WHERE l.person_id = p.id AND l.status = 'confirmado'
            )
          )
        -- A primária ganha quando as duas têm conta: é a que a casa reconhece.
        ORDER BY p.id, (pa.counterparty_id = p.counterparty_id) DESC, pa.id DESC`,
      [ENTITY]
    ).catch(() => [] as Record<string, unknown>[]);
    const payeePorPessoa = new Map(payeeRows.map((r) => [Number(r.person_id), r]));

    const timePessoaRows = await query<{ id: number; area: string | null; default_nucleo: string | null }>(
      `SELECT p.id, p.area, p.default_nucleo
         FROM fin_person p
         JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $1`,
      [ENTITY]
    ).catch(() => [] as { id: number; area: string | null; default_nucleo: string | null }[]);
    const timePorPessoa = new Map(
      timePessoaRows.map((r) => [Number(r.id), timeDaPessoa(r.area, r.default_nucleo)])
    );

    const areasPorItem = new Map<string, Opcao[]>();
    for (const r of areasItemRows) {
      const k = chaveCusto(r.counterparty_id, Number(r.category_id));
      const lista = areasPorItem.get(k) ?? [];
      lista.push({ slug: r.slug, nome: r.nome });
      areasPorItem.set(k, lista);
    }

    const linhas: ContaAPagar[] = linhasRows.map((r) => {
      const counterpartyId = r.counterparty_id == null ? null : Number(r.counterparty_id);
      const categoryId = r.category_id == null ? null : Number(r.category_id);
      const camada = String(r.camada ?? "");
      const contraparte = r.contraparte == null ? null : String(r.contraparte);
      const descricao = String(r.descricao ?? "");
      const categoriaCode = r.categoria_code == null ? null : String(r.categoria_code);
      const grupo = grupoDaCamada(camada, categoriaCode);
      const time = timeDe((r.time_gravado as string) ?? null);
      const areasEmpresa =
        categoryId == null ? [] : areasPorItem.get(chaveCusto(counterpartyId, categoryId)) ?? [];
      const blocoGravado = subparteValida(r.bloco_gravado as string | null)
        ? (r.bloco_gravado as SubparteCusto)
        : null;

      /*
       * Só o grupo `empresa` recebe bloco. Folha, DAS e cartão passariam pela
       * heurística e cairiam em "A organizar" — uma fila de trabalho falsa,
       * porque não há nada a organizar: essas três já têm tela própria.
       */
      const subparte =
        grupo === "empresa"
          ? subparteExibida(
              subparteCustoDe({
                nome: contraparte ?? descricao,
                categoriaCode: categoriaCode ?? "",
                time,
                areasEmpresa,
                bloco: blocoGravado
              })
            )
          : null;

      const payeeAccountId = r.payee_account_id == null ? null : Number(r.payee_account_id);
      const valorCents = Number(r.valor_cents ?? 0);
      const realizadoEm = r.realizado_em == null ? null : String(r.realizado_em);
      const entraNoTotal = Boolean(r.entra_no_total);
      // `chave_tem_vencedora` é true na própria linha vencedora também; o que
      // importa aqui é se ALGUÉM conta, e a vencedora nunca chega a consultar.
      const outraLinhaConta = Boolean(r.chave_tem_vencedora);

      return {
        chaveDedupe: String(r.chave_dedupe ?? ""),
        dia: String(r.dia),
        competencia: String(r.competencia),
        tempo: (r.tempo as ContaAPagar["tempo"]) ?? "futuro",
        diasAFrente: Number(r.dias_a_frente ?? 0),
        procedencia: (r.procedencia as ContaAPagar["procedencia"]) ?? "projetado",
        estado: r.estado == null ? null : String(r.estado),
        camada,
        descricao,
        counterpartyId,
        contraparte,
        categoryId,
        categoriaCode,
        categoriaNome: r.categoria == null ? null : String(r.categoria),
        nucleo: r.nucleo == null ? null : String(r.nucleo),
        valorCents,
        realizadoCents: Number(r.realizado_cents ?? 0),
        realizadoEm,
        vencido: r.vencido == null ? null : Boolean(r.vencido),
        certeza: certezaDe(r.certeza),
        origemTabela: r.origem_tabela == null ? null : String(r.origem_tabela),
        origemId: r.origem_id == null ? null : Number(r.origem_id),
        origemRef: r.origem_ref == null ? null : String(r.origem_ref),
        entraNoTotal,
        motivoNaoSoma: r.motivo_nao_soma == null ? null : String(r.motivo_nao_soma),
        naoConfirmada: naoConfirmadaDe({ realizadoEm, entraNoTotal, outraLinhaConta }),

        grupo,
        natureza: naturezaDe(categoriaCode),
        parte: subparte ? parteDaSubparte(subparte) : null,
        subparte,
        time,
        areasEmpresa,

        payeeAccountId,
        pixTipo: r.pix_address_key_type == null ? null : String(r.pix_address_key_type),
        pixMascarado: mascararChave(
          r.pix_address_key == null ? null : String(r.pix_address_key),
          r.pix_address_key_type == null ? null : String(r.pix_address_key_type)
        ),
        impedimento: impedimentoDe({
          realizadoEm,
          entraNoTotal,
          outraLinhaConta,
          counterpartyId,
          payeeAccountId,
          valorCents
        }),
        ordem:
          r.ordem_id == null
            ? null
            : {
                id: Number(r.ordem_id),
                code: String(r.ordem_code),
                status: String(r.ordem_status),
                scheduledFor: r.ordem_scheduled == null ? null : String(r.ordem_scheduled),
                pagoCents: Number(r.ordem_pago_cents ?? 0),
                pagoEm: r.ordem_pago_em == null ? null : String(r.ordem_pago_em),
                endToEndId: r.ordem_e2e == null ? null : String(r.ordem_e2e)
              },
        favorito: false,
        anexos: [],
        pedacos: []
      };
    });

    /*
     * A folha agregada da 0077 SAI, e a composição do cadastro ENTRA.
     *
     * As duas descrevem o mesmo dinheiro. Deixar as duas somaria a folha duas
     * vezes — o erro que a 0104 inteira existe para impedir. A agregada é a que
     * sai porque é a errada: R$ 439.556,81 contra R$ 105.654,76 que de fato
     * saíram em agosto.
     *
     * Ela não some em silêncio: vira uma linha só, marcada, que não soma e traz
     * o motivo escrito. Esconder uma divergência de R$ 333 mil seria pior que
     * mostrá-la.
     */
    // Toda linha de gente que SOMA, venha de onde vier. Era só `pagar_folha`, e
    // isso deixava passar os 3 documentos de folha do ClickUp — R$ 5.900 em
    // set/26 que somavam enquanto as mesmas pessoas somavam na composição.
    const folhaAgregada = linhas.filter((l) => l.grupo === "folha" && l.entraNoTotal);
    const semFolhaAgregada = linhas.filter((l) => !(l.grupo === "folha" && l.entraNoTotal));

    const ordensPorChave = new Map<string, OrdemExistente>();
    for (const l of linhas) if (l.ordem) ordensPorChave.set(l.chaveDedupe, l.ordem);

    /*
     * As bandas do mês, numa lista só — venham do cadastro (futuro) ou do
     * ledger (passado). Cada banda é uma linha, com chave própria: é o que
     * permite a uma pessoa receber N PIX e à conferência bater banda a banda.
     */
    type Banda = {
      personId: number;
      pessoa: string;
      counterpartyId: number | null;
      natureza: string;
      pacote: PacoteComissao | null;
      cents: number;
      /**
       * Ordem antiga na chave `…:comissao` (sem pacote). A linha continua
       * UM PIX — senão o pago fica órfão e as partes novas nascem pagáveis.
       * O rótulo ainda pode mostrar o pacote quando só há um.
       */
      chaveSemPacote?: boolean;
      detalhePacotes?: { pacote: PacoteComissao; cents: number }[];
    };

    function chaveDaBanda(b: Banda): string {
      if (b.chaveSemPacote) {
        return `${competencia}|fin_person:${b.personId}:${b.natureza}`;
      }
      if (b.natureza === "comissao" && b.pacote) {
        return `${competencia}|fin_person:${b.personId}:comissao:${b.pacote}`;
      }
      return `${competencia}|fin_person:${b.personId}:${b.natureza}`;
    }

    let bandas: Banda[] = competenciaPassada
      ? folhaRealizadaRows.map((r) => ({
          personId: Number(r.person_id),
          pessoa: String(r.pessoa ?? ""),
          counterpartyId: r.counterparty_id == null ? null : Number(r.counterparty_id),
          natureza: String(r.natureza),
          pacote: null,
          cents: Number(r.valor_cents ?? 0)
        }))
      : previsaoCadastro.flatMap((p) =>
          bandasParaPagar(p).map((b) => ({
            personId: p.personId,
            pessoa: p.pessoa,
            counterpartyId: p.counterpartyId,
            natureza: b.natureza,
            pacote: b.pacote,
            cents: b.cents
          }))
        );

    const chavesNovas = bandas.map(chaveDaBanda);
    const chavesVelhasComissao = [
      ...new Set(
        bandas
          .filter((b) => b.natureza === "comissao")
          .map((b) => `${competencia}|fin_person:${b.personId}:comissao`)
      )
    ];
    const chavesFolha = [...new Set([...chavesNovas, ...chavesVelhasComissao])];
    if (chavesFolha.length > 0) {
      const ordensRows = await query<Record<string, unknown>>(
        `SELECT pr.source_id, pr.id, pr.code, pr.status, pr.scheduled_for::text AS scheduled_for,
                pr.paid_cents, ex.paid_on::text AS paid_on, ex.end_to_end_id
           FROM fin_payment_request pr
           JOIN fin_entity e ON e.id = pr.entity_id AND e.slug = $1
           LEFT JOIN LATERAL (
             SELECT e2.paid_on, e2.end_to_end_id
               FROM fin_payment_execution e2
              WHERE e2.payment_request_id = pr.id
              ORDER BY e2.paid_on DESC, e2.id DESC
              LIMIT 1
           ) ex ON TRUE
          WHERE pr.source_id = ANY($2::text[])
            AND pr.status NOT IN ('rejeitada', 'cancelada')`,
        [ENTITY, chavesFolha]
      ).catch(() => [] as Record<string, unknown>[]);
      for (const r of ordensRows) {
        ordensPorChave.set(String(r.source_id), {
          id: Number(r.id),
          code: String(r.code),
          status: String(r.status),
          scheduledFor: r.scheduled_for == null ? null : String(r.scheduled_for),
          pagoCents: Number(r.paid_cents ?? 0),
          pagoEm: r.paid_on == null ? null : String(r.paid_on),
          endToEndId: r.end_to_end_id == null ? null : String(r.end_to_end_id)
        });
      }
    }

    /*
     * ORDEM ANTIGA NA CHAVE SEM PACOTE.
     *
     * Até aqui a comissão de alguém era UM PIX (`…:comissao`). Quebrar em
     * obras/consultoria muda a chave — e uma ordem já gravada na chave velha
     * ficaria órfã enquanto as linhas novas nasceriam pagáveis de novo. Se a
     * chave antiga tem ordem neste mês, esta pessoa continua com UM pacote só.
     */
    if (!competenciaPassada) {
      const comOrdemAntiga = new Set<number>();
      for (const chave of ordensPorChave.keys()) {
        const m = /\|fin_person:(\d+):comissao$/.exec(chave);
        if (m) comOrdemAntiga.add(Number(m[1]));
      }
      if (comOrdemAntiga.size > 0) {
        const porPessoa = new Map<number, Banda[]>();
        for (const b of bandas) {
          const lista = porPessoa.get(b.personId) ?? [];
          lista.push(b);
          porPessoa.set(b.personId, lista);
        }
        bandas = [...porPessoa.values()].flatMap((lista) => {
          const id = lista[0]?.personId;
          if (id == null || !comOrdemAntiga.has(id)) return lista;
          const comissoes = lista.filter((b) => b.natureza === "comissao");
          if (!comissoes.length) return lista;
          const umSo = comissoes.length === 1 ? comissoes[0] : null;
          return [
            ...lista.filter((b) => b.natureza !== "comissao"),
            {
              ...(umSo ?? comissoes[0]),
              chaveSemPacote: true,
              pacote: umSo?.pacote ?? null,
              cents: comissoes.reduce((s, c) => s + c.cents, 0),
              detalhePacotes:
                comissoes.length > 1
                  ? comissoes.flatMap((c) =>
                      c.pacote && c.cents > 0 ? [{ pacote: c.pacote, cents: c.cents }] : []
                    )
                  : undefined
            }
          ];
        });
      }
    }

    const linhasFolha: ContaAPagar[] = bandas.map((b) => {
      const chaveDedupe = chaveDaBanda(b);
      const rotulo = rotuloDaBanda({ natureza: b.natureza, pacote: b.pacote });
      const detalhe =
        b.natureza === "comissao" && b.detalhePacotes && b.detalhePacotes.length > 1
          ? b.detalhePacotes.map((d) => `${ROTULO_PACOTE[d.pacote]} ${brl(d.cents)}`).join(" · ")
          : null;
      const parte =
        b.pacote === "obras" || b.pacote === "consultoria" ? b.pacote : null;
      const origemRef =
        b.natureza === "comissao" && b.pacote
          ? `fin_person:${b.personId}:comissao:${b.pacote}`
          : `fin_person:${b.personId}:${b.natureza}`;
      // Mês fechado é história: o dinheiro saiu, e a tela não pode oferecer
      // "programar" um pagamento de julho.
      const realizadoEm = competenciaPassada ? `${competencia}-01` : null;
      const pa = payeePorPessoa.get(b.personId);
      const payeeAccountId = pa?.payee_account_id == null ? null : Number(pa.payee_account_id);
      // A contraparte da ORDEM é a que tem a conta favorecida — ver o comentário
      // da consulta acima. Sem conta, cai na do cadastro para a linha ainda
      // dizer de quem é.
      const counterpartyDaOrdem =
        pa?.counterparty_id == null ? b.counterpartyId : Number(pa.counterparty_id);

      return {
        chaveDedupe,
        // Dia 2, a mesma regra que a 0079 usa para a folha.
        dia: `${competencia}-02`,
        competencia,
        tempo: competenciaPassada ? "passado" : "futuro",
        diasAFrente: 0,
        procedencia: "item" as const,
        estado: null,
        camada: CAMADA_COMPOSICAO,
        descricao: detalhe ?? `${b.pessoa} — ${rotulo}`,
        counterpartyId: counterpartyDaOrdem,
        contraparte: b.pessoa,
        categoryId: null,
        categoriaCode: null,
        categoriaNome: rotulo,
        nucleo: null,
        valorCents: b.cents,
        realizadoCents: competenciaPassada ? b.cents : 0,
        realizadoEm,
        vencido: null,
        // Cadastro declarado é firme; ledger fechado também. Não há degrau de
        // incerteza aqui — o que havia era o molde, e ele saiu.
        certeza: "firme" as const,
        origemTabela: "fin_person",
        origemId: b.personId,
        origemRef,
        entraNoTotal: true,
        motivoNaoSoma: null,
        naoConfirmada: false,
        grupo: "folha" as const,
        natureza: rotulo,
        parte,
        subparte: null,
        time: timePorPessoa.get(b.personId) ?? "sem_time",
        areasEmpresa: [],
        payeeAccountId,
        pixTipo: pa?.pix_address_key_type == null ? null : String(pa.pix_address_key_type),
        pixMascarado: mascararChave(
          pa?.pix_address_key == null ? null : String(pa.pix_address_key),
          pa?.pix_address_key_type == null ? null : String(pa.pix_address_key_type)
        ),
        impedimento: impedimentoDe({
          realizadoEm,
          entraNoTotal: true,
          outraLinhaConta: true,
          counterpartyId: counterpartyDaOrdem,
          payeeAccountId,
          valorCents: b.cents
        }),
        ordem: ordensPorChave.get(chaveDedupe) ?? null,
        favorito: false,
        anexos: [],
        pedacos: pedacosDaComissao(b.natureza, b.pacote, pedacosPorPessoa.get(b.personId) ?? [])
      };
    });

    linhasFolha.sort(
      (a, b) =>
        (a.contraparte ?? "").localeCompare(b.contraparte ?? "", "pt-BR") ||
        ordemDaNatureza(a.origemRef?.split(":")[2] ?? "") - ordemDaNatureza(b.origemRef?.split(":")[2] ?? "")
    );

    const linhasFinais =
      linhasFolha.length > 0
        ? [
            ...linhasFolha,
            ...folhaAgregada.map((l) => ({
              ...l,
              entraNoTotal: false,
              naoConfirmada: false,
              impedimento: "duplicada" as ImpedimentoPagar,
              motivoNaoSoma: `já no cadastro da folha · ${brl(l.valorCents)}`
            })),
            ...semFolhaAgregada.map((l) =>
              l.grupo === "folha" && l.impedimento === "duplicada"
                ? { ...l, motivoNaoSoma: `já no cadastro da folha · ${brl(l.valorCents)}` }
                : l
            )
          ]
        : linhas;

    const linhasComCobranca = await colarCobranca(linhasFinais);

    const meses = mesesRows.map((r) => r.mes);

    return {
      disponivel: true,
      meses: meses.includes(competencia) ? meses : [...meses, competencia].sort(),
      competencia,
      hoje,
      linhas: linhasComCobranca,
      areasEmpresa: areasCatRows,
      folhaMolde: linhasFolha.length > 0 ? competencia : null,
      ressalva: linhasFinais.length === 0 ? "nenhuma saída prevista nesta competência" : null
    };
  } catch (error) {
    console.error("[financeiro] contas a pagar indisponível:", error);
    return vazio(pedida ?? "", "a consulta falhou — ver log do servidor");
  }
}

/**
 * Favorito e anexos colam DEPOIS da agenda, para a consulta pesada não depender
 * da 0185. Tabela ausente (migration ainda não rodou) devolve a lista nua —
 * a tela continua pagável, só sem estrela nem boleto.
 */
async function colarCobranca(linhas: ContaAPagar[]): Promise<ContaAPagar[]> {
  if (linhas.length === 0) return linhas;
  try {
    const [favoritos, anexos] = await Promise.all([
      listarFavoritos(),
      listarAnexosPorChave(linhas.map((l) => l.chaveDedupe))
    ]);
    return linhas.map((l) => {
      const chave = chaveFavorito(l);
      return {
        ...l,
        favorito: chave ? favoritos.has(chave) : false,
        anexos: anexos.get(l.chaveDedupe) ?? []
      };
    });
  } catch (error) {
    console.error("[financeiro] cobranca indisponível:", error);
    return linhas;
  }
}
