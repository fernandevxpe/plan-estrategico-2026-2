/**
 * O cronograma de uma comissão — a mesma conta no servidor e na tela.
 *
 * POR QUE ESTE ARQUIVO NÃO TEM `server-only`
 * ------------------------------------------
 * O formulário precisa MOSTRAR o cronograma antes de salvar: "entrada de
 * R$ 2.000 em setembro, mais 3× R$ 1.666,67 até dezembro". Se essa prévia
 * fosse calculada por um código diferente do que grava, a tela poderia
 * prometer um parcelamento e o banco gravar outro — e ninguém descobriria até
 * alguém conferir mês a mês.
 *
 * Por isso a função é pura e vive fora de `contratos/`, que é inteiro
 * `server-only`. A prévia e a gravação chamam LITERALMENTE a mesma função.
 *
 * O CENTAVO QUE SOBRA
 * -------------------
 * R$ 1.000,00 em 3 não é R$ 333,33 três vezes: falta um centavo. A sobra vai
 * toda para a ÚLTIMA parcela, nunca para a entrada nem diluída — assim a soma
 * das parcelas é exatamente o total, e a conferência contra o extrato fecha no
 * centavo em vez de "quase".
 */

export const FORMAS_PAGAMENTO = ["avista", "parcelada", "entrada_parcelas"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export const ROTULO_FORMA: Record<FormaPagamento, string> = {
  avista: "À vista (1 mês)",
  parcelada: "Parcelada (N meses iguais)",
  entrada_parcelas: "Entrada + parcelas"
};

export type ParcelaCronograma = {
  /** AAAA-MM-01 */
  competencia: string;
  parcela: number;
  parcelasTotal: number;
  valorCents: number;
  /** Só a primeira, e só quando a forma é entrada + parcelas. */
  ehEntrada: boolean;
};

export type EntradaCronograma = {
  totalCents: number;
  forma: FormaPagamento;
  /** Nº de parcelas DEPOIS da entrada, ou o total de parcelas em `parcelada`. */
  parcelas: number;
  entradaCents: number;
  /** AAAA-MM ou AAAA-MM-01 */
  primeiraCompetencia: string;
};

export const MAX_PARCELAS = 60;

/** AAAA-MM ou AAAA-MM-01 → AAAA-MM-01; null quando não é competência. */
export function normalizarCompetencia(valor: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(valor ?? "").trim());
  if (!m) return null;
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

export function avancarMes(iso: string, n: number): string {
  const [ano, mes] = iso.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1 + n, 1)).toISOString().slice(0, 10);
}

/** Divide em N parcelas; a ÚLTIMA absorve a sobra de centavos. */
export function repartir(totalCents: number, n: number): number[] {
  if (n < 1) return [];
  const base = Math.floor(totalCents / n);
  const resto = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === n - 1 ? resto : 0));
}

/**
 * Devolve o cronograma, ou a razão pela qual ele não existe.
 *
 * Zero é aceito em `avista` — é a declaração de "não houve comissão neste mês"
 * (0177). Parcelar zero, não: não há o que dividir.
 */
export function montarCronograma(
  e: EntradaCronograma
): { ok: true; parcelas: ParcelaCronograma[] } | { ok: false; erro: string } {
  const inicio = normalizarCompetencia(e.primeiraCompetencia);
  if (!inicio) return { ok: false, erro: "competência precisa ser AAAA-MM" };
  if (!Number.isInteger(e.totalCents) || e.totalCents < 0) {
    return { ok: false, erro: "valor total precisa ser um número não negativo" };
  }

  if (e.forma === "avista") {
    return {
      ok: true,
      parcelas: [{ competencia: inicio, parcela: 1, parcelasTotal: 1, valorCents: e.totalCents, ehEntrada: false }]
    };
  }

  if (e.totalCents <= 0) return { ok: false, erro: "parcelar exige um valor maior que zero" };

  if (e.forma === "parcelada") {
    if (!Number.isInteger(e.parcelas) || e.parcelas < 2 || e.parcelas > MAX_PARCELAS) {
      return { ok: false, erro: `parcelas entre 2 e ${MAX_PARCELAS} (uma só é "à vista")` };
    }
    return {
      ok: true,
      parcelas: repartir(e.totalCents, e.parcelas).map((valorCents, i) => ({
        competencia: avancarMes(inicio, i),
        parcela: i + 1,
        parcelasTotal: e.parcelas,
        valorCents,
        ehEntrada: false
      }))
    };
  }

  // entrada + parcelas
  if (!Number.isInteger(e.entradaCents) || e.entradaCents <= 0) {
    return { ok: false, erro: "a entrada precisa ser maior que zero — sem entrada, use “Parcelada”" };
  }
  if (e.entradaCents >= e.totalCents) {
    return { ok: false, erro: "a entrada precisa ser menor que o total — igual ao total é “À vista”" };
  }
  if (!Number.isInteger(e.parcelas) || e.parcelas < 1 || e.parcelas > MAX_PARCELAS - 1) {
    return { ok: false, erro: `parcelas depois da entrada: entre 1 e ${MAX_PARCELAS - 1}` };
  }

  const total = e.parcelas + 1;
  const restante = repartir(e.totalCents - e.entradaCents, e.parcelas);
  return {
    ok: true,
    parcelas: [
      { competencia: inicio, parcela: 1, parcelasTotal: total, valorCents: e.entradaCents, ehEntrada: true },
      ...restante.map((valorCents, i) => ({
        competencia: avancarMes(inicio, i + 1),
        parcela: i + 2,
        parcelasTotal: total,
        valorCents,
        ehEntrada: false
      }))
    ]
  };
}

/** Rótulo curto de uma parcela: "entrada", "2/4", "à vista". */
export function rotuloParcela(p: { parcela: number; parcelasTotal: number; ehEntrada: boolean }): string {
  if (p.ehEntrada) return "entrada";
  if (p.parcelasTotal <= 1) return "à vista";
  return `${p.parcela}/${p.parcelasTotal}`;
}
