import { FinanceUnavailableError, query } from "@/lib/financeiro/db";

import { ENTITY, erro, normalizarTexto } from "../_comum";

/**
 * GET /api/financeiro/cartao/sugerir?texto=...&alvo=categoria|nucleo|centro
 *
 * "A ferramenta busca o apropriado, ou adiciona para próximas buscas" — este é
 * o lado da BUSCA; o lado do "adiciona" está em `../qualificar`.
 *
 * ---------------------------------------------------------------------------
 * DUAS FONTES, E ELAS RESPONDEM PERGUNTAS DIFERENTES
 * ---------------------------------------------------------------------------
 * 1. `fin_padrao_qualificacao` — o que alguém JÁ DECIDIU para texto parecido.
 *    É a fonte forte: uma pessoa olhou e escolheu.
 * 2. `fin_card_transaction` — o que lançamentos parecidos JÁ TÊM classificado,
 *    inclusive por regra automática. É a fonte de partida enquanto o
 *    vocabulário aprendido está vazio (e hoje ele nasce vazio).
 *
 * As duas voltam na mesma lista com a origem declarada, ordenadas por
 * semelhança × repetição. Sem a origem, "decidido por gente 8 vezes" e
 * "chutado por MCC uma vez" pareceriam a mesma sugestão.
 *
 * ---------------------------------------------------------------------------
 * `word_similarity`, NÃO `similarity`
 * ---------------------------------------------------------------------------
 * O texto do banco é longo e sujo ("Mercadolivre*Mercadol", "Facebk
 * *Va4u4frll2") e o que a pessoa digita é curto ("mercado livre", "facebook").
 * `similarity` compara as duas strings inteiras e pune o tamanho diferente;
 * `word_similarity` procura o melhor TRECHO da string longa que casa com a
 * curta — é a função feita para "essa palavra aparece parecida aí dentro".
 */

const ALVOS = new Set(["categoria", "nucleo", "centro"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const texto = normalizarTexto(url.searchParams.get("texto") ?? "");
  const alvo = url.searchParams.get("alvo") ?? "categoria";

  if (!ALVOS.has(alvo)) return erro(`alvo inválido: ${alvo}`);
  // Menos de 3 letras não tem trigrama que preste — devolver vazio é mais
  // honesto que devolver as três primeiras linhas da tabela.
  if (texto.length < 3) return Response.json({ sugestoes: [] });

  try {
    const aprendidas = await query<{
      alvo_tipo: string; category_id: number | null; nucleo: string | null;
      cost_center_id: number | null; rotulo: string; vezes: number; sim: number; texto_norm: string;
    }>(
      `SELECT p.alvo_tipo, p.category_id, p.nucleo, p.cost_center_id,
              coalesce(cat.code || ' ' || cat.name, initcap(p.nucleo), cc.name) AS rotulo,
              p.vezes, word_similarity($2, p.texto_norm) AS sim, p.texto_norm
         FROM fin_padrao_qualificacao p
         JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $1
         LEFT JOIN fin_category cat ON cat.id = p.category_id
         LEFT JOIN fin_cost_center cc ON cc.id = p.cost_center_id
        WHERE p.alvo_tipo = $3
          AND word_similarity($2, p.texto_norm) > 0.3
        ORDER BY sim DESC, p.vezes DESC
        LIMIT 5`,
      [ENTITY, texto, alvo]
    );

    // O histórico dos próprios lançamentos, agrupado pelo alvo — não uma linha
    // por transação parecida, que devolveria treze vezes o mesmo Facebook.
    const coluna = alvo === "categoria" ? "t.category_id" : alvo === "nucleo" ? "t.nucleo" : "t.cost_center_id";
  // O rótulo tem que vir do alvo PEDIDO, não de um coalesce cego. Um item tem
  // categoria E núcleo ao mesmo tempo: com `coalesce(categoria, nucleo, centro)`
  // uma busca por núcleo devolvia "obras" no valor e "4.02 Material — Obras" no
  // rótulo, isto é, a resposta certa com o nome de outra coisa.
  const rotuloSql =
    alvo === "categoria"
      ? "cat.code || ' ' || cat.name"
      : alvo === "nucleo"
        ? "initcap(t.nucleo)"
        : "cc.name";
    const doHistorico = await query<{
      valor: string | null; rotulo: string | null; vezes: string; sim: number; exemplo: string;
    }>(
      // Um parâmetro só: `fin_card_transaction` não tem `entity_id` próprio (o
      // vínculo é via `card_account_id`), então não há o que escopar aqui. Passar
      // ENTITY assim mesmo deixava um `$1` declarado e nunca usado, e o Postgres
      // recusa a consulta inteira com "could not determine data type of parameter".
      `SELECT ${coluna}::text AS valor,
              ${rotuloSql} AS rotulo,
              count(*) AS vezes,
              max(word_similarity($1, t.description_norm)) AS sim,
              (array_agg(t.description ORDER BY word_similarity($1, t.description_norm) DESC))[1] AS exemplo
         FROM fin_card_transaction t
         LEFT JOIN fin_category cat ON cat.id = t.category_id
         LEFT JOIN fin_cost_center cc ON cc.id = t.cost_center_id
        WHERE ${coluna} IS NOT NULL
          AND t.kind IN ('compra', 'iof')
          AND t.description_norm IS NOT NULL
          AND word_similarity($1, t.description_norm) > 0.3
        GROUP BY 1, 2
        ORDER BY sim DESC, vezes DESC
        LIMIT 5`,
      [texto]
    );

    return Response.json({
      sugestoes: [
        ...aprendidas.map((a) => ({
          origem: "aprendido" as const,
          alvo: a.alvo_tipo,
          categoriaId: a.category_id === null ? null : Number(a.category_id),
          nucleo: a.nucleo,
          centroId: a.cost_center_id === null ? null : Number(a.cost_center_id),
          rotulo: a.rotulo,
          vezes: Number(a.vezes),
          similaridade: Number(a.sim),
          parecidoCom: a.texto_norm
        })),
        ...doHistorico.map((h) => ({
          origem: "historico" as const,
          alvo,
          categoriaId: alvo === "categoria" && h.valor ? Number(h.valor) : null,
          nucleo: alvo === "nucleo" ? h.valor : null,
          centroId: alvo === "centro" && h.valor ? Number(h.valor) : null,
          rotulo: h.rotulo,
          vezes: Number(h.vezes),
          similaridade: Number(h.sim),
          parecidoCom: h.exemplo
        }))
      ]
    });
  } catch (e) {
    if (e instanceof FinanceUnavailableError) return erro(e.message, 503);
    return erro(e instanceof Error ? e.message : "falha ao sugerir", 500);
  }
}
