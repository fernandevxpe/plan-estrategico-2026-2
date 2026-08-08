import { toCents } from "@/scripts/lib/fin-normalize.mjs";

import { extractPdfText, isPdf } from "./pdf";
import { brDateToIso, periodOf, type BankParser, type ParsedRow } from "./types";

/**
 * Extrato de Rendimentos — Caixinhas PJ do Nubank (PDF).
 *
 * É a conta de RESERVA da empresa, e por isso importa muito mais do que o
 * volume sugere: o painel dizia que o caixa era R$ 49.826 (só Asaas) enquanto
 * existiam R$ 59.001,05 guardados aqui. Metade do dinheiro da empresa estava
 * fora da vista.
 *
 * Duas naturezas convivem no mesmo extrato, e confundi-las estragaria o
 * resultado:
 *
 *   · "Compra por aplicação" — dinheiro saindo da conta corrente e entrando na
 *     caixinha. NÃO é despesa: é transferência entre contas da própria empresa.
 *     Entra como `transfer_status='em_transito'` até a perna da conta corrente
 *     ser importada e o par ser fechado. Tratá-la como despesa criaria
 *     R$ 51.895 de custo que nunca existiu.
 *   · "Rendimento até essa data" — juros de verdade. É receita financeira
 *     (categoria 9.10), e a única linha do extrato que muda o resultado.
 *
 * O sinal também é invertido em relação ao que o PDF mostra: da perspectiva da
 * CAIXINHA a aplicação é entrada, mas quem move o dinheiro é a empresa e o
 * ledger registra a conta caixinha — então a aplicação é positiva aqui, e a
 * saída correspondente aparecerá na conta corrente quando ela for importada.
 */

/** Uma linha da tabela: data, movimentação e o primeiro valor em reais. */
const LINHA_APLICACAO = /(\d{2}\/\d{2}\/\d{4})\s*C\s*o\s*m\s*p\s*r\s*a\s*p\s*o\s*r\s*a\s*p\s*l\s*i\s*c\s*a\s*ç\s*ã\s*o\s*(R\$[\d.,\s]+)/g;
const LINHA_RENDIMENTO = /(\d{2}\/\d{2}\/\d{4})\s*R\s*e\s*n\s*d\s*i\s*m\s*e\s*n\s*t\s*o\s*a\s*t\s*é\s*e\s*s\s*s\s*a\s*d\s*a\s*t\s*a\s*(R\$[\d.,\s]+)/g;
const SALDO_FINAL = /S\s*a\s*l\s*d\s*o\s*n\s*o\s*f\s*i\s*n\s*a\s*l\s*d\s*o\s*p\s*e\s*r\s*í\s*o\s*d\s*o\s*:\s*(R\$[\d.,\s]+)/;

/**
 * O extrator de PDF devolve o texto com espaço entre cada caractere (é assim
 * que o PDF posiciona os glifos). Compactar antes de casar valor evita ter que
 * escrever `R\s*\$\s*5\s*2\s*0` em toda expressão.
 */
function compactarValor(bruto: string): string {
  return bruto.replace(/\s+/g, "");
}

export const nubankCaixinhasPdfParser: BankParser = {
  id: "nubank_caixinhas_pdf",
  accountSlug: "nubank-caixinhas",
  label: "Nubank — Caixinhas PJ (PDF)",

  detect(sample) {
    const compacto = sample.replace(/\s+/g, "").toLowerCase();
    if (!compacto.includes("caixinhas")) return 0;
    // "Extrato de Rendimentos" + "Caixinhas" só aparecem juntos neste relatório.
    if (compacto.includes("extratoderendimentos")) return 0.98;
    return 0.7;
  },

  parse(texto) {
    const rows: ParsedRow[] = [];
    const warnings: string[] = [];
    let numero = 0;

    for (const casamento of texto.matchAll(LINHA_APLICACAO)) {
      const iso = brDateToIso(casamento[1]);
      const centavos = toCents(compactarValor(casamento[2]));
      numero += 1;
      if (!iso || !centavos) {
        warnings.push(`linha ${numero}: não consegui ler "${casamento[1]} ${compactarValor(casamento[2])}"`);
        continue;
      }
      rows.push({
        rowNumber: numero,
        postedOn: iso,
        amountCents: centavos,
        descriptionRaw: "Aplicação na caixinha (transferência da conta corrente)",
        sourceKind: "APLICACAO"
      });
    }

    for (const casamento of texto.matchAll(LINHA_RENDIMENTO)) {
      const iso = brDateToIso(casamento[1]);
      const centavos = toCents(compactarValor(casamento[2]));
      numero += 1;
      if (!iso || !centavos) continue;
      rows.push({
        rowNumber: numero,
        postedOn: iso,
        amountCents: centavos,
        descriptionRaw: "Rendimento da caixinha",
        sourceKind: "RENDIMENTO"
      });
    }

    if (!rows.length) {
      throw new Error(
        "Reconheci um extrato de Caixinhas, mas não achei nenhum lançamento. " +
          "Se o PDF foi escaneado em vez de baixado do app, o texto não existe no arquivo."
      );
    }

    rows.sort((a, b) => (a.postedOn < b.postedOn ? -1 : a.postedOn > b.postedOn ? 1 : 0));
    rows.forEach((linha, indice) => {
      linha.rowNumber = indice + 1;
    });

    const saldo = texto.match(SALDO_FINAL);
    const declaredBalanceCents = saldo ? toCents(compactarValor(saldo[1])) : null;

    // A conferência que pega linha faltando: aplicações + rendimento têm de
    // fechar com o saldo declarado, dado o saldo anterior. Como o extrato não
    // informa o saldo inicial, só dá para avisar quando o próprio arquivo é
    // internamente incoerente — o resto a tela de conferência resolve contra o
    // ledger.
    if (declaredBalanceCents !== null) {
      const soma = rows.reduce((total, linha) => total + linha.amountCents, 0);
      if (soma > declaredBalanceCents) {
        warnings.push(
          "A soma dos lançamentos é maior que o saldo final declarado — houve resgate no período que este relatório não lista."
        );
      }
    }

    return { rows, warnings, ...periodOf(rows), declaredBalanceCents };
  }
};

/** Converte o buffer em texto, lidando com PDF. Usado pelo detector. */
export function textoDeExtrato(buffer: Buffer): string | null {
  if (!isPdf(buffer)) return null;
  const texto = extractPdfText(buffer);
  return texto.length > 50 ? texto : null;
}
