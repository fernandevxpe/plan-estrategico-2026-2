import { getFluxoDeCaixa } from "@/lib/financeiro/contratos";
import { anoDe, comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem, lista } from "../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/fluxo?ano=
 *
 * O fluxo de caixa mês a mês, consolidado. A quebra por conta já tinha rota
 * (`fluxo/contas`); o consolidado, que é o que a tela abre primeiro, não tinha.
 *
 * `residuoCents` É O TESTE DA DEMONSTRAÇÃO, NÃO UM DETALHE
 *
 * Saldo inicial + movimento tem de dar saldo final. Quando não dá, a diferença
 * mora em `residuoCents` e `fecha` vem falso. Publicar a tabela sem esse carimbo
 * convida a somar colunas que não somam — e um fluxo que não fecha é um fluxo em
 * que qualquer linha citada pode estar errada, não só a que sobrou.
 *
 * Duas colunas existem para não esconder o que o consolidado esconderia:
 * `transferenciaInternaCents` (movimento entre contas próprias, que não é receita
 * nem despesa — 81 movimentos e R$ 966.069,29 já estiveram contados como despesa
 * na DRE até a 0059) e `saidaSemHistoricoCents` (saída sem descrição
 * aproveitável, que não é "outras despesas": é despesa que ninguém explicou).
 *
 * Fluxo é SEMPRE regime de caixa. Não há parâmetro `visao` aqui de propósito —
 * competência é a DRE (`/api/financeiro/gerencial/dre?visao=competencia`), e
 * misturar os dois num só endpoint produziria um "fluxo de competência", que não
 * bate com extrato nenhum.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getFluxoDeCaixa(anoDe(sp));

  const naoFecham = contrato.dado.filter((m) => !m.fecha);
  const semHistorico = contrato.dado.filter((m) => m.saidaSemHistoricoCents !== 0);
  const naoClassificado = contrato.dado.reduce((s, m) => s + m.naoClassificadoCents, 0);

  return responderContrato(
    comRessalvas(
      contrato,
      naoFecham.length
        ? `${contagem(naoFecham.length, "mês NÃO fecha", "meses NÃO fecham")}: ${lista(naoFecham.map((m) => `${m.mes.slice(0, 7)} (${brl(m.residuoCents)})`))}. ` +
            `Some as colunas antes de citar qualquer linha deles — o resíduo pode estar em qualquer uma.`
        : `Todos os ${contrato.dado.length} meses fecham: saldo inicial + movimento = saldo final, resíduo R$ 0,00.`,
      semHistorico.length
        ? `${contagem(semHistorico.length, "mês tem", "meses têm")} saída sem histórico aproveitável, somando ${brl(
            semHistorico.reduce((s, m) => s + m.saidaSemHistoricoCents, 0)
          )}. Isso não é "outras despesas": é despesa que ninguém explicou, e a coluna existe para não deixá-la se diluir.`
        : null,
      naoClassificado !== 0
        ? `${brl(naoClassificado)} ainda sem classificação no período. O dinheiro andou e está no saldo; o que falta é a natureza dele.`
        : null,
      "transferenciaInternaCents é movimento entre contas próprias — não é receita nem despesa. Somá-lo às demais colunas foi o erro que a migration 0059 corrigiu (R$ 966.069,29 contados como despesa na DRE)."
    )
  );
});
