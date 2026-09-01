/**
 * O SVG DO RECHARTS VIRANDO IMAGEM — e os dois furos que o `ChartFrame` tinha.
 *
 * O caminho é o mesmo de sempre: clonar o `<svg>`, serializar, carregar num
 * `<img>` e pintar num `<canvas>`. O detalhe que decide se a imagem sai certa é
 * que o SVG serializado vira um DOCUMENTO ISOLADO dentro do `<img>` — ele não
 * enxerga `app/globals.css`, não enxerga `data-theme`, não enxerga nada.
 *
 * FURO 1 — cor que vem de classe CSS sumia.
 * A maioria dos gráficos usa `chartTheme`, que é hex literal virando atributo de
 * apresentação (`fill="#6d28d9"`), e isso sobrevive ao clone. Mas três famílias
 * pintam por CSS e saíam sem cor: `.fin-cartao-an` (globals.css:25150, cor do
 * tick e da grade), `.fin-cartao-topo-faixa` (:22258, cor da barra) e
 * `.funnel-stage-chart` (:3110). Some `color-mix()`, usado em 136 lugares do
 * globals.css, que nenhum serializador resolve sozinho.
 * Conserto: `getComputedStyle` no elemento VIVO devolve a cor já resolvida em
 * `rgb()` — inclusive a que veio de `color-mix()` e de variável de tema — e ela
 * é gravada inline no clone. O tema atual sai junto, de graça.
 *
 * FURO 2 — a legenda nunca entrava.
 * `<Legend>` do recharts NÃO é SVG: é uma `<ul>` de HTML em
 * `.recharts-legend-wrapper`, irmã do `<svg>`. Um `querySelector("svg")` a
 * deixava de fora — em 8 arquivos que usam legenda, a imagem baixada saía com
 * as séries coloridas e nada dizendo qual é qual.
 * Conserto: depois de pintar o gráfico, a legenda é redesenhada no canvas com
 * as APIs 2D, lendo cor e rótulo do DOM vivo.
 */

/** Propriedades que mudam o desenho de um SVG. Copiar o resto seria peso morto. */
const PROPRIEDADES = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "visibility",
  "display"
] as const;

/**
 * Copia o estilo calculado do vivo para o clone, nó a nó.
 *
 * Os dois percursos andam juntos porque `cloneNode(true)` preserva a ordem da
 * árvore — o n-ésimo descendente de um é o n-ésimo descendente do outro. É a
 * única forma barata de casar os pares sem inventar identificador.
 */
function gravarEstiloInline(vivo: Element, clone: Element) {
  const calculado = getComputedStyle(vivo);
  const declaracoes: string[] = [];
  for (const prop of PROPRIEDADES) {
    const valor = calculado.getPropertyValue(prop);
    if (valor && valor !== "none" && valor !== "normal" && valor !== "auto") {
      declaracoes.push(`${prop}:${valor}`);
    } else if (prop === "fill" && valor === "none") {
      // `fill:none` é significativo numa linha: sem ele o traçado vira uma
      // mancha sólida embaixo da curva.
      declaracoes.push("fill:none");
    }
  }
  if (declaracoes.length) {
    const anterior = clone.getAttribute("style");
    clone.setAttribute("style", anterior ? `${anterior};${declaracoes.join(";")}` : declaracoes.join(";"));
  }

  const filhosVivos = vivo.children;
  const filhosClone = clone.children;
  for (let i = 0; i < filhosVivos.length && i < filhosClone.length; i++) {
    gravarEstiloInline(filhosVivos[i], filhosClone[i]);
  }
}

function corDaSuperficie(): string {
  const raiz = getComputedStyle(document.documentElement);
  const card = raiz.getPropertyValue("--card").trim();
  if (!card) return "#ffffff";
  // `--card` pode ser `color-mix(...)`: só o navegador resolve. Um elemento
  // temporário com a cor aplicada devolve o `rgb()` final.
  const sonda = document.createElement("div");
  sonda.style.color = card;
  sonda.style.position = "absolute";
  sonda.style.visibility = "hidden";
  document.body.appendChild(sonda);
  const resolvida = getComputedStyle(sonda).color;
  sonda.remove();
  return resolvida || "#ffffff";
}

type ItemLegenda = { cor: string; rotulo: string };

/** Lê a legenda HTML que o recharts desenha ao lado do `<svg>`. */
function lerLegenda(container: Element): ItemLegenda[] {
  const wrapper = container.querySelector(".recharts-legend-wrapper");
  if (!wrapper) return [];
  const itens: ItemLegenda[] = [];
  for (const li of Array.from(wrapper.querySelectorAll(".recharts-legend-item"))) {
    const rotulo = li.querySelector(".recharts-legend-item-text")?.textContent?.trim() ?? "";
    if (!rotulo) continue;
    const amostra = li.querySelector("path, rect, line, circle");
    const cor = amostra
      ? getComputedStyle(amostra).fill !== "none"
        ? getComputedStyle(amostra).fill
        : getComputedStyle(amostra).stroke
      : getComputedStyle(li).color;
    itens.push({ cor: cor || "#666", rotulo });
  }
  return itens;
}

const ALTURA_LINHA_LEGENDA = 20;

function alturaDaLegenda(itens: ItemLegenda[], largura: number, ctx: CanvasRenderingContext2D): number {
  if (!itens.length) return 0;
  let linhas = 1;
  let x = 0;
  for (const item of itens) {
    const w = 14 + 6 + ctx.measureText(item.rotulo).width + 18;
    if (x + w > largura && x > 0) {
      linhas++;
      x = w;
    } else {
      x += w;
    }
  }
  return linhas * ALTURA_LINHA_LEGENDA + 8;
}

function desenharLegenda(
  ctx: CanvasRenderingContext2D,
  itens: ItemLegenda[],
  largura: number,
  topo: number,
  corTexto: string
) {
  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textBaseline = "middle";
  let x = 0;
  let y = topo + ALTURA_LINHA_LEGENDA / 2;
  for (const item of itens) {
    const larguraTexto = ctx.measureText(item.rotulo).width;
    const w = 14 + 6 + larguraTexto + 18;
    if (x + w > largura && x > 0) {
      x = 0;
      y += ALTURA_LINHA_LEGENDA;
    }
    ctx.fillStyle = item.cor;
    ctx.fillRect(x, y - 5, 12, 10);
    ctx.fillStyle = corTexto;
    ctx.fillText(item.rotulo, x + 20, y);
    x += w;
  }
}

export type OpcoesPng = {
  /** 2x por padrão: 1x sai borrado em apresentação e em tela retina. */
  escala?: number;
  /** Fundo sólido. PNG transparente colado no PowerPoint some no slide claro. */
  fundo?: string;
};

/**
 * Recebe o elemento que ENVOLVE o gráfico (não o `<svg>`), porque a legenda
 * mora fora do `<svg>` e precisa entrar na mesma imagem.
 */
export async function graficoParaCanvas(container: Element, opcoes: OpcoesPng = {}): Promise<HTMLCanvasElement | null> {
  // `.recharts-surface` primeiro: a legenda desenha um `<svg>` de amostra por
  // série, e com `verticalAlign="top"` um deles pode vir antes no documento.
  const svg = container.querySelector<SVGSVGElement>("svg.recharts-surface") ?? container.querySelector("svg");
  if (!svg) return null;

  const escala = opcoes.escala ?? 2;
  // `clientWidth` é a medida de LAYOUT: imune ao `transform: scale()` que o
  // zoom do ChartFrame aplica. Usar `getBoundingClientRect` exportaria o
  // gráfico no tamanho do zoom, que não é o que ninguém pediu.
  const largura = svg.clientWidth || Number(svg.getAttribute("width")) || 800;
  const altura = svg.clientHeight || Number(svg.getAttribute("height")) || 420;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  gravarEstiloInline(svg, clone);
  clone.setAttribute("width", String(largura));
  clone.setAttribute("height", String(altura));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${largura} ${altura}`);

  const fundo = opcoes.fundo ?? corDaSuperficie();
  const corTexto = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#111";

  const svgTexto = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([svgTexto], { type: "image/svg+xml;charset=utf-8" }));

  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("o SVG do gráfico não carregou como imagem"));
      img.src = url;
    });

    const medidor = document.createElement("canvas").getContext("2d");
    const itens = lerLegenda(container);
    const alturaLegenda = medidor ? alturaDaLegenda(itens, largura, medidor) : 0;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(largura * escala);
    canvas.height = Math.round((altura + alturaLegenda) * escala);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(escala, escala);
    ctx.fillStyle = fundo;
    ctx.fillRect(0, 0, largura, altura + alturaLegenda);
    ctx.drawImage(img, 0, 0, largura, altura);
    if (itens.length) desenharLegenda(ctx, itens, largura, altura, corTexto);

    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** PNG para baixar: mantém transparência onde o fundo não foi pedido. */
export async function graficoParaPng(container: Element, opcoes: OpcoesPng = {}): Promise<Blob | null> {
  const canvas = await graficoParaCanvas(container, opcoes);
  if (!canvas) return null;
  return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

export type ImagemParaPdf = { jpeg: Uint8Array; largura: number; altura: number };

/**
 * JPEG para entrar no PDF.
 *
 * O PDF embute JPEG cru com `/Filter /DCTDecode` — os bytes que o canvas
 * devolve vão direto para dentro do arquivo, sem recompressão e sem precisar de
 * um compressor `Flate` no cliente. É por isso que o gráfico entra no PDF como
 * JPEG e não como PNG: PNG exigiria escrever um deflate à mão para ganhar nada,
 * já que gráfico é imagem de tela e não texto.
 */
export async function graficoParaJpeg(container: Element, opcoes: OpcoesPng = {}): Promise<ImagemParaPdf | null> {
  const canvas = await graficoParaCanvas(container, { ...opcoes, fundo: opcoes.fundo ?? "#ffffff" });
  if (!canvas) return null;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) return null;
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), largura: canvas.width, altura: canvas.height };
}

/** Um nome de arquivo que sobrevive a acento, barra e dois-pontos. */
export function nomeDeArquivo(titulo: string, extensao: string): string {
  const base = titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
  return `${base || "xpe"}.${extensao}`;
}

export function baixarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revogar na mesma volta do event loop cancela o download no Firefox — o
  // navegador ainda não leu o blob quando o clique retorna.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
