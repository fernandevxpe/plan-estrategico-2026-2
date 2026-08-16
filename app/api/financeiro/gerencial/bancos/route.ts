import { getBancos } from "@/lib/financeiro/contratos";
import { comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem, lista } from "../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/bancos
 *
 * "Quanto tenho, agora, conta a conta?" — a pergunta que abre tudo, e a única
 * cuja resposta errada invalida todas as outras.
 *
 * `fecha` E `emDia` SÃO PERGUNTAS DIFERENTES E NÃO PODEM VIRAR UM "OK" VERDE
 *
 *   `fecha`  o saldo reconstruído lançamento a lançamento bate com o declarado?
 *   `emDia`  o extrato cobre até ontem?
 *
 * Uma conta pode fechar aritmeticamente no dia em que o extrato termina e ainda
 * assim mentir sobre hoje. Colapsar as duas num único selo é exatamente como este
 * tipo de painel costuma enganar o dono, e o contrato se recusa a fazê-lo.
 *
 * `fecha: null` é um terceiro estado, e o mais perigoso: **não fecha nem deixa de
 * fechar**, porque não há cobertura de extrato declarada para conferir. É o
 * invariante F1 (dúvida 5, a 7ª conta Caixa e o contrato do Pronampe) e é
 * bloqueio de DADO, não de código. Tratar null como verde transformaria uma
 * pergunta pendente em um "conferido".
 *
 * `lacunas[]` são períodos sem nenhum lote importado — buracos no meio do
 * extrato. Uma conta pode fechar nas pontas e ter um mês inteiro faltando no
 * meio; a lista existe para isso não passar.
 *
 * `totalDisponivelCents` exclui a conta de empréstimo, cujo saldo negativo é
 * normal e falsearia o runway se entrasse na soma.
 */
export const GET = rotaDeLeitura(async () => {
  const contrato = await getBancos();
  const d = contrato.dado;

  const naoFecham = d.contas.filter((c) => c.fecha === false);
  const semVeredito = d.contas.filter((c) => c.fecha === null);
  const atrasadas = d.contas.filter((c) => !c.emDia);
  const comLacuna = d.contas.filter((c) => c.lacunas.length > 0);
  const divergencia = naoFecham.reduce((s, c) => s + Math.abs(c.divergenciaCents ?? 0), 0);

  return responderContrato(
    comRessalvas(
      contrato,
      contrato.disponivel
        ? `${d.fecham}/${d.contas.length} contas fecham · ${d.emDia}/${d.contas.length} com extrato em dia. As duas medidas são independentes.`
        : null,
      naoFecham.length
        ? `NÃO FECHAM: ${lista(naoFecham.map((c) => `${c.slug} (${brl(c.divergenciaCents ?? 0)})`))} — divergência total ${brl(divergencia)}. ` +
            `Caixa é a validação máxima: enquanto isso durar, nenhuma DRE ou projeção derivada deste ledger vale.`
        : null,
      semVeredito.length
        ? `SEM VEREDITO (fecha = null): ${lista(semVeredito.map((c) => c.slug))}. Não há cobertura de extrato declarada, então não dá para conferir — ` +
            `é o invariante F1, bloqueio de dado (dúvida 5), e null aqui NÃO é "ok".`
        : null,
      atrasadas.length
        ? `Extrato fora de D+1 em ${lista(
            atrasadas.map((c) => `${c.slug}${c.diasSemExtrato === null ? " (nunca importado)" : ` (${c.diasSemExtrato}d)`}`)
          )}. O saldo delas continua parecendo saudável — é o motivo de a data viajar ao lado do número.`
        : null,
      comLacuna.length
        ? `${contagem(comLacuna.length, "conta tem", "contas têm")} buraco no meio do extrato: ${lista(
            comLacuna.map((c) => `${c.slug} (${c.lacunas.length} lacuna(s))`)
          )}. Fechar nas pontas não prova que o meio está completo.`
        : null,
      `totalDisponivelCents (${brl(d.totalDisponivelCents)}) exclui a conta de empréstimo; totalCents (${brl(d.totalCents)}) inclui. Use o primeiro para runway, o segundo para conciliação.`
    )
  );
});
