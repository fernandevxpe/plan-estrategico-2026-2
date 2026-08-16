/**
 * As ressalvas MEDIDAS — o que a rota calcula a cada requisição.
 *
 * `comRessalvas` (em `contratos/http.ts`) existe para pôr estas frases na frente
 * das ressalvas fixas do contrato. A diferença entre as duas é o motivo deste
 * arquivo existir: a fixa é permanente ("fluxo é sempre regime de caixa"); a
 * medida é o estado de HOJE ("a folha de agosto ainda não saiu, então este mês
 * está otimista"). Congelar a segunda dentro do contrato a tornaria falsa no dia
 * seguinte, sem ninguém perceber.
 *
 * Regra deste arquivo: toda função aqui é PURA e derivada do dado que acabou de
 * voltar. Nenhuma consulta, nenhuma suposição — se a frase não puder ser medida
 * a partir do corpo da resposta, ela não pertence aqui.
 */

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Centavos → `R$ 1.234,56`. A API transporta centavos; a ressalva é para humano ler. */
export function brl(cents: number): string {
  return BRL.format(cents / 100);
}

/** `1 mês` / `3 meses`, para a frase não sair com "1 mês(es)". */
export function contagem(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Junta uma lista em português: `a`, `a e b`, `a, b e c`.
 *
 * Existe porque as ressalvas NOMEIAM o que está incompleto — "a folha ainda não
 * saiu em 2026-08" é acionável, "há meses incompletos" é ruído.
 */
export function lista(itens: string[], maximo = 6): string {
  const visiveis = itens.slice(0, maximo);
  const restantes = itens.length - visiveis.length;
  const texto =
    visiveis.length <= 1
      ? visiveis.join("")
      : `${visiveis.slice(0, -1).join(", ")} e ${visiveis[visiveis.length - 1]}`;
  return restantes > 0 ? `${texto} (+${restantes})` : texto;
}
