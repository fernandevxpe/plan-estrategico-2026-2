/**
 * O QUE, NESTA TELA, DÁ PARA EXPORTAR — descoberto na hora, não cadastrado.
 *
 * A alternativa era cada uma das 59 rotas declarar suas tabelas e gráficos numa
 * lista. Lista assim nasce certa e envelhece errada: a tela nova que ninguém
 * cadastrou não exporta, e ninguém descobre porque não há erro — só um botão
 * que não aparece. Varrendo o DOM, tela nova exporta no dia em que nasce.
 *
 * A varredura roda no clique, nunca na montagem: um `MutationObserver` vivo em
 * cima de `FinContasAPagar` (2.969 linhas, tabela aninhada por lançamento)
 * dispararia a cada marcação de checkbox.
 */

import { extrairTabela, textoVisivel, type TabelaExtraida } from "./tabela-dom";

export type Alvo =
  | { tipo: "tabela"; titulo: string; elemento: HTMLTableElement }
  | { tipo: "grafico"; titulo: string; elemento: Element };

/** Regiões que nunca entram: casca, navegação e o próprio painel de exportar. */
const FORA = [
  ".topbar",
  ".fin-nav",
  ".subbar",
  "[data-exportar='ignorar']",
  ".exportar-painel",
  "[role='dialog'] .exportar-painel"
].join(", ");

function visivel(el: Element): boolean {
  const html = el as HTMLElement;
  if (html.hidden) return false;
  return html.offsetParent !== null || html.getClientRects().length > 0;
}

function dentroDeAreaExcluida(el: Element): boolean {
  return el.closest(FORA) !== null;
}

/**
 * O nome do gráfico.
 *
 * `.chart-frame-titulo` é o que o `ChartFrame` já escreve na barra — quando o
 * gráfico tem moldura, o nome do arquivo passa a ser exatamente o que está
 * escrito acima dele na tela.
 */
function tituloDoGrafico(wrapper: Element, indice: number): string {
  const moldura = wrapper.closest(".chart-frame");
  const naBarra = moldura?.querySelector(".chart-frame-titulo")?.textContent?.trim();
  if (naBarra) return naBarra;

  const marcado = wrapper.closest("[data-exportar-titulo]")?.getAttribute("data-exportar-titulo");
  if (marcado?.trim()) return marcado.trim();

  const secaoRotulada = wrapper.closest("section[aria-label], article[aria-label], figure[aria-label]");
  const rotuloDaSecao = secaoRotulada?.getAttribute("aria-label")?.trim();
  if (rotuloDaSecao) return rotuloDaSecao;

  const cartao = wrapper.closest("section, .card, .chart-box, .ci-chart, article, figure");
  const cabecalho = cartao?.querySelector("h1, h2, h3, h4, .card-title, figcaption");
  const texto = cabecalho ? textoVisivel(cabecalho, { semLinks: true }) : "";
  return texto ? texto.slice(0, 120) : `Gráfico ${indice + 1}`;
}

/**
 * Varre a tela e devolve os alvos na ordem em que aparecem.
 *
 * A ordem importa: é ela que faz o PDF da página inteira sair na mesma sequência
 * que a pessoa leu na tela. `querySelectorAll` já entrega em ordem de documento.
 */
export function varrerPagina(raiz: ParentNode = document): Alvo[] {
  const alvos: Alvo[] = [];

  // `.recharts-wrapper` e não o `<svg>`: a legenda do recharts é uma `<ul>` de
  // HTML irmã do `<svg>`, e ela precisa estar dentro do elemento capturado.
  const encontrados = Array.from(raiz.querySelectorAll<HTMLElement>("table, .recharts-wrapper"));

  let tabelas = 0;
  let graficos = 0;

  for (const el of encontrados) {
    if (!visivel(el) || dentroDeAreaExcluida(el)) continue;

    if (el.tagName === "TABLE") {
      const tabela = el as HTMLTableElement;
      // Tabela sem linha de dado é esqueleto de carregamento ou estado vazio.
      if (!tabela.rows.length) continue;
      alvos.push({ tipo: "tabela", titulo: "", elemento: tabela });
      tabelas++;
      continue;
    }

    alvos.push({ tipo: "grafico", titulo: tituloDoGrafico(el, graficos), elemento: el });
    graficos++;
  }

  // O título da tabela sai da extração (usa `<caption>`, `aria-label` e o
  // cabeçalho do cartão em volta), e por isso só é resolvido agora.
  let i = 0;
  return alvos.map((alvo) => {
    if (alvo.tipo !== "tabela") return alvo;
    const dados = extrairTabela(alvo.elemento, i++);
    return { ...alvo, titulo: dados.titulo };
  });
}

/** Lê o dado de um alvo de tabela. Separado da varredura porque custa caro. */
export function lerTabela(alvo: Extract<Alvo, { tipo: "tabela" }>, indice = 0): TabelaExtraida {
  return extrairTabela(alvo.elemento, indice);
}

/**
 * O nome da tela, para o título do PDF.
 *
 * Vem do `<h1>` renderizado, e não do mapa de rotas, porque o `<h1>` carrega o
 * recorte que o mapa não conhece — "Contas a pagar · setembro/2026" contra
 * "Contas a pagar e receber".
 */
export function nomeDaTela(): string {
  const marcado = document.querySelector("[data-exportar-tela]")?.getAttribute("data-exportar-tela");
  if (marcado?.trim()) return marcado.trim();

  const h1 = document.querySelector("main h1, .shell h1, h1");
  const texto = h1 ? textoVisivel(h1, { semLinks: true }) : "";
  if (texto) return texto.slice(0, 140);

  // Última saída: a trilha do cabeçalho, que sempre existe fora da raiz.
  const trilha = Array.from(document.querySelectorAll(".trilha-nav li"))
    .map((li) => li.textContent?.trim())
    .filter(Boolean)
    .join(" › ");
  return trilha || document.title || "Plataforma XPE";
}

/** dd/mm/aaaa — o formato que a casa lê em toda tela. */
export function hojeEmTexto(): string {
  const agora = new Date();
  const dd = String(agora.getDate()).padStart(2, "0");
  const mm = String(agora.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${agora.getFullYear()}`;
}
