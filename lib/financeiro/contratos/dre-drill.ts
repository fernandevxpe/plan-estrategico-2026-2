import "server-only";

import { isFinanceConfigured, query, transaction } from "../db";
import { contrato, contratoIndisponivel, type Contrato } from "./base";
import type { Visao } from "./resultado";

/**
 * A DRE expansível até o lançamento, e a operação de mover item de linha.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO NÃO É EXPORTADO POR `contratos/index.ts`
 * ---------------------------------------------------------------------------
 * `index.ts` está com alterações não commitadas de OUTRA frente enquanto esta
 * é escrita (o bloco de `categorizacao`). `git commit -- <caminhos>` grava o
 * conteúdo do diretório de trabalho dos caminhos listados, então incluir
 * `index.ts` no meu commit levaria o trabalho alheio junto — que é exatamente
 * o acidente descrito na §6 de `docs/CONTINUACAO.md`, e que já aconteceu duas
 * vezes nesta árvore.
 *
 * Então as rotas importam deste módulo diretamente. Quando `index.ts` estiver
 * limpo, uma linha de `export * from "./dre-drill"` restaura o ponto de
 * entrada único sem mudar mais nada.
 *
 * ---------------------------------------------------------------------------
 * A LEITURA E A ESCRITA MORAM JUNTAS AQUI, E É DE PROPÓSITO
 * ---------------------------------------------------------------------------
 * `contratos/http.ts` diz, com razão, que os contratos de leitura não escrevem.
 * Este é o primeiro que escreve, e a exceção precisa estar visível em vez de
 * disfarçada num arquivo de nome neutro:
 *
 *   · `getDreDrill` .............. só lê. É o expansível da tela.
 *   · `simularMoverCategoria` .... só lê. É o dry-run, com o impacto em reais.
 *   · `aplicarMoverCategoria` .... ESCREVE. Único ponto de escrita do módulo.
 *
 * A escrita é toda em `fin_dre_mover_aplicar`, no banco, porque a ORDEM dos
 * três passos (resolver a fila, gravar a trilha, atualizar a transação) é uma
 * regra do schema — o gatilho da 0094 é BEFORE e lê a fila no instante do
 * UPDATE. Reimplementar essa ordem em TypeScript seria a segunda cópia de uma
 * regra que já custou um invariante para ser descoberta.
 *
 * Nada aqui chama API externa. A restrição "APIs externas: somente GET" vale
 * inteira: esta escrita é no ledger próprio e em mais nada.
 */

const DOMINIO = "dre-drill";

export type NivelDrill = "linha" | "categoria" | "contraparte" | "lancamento";
export const NIVEIS = ["linha", "categoria", "contraparte", "lancamento"] as const;
const PROFUNDIDADE: Record<NivelDrill, number> = {
  linha: 1,
  categoria: 2,
  contraparte: 3,
  lancamento: 4
};

/** Teto de nós devolvidos. Estourar o teto é DECLARADO, nunca silencioso. */
const TETO_NOS = 4000;

export type RessalvaMedida = {
  chave: string;
  severidade: string;
  valorEmJogoCents: number;
  texto: string;
};

export type DestinoProvavel = {
  linha: string | null;
  linhaNome: string | null;
  concordanciaPct: number | null;
  evidencia: string | null;
  motivoIndeterminado: string | null;
};

export type NoDrill = {
  nivel: number;
  nivelNome: NivelDrill;
  chave: string;
  pai: string | null;
  rotulo: string;
  linha: string;
  secao: string;
  indentacao: number;
  /**
   * A ressalva vem ANTES do número — inclusive na ordem das chaves do JSON.
   * Não é estética: uma ressalva impressa depois é lida depois de o número já
   * ter sido acreditado, e o mês corrente na visão competência é justamente o
   * que mais parece bom e menos é.
   */
  ressalvasAntes: RessalvaMedida[];
  valorCents: number;
  /** A parte indeterminada DESTE grupo. Vem em todo nível, nunca num rodapé. */
  lacunaCents: number;
  lacunaBrutoCents: number;
  lancamentos: number;
  semCategoria: number;
  semContraparte: number;
  travados: number;
  ehLacuna: boolean;
  temFilhos: boolean;
  categoriaCode: string | null;
  contraparteId: number | null;
  origem: string | null;
  lancamentoId: number | null;
  /** Só em nó de lacuna: onde ele cairia, com a evidência. HIPÓTESE, nunca somada. */
  destinoProvavel: DestinoProvavel | null;
};

export type RegraDeOuro = {
  fecha: boolean;
  meses: number;
  lancamentos: number;
  dreCaixaCents: number;
  ledgerCents: number;
  residuoLedgerCents: number;
  aberturaCents: number;
  atualCents: number;
  residuoSaldoCents: number;
  itensCartaoNoCaixa: number;
};

export type DreDrill = {
  visao: Visao;
  mes: string | null;
  nivel: NivelDrill;
  expandidos: string[];
  ressalvasAntes: RessalvaMedida[];
  nos: NoDrill[];
  truncado: boolean;
  regraDeOuro: RegraDeOuro | null;
};

const VAZIO: DreDrill = {
  visao: "caixa",
  mes: null,
  nivel: "linha",
  expandidos: [],
  ressalvasAntes: [],
  nos: [],
  truncado: false,
  regraDeOuro: null
};

/**
 * O expansível.
 *
 * `nivel` é o TETO de profundidade e `expandir` diz quais nós abrir. Sem
 * `expandir`, devolve só o nível 1 — abrir tudo de uma vez seriam 14.662 nós
 * para um mês que tem 21 linhas.
 */
export async function getDreDrill(opcoes: {
  visao?: Visao;
  mes?: string;
  nivel?: NivelDrill;
  expandir?: string[];
}): Promise<Contrato<DreDrill>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");

  const visao: Visao = opcoes.visao === "competencia" ? "competencia" : "caixa";
  const nivel: NivelDrill = opcoes.nivel ?? "linha";
  const expandir = (opcoes.expandir ?? []).filter((e) => e.length > 0);
  const teto = PROFUNDIDADE[nivel];

  try {
    const mes =
      opcoes.mes ??
      (
        await query<{ mes: string }>(
          `SELECT max(mes)::text AS mes FROM fin_dre_drill_arvore_v WHERE visao = $1`,
          [visao]
        )
      )[0]?.mes ??
      null;

    if (!mes) {
      return contrato({
        dominio: DOMINIO,
        dado: { ...VAZIO, visao, nivel },
        ressalvas: ["Nenhum mês retornou para esta visão: não há o que abrir, e isso não é 'mês sem movimento'."]
      });
    }

    // Os nós: o nível 1 sempre, mais os filhos de cada chave expandida, até o
    // teto de profundidade. `pai = ANY($4)` é o expandir inteiro em UM ida e
    // volta — abrir n níveis com n consultas faria a tela piscar por degrau.
    const linhas = await query<Record<string, unknown>>(
      `SELECT n.* FROM fin_dre_drill_arvore_v n
        WHERE n.visao = $1 AND n.mes = $2::date AND n.nivel <= $3
          AND (n.nivel = 1 OR n.pai = ANY($4::text[]))
        ORDER BY n.linha_ordem, n.nivel, n.valor_cents, n.rotulo
        LIMIT $5`,
      [visao, mes, teto, expandir, TETO_NOS + 1]
    );

    const truncado = linhas.length > TETO_NOS;
    const nos = truncado ? linhas.slice(0, TETO_NOS) : linhas;

    const [ressalvas, ouro, destinos] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT linha, chave, severidade, valor_em_jogo_cents, texto
           FROM fin_dre_drill_ressalva_v
          WHERE visao = $1 AND mes = $2::date ORDER BY ordem`,
        [visao, mes]
      ),
      query<Record<string, unknown>>(`SELECT * FROM fin_dre_regra_de_ouro_v LIMIT 1`),
      // O destino provável só é buscado quando o drill chegou ao lançamento —
      // é lá que ele significa alguma coisa acionável.
      teto === 4
        ? query<Record<string, unknown>>(
            `SELECT origem, lancamento_id, linha_provavel, linha_provavel_nome,
                    concordancia_pct, evidencia, motivo_indeterminado
               FROM fin_dre_lacuna_destino_v`
          )
        : Promise.resolve([] as Record<string, unknown>[])
    ]);

    const porLancamento = new Map<string, Record<string, unknown>>();
    for (const d of destinos) porLancamento.set(`${d.origem}:${d.lancamento_id}`, d);

    const ressalvaDaLinha = (linha: string) =>
      ressalvas
        .filter((r) => r.linha === linha)
        .map((r) => mapearRessalva(r));
    const ressalvasDoMes = ressalvas.filter((r) => r.linha === null).map((r) => mapearRessalva(r));

    return contrato({
      dominio: DOMINIO,
      dado: {
        visao,
        mes: mes.slice(0, 10),
        nivel,
        expandidos: expandir,
        ressalvasAntes: ressalvasDoMes,
        nos: nos.map((n) => {
          const chaveLanc = n.origem ? `${n.origem}:${n.lancamento_id}` : null;
          const destino = chaveLanc ? porLancamento.get(chaveLanc) : undefined;
          return {
            nivel: Number(n.nivel),
            nivelNome: String(n.nivel_nome) as NivelDrill,
            chave: String(n.chave),
            pai: (n.pai as string) ?? null,
            rotulo: String(n.rotulo),
            linha: String(n.linha),
            secao: String(n.secao),
            indentacao: Number(n.indentacao),
            // ANTES do número, também na ordem das chaves do JSON.
            ressalvasAntes: Number(n.nivel) === 1 ? ressalvaDaLinha(String(n.linha)) : [],
            valorCents: Number(n.valor_cents ?? 0),
            lacunaCents: Number(n.lacuna_cents ?? 0),
            lacunaBrutoCents: Number(n.lacuna_bruto_cents ?? 0),
            lancamentos: Number(n.lancamentos ?? 0),
            semCategoria: Number(n.lancamentos_sem_categoria ?? 0),
            semContraparte: Number(n.lancamentos_sem_contraparte ?? 0),
            travados: Number(n.lancamentos_travados ?? 0),
            ehLacuna: Boolean(n.eh_lacuna),
            temFilhos: Boolean(n.tem_filhos),
            categoriaCode: (n.categoria_code as string) ?? null,
            contraparteId: n.counterparty_id === null ? null : Number(n.counterparty_id),
            origem: (n.origem as string) ?? null,
            lancamentoId: n.lancamento_id === null ? null : Number(n.lancamento_id),
            destinoProvavel: destino
              ? {
                  linha: (destino.linha_provavel as string) ?? null,
                  linhaNome: (destino.linha_provavel_nome as string) ?? null,
                  concordanciaPct:
                    destino.concordancia_pct === null ? null : Number(destino.concordancia_pct),
                  evidencia: (destino.evidencia as string) ?? null,
                  motivoIndeterminado: (destino.motivo_indeterminado as string) ?? null
                }
              : null
          };
        }),
        truncado,
        regraDeOuro: ouro.length ? mapearRegraDeOuro(ouro[0]) : null
      },
      ressalvas: [
        visao === "caixa"
          ? "Visão de CAIXA: realizado é fin_transaction, sempre. Item de cartão NÃO aparece aqui — o caixa dele é o pagamento da fatura, que é outro lançamento."
          : "Visão de COMPETÊNCIA: o MESMO dinheiro reposicionado no tempo, nunca dinheiro diferente. Item de cartão só existe nesta visão, na competência da compra.",
        "Cada nível soma exatamente o de cima: os quatro agregam o mesmo fato com GROUP BY mais fino. Se um dia não somar, é bug — e scripts/test-dre-drill.mjs o pega.",
        "lacunaCents vem em TODO nível, dentro do grupo a que pertence. Não existe rodapé de lacuna: rodapé é a forma elegante de esconder.",
        "destinoProvavel é HIPÓTESE sustentada pelo histórico da mesma contraparte, com a concordância medida. Nenhum total desta base a soma."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:dre-drill]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}

function mapearRessalva(r: Record<string, unknown>): RessalvaMedida {
  return {
    chave: String(r.chave),
    severidade: String(r.severidade),
    valorEmJogoCents: Number(r.valor_em_jogo_cents ?? 0),
    texto: String(r.texto)
  };
}

function mapearRegraDeOuro(o: Record<string, unknown>): RegraDeOuro {
  return {
    fecha: Boolean(o.fecha),
    meses: Number(o.meses ?? 0),
    lancamentos: Number(o.lancamentos ?? 0),
    dreCaixaCents: Number(o.dre_cents ?? 0),
    ledgerCents: Number(o.ledger_cents ?? 0),
    residuoLedgerCents: Number(o.residuo_ledger_cents ?? 0),
    aberturaCents: Number(o.abertura ?? 0),
    atualCents: Number(o.atual ?? 0),
    residuoSaldoCents: Number(o.residuo_saldo_cents ?? 0),
    itensCartaoNoCaixa: Number(o.itens_cartao_no_caixa ?? 0)
  };
}

// ---------------------------------------------------------------------------
// Mover item de uma linha para outra
// ---------------------------------------------------------------------------

export const ALVOS_MOVER = ["fin_transaction", "fin_card_transaction"] as const;
export type AlvoMover = (typeof ALVOS_MOVER)[number];

export type AvaliacaoMover = {
  alvo: string;
  id: number;
  aceito: boolean;
  semEfeito: boolean;
  recusa: string | null;
  amountCents: number;
  categoriaAntes: string | null;
  categoriaDepois: string | null;
  linhaAntes: string | null;
  linhaDepois: string | null;
  travado: boolean;
  classifiedBy: string | null;
};

export type ImpactoLinha = {
  visao: string;
  mes: string;
  linha: string;
  linhaNome: string | null;
  valorAntesCents: number;
  valorDepoisCents: number;
  deltaCents: number;
};

export type MoverCategoria = {
  aplicado: boolean;
  alvo: AlvoMover;
  categoriaDestinoId: number;
  batchId: string | null;
  avaliacoes: AvaliacaoMover[];
  aceitos: number;
  recusados: number;
  semEfeito: number;
  impacto: ImpactoLinha[];
  regraDeOuro: RegraDeOuro | null;
};

const VAZIO_MOVER: MoverCategoria = {
  aplicado: false,
  alvo: "fin_transaction",
  categoriaDestinoId: 0,
  batchId: null,
  avaliacoes: [],
  aceitos: 0,
  recusados: 0,
  semEfeito: 0,
  impacto: [],
  regraDeOuro: null
};

/** O dry-run. Não escreve nada, e devolve o impacto em reais linha a linha. */
export async function simularMoverCategoria(entrada: {
  alvo: AlvoMover;
  ids: number[];
  categoriaId: number;
}): Promise<Contrato<MoverCategoria>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO_MOVER, "banco financeiro não configurado");
  try {
    const [avaliacoes, impacto, ouro] = await Promise.all([
      query<Record<string, unknown>>(`SELECT * FROM fin_dre_mover_avaliar($1, $2::bigint[], $3)`, [
        entrada.alvo,
        entrada.ids,
        entrada.categoriaId
      ]),
      query<Record<string, unknown>>(`SELECT * FROM fin_dre_mover_impacto($1, $2::bigint[], $3)`, [
        entrada.alvo,
        entrada.ids,
        entrada.categoriaId
      ]),
      query<Record<string, unknown>>(`SELECT * FROM fin_dre_regra_de_ouro_v LIMIT 1`)
    ]);

    return montar(entrada, false, null, avaliacoes, impacto, ouro, [
      "DRY-RUN: nada foi escrito. Este é o mesmo julgamento que a aplicação faz — se algum id vier recusado, o POST com aplicar=true recusa o LOTE INTEIRO."
    ]);
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:dre-drill:simular]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO_MOVER, mensagem);
  }
}

/**
 * A aplicação. O ÚNICO ponto de escrita deste módulo.
 *
 * O antes/depois devolvido é MEDIDO, não simulado: as linhas da DRE são lidas
 * antes do UPDATE e depois dele, dentro da mesma transação. Devolver a
 * simulação como se fosse o resultado esconderia justamente o caso em que os
 * dois divergem — que é o caso em que alguém precisa saber.
 */
export async function aplicarMoverCategoria(entrada: {
  alvo: AlvoMover;
  ids: number[];
  categoriaId: number;
  motivo: string;
  autor: string;
}): Promise<Contrato<MoverCategoria>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO_MOVER, "banco financeiro não configurado");
  try {
    const resultado = await transaction(async (client) => {
      const chaves = await client.query(
        `SELECT DISTINCT visao, mes, linha FROM (
           SELECT visao, mes, linha FROM fin_dre_mover_impacto($1, $2::bigint[], $3)) x`,
        [entrada.alvo, entrada.ids, entrada.categoriaId]
      );

      const antes = await client.query(
        `SELECT n.visao, n.mes, n.linha, n.valor_cents FROM fin_dre_drill_arvore_v n
          WHERE n.nivel = 1 AND (n.visao, n.mes, n.linha) IN (
            SELECT visao, mes, linha FROM fin_dre_mover_impacto($1, $2::bigint[], $3))`,
        [entrada.alvo, entrada.ids, entrada.categoriaId]
      );

      const aplicados = await client.query(
        `SELECT * FROM fin_dre_mover_aplicar($1, $2::bigint[], $3, $4, $5)`,
        [entrada.alvo, entrada.ids, entrada.categoriaId, entrada.motivo, entrada.autor]
      );

      // O DEPOIS é lido pelas chaves capturadas ANTES do UPDATE, não por uma
      // nova chamada a `fin_dre_mover_impacto` — depois de aplicado o
      // movimento já aconteceu, e a função devolveria delta zero. Ler pelo
      // conjunto de chaves congelado é o que faz o antes/depois ser MEDIDO.
      const depois = await client.query(
        `SELECT n.visao, n.mes, n.linha, n.valor_cents FROM fin_dre_drill_arvore_v n
          WHERE n.nivel = 1 AND (n.visao, n.mes, n.linha) IN (
            SELECT (x->>'visao')::text, (x->>'mes')::date, (x->>'linha')::text
              FROM jsonb_array_elements($1::jsonb) x)`,
        [JSON.stringify(chaves.rows)]
      );

      const ouro = await client.query(`SELECT * FROM fin_dre_regra_de_ouro_v LIMIT 1`);
      if (ouro.rows.length && ouro.rows[0].fecha !== true) {
        // Não deveria ser alcançável: mover reclassifica, não move dinheiro.
        // Se for, a transação inteira volta — meio caminho gravado é pior que
        // nada gravado quando o assunto é dinheiro.
        throw new Error(
          "a regra de ouro deixou de fechar depois de mover: a transação foi desfeita. " +
            "Na visão caixa o realizado é fin_transaction, e mover categoria não pode alterar isso."
        );
      }

      const avaliacoes = await client.query(
        `SELECT * FROM fin_dre_mover_avaliar($1, $2::bigint[], $3)`,
        [entrada.alvo, entrada.ids, entrada.categoriaId]
      );

      return { antes: antes.rows, depois: depois.rows, aplicados: aplicados.rows, ouro: ouro.rows, avaliacoes: avaliacoes.rows };
    });

    const chave = (r: Record<string, unknown>) => `${r.visao}|${String(r.mes).slice(0, 10)}|${r.linha}`;
    const antesPor = new Map(resultado.antes.map((r) => [chave(r), Number(r.valor_cents ?? 0)]));
    const impacto: ImpactoLinha[] = resultado.depois.map((r) => {
      const a = antesPor.get(chave(r)) ?? 0;
      const d = Number(r.valor_cents ?? 0);
      return {
        visao: String(r.visao),
        mes: String(r.mes).slice(0, 10),
        linha: String(r.linha),
        linhaNome: null,
        valorAntesCents: a,
        valorDepoisCents: d,
        deltaCents: d - a
      };
    });

    const batchId = resultado.aplicados.length ? String(resultado.aplicados[0].batch_id) : null;

    return montar(
      entrada,
      true,
      batchId,
      resultado.avaliacoes,
      [],
      resultado.ouro,
      [
        `APLICADO: ${resultado.aplicados.length} lançamento(s) mudaram de linha, lote ${batchId}. ` +
          "O antes/depois abaixo é MEDIDO dentro da transação, não simulado.",
        "A trilha está em fin_audit_log (batch_id) e em fin_classification_event (stage='humano', com o valor anterior). Desfazer é possível a partir de `before`.",
        "Nenhum centavo mudou de conta: mover é RECLASSIFICAR. A regra de ouro foi reconferida dentro da mesma transação."
      ],
      impacto
    );
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:dre-drill:aplicar]", mensagem);
    return contratoIndisponivel(DOMINIO, { ...VAZIO_MOVER, alvo: entrada.alvo }, mensagem);
  }
}

function montar(
  entrada: { alvo: AlvoMover; categoriaId: number },
  aplicado: boolean,
  batchId: string | null,
  avaliacoes: Record<string, unknown>[],
  impactoBruto: Record<string, unknown>[],
  ouro: Record<string, unknown>[],
  ressalvas: string[],
  impactoMedido?: ImpactoLinha[]
): Contrato<MoverCategoria> {
  const aval: AvaliacaoMover[] = avaliacoes.map((a) => ({
    alvo: String(a.alvo),
    id: Number(a.id),
    aceito: Boolean(a.aceito),
    semEfeito: Boolean(a.sem_efeito),
    recusa: (a.recusa as string) ?? null,
    amountCents: Number(a.amount_cents ?? 0),
    categoriaAntes: (a.categoria_antes as string) ?? null,
    categoriaDepois: (a.categoria_depois as string) ?? null,
    linhaAntes: (a.linha_antes as string) ?? null,
    linhaDepois: (a.linha_depois as string) ?? null,
    travado: Boolean(a.travado),
    classifiedBy: (a.classified_by as string) ?? null
  }));

  const impacto: ImpactoLinha[] =
    impactoMedido ??
    impactoBruto.map((i) => ({
      visao: String(i.visao),
      mes: String(i.mes).slice(0, 10),
      linha: String(i.linha),
      linhaNome: (i.linha_nome as string) ?? null,
      valorAntesCents: Number(i.valor_antes ?? 0),
      valorDepoisCents: Number(i.valor_depois ?? 0),
      deltaCents: Number(i.delta ?? 0)
    }));

  const recusados = aval.filter((a) => !a.aceito);
  const travados = aval.filter((a) => a.aceito && a.travado);

  return contrato({
    dominio: DOMINIO,
    dado: {
      aplicado,
      alvo: entrada.alvo,
      categoriaDestinoId: entrada.categoriaId,
      batchId,
      avaliacoes: aval,
      aceitos: aval.filter((a) => a.aceito && !a.semEfeito).length,
      recusados: recusados.length,
      semEfeito: aval.filter((a) => a.semEfeito).length,
      impacto,
      regraDeOuro: ouro.length ? mapearRegraDeOuro(ouro[0]) : null
    },
    ressalvas: [
      ...ressalvas,
      recusados.length
        ? `${recusados.length} lançamento(s) recusado(s), com motivo em cada linha de avaliacoes. O lote é TUDO OU NADA: com um recusado, nada é escrito.`
        : "",
      travados.length
        ? `${travados.length} lançamento(s) já tinham a categoria TRAVADA por decisão humana anterior. Mover sobrescreve uma decisão de gente, não um palpite de máquina — confira antes.`
        : "",
      "Mover item de linha é RECLASSIFICAR a categoria, nunca editar a DRE. A DRE é derivada: alterá-la direto criaria uma segunda verdade, e a pergunta 'de onde veio este número?' passaria a ter duas respostas."
    ].filter((r) => r.length > 0)
  });
}
