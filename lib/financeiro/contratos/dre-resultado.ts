import "server-only";

import { isFinanceConfigured, query, transaction } from "../db";
import { contrato, contratoIndisponivel, ENTIDADE, type Contrato } from "./base";
import type { Visao } from "./resultado";

/**
 * O que a tela de Resultado precisa e o drill não dá.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO EXISTE AO LADO DE `dre-drill.ts`
 * ---------------------------------------------------------------------------
 * `fin_dre_drill_arvore_v` devolve só linhas de TIPO ITEM — é o que faz sentido
 * para um expansível, porque subtotal não tem lançamento embaixo. Mas a DRE que
 * alguém lê tem "Receita líquida", "Margem de contribuição" e "Lucro líquido"
 * no meio, e uma tela que os omite obriga o leitor a somar de cabeça.
 *
 * Então: o drill continua sendo a fonte do que ABRE, e este contrato é a fonte
 * do ESQUELETO — as mesmas linhas mais os subtotais, direto de
 * `fin_dre_com_ajuste_v`. Os dois leem a mesma origem (`fin_dre_v`), e a tela
 * confere um contra o outro na cara do usuário em vez de escolher um.
 *
 * ---------------------------------------------------------------------------
 * O AJUSTE DECLARADO: A ESCRITA QUE NÃO TOCA O CAIXA, PROVADA A CADA ESCRITA
 * ---------------------------------------------------------------------------
 * `fin_dre_ajuste` nasceu com três travas estruturais (0102 §7): a DRE mensal
 * não lê a tabela, um CHECK proíbe `visao='caixa'`, e um gatilho recusa linha
 * de subtotal. Isso é o schema garantindo o desenho.
 *
 * O que este contrato acrescenta é a MEDIDA: `criarAjuste` lê o lucro do mês e
 * a regra de ouro ANTES do INSERT e DEPOIS dele, dentro da mesma transação, e
 * devolve os dois. A frase "ajuste não altera o caixa" deixa de ser promessa da
 * documentação e passa a ser um par de números na resposta — e se um dia os
 * dois divergirem, a transação inteira volta.
 *
 * Como em `dre-drill.ts`, este módulo NÃO é exportado por `contratos/index.ts`:
 * as rotas importam daqui direto. O motivo está lá, e é o mesmo (§6 de
 * `docs/CONTINUACAO.md`).
 *
 * Nada aqui chama API externa. A escrita é no ledger próprio e em mais nada.
 */

const DOMINIO = "dre-resultado";

/** Uma linha do esqueleto da DRE: item, subtotal, ou ajuste declarado. */
export type LinhaResultado = {
  linha: string;
  nome: string;
  secao: string;
  tipo: string;
  ordem: number;
  formula: string | null;
  valorCents: number;
  /** 'extrato' = dinheiro que andou · 'declarado' = afirmação humana. */
  origem: string;
  motivo: string | null;
  autor: string | null;
};

export type AjusteDeclarado = {
  id: number;
  visao: string;
  mes: string;
  linha: string;
  linhaNome: string;
  amountCents: number;
  motivo: string;
  autor: string;
  evidenciaUrl: string | null;
  criadoEm: string;
  vigente: boolean;
  revogadoEm: string | null;
  revogadoPor: string | null;
  revogadoMotivo: string | null;
};

/** Uma linha onde o ajuste é ACEITO. As outras o banco recusa, e a tela não as oferece. */
export type LinhaAjustavel = { linha: string; nome: string; ordem: number };

export type MesDisponivel = {
  mes: string;
  lucroLiquidoCents: number;
  lucroComLacunasCents: number;
  lancamentos: number;
};

/**
 * A ressalva do mês, por linha — inclusive das linhas SEM nó no drill.
 *
 * Este é o motivo de ela viver aqui e não só no drill. Em agosto/2026, na visão
 * competência, `despesas_pessoal` vale ZERO: a folha sai em 01/09. Zero valor
 * significa zero lançamento, e zero lançamento significa que a linha não existe
 * na árvore do drill — então a ressalva mais importante do mês (o resultado
 * está otimista em ~R$ 93.731) seria a única que a tela não teria como mostrar,
 * justamente por estar pendurada na linha que sumiu.
 */
export type RessalvaLinha = {
  /** `null` = ressalva do mês inteiro, não de uma linha. */
  linha: string | null;
  chave: string;
  severidade: string;
  valorEmJogoCents: number;
  texto: string;
};

/** O catálogo de destino do "mover": categoria → linha da DRE em que ela cai. */
export type CategoriaDestino = {
  id: number;
  code: string;
  nome: string;
  kind: string;
  linha: string | null;
  linhaNome: string | null;
};

export type DreResultado = {
  visao: Visao;
  mes: string | null;
  linhas: LinhaResultado[];
  /** Vêm ANTES do número na tela, e antes dele também nesta lista de chaves. */
  ressalvas: RessalvaLinha[];
  ajustes: AjusteDeclarado[];
  linhasAjustaveis: LinhaAjustavel[];
  meses: MesDisponivel[];
  categorias: CategoriaDestino[];
};

const VAZIO: DreResultado = {
  visao: "caixa",
  mes: null,
  linhas: [],
  ressalvas: [],
  ajustes: [],
  linhasAjustaveis: [],
  meses: [],
  categorias: []
};

/**
 * O esqueleto do mês: linhas com subtotal, ajustes declarados, meses e destinos.
 *
 * Uma consulta por assunto, em paralelo. Nenhuma delas depende do resultado da
 * outra, e serializá-las só faria a tela abrir mais devagar.
 */
export async function getDreResultado(opcoes: {
  visao?: Visao;
  mes?: string;
}): Promise<Contrato<DreResultado>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");

  const visao: Visao = opcoes.visao === "competencia" ? "competencia" : "caixa";

  try {
    const meses = await query<Record<string, unknown>>(
      `SELECT m.mes::text AS mes, m.lucro_liquido_cents, m.lucro_liquido_com_lacunas_cents, m.lancamentos
         FROM fin_dre_mensal_v m JOIN fin_entity e ON e.id = m.entity_id
        WHERE e.slug = $1 AND m.visao = $2
        ORDER BY m.mes DESC`,
      [ENTIDADE, visao]
    );

    const mes = opcoes.mes ?? (meses[0]?.mes ? String(meses[0].mes).slice(0, 10) : null);

    if (!mes) {
      return contrato({
        dominio: DOMINIO,
        dado: { ...VAZIO, visao },
        ressalvas: ["Nenhum mês retornou para esta visão. Isso não é 'mês sem movimento': é ausência de dado."]
      });
    }

    const [linhas, ressalvas, ajustes, ajustaveis, categorias] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT v.linha, v.linha_nome, v.secao, v.tipo, v.ordem, v.formula, v.valor_cents,
                v.origem, v.motivo, v.autor
           FROM fin_dre_com_ajuste_v v JOIN fin_entity e ON e.id = v.entity_id
          WHERE e.slug = $1 AND v.visao = $2 AND v.mes = $3::date
          ORDER BY v.ordem, v.linha`,
        [ENTIDADE, visao, mes]
      ),
      // TODAS as ressalvas do mês, inclusive as de linha que não tem nó no
      // drill. Ver o comentário de `RessalvaLinha`: é a da folha de agosto.
      query<Record<string, unknown>>(
        `SELECT linha, chave, severidade, valor_em_jogo_cents, texto
           FROM fin_dre_drill_ressalva_v
          WHERE visao = $1 AND mes = $2::date
          ORDER BY ordem`,
        [visao, mes]
      ),
      // Os revogados vêm junto de propósito: um ajuste que some da tela quando
      // é revogado apaga o fato de alguém já ter afirmado aquilo um dia.
      query<Record<string, unknown>>(
        `SELECT a.* FROM fin_dre_ajuste_v a JOIN fin_entity e ON e.id = a.entity_id
          WHERE e.slug = $1 AND a.mes = $2::date
          ORDER BY a.vigente DESC, a.criado_em DESC`,
        [ENTIDADE, mes]
      ),
      // A mesma condição que o gatilho `fin_dre_ajuste_guarda` aplica. Oferecer
      // na tela uma linha que o banco vai recusar é ensinar o usuário a apanhar.
      query<Record<string, unknown>>(
        `SELECT slug, name, ordem FROM fin_dre_linha
          WHERE secao = 'resultado' AND tipo = 'item' ORDER BY ordem`
      ),
      query<Record<string, unknown>>(
        `SELECT c.id, c.code, c.name, c.kind,
                fin_dre_linha_da_categoria(c.id, false, 'ledger') AS linha,
                d.name AS linha_nome
           FROM fin_category c
           JOIN fin_entity e ON e.id = c.entity_id
           LEFT JOIN fin_dre_linha d
                  ON d.slug = fin_dre_linha_da_categoria(c.id, false, 'ledger')
          WHERE e.slug = $1 AND c.is_active
          ORDER BY c.code`,
        [ENTIDADE]
      )
    ]);

    const vigentes = ajustes.filter((a) => a.vigente === true);
    const totalAjuste = vigentes.reduce((s, a) => s + Number(a.amount_cents ?? 0), 0);

    return contrato({
      dominio: DOMINIO,
      dado: {
        visao,
        mes,
        linhas: linhas.map(mapearLinha),
        ressalvas: ressalvas.map((r) => ({
          linha: (r.linha as string) ?? null,
          chave: String(r.chave),
          severidade: String(r.severidade),
          valorEmJogoCents: Number(r.valor_em_jogo_cents ?? 0),
          texto: String(r.texto)
        })),
        ajustes: ajustes.map(mapearAjuste),
        linhasAjustaveis: ajustaveis.map((l) => ({
          linha: String(l.slug),
          nome: String(l.name),
          ordem: Number(l.ordem ?? 0)
        })),
        meses: meses.map((m) => ({
          mes: String(m.mes).slice(0, 10),
          lucroLiquidoCents: Number(m.lucro_liquido_cents ?? 0),
          lucroComLacunasCents: Number(m.lucro_liquido_com_lacunas_cents ?? 0),
          lancamentos: Number(m.lancamentos ?? 0)
        })),
        categorias: categorias.map((c) => ({
          id: Number(c.id),
          code: String(c.code),
          nome: String(c.name),
          kind: String(c.kind),
          linha: (c.linha as string) ?? null,
          linhaNome: (c.linha_nome as string) ?? null
        }))
      },
      ressalvas: [
        "As linhas de tipo `subtotal` NÃO são abríveis: subtotal não tem lançamento embaixo, ele soma os itens que tem. O que abre é item.",
        totalAjuste !== 0
          ? "Há ajuste declarado vigente neste mês. Ele vive em seção própria (`secao='ajuste'`, `origem='declarado'`) e NÃO entra em nenhuma linha do extrato — somar as duas seções sem olhar `origem` é o erro que a separação existe para impedir."
          : "Nenhum ajuste declarado vigente neste mês: a seção de ajuste está estruturalmente zerada, não vazia por falta de carregamento.",
        visao === "caixa"
          ? "Na visão CAIXA a seção de ajuste é sempre zero por CHECK do banco (`fin_dre_ajuste.visao = 'competencia'`). Ajuste em caixa faria a soma da coluna deixar de reconstruir o saldo — que é a regra de ouro."
          : "Ajuste declarado só existe na visão COMPETÊNCIA, e mesmo aqui fica ao lado, nunca dentro."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:dre-resultado]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}

function mapearLinha(l: Record<string, unknown>): LinhaResultado {
  return {
    linha: String(l.linha),
    nome: String(l.linha_nome),
    secao: String(l.secao),
    tipo: String(l.tipo),
    ordem: Number(l.ordem ?? 0),
    formula: (l.formula as string) ?? null,
    valorCents: Number(l.valor_cents ?? 0),
    origem: String(l.origem),
    motivo: (l.motivo as string) ?? null,
    autor: (l.autor as string) ?? null
  };
}

function mapearAjuste(a: Record<string, unknown>): AjusteDeclarado {
  return {
    id: Number(a.id),
    visao: String(a.visao),
    mes: String(a.mes).slice(0, 10),
    linha: String(a.linha),
    linhaNome: String(a.linha_nome),
    amountCents: Number(a.amount_cents ?? 0),
    motivo: String(a.motivo),
    autor: String(a.autor),
    evidenciaUrl: (a.evidencia_url as string) ?? null,
    criadoEm: a.criado_em instanceof Date ? a.criado_em.toISOString() : String(a.criado_em),
    vigente: Boolean(a.vigente),
    revogadoEm:
      a.revogado_em == null ? null : a.revogado_em instanceof Date ? a.revogado_em.toISOString() : String(a.revogado_em),
    revogadoPor: (a.revogado_por as string) ?? null,
    revogadoMotivo: (a.revogado_motivo as string) ?? null
  };
}

// ---------------------------------------------------------------------------
// O ajuste declarado — escrita, com a prova de que ela não alcança o caixa
// ---------------------------------------------------------------------------

/** O tamanho mínimo do motivo. Espelha o CHECK da 0102: "ajuste" não é motivo. */
export const MOTIVO_MINIMO = 12;

export type ProvaSeparacao = {
  /** `fin_dre_mensal_v` do mês: a DRE que NÃO lê a tabela de ajuste. */
  lucroLiquidoAntesCents: number;
  lucroLiquidoDepoisCents: number;
  /** A regra de ouro: abertura + DRE de caixa = saldo. */
  residuoLedgerAntesCents: number;
  residuoLedgerDepoisCents: number;
  residuoSaldoAntesCents: number;
  residuoSaldoDepoisCents: number;
  fechaAntes: boolean;
  fechaDepois: boolean;
  /** Verdadeiro quando NADA disso se mexeu — que é o resultado esperado. */
  caixaIntacto: boolean;
};

export type ResultadoAjuste = {
  aplicado: boolean;
  acao: "criar" | "revogar";
  ajuste: AjusteDeclarado | null;
  prova: ProvaSeparacao | null;
  recusa: string | null;
};

const VAZIO_AJUSTE: ResultadoAjuste = {
  aplicado: false,
  acao: "criar",
  ajuste: null,
  prova: null,
  recusa: null
};

/**
 * O dry-run do ajuste.
 *
 * Ele julga com as MESMAS regras do banco (linha de item da seção resultado,
 * motivo de 12+, autor não vazio, visão competência) e não escreve nada. É o
 * mesmo desenho do `mover-categoria`: um caminho só, o verbo é a diferença.
 */
export async function simularAjuste(entrada: EntradaAjuste): Promise<Contrato<ResultadoAjuste>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO_AJUSTE, "banco financeiro não configurado");
  try {
    const recusa = await julgarAjuste(entrada);
    return contrato({
      dominio: DOMINIO,
      dado: { ...VAZIO_AJUSTE, recusa },
      ressalvas: [
        recusa
          ? `DRY-RUN: este ajuste seria RECUSADO — ${recusa}`
          : "DRY-RUN: nada foi escrito. O ajuste seria aceito, e apareceria em seção própria, sem alterar nenhuma linha do extrato.",
        "Ajuste declarado NÃO altera o caixa nem o saldo de nenhuma conta. Ele não entra em fin_dre_mensal_v; a aplicação devolve a medida disso, antes e depois."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:dre-resultado:simular-ajuste]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO_AJUSTE, mensagem);
  }
}

export type EntradaAjuste = {
  mes: string;
  linha: string;
  amountCents: number;
  motivo: string;
  autor: string;
  evidenciaUrl?: string | null;
};

/**
 * Grava o ajuste. Um dos dois pontos de escrita da tela de Resultado.
 *
 * O lucro do mês e a regra de ouro são lidos antes e depois, na mesma
 * transação. Se qualquer um se mexer, a transação volta inteira: um ajuste que
 * alcança o caixa é exatamente o que esta tabela foi desenhada para não ser.
 */
export async function criarAjuste(entrada: EntradaAjuste): Promise<Contrato<ResultadoAjuste>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO_AJUSTE, "banco financeiro não configurado");
  try {
    const recusa = await julgarAjuste(entrada);
    if (recusa) {
      return contrato({
        dominio: DOMINIO,
        dado: { ...VAZIO_AJUSTE, recusa },
        ressalvas: [`RECUSADO, nada foi escrito: ${recusa}`]
      });
    }

    const feito = await transaction(async (client) => {
      const antes = await medirSeparacao(client, entrada.mes);

      const inserido = await client.query(
        `INSERT INTO fin_dre_ajuste (entity_id, visao, mes, linha, amount_cents, motivo, autor, evidencia_url)
         SELECT e.id, 'competencia', $2::date, $3, $4, $5, $6, $7
           FROM fin_entity e WHERE e.slug = $1
         RETURNING id`,
        [
          ENTIDADE,
          entrada.mes,
          entrada.linha,
          entrada.amountCents,
          entrada.motivo.trim(),
          entrada.autor.trim(),
          entrada.evidenciaUrl?.trim() || null
        ]
      );
      if (!inserido.rows.length) throw new Error(`entidade ${ENTIDADE} não encontrada`);

      const depois = await medirSeparacao(client, entrada.mes);
      const prova = compararSeparacao(antes, depois);
      if (!prova.caixaIntacto) {
        throw new Error(
          "o ajuste declarado mexeu no caixa: a transação foi desfeita. Isto não deveria ser " +
            "alcançável — fin_dre_mensal_v não lê fin_dre_ajuste, e a regra de ouro não depende dela."
        );
      }

      const linha = await client.query(`SELECT * FROM fin_dre_ajuste_v WHERE id = $1`, [inserido.rows[0].id]);
      return { prova, ajuste: linha.rows[0] as Record<string, unknown> };
    });

    return contrato({
      dominio: DOMINIO,
      dado: {
        aplicado: true,
        acao: "criar",
        ajuste: mapearAjuste(feito.ajuste),
        prova: feito.prova,
        recusa: null
      },
      ressalvas: [
        "GRAVADO em fin_dre_ajuste. Ele aparece em seção própria da DRE, com autor e motivo, e nunca dentro de uma linha do extrato.",
        "Medido dentro da mesma transação: o lucro líquido do mês e a regra de ouro são IDÊNTICOS antes e depois. Ajuste declarado não move dinheiro — ele declara uma leitura.",
        "Para desfazer, revogue: revogar é ato com dono e motivo, como criar. O ajuste revogado continua visível, porque alguém afirmou aquilo um dia."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:dre-resultado:criar-ajuste]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO_AJUSTE, mensagem);
  }
}

/** Revogar: o ajuste some do total, nunca da tela. */
export async function revogarAjuste(entrada: {
  id: number;
  por: string;
  motivo: string;
}): Promise<Contrato<ResultadoAjuste>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO_AJUSTE, "banco financeiro não configurado");
  try {
    if (entrada.motivo.trim().length < MOTIVO_MINIMO) {
      return contrato({
        dominio: DOMINIO,
        dado: {
          ...VAZIO_AJUSTE,
          acao: "revogar",
          recusa: `motivo da revogação precisa de ao menos ${MOTIVO_MINIMO} caracteres: sumir sem explicação é pior que ficar errado à vista`
        },
        ressalvas: ["RECUSADO, nada foi escrito."]
      });
    }
    if (!entrada.por.trim()) {
      return contrato({
        dominio: DOMINIO,
        dado: { ...VAZIO_AJUSTE, acao: "revogar", recusa: "quem revoga é obrigatório: revogação anônima é revogação sem dono" },
        ressalvas: ["RECUSADO, nada foi escrito."]
      });
    }

    const linhas = await query<Record<string, unknown>>(
      `UPDATE fin_dre_ajuste
          SET revogado_em = now(), revogado_por = $2, revogado_motivo = $3
        WHERE id = $1 AND revogado_em IS NULL
        RETURNING id`,
      [entrada.id, entrada.por.trim(), entrada.motivo.trim()]
    );
    if (!linhas.length) {
      return contrato({
        dominio: DOMINIO,
        dado: { ...VAZIO_AJUSTE, acao: "revogar", recusa: "ajuste não encontrado ou já revogado" },
        ressalvas: ["Nada foi escrito."]
      });
    }

    const atual = await query<Record<string, unknown>>(`SELECT * FROM fin_dre_ajuste_v WHERE id = $1`, [entrada.id]);
    return contrato({
      dominio: DOMINIO,
      dado: { aplicado: true, acao: "revogar", ajuste: mapearAjuste(atual[0]), prova: null, recusa: null },
      ressalvas: [
        "REVOGADO. Ele sai do subtotal de ajustes e continua listado, com quem revogou e por quê.",
        "O caixa não se mexeu porque nunca esteve envolvido: ajuste declarado não toca fin_transaction."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:dre-resultado:revogar-ajuste]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO_AJUSTE, mensagem);
  }
}

/**
 * O julgamento, em português, ANTES de o banco recusar em SQL.
 *
 * Não substitui os CHECKs — eles continuam sendo a autoridade. Existe para a
 * pessoa ler o motivo em vez de uma mensagem de constraint.
 */
async function julgarAjuste(entrada: EntradaAjuste): Promise<string | null> {
  if (!/^\d{4}-\d{2}-01$/.test(entrada.mes)) {
    return "mês precisa ser o primeiro dia do mês, no formato AAAA-MM-01";
  }
  if (!Number.isInteger(entrada.amountCents) || entrada.amountCents === 0) {
    return "valor precisa ser um inteiro de centavos diferente de zero: ajuste de R$ 0,00 não é ajuste";
  }
  if (entrada.motivo.trim().length < MOTIVO_MINIMO) {
    return `motivo precisa de ao menos ${MOTIVO_MINIMO} caracteres: "ajuste" é rótulo, não motivo`;
  }
  if (!entrada.autor.trim()) {
    return "autor é obrigatório: ajuste anônimo é ajuste sem dono";
  }

  const linha = await query<Record<string, unknown>>(
    `SELECT slug, name, secao, tipo FROM fin_dre_linha WHERE slug = $1`,
    [entrada.linha]
  );
  if (!linha.length) return `a linha "${entrada.linha}" não existe na DRE`;
  if (String(linha[0].tipo) !== "item") {
    return `${linha[0].name} é SUBTOTAL: ele já soma os itens, e ajustar ali contaria duas vezes. Ajuste a linha de item.`;
  }
  if (String(linha[0].secao) !== "resultado") {
    return (
      `${linha[0].name} é da seção "${linha[0].secao}": "fora" é o que existe no caixa e não é resultado, ` +
      `"lacuna" é o que a DRE não conseguiu classificar. Declarar ajuste ali mentiria sobre a natureza da seção.`
    );
  }
  return null;
}

type FotoSeparacao = {
  lucro: number;
  residuoLedger: number;
  residuoSaldo: number;
  fecha: boolean;
};

async function medirSeparacao(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  mes: string
): Promise<FotoSeparacao> {
  const dre = await client.query(
    `SELECT m.lucro_liquido_cents FROM fin_dre_mensal_v m JOIN fin_entity e ON e.id = m.entity_id
      WHERE e.slug = $1 AND m.visao = 'competencia' AND m.mes = $2::date`,
    [ENTIDADE, mes]
  );
  const ouro = await client.query(`SELECT * FROM fin_dre_regra_de_ouro_v LIMIT 1`);
  return {
    lucro: Number(dre.rows[0]?.lucro_liquido_cents ?? 0),
    residuoLedger: Number(ouro.rows[0]?.residuo_ledger_cents ?? 0),
    residuoSaldo: Number(ouro.rows[0]?.residuo_saldo_cents ?? 0),
    fecha: Boolean(ouro.rows[0]?.fecha)
  };
}

function compararSeparacao(antes: FotoSeparacao, depois: FotoSeparacao): ProvaSeparacao {
  return {
    lucroLiquidoAntesCents: antes.lucro,
    lucroLiquidoDepoisCents: depois.lucro,
    residuoLedgerAntesCents: antes.residuoLedger,
    residuoLedgerDepoisCents: depois.residuoLedger,
    residuoSaldoAntesCents: antes.residuoSaldo,
    residuoSaldoDepoisCents: depois.residuoSaldo,
    fechaAntes: antes.fecha,
    fechaDepois: depois.fecha,
    caixaIntacto:
      antes.lucro === depois.lucro &&
      antes.residuoLedger === depois.residuoLedger &&
      antes.residuoSaldo === depois.residuoSaldo &&
      antes.fecha === depois.fecha
  };
}
