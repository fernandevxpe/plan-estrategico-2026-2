import {
  getDreDrill,
  NIVEIS,
  type NivelDrill
} from "@/lib/financeiro/contratos/dre-drill";
import type { Visao } from "@/lib/financeiro/contratos/resultado";
import {
  comRessalvas,
  opcaoDe,
  ParametroInvalido,
  responderContrato,
  rotaDeLeitura
} from "@/lib/financeiro/contratos/http";

import { brl, contagem } from "../../_medido";
import { mesEstritoDe } from "../../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VISOES = ["caixa", "competencia"] as const satisfies readonly Visao[];

/**
 * GET /api/financeiro/gerencial/dre/drill?visao=&mes=&nivel=&expandir=
 *
 * A DRE expansível até o lançamento. Quatro níveis, e cada um soma exatamente
 * o de cima:
 *
 *   linha da DRE → categoria → contraparte → lançamento individual
 *
 * `nivel` é o TETO de profundidade (`linha` por padrão) e `expandir` diz quais
 * nós abrir. Os dois juntos são o que impede a rota de devolver 14.662 nós
 * para um mês que tem 21 linhas — e o que faz "abrir uma linha" ser um pedido,
 * não um download.
 *
 * `expandir` aceita a chave de um nó, repetida ou separada por vírgula:
 *
 *   ?nivel=categoria&expandir=despesas_administrativas
 *   ?nivel=lancamento&expandir=despesas_administrativas&expandir=despesas_administrativas5.01
 *
 * A chave usa U+001F como separador porque nome de categoria e de contraparte
 * são texto livre: qualquer separador imprimível aparece um dia dentro de um
 * nome e parte a hierarquia no meio.
 *
 * TRÊS COISAS QUE ESTA ROTA DEVOLVE E QUE NENHUMA TELA DEVERIA TER DE CALCULAR
 *
 * 1. `ressalvasAntes`, em cada nó e no mês. A ressalva vem antes do número —
 *    inclusive na ordem das chaves do JSON. Agosto/2026 na visão competência
 *    mostra pessoal ZERO porque a folha sai em 01/09: o mês parece o melhor da
 *    série e está otimista em torno de R$ 93.731.
 *
 * 2. `lacunaCents`, em TODO nível, dentro do grupo a que pertence. Não existe
 *    rodapé de lacuna nesta rota: rodapé é a forma elegante de esconder, e
 *    quem abre "Administrativas" não rola até o fim da página.
 *
 * 3. `destinoProvavel`, no nível do lançamento, só para o que está em lacuna:
 *    a linha em que ele cairia, com a evidência escrita (quantos lançamentos
 *    da mesma contraparte estão lá) e a concordância medida. É HIPÓTESE —
 *    nenhum total desta base a soma, e o teste prova isso.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const nivel = opcaoDe<NivelDrill>(sp, "nivel", NIVEIS, "linha");
  const expandir = lerExpandir(sp);

  const contrato = await getDreDrill({
    visao: opcaoDe(sp, "visao", VISOES, "caixa"),
    mes: mesEstritoDe(sp, "mes"),
    nivel,
    expandir
  });

  const { nos, regraDeOuro, truncado, ressalvasAntes } = contrato.dado;
  const comLacuna = nos.filter((n) => n.nivel === 1 && n.lacunaCents !== 0);
  const lacunaTotal = comLacuna.reduce((s, n) => s + n.lacunaBrutoCents, 0);
  const abriveis = nos.filter((n) => n.temFilhos).length;

  return responderContrato(
    comRessalvas(
      contrato,
      // A ressalva medida do mês vem primeiro de todas, porque é ela que muda a
      // leitura do número que está na tela agora.
      ressalvasAntes.length ? ressalvasAntes.map((r) => r.texto).join(" ") : null,
      comLacuna.length
        ? `${contagem(comLacuna.length, "linha carrega", "linhas carregam")} lacuna, somando ${brl(lacunaTotal)} em valor bruto — ` +
            `dinheiro que existe e ainda não tem linha. Ele viaja em lacunaCents dentro de cada grupo, não num rodapé.`
        : null,
      regraDeOuro && !regraDeOuro.fecha
        ? `A REGRA DE OURO NÃO ESTÁ FECHANDO: resíduo de ${brl(regraDeOuro.residuoLedgerCents)} entre a DRE de caixa e o ledger e ` +
            `${brl(regraDeOuro.residuoSaldoCents)} entre abertura + DRE e o saldo atual. Não cite nenhum número desta tela até isso ser zero.`
        : null,
      truncado
        ? `A resposta foi TRUNCADA no teto de nós. O que está aqui soma menos que a DRE — expanda menos chaves por vez em vez de somar o que voltou.`
        : null,
      abriveis && nivel === "linha"
        ? `${contagem(abriveis, "linha pode", "linhas podem")} ser aberta: passe ?expandir=<chave>&nivel=categoria para descer um degrau.`
        : null
    )
  );
});

/** `?expandir=a&expandir=b` e `?expandir=a,b` são a mesma coisa. */
function lerExpandir(sp: URLSearchParams): string[] {
  const bruto = sp.getAll("expandir").flatMap((v) => v.split(","));
  const chaves = bruto.map((v) => v.trim()).filter((v) => v.length > 0);
  if (chaves.length > 200) {
    throw new ParametroInvalido("expandir", "expandir aceita no máximo 200 chaves por requisição");
  }
  for (const c of chaves) {
    if (c.length > 300) {
      throw new ParametroInvalido("expandir", "chave de expansão excede 300 caracteres");
    }
  }
  return [...new Set(chaves)];
}
