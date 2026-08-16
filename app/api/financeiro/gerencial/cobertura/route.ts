import {
  contrato as envelope,
  contratoIndisponivel,
  getCobertura,
  type Cobertura
} from "@/lib/financeiro/contratos";
import { responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem, lista } from "../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/cobertura
 *
 * "Posso confiar neste número?" — a matriz de cobertura de fontes (0085).
 *
 * É a única rota desta família que não recebe um `Contrato<T>` pronto:
 * `getCobertura()` devolve um `Cobertura` cru, porque ele é o insumo que os
 * OUTROS contratos usam para montar o próprio `frescorPior`. Aqui ele vira o
 * `dado`, e as fontes que o compõem viram a `cobertura` do envelope — de modo
 * que esta rota responde no mesmo formato de todas as outras. Um consumidor que
 * saiba ler qualquer rota desta API sabe ler esta.
 *
 * O QUE ESTE PAINEL DIZ QUE NENHUM OUTRO DIZ
 *
 * `fecha` e `emDia` são perguntas diferentes e o contrato se recusa a colapsá-las
 * num único "ok" verde: uma conta pode fechar aritmeticamente no dia em que o
 * extrato termina e ainda assim mentir sobre hoje. `contasQueNaoFecham` é a regra
 * zero do projeto — se ela for maior que zero, nenhuma DRE, projeção ou indicador
 * desta plataforma importa.
 *
 * As tolerâncias vêm da física de cada fonte (extrato D+1, NFe 10 dias, orçamento
 * 95 dias), não de estética. Cobrar D+1 de todas produziria um painel
 * permanentemente vermelho, que é a maneira mais rápida de ensinar o time a
 * ignorar alerta.
 */
export const GET = rotaDeLeitura(async () => {
  const medida = await getCobertura();

  if (!medida.disponivel) {
    return responderContrato(
      contratoIndisponivel<Cobertura>(
        "cobertura",
        medida,
        "a matriz de cobertura não pôde ser medida: o banco financeiro não está configurado ou não respondeu. " +
          "Nenhuma fonte é declarada em dia — o que NÃO é o mesmo que declarar todas atrasadas."
      )
    );
  }

  const naoFecham = medida.contas.filter((c) => c.fechaCaixa === false);
  const semVeredito = medida.contas.filter((c) => c.fechaCaixa === null);
  const atrasadas = medida.contas.filter((c) => c.estado !== "em_dia");
  const divergencia = naoFecham.reduce((s, c) => s + Math.abs(c.divergenciaCents ?? 0), 0);

  return responderContrato(
    envelope<Cobertura>({
      dominio: "cobertura",
      dado: medida,
      // As fontes medidas VIRAM a cobertura do envelope: o selo desta rota é a
      // pior fonte que ela mesma está reportando. Qualquer outra escolha faria a
      // matriz de confiança se declarar confiável por conta própria.
      cobertura: medida.fontes,
      pendencias: [
        ...(naoFecham.length
          ? [
              {
                chave: "caixa_nao_fecha",
                titulo: "Contas cujo saldo reconstruído não bate com o declarado",
                quantidade: naoFecham.length,
                valorCents: divergencia,
                severidade: "bloqueante" as const,
                telaDeDecisao: "/financeiro/contas"
              }
            ]
          : []),
        ...(atrasadas.length
          ? [
              {
                chave: "extrato_atrasado",
                titulo: "Contas cujo extrato não cobre D+1",
                quantidade: atrasadas.length,
                valorCents: null,
                severidade: "alerta" as const,
                telaDeDecisao: "/financeiro/contas"
              }
            ]
          : []),
        ...(semVeredito.length
          ? [
              {
                chave: "caixa_sem_veredito",
                titulo: "Contas sem cobertura de extrato declarada — não fecham nem deixam de fechar",
                quantidade: semVeredito.length,
                valorCents: null,
                severidade: "bloqueante" as const,
                telaDeDecisao: "/financeiro/contas"
              }
            ]
          : [])
      ],
      ressalvas: [
        naoFecham.length
          ? `REGRA ZERO VIOLADA: ${contagem(naoFecham.length, "conta não fecha", "contas não fecham")} (${lista(naoFecham.map((c) => c.slug))}), divergência ${brl(divergencia)}. ` +
            `Enquanto isso for verdade, nenhuma DRE, projeção ou indicador desta plataforma vale — caixa é a validação máxima.`
          : semVeredito.length
            ? `Nenhuma conta CONTRADIZ o saldo declarado, mas a regra zero não está provada: ${medida.contas.length - semVeredito.length} de ${medida.contas.length} contas reconstroem, ` +
              `e ${contagem(semVeredito.length, "conta ficou sem como ser conferida", "contas ficaram sem como ser conferidas")}. ` +
              `"N de N fecham" contado só sobre as conferíveis é a forma mais educada de esconder as outras.`
            : `Regra zero cumprida: ${medida.contas.length}/${medida.contas.length} contas reconstroem o saldo declarado.`,
        semVeredito.length
          ? `${contagem(semVeredito.length, "conta tem", "contas têm")} fechaCaixa = null (${lista(semVeredito.map((c) => c.slug))}): não há cobertura de extrato declarada, então não há veredito. ` +
            `Null aqui NÃO é "fecha" — é "não dá para saber", e tratá-lo como verde é o erro que este painel existe para impedir.`
          : null,
        atrasadas.length
          ? `${contagem(atrasadas.length, "conta está", "contas estão")} fora da tolerância de extrato: ${lista(
              atrasadas.map((c) => `${c.slug} (${c.diasDesatualizado === null ? "nunca importado" : `${c.diasDesatualizado}d`})`)
            )}. Elas continuam com saldo plausível — é justamente por isso que a data precisa ser lida junto.`
          : null,
        "'fecha' e 'emDia' respondem perguntas diferentes: a primeira é aritmética, a segunda é temporal. Uma conta pode fechar no dia em que o extrato termina e mentir sobre hoje.",
        "As tolerâncias por fonte (extrato 1 dia, NFe 10, orçamento 95) vêm da física de cada fonte. Um painel permanentemente vermelho ensina o time a ignorar alerta."
      ].filter((r): r is string => r !== null)
    })
  );
});
