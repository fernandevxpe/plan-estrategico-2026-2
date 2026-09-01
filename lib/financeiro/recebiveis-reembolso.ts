/**
 * Aritmética do reembolso em Recebíveis — pura, sem banco.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO EXISTE FORA DE `time.ts`
 * ---------------------------------------------------------------------------
 * `time.ts` é `server-only`. A prova desta conta tem de rodar em `node scripts/…`
 * sem subir o Next, igual `comissao-cronograma.ts`. A regra cabe em duas
 * funções; o que não cabe é ela viver só no payload, onde um gráfico e uma
 * faixa já divergiram uma vez.
 *
 * ---------------------------------------------------------------------------
 * O QUE FOI MEDIDO EM 01/09/2026 (Fernando, person_id = 4)
 * ---------------------------------------------------------------------------
 * A view `fin_time_remuneracao_mes_v` MODELA a divisão do que caiu. Em
 * setembro ela pintava salário R$ 1.621,00 (não saiu Pix nenhum desse valor),
 * pró-labore R$ 2.748,00 e reembolso R$ 1.440,76. Os dois Pix do dia 01/09
 * foram R$ 4.379,00 (pró-labore) e R$ 1.440,76 (reembolso). A conferência
 * casa por valor e acerta; o histórico lia a banda e mostrava salário que
 * ainda está "a receber".
 *
 * Só reescreve o mês quando a soma dos Pix conferidos DAQUELE mês de caixa
 * fecha com o total que caiu. Se não fechar, deixa a view — inventar o resto
 * seria pior.
 *
 * E o Pix de reembolso já liquidou Gasolina + PagBank. Enquanto o cabeçalho
 * segue `aprovado`, a previsão de outubro ia cobrá-los de novo.
 */

export type MesComBandas = {
  mes: string;
  totalCents: number;
  porNatureza: Record<string, number>;
};

export type PixConferido = {
  /** Data do Pix, `YYYY-MM-DD`. O mês de caixa é daqui, não da competência. */
  data: string;
  natureza: string;
  cents: number;
};

export type PrevistoPago = {
  natureza: string;
  pagoCents: number;
  conferido: boolean;
};

export type LinhaExtratoConferido = {
  data: string;
  valorCents: number;
  natureza: string;
  casado: boolean;
};

/**
 * Os Pix da conferência, no mês em que CAÍRAM.
 *
 * A conferência agrupa por competência (folha de agosto). O histórico e o
 * gráfico agrupam pela data do Pix (setembro). Sem esta tradução, o R$ 10
 * de comissão pago em 31/08 reescreveria agosto inteiro, e o salário que
 * não saiu apareceria em setembro.
 */
export function pixesDoCaixa(args: {
  previstos: PrevistoPago[];
  extrato: LinhaExtratoConferido[];
}): PixConferido[] {
  const out: PixConferido[] = [];
  const usados = new Set<number>();
  for (const p of args.previstos) {
    if (!p.conferido || p.pagoCents <= 0) continue;
    const idx = args.extrato.findIndex(
      (l, i) => !usados.has(i) && l.casado && l.valorCents === p.pagoCents
    );
    if (idx < 0) continue;
    usados.add(idx);
    out.push({ data: args.extrato[idx].data, natureza: p.natureza, cents: p.pagoCents });
  }
  for (let i = 0; i < args.extrato.length; i += 1) {
    const l = args.extrato[i];
    if (l.casado || usados.has(i) || l.valorCents <= 0) continue;
    out.push({ data: l.data, natureza: l.natureza || "extra", cents: l.valorCents });
  }
  return out;
}

/**
 * Troca as bandas modeladas pelos Pix conferidos daquele mês de caixa.
 *
 * O total do mês NÃO muda: é o que caiu na conta. Se os Pix não fecharem
 * com esse total, não mexe.
 */
export function alinharBandasComPixConferido(porMes: MesComBandas[], pixes: PixConferido[]): void {
  const porCaixa = new Map<string, Record<string, number>>();
  for (const p of pixes) {
    if (p.cents <= 0 || p.data.length < 7) continue;
    const mes = p.data.slice(0, 7);
    const acc = porCaixa.get(mes) ?? {};
    acc[p.natureza] = (acc[p.natureza] ?? 0) + p.cents;
    porCaixa.set(mes, acc);
  }
  const meses = new Map(porMes.map((m) => [m.mes, m]));
  for (const [mes, bandas] of porCaixa) {
    const m = meses.get(mes);
    if (!m) continue;
    const soma = Object.values(bandas).reduce((a, b) => a + b, 0);
    if (soma !== m.totalCents) continue;
    m.porNatureza = { ...bandas };
  }
}

/**
 * Pedido do app cuja competência já tem Pix conferido.
 *
 * Série da planilha NÃO entra: ela é dívida que se repete todo mês. O item do
 * app é de uma parcela só (0179) — depois que o Pix casou, projetá-lo de novo
 * é a mesma compra duas vezes.
 */
export function itemAppJaLiquidado(
  origem: string,
  ultimaCompetencia: string,
  competenciasPagas: ReadonlySet<string>
): boolean {
  return origem === "app" && Boolean(ultimaCompetencia) && competenciasPagas.has(ultimaCompetencia);
}
