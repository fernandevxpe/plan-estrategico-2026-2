import { getAgenda, ORDENACOES_VALIDAS, type Certeza, type Direcao } from "@/lib/financeiro/contratos/agenda";
import {
  comRessalvas,
  dataDe,
  inteiroDe,
  opcaoDe,
  ParametroInvalido,
  responderContrato,
  rotaDeLeitura,
  textoDe
} from "@/lib/financeiro/contratos/http";

import { brl, contagem } from "../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/agenda
 *
 * A agenda diária de obrigações: contas a pagar e a receber, dia a dia, do
 * passado ao futuro, numa linha do tempo só.
 *
 * PARÂMETROS
 *   de, ate ............ janela (YYYY-MM-DD). Padrão: 30 dias atrás → 90 à frente
 *   direcao ............ receber | pagar
 *   texto .............. busca em descrição E contraparte
 *   categoria .......... code do plano de contas ("5.01")
 *   camada ............. pagar_folha, receber_cobranca, …
 *   certeza ............ firme | provavel | observado | atrasado | indeterminado
 *   procedencia ........ documento | item | projetado
 *   estado ............. previsto | confirmado | realizado | ignorado | projetado | liquidado | …
 *   valorMin, valorMax . faixa em CENTAVOS
 *   somenteSomaveis .... esconde o que não soma (padrão: mostra tudo)
 *   somenteVencidos .... só o que venceu e não aconteceu
 *   pagina, porPagina, ordenarPor, ordem
 *
 * ORDENAÇÃO POR LISTA BRANCA. `ORDER BY` não aceita parâmetro no Postgres — o
 * nome da coluna vira texto na consulta. Um nome vindo do cliente concatenado
 * ali é injeção de SQL com outro nome. `ordenarPor` só aceita o que está em
 * `ORDENACOES_VALIDAS`; o resto é 400.
 *
 * TRÊS CAMPOS QUE NÃO PODEM SER LIDOS ISOLADOS
 *
 * · `entraNoTotal` — some SÓ o que é true. Duas linhas com a mesma
 *   `chaveDedupe` são o MESMO dinheiro visto por procedências diferentes, e
 *   somar as duas é o defeito de R$ 1,27 milhão da migration 0060.
 * · `saldoPrevistoCents` — NULL no passado, sempre. O saldo de ontem é o
 *   extrato de ontem, não a âncora de hoje projetada para trás.
 * · `prova` — a conta que confronta a soma da agenda com
 *   `fin_previsao_evento_v`, mês a mês. `provaOk = false` significa que alguma
 *   coisa está sendo contada duas vezes, e a tela deve dizer isso em vez de
 *   desenhar o total.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const hoje = new Date();
  const desloca = (dias: number) => {
    const d = new Date(hoje);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  };

  const de = dataDe(sp, "de") ?? desloca(-30);
  const ate = dataDe(sp, "ate") ?? desloca(90);
  if (de > ate) throw new ParametroInvalido("de", "de não pode ser posterior a ate");

  // Teto de janela: a agenda cobre 2021→2027 e uma consulta sem limite traria
  // 4.351 linhas por página nenhuma. 400 explícito ensina; timeout não.
  const dias = Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
  if (dias > 800) throw new ParametroInvalido("ate", "janela acima de 800 dias — estreite o período");

  const valorMin = inteiroDe(sp, "valorMin", { min: 0, max: 100_000_000_00 });
  const valorMax = inteiroDe(sp, "valorMax", { min: 0, max: 100_000_000_00 });
  if (valorMin !== undefined && valorMax !== undefined && valorMin > valorMax) {
    throw new ParametroInvalido("valorMin", "valorMin não pode ser maior que valorMax");
  }

  const contrato = await getAgenda({
    de,
    ate,
    direcao: sp.get("direcao") ? opcaoDe(sp, "direcao", ["receber", "pagar"] as const, "receber") : undefined,
    texto: textoDe(sp, "texto", 120),
    categoria: textoDe(sp, "categoria", 20),
    camada: textoDe(sp, "camada", 40),
    certeza: sp.get("certeza")
      ? (opcaoDe(sp, "certeza", ["firme", "provavel", "observado", "atrasado", "indeterminado"] as const, "firme") as Certeza)
      : undefined,
    procedencia: sp.get("procedencia")
      ? opcaoDe(sp, "procedencia", ["documento", "item", "projetado"] as const, "item")
      : undefined,
    estado: textoDe(sp, "estado", 20),
    valorMinCents: valorMin,
    valorMaxCents: valorMax,
    somenteSomaveis: sp.get("somenteSomaveis") === "1",
    somenteVencidos: sp.get("somenteVencidos") === "1",
    pagina: inteiroDe(sp, "pagina", { min: 1, max: 10_000 }),
    porPagina: inteiroDe(sp, "porPagina", { min: 10, max: 500 }),
    ordenarPor: opcaoDe(sp, "ordenarPor", ORDENACOES_VALIDAS as [string, ...string[]], "dia"),
    ordem: opcaoDe(sp, "ordem", ["asc", "desc"] as const, "asc")
  });

  const d = contrato.dado;
  const provaRuim = d.prova.filter((p) => !p.deltaExplicado);
  const diasComRuptura = d.dias.filter((x) => x.tempo !== "passado" && (x.saldoPrevistoCents ?? 1) < 0);
  const vencidos = d.dias.reduce((s, x) => s + x.itensVencidos, 0);
  const vencidoCents = d.dias.reduce((s, x) => s + x.vencidoCents, 0);

  return responderContrato(
    comRessalvas(
      contrato,
      provaRuim.length
        ? `A PROVA DE NÃO-DUPLICAÇÃO FALHOU em ${contagem(provaRuim.length, "mês", "meses")}: ` +
            provaRuim.map((p) => `${p.competencia.slice(0, 7)}/${p.direcao} delta ${brl(p.deltaCents)}`).join(", ") +
            ". Não apresente o total como confiável — alguma coisa está sendo contada duas vezes."
        : null,
      d.foraDaSomaLinhas
        ? `${contagem(d.foraDaSomaLinhas, "linha aparece e NÃO soma", "linhas aparecem e NÃO somam")}, ` +
            `totalizando ${brl(d.foraDaSomaCents)} — cada uma com motivoNaoSoma escrito. ` +
            `Somá-las ao total conta o mesmo dinheiro duas vezes.`
        : null,
      vencidos
        ? `${contagem(vencidos, "obrigação venceu", "obrigações venceram")} sem acontecer no período (${brl(vencidoCents)}). ` +
            `No passado a agenda mostra previsto × realizado; use isso para corrigir a previsão, não para somar de novo.`
        : null,
      diasComRuptura.length
        ? `${contagem(diasComRuptura.length, "dia projetado fica", "dias projetados ficam")} com saldo negativo, ` +
            `a partir de ${diasComRuptura[0].dia}. A curva já é OTIMISTA (a saída prevista cobre ~72% do que sai): ` +
            `a ruptura real tende a chegar antes.`
        : null,
      d.ancoraAte
        ? `A curva parte do saldo real de ${d.ancoraAte} (${brl(d.ancoraSaldoCents ?? 0)}). ` +
            `Extrato atrasado desloca tudo o que vem depois.`
        : null
    )
  );
});
