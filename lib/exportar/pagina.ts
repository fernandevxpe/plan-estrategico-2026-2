/**
 * DE UMA TELA VIVA PARA UM ARQUIVO — a junção das três peças.
 *
 * `alvos.ts` acha o que existe, `tabela-dom.ts` lê o dado, `pdf.ts` escreve os
 * bytes. Aqui é só a costura, e ela é o lugar certo para uma regra que não cabe
 * em nenhuma das três: gráfico entra no PDF como imagem, tabela entra como
 * dado. Fotografar a tabela seria jogar fora o alinhamento, a paginação e a
 * repetição de cabeçalho que o escritor de PDF já sabe fazer.
 */

import { graficoParaJpeg } from "./grafico-png";
import { hojeEmTexto, lerTabela, nomeDaTela, type Alvo } from "./alvos";
import { montarPdf, type Documento, type Secao } from "./pdf";
import { tabelaParaCsv } from "./tabela-dom";

/** Uma tabela grande vira PDF de dezenas de páginas; o aviso vale mais que o susto. */
export const LIMITE_LINHAS_AVISO = 800;

export type ResumoAlvo = { titulo: string; detalhe: string };

/** O que mostrar na lista antes de a pessoa escolher. */
export function descrever(alvo: Alvo, indice: number): ResumoAlvo {
  if (alvo.tipo === "grafico") return { titulo: alvo.titulo, detalhe: "gráfico" };
  const dados = lerTabela(alvo, indice);
  const n = dados.totalDeDados;
  return {
    titulo: dados.titulo,
    detalhe: `${n} ${n === 1 ? "linha" : "linhas"}${dados.colunas.length ? ` · ${dados.colunas.length} colunas` : ""}`
  };
}

async function secaoDoAlvo(alvo: Alvo, indice: number): Promise<Secao | null> {
  if (alvo.tipo === "tabela") {
    const dados = lerTabela(alvo, indice);
    if (!dados.linhas.length && !dados.rodape.length) return null;
    return {
      tipo: "tabela",
      titulo: dados.titulo,
      colunas: dados.colunas,
      linhas: dados.linhas,
      rodape: dados.rodape
    };
  }

  const imagem = await graficoParaJpeg(alvo.elemento);
  if (!imagem) return null;
  // O canvas sai em 2x para não borrar; no PDF a medida volta a ser a de tela,
  // senão o gráfico ocuparia o dobro da página.
  return {
    tipo: "imagem",
    titulo: alvo.titulo,
    jpeg: imagem.jpeg,
    largura: imagem.largura / 2,
    altura: imagem.altura / 2
  };
}

export async function documentoDeAlvos(alvos: Alvo[], titulo: string, subtitulo?: string): Promise<Documento> {
  const secoes: Secao[] = [];
  for (let i = 0; i < alvos.length; i++) {
    const secao = await secaoDoAlvo(alvos[i], i);
    if (secao) secoes.push(secao);
  }
  return { titulo, subtitulo, gerado: hojeEmTexto(), secoes };
}

/** O PDF da tela inteira, na ordem em que a pessoa leu. */
export async function pdfDaPagina(alvos: Alvo[]): Promise<Uint8Array> {
  const tabelas = alvos.filter((a) => a.tipo === "tabela").length;
  const graficos = alvos.length - tabelas;
  const partes = [
    tabelas ? `${tabelas} ${tabelas === 1 ? "tabela" : "tabelas"}` : "",
    graficos ? `${graficos} ${graficos === 1 ? "gráfico" : "gráficos"}` : ""
  ].filter(Boolean);
  const documento = await documentoDeAlvos(alvos, nomeDaTela(), partes.join(" · ") || undefined);
  return montarPdf(documento);
}

/** O PDF de um alvo só. */
export async function pdfDeUmAlvo(alvo: Alvo, indice: number): Promise<Uint8Array | null> {
  const secao = await secaoDoAlvo(alvo, indice);
  if (!secao) return null;
  const titulo = secao.tipo === "nota" ? nomeDaTela() : secao.titulo || nomeDaTela();
  return montarPdf({ titulo, subtitulo: nomeDaTela(), gerado: hojeEmTexto(), secoes: [secao] });
}

export function csvDeUmAlvo(alvo: Extract<Alvo, { tipo: "tabela" }>, indice: number): string {
  return tabelaParaCsv(lerTabela(alvo, indice));
}

/** Blob a partir dos bytes — `Uint8Array` cru não vira download sozinho. */
export function blobDePdf(bytes: Uint8Array): Blob {
  return new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
}
