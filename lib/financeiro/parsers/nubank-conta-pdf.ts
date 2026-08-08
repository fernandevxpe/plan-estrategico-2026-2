import { toCents } from "@/scripts/lib/fin-normalize.mjs";

import { periodOf, type BankParser, type ParsedRow } from "./types";

/**
 * Extrato da conta corrente PJ do Nubank (PDF).
 *
 * É a conta onde a operação de Obras vive, e por isso o arquivo mais importante
 * que este módulo lê: 815 movimentos e R$ 583 mil de saída em sete meses de
 * 2026 — a despesa da empresa inteira, que até aqui era um buraco no ledger.
 *
 * O layout é uma tabela por DIA, não uma linha por lançamento:
 *
 *     02 JAN 2026
 *     Total de entradas          + 4.000,00
 *     Resgate RDB                  4.000,00
 *     Total de saídas            - 5.876,74
 *     Transferência enviada…  TAWANNY DE MELO…   2.500,00
 *     Saldo do dia                   190,50
 *
 * DUAS DECISÕES QUE O FORMATO IMPÕE:
 *
 * 1. O SINAL VEM DA SEÇÃO, não do tipo do movimento. Os valores individuais são
 *    impressos sempre positivos; o que diz se entrou ou saiu é estar sob "Total
 *    de entradas" ou "Total de saídas". Deduzir pelo tipo daria errado logo no
 *    primeiro estorno — "Estorno - Transferência enviada pelo Pix" é dinheiro
 *    VOLTANDO, e aparece na seção de entradas.
 *
 * 2. A DESCRIÇÃO OCUPA VÁRIAS LINHAS e termina quando aparece um valor. O nome
 *    do favorecido vem quebrado em três ou quatro pedaços com CNPJ, banco,
 *    agência e conta no meio. Juntar tudo e cortar no primeiro número é o que
 *    faz "FERREIRA COSTA & CIA LTDA - 10.230.480/0001-30 - BCO BRADESCO…"
 *    chegar inteiro na classificação.
 *
 * O extrato traz os totais do período no cabeçalho, e o parser os usa como
 * conferência: se a soma das linhas lidas não bater com o que o Nubank declara,
 * o arquivo foi lido errado e a tela avisa antes de qualquer coisa entrar.
 */

/** Tipos de movimento que o Nubank imprime. Fechado de propósito: linha que não casa nenhum é descrição, não lançamento. */
const TIPOS = [
  "Transferência enviada pelo Pix",
  "Transferência recebida pelo Pix",
  "Transferência Recebida",
  "Transferência Enviada",
  "Estorno - Transferência enviada pelo Pix",
  "Estorno - Transferência enviada pelo",
  "Estorno - Transferência enviada",
  "Reembolso recebido pelo Pix",
  "Pagamento de boleto efetuado",
  "Pagamento de boleto devolvido",
  "Pagamento de fatura",
  "Aplicação RDB",
  "Resgate RDB",
  "Débito automático",
  "Compra no débito"
];

/** Movimentos sem descrição: o valor vem na linha seguinte, direto. */
const SEM_DESCRICAO = new Set(["Aplicação RDB", "Resgate RDB", "Pagamento de fatura"]);

const MESES: Record<string, string> = {
  JAN: "01", FEV: "02", MAR: "03", ABR: "04", MAI: "05", JUN: "06",
  JUL: "07", AGO: "08", SET: "09", OUT: "10", NOV: "11", DEZ: "12"
};

const DATA = /^(\d{2})\s+([A-ZÇ]{3})\s+(\d{4})$/;
/** Valor solto: "2.500,00". Sem sinal — o sinal vem da seção. */
const VALOR = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;

/** Rodapé e cabeçalho que se repetem em cada uma das 106 páginas. */
const RUIDO = [
  "Tem alguma dúvida?",
  "Caso a solução fornecida",
  "Extrato gerado dia",
  "XP ENERGY SERVICOS",
  "LTDA",
  "CNPJ",
  "Agência",
  "Conta",
  "VALORES EM R$",
  "Movimentações",
  "DE JANEIRO DE",
  "DE AGOSTO DE",
  "nubank.com.br",
  "metropolitanas)",
  "disponíveis em"
];

const ehRuido = (linha: string) =>
  RUIDO.some((marca) => linha.startsWith(marca)) || /^\d{1,3}$/.test(linha) || linha === "de" || linha === "a";

/** "02 JAN 2026" → "2026-01-02". */
function dataIso(linha: string): string | null {
  const m = linha.match(DATA);
  if (!m) return null;
  const mes = MESES[m[2].toUpperCase()];
  return mes ? `${m[3]}-${mes}-${m[1]}` : null;
}

export const nubankContaPdfParser: BankParser = {
  id: "nubank_conta_pdf",
  accountSlug: "nubank",
  label: "Nubank — conta corrente (PDF)",

  detect(sample) {
    const compacto = sample.replace(/\s+/g, "").toLowerCase();
    // A do Caixinhas também tem "nubank"; o que separa as duas é o cabeçalho.
    if (compacto.includes("extratoderendimentos") || compacto.includes("caixinhas")) return 0;
    if (compacto.includes("saldofinaldoperíodo") && compacto.includes("movimentações")) return 0.95;
    if (compacto.includes("totaldeentradas") && compacto.includes("totaldesaídas")) return 0.8;
    return 0;
  },

  parse(texto) {
    const linhas = texto.split("\n").map((linha) => linha.trim()).filter(Boolean);
    const rows: ParsedRow[] = [];
    const warnings: string[] = [];

    let dataAtual: string | null = null;
    let sinal: 1 | -1 | 0 = 0;
    // Totais do período, lidos do cabeçalho por posição e não por estado: eles
    // aparecem antes da primeira data, e os mesmos rótulos se repetem em cada
    // dia do corpo. A máquina de estados confundiria os dois.
    const cabecalho = texto.slice(0, texto.indexOf("Movimentações") + 1 || 2000);
    const somaDeclarada = (sinal: "+" | "-") => {
      const m = cabecalho.match(new RegExp(`\\${sinal}(\\d{1,3}(?:\\.\\d{3})*,\\d{2})`));
      return m ? toCents(m[1]) : null;
    };
    const declaradoEntradas: number | null = somaDeclarada("+");
    const declaradoSaidas: number | null = somaDeclarada("-");

    for (let i = 0; i < linhas.length; i += 1) {
      const linha = linhas[i];

      const iso = dataIso(linha);
      if (iso) {
        dataAtual = iso;
        sinal = 0;
        continue;
      }

      if (linha === "Total de entradas") {
        sinal = 1;
        continue;
      }
      if (linha === "Total de saídas") {
        sinal = -1;
        continue;
      }
      // "Saldo do dia" encerra o dia; o valor seguinte não é lançamento.
      if (linha === "Saldo do dia") {
        sinal = 0;
        i += 1;
        continue;
      }

      if (ehRuido(linha)) continue;

      const tipo = TIPOS.find((candidato) => linha === candidato || linha.startsWith(candidato));
      if (!tipo || !dataAtual || sinal === 0) continue;

      // Junta a descrição até o valor. Sem teto, um tipo mal reconhecido
      // engoliria o resto do arquivo — 12 linhas cobre a descrição mais longa
      // que este extrato produz (nome + CNPJ + banco + agência + conta).
      const partes: string[] = [];
      let j = i + 1;
      let valor: number | null = null;

      while (j < linhas.length && j - i <= 12) {
        const proxima = linhas[j];
        if (VALOR.test(proxima)) {
          valor = toCents(proxima);
          break;
        }
        if (ehRuido(proxima)) {
          j += 1;
          continue;
        }
        // Outro tipo ou nova data antes do valor: lançamento truncado pela
        // quebra de página. Perde-se a linha, e isso vira aviso — nunca um
        // valor inventado.
        if (dataIso(proxima) || TIPOS.some((c) => proxima === c) || proxima === "Saldo do dia") break;
        if (!SEM_DESCRICAO.has(tipo)) partes.push(proxima);
        j += 1;
      }

      if (valor === null || valor === 0) {
        warnings.push(`${dataAtual}: "${tipo}" sem valor legível (provável quebra de página)`);
        continue;
      }

      rows.push({
        rowNumber: rows.length + 1,
        postedOn: dataAtual,
        amountCents: valor * sinal,
        descriptionRaw: partes.length ? `${tipo} — ${partes.join(" ")}` : tipo,
        // O tipo vira source_kind para as regras estruturais casarem por FATO,
        // não por texto: aplicação e resgate de RDB são a outra perna das
        // Caixinhas e não podem virar despesa.
        sourceKind: tipo.startsWith("Aplicação RDB")
          ? "APLICACAO_RDB"
          : tipo.startsWith("Resgate RDB")
            ? "RESGATE_RDB"
            : tipo.startsWith("Pagamento de fatura")
              ? "FATURA_CARTAO"
              : tipo.startsWith("Estorno")
                ? "ESTORNO"
                : undefined
      });

      i = j;
    }

    if (!rows.length) {
      throw new Error(
        "Reconheci um extrato do Nubank, mas não achei nenhum lançamento. " +
          "Se o PDF foi escaneado em vez de baixado do app, o texto não existe no arquivo."
      );
    }

    // A conferência que o banco entrega de graça. Divergência aqui significa
    // leitura errada — e um extrato lido errado é pior que extrato nenhum.
    const somaEntradas = rows.filter((r) => r.amountCents > 0).reduce((t, r) => t + r.amountCents, 0);
    const somaSaidas = rows.filter((r) => r.amountCents < 0).reduce((t, r) => t - r.amountCents, 0);

    if (declaradoEntradas !== null && Math.abs(somaEntradas - declaradoEntradas) > 100) {
      warnings.push(
        `entradas lidas (${(somaEntradas / 100).toFixed(2)}) não batem com o total do extrato (${(declaradoEntradas / 100).toFixed(2)})`
      );
    }
    if (declaradoSaidas !== null && Math.abs(somaSaidas - declaradoSaidas) > 100) {
      warnings.push(
        `saídas lidas (${(somaSaidas / 100).toFixed(2)}) não batem com o total do extrato (${(declaradoSaidas / 100).toFixed(2)})`
      );
    }

    // Saldo final: o extrato o imprime logo após "Saldo final do período".
    const saldoFinal = texto.match(/Saldo final do período\s*\n\s*R\$\s*([\d.,]+)/);
    const declaredBalanceCents = saldoFinal ? toCents(saldoFinal[1]) : null;

    return { rows, warnings, ...periodOf(rows), declaredBalanceCents };
  }
};
