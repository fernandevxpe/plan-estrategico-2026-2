import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { listarMeusEnvios, opcoesDoTime } from "@/lib/financeiro/time";

/**
 * GET /api/time/envios — o que ESTA pessoa enviou, e o que aconteceu com cada
 * coisa.
 *
 * Não existe parâmetro de pessoa, nem de filtro por pessoa, nem "todos". O
 * escopo vem da sessão e é a única fonte. Uma query string `?pessoa=` aqui
 * seria a forma mais curta de transformar "cada um vê o que enviou" numa frase
 * de documentação.
 *
 * Vem junto `opcoes` (tipos de reembolso e categorias sugeríveis) porque a tela
 * precisa das duas coisas na primeira pintura, e duas viagens fariam o
 * formulário aparecer sem os selects preenchidos.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { sessao } = await exigirContexto();
    const [envios, opcoes] = await Promise.all([listarMeusEnvios(sessao), opcoesDoTime()]);
    return Response.json({ sessao, envios, opcoes });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
