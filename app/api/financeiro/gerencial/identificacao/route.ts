import { normalizarPaginacao } from "@/lib/financeiro/contratos/base";
import { opcaoDe, rotaDeLeitura } from "@/lib/financeiro/contratos/http";
import {
  CAMINHOS,
  UNIVERSOS,
  listarExcluidos,
  listarGrupos,
  listarInventario
} from "@/lib/financeiro/identificacao";

import { centavosDe, paginacaoDe } from "../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/identificacao
 *
 * O inventário do que está sem identificação, num lugar só.
 *
 * Filtros: `?universo=` `?tipo=` `?caminho=` `?valorMinCents=` `?valorMaxCents=`
 *          `?alcancavel=1|0` `?em2026=1|0` `?pagina=` `?porPagina=`
 *
 * TRÊS COISAS QUE O CORPO DIZ E QUE NENHUMA LISTA DE PENDÊNCIA COSTUMA DIZER
 *
 * 1. `alcancavelAgora` VEM ANTES DO VALOR NA ORDENAÇÃO. Ordenar puro por R$ põe
 *    as 243 pernas de transferência sem extrato (R$ 2,4 milhões) no topo — e a
 *    única ação possível nelas é esperar um extrato de 2022 que talvez não
 *    exista. Quem trabalhasse a lista de cima para baixo perderia a manhã antes
 *    do primeiro caso acionável. O bloqueado continua listado, com o número da
 *    dúvida que o destrava, porque escondê-lo seria a outra metade do erro.
 *
 * 2. `grupos` SEPARA TAMANHO DO PROBLEMA DE TAMANHO DO TRABALHO. 7.245 taxas do
 *    Asaas são UMA decisão; 500 itens de cartão são 105 estabelecimentos. Uma
 *    fila ordenada por contagem manda atacar o monte maior, que costuma ser o
 *    mais barato. `itensPorDecisao` é a alavanca, e é por ela que se escolhe.
 *
 * 3. `excluidos` DECLARA O QUE FICOU DE FORA. Sem isso, quem recontar "sem
 *    contraparte" direto na tabela acha 8.662 onde o inventário mostra menos e
 *    conclui que ele está furado. Pior: acha os 162 lançamentos com o CNPJ da
 *    própria XPE no topo por valor e cadastra a contraparte "XPE TECNOLOGIA" —
 *    que é exatamente o erro de R$ 151.977,33 que A1 e A2 existem para impedir.
 *
 * `totalValorCents` é a soma da PÁGINA FILTRADA e serve para ordenar, nunca para
 * totalizar o inventário: o mesmo lançamento aparece em até três tipos (sem
 * categoria, sem núcleo, sem centro de custo) e a coluna mistura estoque com
 * fluxo. Somar tudo daria um número que não é dinheiro nenhum.
 *
 * SOMENTE LEITURA. As escritas vivem nas três sub-rotas, cada uma com POST e
 * trilha em `fin_audit_log`. Não existe, e não deve passar a existir, uma rota
 * que resolva o inventário inteiro de uma vez.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const universo = opcaoOpcional(sp, "universo", UNIVERSOS);
  const caminho = opcaoOpcional(sp, "caminho", CAMINHOS);
  const tipo = sp.get("tipo")?.trim() || undefined;
  // `paginacaoDe` valida a faixa (e recusa com 400 o que passar do teto);
  // `normalizarPaginacao` aplica os padrões, para que a resposta declare a
  // página que REALMENTE serviu em vez de `undefined`.
  const paginacao = normalizarPaginacao(paginacaoDe(sp));

  const alcancavel = tresEstados(sp, "alcancavel");
  const em2026 = tresEstados(sp, "em2026");

  const [inventario, grupos, excluidos] = await Promise.all([
    listarInventario({
      universo,
      tipo,
      caminho,
      valorMinCents: centavosDe(sp, "valorMinCents"),
      valorMaxCents: centavosDe(sp, "valorMaxCents"),
      alcancavelAgora: alcancavel,
      em2026,
      pagina: paginacao.pagina,
      porPagina: paginacao.porPagina
    }),
    listarGrupos(),
    listarExcluidos()
  ]);

  const alcancaveis = grupos.filter((g) => g.alcancavelAgora);
  const bloqueados = grupos.filter((g) => !g.alcancavelAgora);
  const soma = (gs: typeof grupos) => gs.reduce((s, g) => s + g.itens, 0);
  const decisoes = (gs: typeof grupos) => gs.reduce((s, g) => s + g.decisoesDistintas, 0);

  return Response.json(
    {
      medidoEm: new Date().toISOString(),
      filtro: {
        universo: universo ?? null,
        tipo: tipo ?? null,
        caminho: caminho ?? null,
        alcancavel: alcancavel ?? null,
        em2026: em2026 ?? null,
        pagina: paginacao.pagina,
        porPagina: paginacao.porPagina
      },
      resumo: {
        casosNoFiltro: inventario.total,
        casosAlcancaveisAgora: soma(alcancaveis),
        decisoesAlcancaveisAgora: decisoes(alcancaveis),
        casosBloqueados: soma(bloqueados),
        decisoesBloqueadas: decisoes(bloqueados),
        duvidasQueDestravam: [
          ...new Set(bloqueados.map((g) => g.bloqueadoPor).filter((d): d is number => d !== null))
        ].sort((a, b) => a - b)
      },
      casos: inventario.casos,
      grupos,
      excluidos,
      ressalvas: [
        "totalValorCents e valorCents ORDENAM, não totalizam: o mesmo lançamento aparece em até três " +
          "tipos de pendência e a coluna mistura estoque (perna sem extrato) com fluxo. Somar o inventário " +
          "inteiro produz um número que não corresponde a dinheiro nenhum.",
        "alcancavelAgora=false significa que falta dado que não está em fonte nenhuma desta base — não que " +
          "o caso seja menos importante. Vários dos maiores valores estão aí.",
        "bloqueadoPor é o número da dúvida em docs/DUVIDAS_FINANCEIRO.md. Um caso pode ter dúvida e ser " +
          "alcançável (a dúvida 57 é de escopo, e a decisão técnica já existe).",
        "excluidos lista o que a varredura deixou de fora DE PROPÓSITO, com o motivo. Se o seu recount por " +
          "fora não bate com este inventário, a diferença está ali."
      ]
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
});

/** Enum opcional: ausente continua ausente; presente passa pela lista branca. */
function opcaoOpcional<const T extends readonly [string, ...string[]]>(
  sp: URLSearchParams,
  nome: string,
  validas: T
): T[number] | undefined {
  const bruto = sp.get(nome);
  if (bruto === null || bruto === "") return undefined;
  return opcaoDe(sp, nome, validas, validas[0]) as T[number];
}

/**
 * Bandeira de TRÊS estados, e não de dois.
 *
 * `?alcancavel=0` tem de significar "só os bloqueados", não "sem filtro". Um
 * booleano comum trataria ausente e `0` como o mesmo falso, e a pessoa que
 * pedisse a lista do que está travado receberia o inventário inteiro.
 */
function tresEstados(sp: URLSearchParams, nome: string): boolean | undefined {
  const bruto = sp.get(nome)?.trim().toLowerCase();
  if (bruto === undefined || bruto === "") return undefined;
  if (["1", "true", "sim"].includes(bruto)) return true;
  if (["0", "false", "nao", "não"].includes(bruto)) return false;
  return opcaoDe(sp, nome, ["1", "0", "true", "false", "sim", "nao"] as const, "1") === "1";
}
