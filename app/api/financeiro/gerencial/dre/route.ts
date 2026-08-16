import { getResultado, type Visao } from "@/lib/financeiro/contratos";
import { anoDe, comRessalvas, opcaoDe, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem, lista } from "../_medido";
import { mesEstritoDe } from "../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VISOES = ["caixa", "competencia"] as const satisfies readonly Visao[];

/**
 * GET /api/financeiro/gerencial/dre?visao=&ano=&mes=
 *
 * "Qual o resultado do mês?" — a pergunta central da §2 de `OBJETIVOS_METAS.md`.
 * Até aqui só existia a quebra dimensional (`dre/dimensao`); a DRE mensal em si
 * não tinha URL.
 *
 * DUAS COISAS QUE ESTA ROTA MEDE E ACRESCENTA AO ENVELOPE
 *
 * 1. `folhaDoMesJaPaga`. O salário do mês sai no dia 1º do mês seguinte, então o
 *    mês corrente na visão de COMPETÊNCIA é sempre otimista — a receita já está
 *    lá e a maior despesa ainda não. `fin_dre_mensal_v` carrega a marca por mês;
 *    ela chega intacta em `dado.cobertura[].folhaDoMesJaPaga`, e a ressalva
 *    medida nomeia QUAIS meses estão nessa condição. Um consumidor que leia só
 *    `lucroLiquidoCents` de agosto lê um número que ainda vai piorar.
 *
 * 2. As lacunas. `lacunaLedgerCents` e `lacunaCartaoCents` são o que o ledger e o
 *    cartão não explicam naquele mês. Elas não entram no lucro — por isso o
 *    contrato devolve `lucroComLacunasCents` ao lado, e a ressalva medida diz o
 *    tamanho do que ficou de fora. Ignorá-las faz o resultado parecer mais limpo
 *    do que é.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getResultado({
    visao: opcaoDe(sp, "visao", VISOES, "caixa"),
    ano: anoDe(sp),
    mes: mesEstritoDe(sp, "mes")
  });

  const otimistas = contrato.dado.cobertura.filter((c) => !c.folhaDoMesJaPaga).map((c) => c.mes.slice(0, 7));
  const comLacuna = contrato.dado.meses.filter((m) => m.lacunaLedgerCents !== 0 || m.lacunaCartaoCents !== 0);
  const lacunaTotal = comLacuna.reduce((s, m) => s + m.lacunaLedgerCents + m.lacunaCartaoCents, 0);

  return responderContrato(
    comRessalvas(
      contrato,
      otimistas.length
        ? `A folha ainda não saiu em ${lista(otimistas)} — o salário do mês é pago no dia 1º do mês seguinte. ` +
            `O resultado destes meses está OTIMISTA e vai piorar. A marca vem de fin_dre_mensal_v e viaja em dado.cobertura[].folhaDoMesJaPaga.`
        : null,
      comLacuna.length
        ? `${contagem(comLacuna.length, "mês tem", "meses têm")} lacuna declarada, somando ${brl(lacunaTotal)} que o ledger e o cartão não explicam. ` +
            `Compare lucroLiquidoCents com lucroComLacunasCents antes de citar qualquer resultado: a diferença entre os dois é exatamente o que não tem origem.`
        : null,
      contrato.dado.mesSelecionado === null && contrato.disponivel
        ? "Nenhum mês retornou para o ano pedido: dado.linhasDoMes vem vazio porque não há mês a detalhar, não porque o mês não teve movimento."
        : null
    )
  );
});
