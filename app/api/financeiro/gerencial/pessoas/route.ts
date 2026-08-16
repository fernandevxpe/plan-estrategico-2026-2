import { getPessoas } from "@/lib/financeiro/contratos";
import { comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem } from "../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/pessoas
 *
 * "Quanto custa a equipe, de verdade?" e "contratado bate com pago?".
 *
 * NÃO CONFUNDIR COM `/api/financeiro/pessoas`
 *
 * Aquela rota serve o GRÃO do custo (pessoa × mês × conta × natureza), de
 * `lib/financeiro/pessoas.ts`. Esta serve o CONTRATO de tela: o cadastro, a folha
 * mensal por natureza e a divergência entre pactuado e realizado, com envelope,
 * cobertura e frescor. As duas somam a mesma coisa por caminhos diferentes de
 * propósito — se divergirem, uma delas está errada e isso é achado, não ruído.
 *
 * `meiCents` VEM SEPARADO E NÃO SE SOMA À FOLHA SEM DECISÃO
 *
 * O MEI aparece como serviço de terceiro no ledger e como pessoa aqui; somar as
 * duas leituras dobraria a folha. É também a dúvida 21 (R$ 255.936,66 em
 * `6.01 Salários` por omissão do importador), que decide o Fator R e portanto o
 * anexo do Simples — a maior lacuna aberta da base. Por isso `folhaSemMeiCents` e
 * `folhaTotalCents` viajam lado a lado: quem publicar um número tem de dizer qual
 * dos dois escolheu.
 *
 * `pactuadoMesAtualCents`, `realizadoMesAtualCents` e `divergenciaCents` são
 * `Medida`. Divergência null não é "bate certinho": é "não há pactuado registrado
 * para comparar". O acréscimo mediano medido é ~R$ 22.299,24/mês, 27% do que sai
 * — um null lido como zero apagaria justamente essa conta.
 *
 * Reembolso NÃO entra aqui: ele é pago no mês seguinte junto do fixo e
 * classificado como salário. Somar a planilha ao extrato inflaria a folha em
 * ~R$ 6 mil/mês, e a regra está gravada no schema para ninguém somar de novo.
 */
export const GET = rotaDeLeitura(async () => {
  const contrato = await getPessoas();
  const d = contrato.dado;

  const ultimo = d.folhaMensal.at(-1) ?? null;
  const semPactuado = d.pessoas.filter((p) => p.pactuadoMesCents === null);
  const meis = d.pessoas.filter((p) => p.ehMei);

  return responderContrato(
    comRessalvas(
      contrato,
      ultimo && ultimo.meiCents !== 0
        ? `Em ${ultimo.mes.slice(0, 7)}: folhaSemMeiCents ${brl(ultimo.folhaSemMeiCents)} e folhaTotalCents ${brl(ultimo.folhaTotalCents)}, ` +
            `diferença de ${brl(ultimo.meiCents)} em MEI. Diga qual dos dois está publicando — o MEI também aparece como serviço de terceiro no ledger, e somar as duas leituras dobra a folha.`
        : null,
      meis.length
        ? `${contagem(meis.length, "pessoa é", "pessoas são")} MEI. Em que conta elas ficam é a dúvida 21 (R$ 255.936,66 hoje em 6.01 Salários por omissão do importador), e ela decide o Fator R e o anexo do Simples.`
        : null,
      d.divergenciaCents.valorCents === null
        ? `divergenciaCents é indeterminada${d.divergenciaCents.motivo ? `: "${d.divergenciaCents.motivo}"` : ""}. ` +
            `Null NÃO é "contratado bate com pago" — o acréscimo mediano medido é ~R$ 22.299,24/mês, 27% do que sai.`
        : `Divergência do mês: ${brl(d.divergenciaCents.valorCents)} entre pactuado e realizado.`,
      semPactuado.length
        ? `${contagem(semPactuado.length, "pessoa não tem", "pessoas não têm")} valor pactuado registrado (pactuadoMesCents null): para elas não há contra o que conferir o pago.`
        : null,
      "Reembolso não entra nesta folha: ele é pago no mês seguinte junto do fixo e já entra como salário. Somá-lo aqui inflaria a folha em ~R$ 6 mil/mês — ver /api/financeiro/gerencial/reembolsos."
    )
  );
});
