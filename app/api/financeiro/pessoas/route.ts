import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { getCustoPessoas } from "@/lib/financeiro/pessoas";

/**
 * GET /api/financeiro/pessoas — o custo com pessoas inteiro, num payload só.
 *
 * Sem POST/PATCH de propósito: esta tela é leitura. Corrigir um vínculo, um time
 * ou uma ligação pessoa↔contraparte muda a soma de todos os meses passados de
 * uma vez, então a escrita pertence à fila de revisão e ao cadastro de pessoas,
 * onde a mudança é auditada — não a um botão dentro de um relatório.
 *
 * O payload traz o GRÃO (pessoa × mês × conta × natureza) e não os totais já
 * somados. Duas razões: quem consumir de fora consegue cruzar do jeito que
 * precisa sem uma segunda rota, e — a que importa — a tela e a API somam a mesma
 * coisa. Devolver totais prontos aqui criaria uma segunda definição de "custo de
 * gente", que é exatamente o problema que a planilha do dono tinha.
 *
 * Vem junto, sempre, `cobertura`: o que NÃO pôde ser atribuído. Um consumidor
 * que leia só `celulas` verá um total menor que a realidade, e o campo ao lado é
 * o que impede essa leitura de passar por completa.
 */
export async function GET() {
  try {
    return Response.json(await getCustoPessoas());
  } catch (error) {
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}
