import { getVisaoExecutiva } from "@/lib/financeiro/contratos";
import { comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { contagem, lista } from "../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/executivo
 *
 * A primeira tela — e a que mais mente se for descuidada.
 *
 * TRÊS CAMPOS QUE UM KPI COMUM NÃO CARREGA, E QUE ESTA ROTA NÃO PODE ACHATAR
 *
 * · `medida` pode ser `{ valorCents: null, motivo }`. Saldo de conta sem extrato
 *   não é zero; é desconhecido. A distância entre "tenho R$ 0" e "não sei quanto
 *   tenho" é a distância entre uma decisão e um acidente.
 * · `drill` é o filtro que reproduz o número linha a linha. Número que não se
 *   abre não é auditável — e um painel executivo é justamente onde ninguém
 *   confere.
 * · `confiavel` é falso quando a fonte que sustenta o indicador está atrasada,
 *   com o porquê em `ressalva`. É o que permite a tela APAGAR o número em vez de
 *   exibi-lo com a mesma tinta de um dado fresco.
 *
 * `regraZero` é o placar do projeto: quantas das contas fecham. Se
 * `aprovado: false`, o resto desta tela é decoração — caixa é a validação máxima,
 * e nenhum indicador derivado sobrevive a um caixa que não bate.
 *
 * `concentracaoTop5Pct` responde "quanto do faturamento depende de cinco
 * clientes". Null quando não há base para medir, nunca 0 — zero diria
 * "carteira perfeitamente pulverizada", que é a leitura oposta.
 */
export const GET = rotaDeLeitura(async () => {
  const contrato = await getVisaoExecutiva();
  const d = contrato.dado;

  const indeterminados = d.indicadores.filter((i) => i.medida.valorCents === null);
  const naoConfiaveis = d.indicadores.filter((i) => !i.confiavel);
  const semExtrato = d.caixaPorConta.filter((c) => c.diasSemExtrato === null || c.diasSemExtrato > 1);
  const mesesIncompletos = [...d.receita12m.pontos, ...d.despesa12m.pontos].filter((p) => p.incompleto);

  return responderContrato(
    comRessalvas(
      contrato,
      contrato.disponivel
        ? !d.regraZero.aprovado
          ? `REGRA ZERO REPROVADA: ${d.regraZero.fecham}/${d.regraZero.total} contas fecham. Todo indicador abaixo é derivado do mesmo ledger e herda essa dúvida.`
          : d.regraZero.fecham < d.regraZero.total
            ? `Regra zero sem contradição, mas não provada: ${d.regraZero.fecham}/${d.regraZero.total} contas reconstroem o saldo. ` +
              `As outras ${d.regraZero.total - d.regraZero.fecham} não discordam — elas não têm como ser conferidas. Ver /api/financeiro/gerencial/cobertura antes de repetir "N/N fecham".`
            : `Regra zero cumprida: ${d.regraZero.fecham}/${d.regraZero.total} contas fecham.`
        : null,
      indeterminados.length
        ? `${contagem(indeterminados.length, "indicador está", "indicadores estão")} indeterminados (medida.valorCents null): ${lista(
            indeterminados.map((i) => i.chave)
          )}. Renderize o motivo, não um zero.`
        : null,
      naoConfiaveis.length
        ? `${contagem(naoConfiaveis.length, "indicador tem", "indicadores têm")} confiavel = false: ${lista(
            naoConfiaveis.map((i) => i.chave)
          )}. O número existe e está velho — é o caso em que ele parece tão saudável quanto um fresco.`
        : null,
      semExtrato.length
        ? `${contagem(semExtrato.length, "conta está", "contas estão")} sem extrato de ontem: ${lista(
            semExtrato.map((c) => `${c.slug}${c.diasSemExtrato === null ? " (nunca)" : ` (${c.diasSemExtrato}d)`}`)
          )}. O saldo delas continua plausível, e é por isso que a data importa.`
        : null,
      mesesIncompletos.length
        ? `${contagem(mesesIncompletos.length, "ponto das séries de 12 meses está", "pontos das séries de 12 meses estão")} marcados incompleto: a fonte não cobre o mês. ` +
            `Eles vêm com valorCents 0 e incompleto = true — desenhá-los como zero achataria o gráfico e sugeriria queda que não houve.`
        : null,
      d.concentracaoTop5Pct === null
        ? "concentracaoTop5Pct é null: não há base para medir a dependência dos cinco maiores clientes. Null aqui não é carteira pulverizada."
        : null
    )
  );
});
