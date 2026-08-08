import { NextResponse } from "next/server";

import { query } from "@/lib/financeiro/db";
import {
  SQL_DOCS_PARA_REGRA,
  sujeitoDeDocumento,
  validarCondicoes,
  type DocParaRegra
} from "@/lib/financeiro/regras";
import { evaluateConditions } from "@/scripts/lib/fin-rules.mjs";

/**
 * Dry-run: "esta regra classificaria mais 187 cobranças, R$ 94.300".
 *
 * É a funcionalidade que transforma a fila de 1.170 itens numa tarde de
 * trabalho em vez de semanas — e é também a rede contra o bug que já aconteceu
 * duas vezes neste módulo: uma agulha curta demais capturando o nome de um
 * cliente ("medicao" na razão social, "art " dentro de "smart charging"). Ver o
 * impacto ANTES de salvar é o que teria evitado os dois.
 *
 * Usa o MESMO avaliador do lote, de propósito. Um preview que discorda da
 * aplicação é pior que nenhum preview.
 */
export async function POST(request: Request) {
  let body: { conditions?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  const problema = validarCondicoes(body.conditions);
  if (problema) return NextResponse.json({ error: problema }, { status: 422 });

  const docs = await query<DocParaRegra>(SQL_DOCS_PARA_REGRA, ["xpe"]);

  const casados: DocParaRegra[] = [];
  for (const doc of docs) {
    const resultado = evaluateConditions(body.conditions as never, sujeitoDeDocumento(doc));
    if (resultado.ok) casados.push(doc);
  }

  const jaClassificadas = casados.filter((doc) => doc.category_id !== null);
  const amostra = casados
    .slice()
    .sort((a, b) => Math.abs(b.amount_cents) - Math.abs(a.amount_cents))
    .slice(0, 15);

  const ids = amostra.map((doc) => doc.id);
  const descricoes = ids.length
    ? await query<{ id: number; description: string }>(
        `SELECT id, description FROM fin_document WHERE id = ANY($1)`,
        [ids]
      )
    : [];
  const textoPor = new Map(descricoes.map((linha) => [linha.id, linha.description]));

  return NextResponse.json({
    casaria: casados.length,
    valorCents: casados.reduce((total, doc) => total + doc.amount_cents, 0),
    jaClassificadas: jaClassificadas.length,
    // O que a regra mudaria de fato: o resto já tem categoria e seria ignorado
    // pelo aplicar, que só toca em documento sem classificação.
    afetaria: casados.length - jaClassificadas.length,
    amostra: amostra.map((doc) => ({
      id: doc.id,
      descricao: textoPor.get(doc.id) ?? "",
      amountCents: doc.amount_cents,
      jaClassificada: doc.category_id !== null
    }))
  });
}
