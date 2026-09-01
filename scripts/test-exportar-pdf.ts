/**
 * O escritor de PDF, conferido fora do navegador.
 *
 * `lib/exportar/pdf.ts` não toca DOM de propósito: ele recebe dado e devolve
 * bytes. Isso permite provar aqui o que só se descobriria abrindo o arquivo —
 * que a tabela de referência cruzada aponta para os objetos certos, que a
 * acentuação virou WinAnsi e não interrogação, e que a paginação fecha.
 *
 * A conferência final é o próprio Quartz do macOS: se `qlmanage` consegue
 * desenhar uma miniatura, um leitor de PDF de verdade abre.
 */

import { writeFileSync } from "node:fs";

import { montarPdf, larguraDoTexto, type Documento, type LinhaPdf } from "../lib/exportar/pdf.ts";

let falhas = 0;
function conferir(rotulo: string, condicao: boolean, detalhe = "") {
  if (condicao) {
    console.log(`  ok   ${rotulo}`);
  } else {
    falhas++;
    console.log(`  FALHA ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

function celula(texto: string, numerica = false, enfase = false) {
  return { texto, numerica, enfase, colspan: 1 };
}

// Uma tabela com o que a casa realmente exporta: acento, cedilha, travessão,
// real com centavo, e linhas suficientes para estourar a página.
const COLUNAS = ["Descrição", "Favorecido", "Categoria", "Vencimento", "Valor", "Situação"];

const linhas: LinhaPdf[] = [];
for (let mes = 8; mes <= 10; mes++) {
  linhas.push({ tipo: "grupo", celulas: [{ texto: `Competência ${String(mes).padStart(2, "0")}/2026`, numerica: false, enfase: true, colspan: 6 }] });
  for (let i = 1; i <= 30; i++) {
    linhas.push({
      tipo: "dado",
      celulas: [
        celula(`Manutenção preventiva — inversor ${i} da usina São João`),
        celula("José Gonçalves de Assunção"),
        celula("6.02 Prestação de serviço"),
        celula(`${String(i).padStart(2, "0")}/${String(mes).padStart(2, "0")}/2026`),
        celula(`R$ ${(i * 137.42).toFixed(2).replace(".", ",")}`, true),
        celula(i % 3 === 0 ? "Programado" : "Em aberto")
      ]
    });
  }
  linhas.push({
    tipo: "total",
    celulas: [celula("Subtotal do mês", false, true), celula(""), celula(""), celula(""), celula("R$ 63.900,30", true, true), celula("")]
  });
}

const documento: Documento = {
  titulo: "Contas a pagar — setembro/2026",
  subtitulo: "Custo da empresa · 3 competências · 90 lançamentos",
  gerado: "01/09/2026",
  secoes: [
    { tipo: "nota", texto: "Recorte da tela: ciclo «recorrente», área «Operação», eixo «previsto»." },
    { tipo: "tabela", titulo: "Lançamentos programados", colunas: COLUNAS, linhas, rodape: [
      { tipo: "total", celulas: [celula("Total geral", false, true), celula(""), celula(""), celula(""), celula("R$ 191.700,90", true, true), celula("")] }
    ] }
  ]
};

console.log("\nEscritor de PDF");
const bytes = montarPdf(documento);
conferir("gerou bytes", bytes.length > 2000, `${bytes.length} bytes`);

const texto = Buffer.from(bytes).toString("latin1");

conferir("cabeçalho %PDF-1.4", texto.startsWith("%PDF-1.4"));
conferir("termina em %%EOF", texto.trimEnd().endsWith("%%EOF"));
conferir("tem tabela de referência cruzada", texto.includes("\nxref\n"));
conferir("declara WinAnsiEncoding", texto.includes("/WinAnsiEncoding"));
conferir("usa Helvetica e Helvetica-Bold", texto.includes("/BaseFont /Helvetica\n") || texto.includes("/BaseFont /Helvetica "), "");
conferir("Helvetica-Bold presente", texto.includes("/Helvetica-Bold"));

// Acentuação: "Manutenção" tem ç (0xE7) e ã (0xE3) em WinAnsi. Se saísse como
// UTF-8, apareceria 0xC3 0xA7 — dois bytes, e o leitor mostraria "Ã§".
conferir("cedilha gravada como byte único WinAnsi", texto.includes("\xe7\xe3o"), "esperado 0xE7 0xE3");
conferir("não vazou UTF-8 de dois bytes", !texto.includes("\xc3\xa7"), "achou 0xC3 0xA7");
conferir("travessão em 0x97", texto.includes("\x97"));

// A referência cruzada tem de apontar para o começo de cada objeto. Um offset
// errado é o defeito clássico de escritor de PDF à mão: o arquivo abre em
// alguns leitores e falha em outros, sem mensagem.
const posXref = texto.lastIndexOf("\nxref\n") + 6;
const cabecalhoXref = texto.slice(posXref, texto.indexOf("\n", posXref));
const totalObjetos = Number(cabecalhoXref.split(" ")[1]);
conferir("xref declara um total plausível", totalObjetos > 4, `${totalObjetos}`);

let offsetsCertos = 0;
let offsetsErrados: string[] = [];
const linhasXref = texto.slice(texto.indexOf("\n", posXref) + 1).split("\n");
for (let i = 1; i < totalObjetos; i++) {
  const linha = linhasXref[i];
  if (!linha) break;
  const offset = Number(linha.slice(0, 10));
  const esperado = `${i} 0 obj`;
  if (texto.startsWith(esperado, offset)) offsetsCertos++;
  else offsetsErrados.push(`obj ${i} @${offset} achou "${texto.slice(offset, offset + 12)}"`);
}
conferir(
  `os ${totalObjetos - 1} offsets do xref apontam para o objeto certo`,
  offsetsErrados.length === 0,
  offsetsErrados.slice(0, 3).join("; ")
);

// Regressão do defeito que a miniatura do Quartz revelou em 01/09/2026: o
// subtotal saía "R$ 63.900,…". A largura das colunas era medida em corpo
// normal e desenhada em negrito, e o excedente encolhia TODA coluna por igual
// — inclusive a de dinheiro. Número truncado num relatório financeiro é
// número errado, e o leitor não tem como perceber que faltou dígito.
conferir("subtotal do mês inteiro no arquivo", texto.includes("R$ 63.900,30"));
conferir("total geral inteiro no arquivo", texto.includes("R$ 191.700,90"));
conferir("nenhum valor em real terminou em reticências", !/R\$[^)\n]*\x85/.test(texto));
conferir("cabeçalho 'Vencimento' não truncou", texto.includes("Vencimento"));

const paginas = (texto.match(/\/Type \/Page[^s]/g) ?? []).length;
const contagemDeclarada = Number(/\/Count (\d+)/.exec(texto)?.[1] ?? 0);
conferir("Count bate com o número de objetos de página", paginas === contagemDeclarada, `${paginas} objetos, Count=${contagemDeclarada}`);
conferir("paginou de verdade (90 linhas não cabem numa página)", contagemDeclarada >= 2, `${contagemDeclarada} páginas`);

// A métrica: dígito é 556 em Helvetica, e é o que sustenta o alinhamento de
// dinheiro à direita fechar na vírgula.
conferir("largura de 10 dígitos em corpo 10 = 55,6pt", Math.abs(larguraDoTexto("0123456789", 10) - 55.6) < 0.01);
conferir("acentuada mede como a base", larguraDoTexto("ação", 10) === larguraDoTexto("acao", 10));

const destino = process.env.DESTINO_PDF ?? "/tmp/xpe-teste.pdf";
writeFileSync(destino, bytes);
console.log(`\n  arquivo: ${destino} (${(bytes.length / 1024).toFixed(1)} KB, ${contagemDeclarada} páginas)`);

console.log(falhas === 0 ? "\nTudo certo.\n" : `\n${falhas} falha(s).\n`);
process.exit(falhas === 0 ? 0 : 1);
