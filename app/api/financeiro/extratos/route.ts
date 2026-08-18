import { contasDisponiveis, buscarLinhasExtrato, montarCsv, montarXlsx } from "@/lib/financeiro/extratos";
import { dataDe, opcaoDe, textoDe, rotaDeLeitura, ParametroInvalido } from "@/lib/financeiro/contratos/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/financeiro/extratos?de=YYYY-MM-DD&ate=YYYY-MM-DD&contas=nubank,inter&formato=xlsx
 *
 * Devolve um ARQUIVO, não um `Contrato<T>` — por isso não usa `responderContrato`.
 * `rotaDeLeitura` ainda serve: traduz parâmetro inválido em 400 e banco fora do
 * ar em 503, do mesmo jeito que toda rota de leitura do financeiro.
 *
 * `contas` ausente ou `todas` = todas as contas ativas juntas, cada uma na sua
 * aba do Excel (ou todas misturadas, com a coluna Conta, no CSV).
 */
export const GET = rotaDeLeitura(async (sp) => {
  const de = dataDe(sp, "de");
  const ate = dataDe(sp, "ate");
  if (!de) throw new ParametroInvalido("de", "de é obrigatório (YYYY-MM-DD)");
  if (!ate) throw new ParametroInvalido("ate", "ate é obrigatório (YYYY-MM-DD)");
  if (de > ate) throw new ParametroInvalido("de", "de não pode ser depois de ate");

  const formato = opcaoDe(sp, "formato", ["xlsx", "csv"] as const, "xlsx");
  const contasParam = textoDe(sp, "contas", 400);

  const todasAtivas = await contasDisponiveis();
  const slugsValidos = new Set(todasAtivas.map((c) => c.slug));

  let contas = todasAtivas;
  if (contasParam && contasParam !== "todas") {
    const pedidos = contasParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const invalido = pedidos.find((s) => !slugsValidos.has(s));
    if (invalido) {
      throw new ParametroInvalido("contas", `conta desconhecida ou inativa: "${invalido}"`);
    }
    contas = todasAtivas.filter((c) => pedidos.includes(c.slug));
  }

  if (contas.length === 0) {
    throw new ParametroInvalido("contas", "nenhuma conta válida selecionada");
  }

  const linhas = await buscarLinhasExtrato({
    contas: contas.map((c) => c.slug),
    de,
    ate
  });

  const nomeArquivo = `extrato_${de}_a_${ate}${contas.length === 1 ? `_${contas[0].slug}` : ""}`;

  if (formato === "csv") {
    const csv = montarCsv(linhas);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nomeArquivo}.csv"`,
        "Cache-Control": "no-store"
      }
    });
  }

  const buffer = await montarXlsx({ linhas, contas, de, ate });
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeArquivo}.xlsx"`,
      "Cache-Control": "no-store"
    }
  });
});
