import {
  autorDe,
  criarManualDaAgenda,
  direcaoDe,
  respostaDeErro
} from "@/lib/financeiro/agenda";
import { transaction } from "@/lib/financeiro/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/financeiro/gerencial/agenda/itens — cadastrar um futuro.
 *
 * O "cadastrar como futuro de receitas ou custos" do pedido: uma obrigação ou
 * um recebimento que NENHUMA fonte declarou ainda. É por aqui que a lacuna de
 * cobertura se fecha — a previsão de saída cobre ~72% do que sai, e o resto só
 * entra se alguém o escrever.
 *
 * Corpo:
 *   direcao ............... "receber" | "pagar"   (obrigatório)
 *   competencia ........... "YYYY-MM"             (obrigatório)
 *   descricao ............. texto                 (obrigatório)
 *   valorCents ............ inteiro em centavos   ┐ um dos dois é obrigatório
 *   indeterminadoMotivo ... texto                 ┘
 *   diaEsperado, categoria (code), nucleo, contraparte, centroDeCusto, confirmar
 *
 * O QUE ESTA ROTA NÃO FAZ, E É O PONTO
 *
 * · NÃO cria lançamento em `fin_transaction`. O item nasce previsto e só vira
 *   'realizado' quando alguém apontar o lançamento — e o gatilho do banco
 *   confere o sinal (crédito realiza receita, débito realiza custo).
 * · NÃO mexe em saldo de conta nenhuma. Depois de cadastrar, `6/6 contas
 *   fecham` continua valendo, e isso é verificável.
 * · NÃO cria `fin_document`. Uma receita que ninguém emitiu não é cobrança;
 *   gravá-la lá a faria contar como faturamento no aging e na curva ABC.
 *
 * O item manual aparece na agenda com precedência própria ('manual') e é
 * visualmente distinto do que veio de fonte — e `fin_agenda_prova_v` o separa
 * na hora de conferir a soma contra a previsão, porque ele é justamente o
 * delta legítimo.
 *
 * SEM VALOR EXIGE MOTIVO. A restrição nº 5 do projeto está no CHECK do banco e
 * repetida aqui só para a mensagem ser legível na tela: onde não houver
 * evidência, o valor é indeterminado COM MOTIVO — nunca um número plausível.
 */
export async function POST(request: Request) {
  let corpo: Record<string, unknown>;
  try {
    corpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ erro: "corpo não é JSON válido" }, { status: 400 });
  }

  const actor = autorDe(request);
  try {
    const direcao = direcaoDe(corpo.direcao);
    const resultado = await transaction((c) => criarManualDaAgenda(c, { direcao, corpo, actor }));
    return Response.json(
      {
        ok: true,
        direcao,
        ...resultado,
        ressalvas: [
          "Item manual é PREVISÃO, não caixa: não virou lançamento, não alterou saldo de conta nenhuma " +
            "e não entra na DRE. O realizado desta base é sempre fin_transaction.",
          direcao === "receber"
            ? "Não foi criada cobrança nenhuma. Emitir boleto é ação no Asaas, e as APIs externas desta plataforma são somente GET."
            : "Não foi criada ordem de pagamento nenhuma. Nenhuma automação desta plataforma executa pagamento."
        ]
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
