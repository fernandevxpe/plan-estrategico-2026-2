/**
 * IMPRIMIR A PÁGINA — o PDF do navegador, com a cara da tela.
 *
 * É a outra metade do que a exportação oferece. O PDF montado do dado
 * (`pdf.ts`) ganha em tabela: pagina, repete cabeçalho, alinha dinheiro. Mas
 * redesenha a tela num formato só dele. Quando o que a pessoa quer é a TELA —
 * os cartões, os KPIs, a ordem visual — quem faz isso bem é o navegador.
 *
 * EM ABA SEPARADA, E POR QUE MUDOU
 *
 * A primeira versão montava o documento num iframe oculto e chamava
 * `print()` nele. Isso travou o Cursor num teste local em 01/09/2026 — a
 * janela inteira fechou.
 *
 * Medi o que ia para o papel antes de culpar o tamanho, e o tamanho está
 * absolvido: em `/financeiro/pessoas`, o documento sai com 3.370 nós e 240 KB,
 * montado em 40ms; em `/financeiro/caixa`, 649 nós e 91 KB em 18ms. Nenhum
 * `<script>` entra junto — o payload RSC do Next (166 KB dos 190 KB da página)
 * mora FORA de `#conteudo`, então o clone nunca o carregou.
 *
 * Sobra a chamada `print()`. Num iframe, ela roda no MESMO processo de
 * renderização da aplicação: se o motor de impressão do host morre — e num
 * webview de Electron, que é o que o Cursor embute, ele morre — leva a tela
 * junto. Uma aba nova é outro contexto de navegação: o pior caso passa a ser
 * perder a aba do documento, nunca a tela onde a pessoa estava trabalhando.
 *
 * E se `print()` falhar mesmo assim, a aba continua aberta com a página pronta
 * para imprimir. A pessoa dá Cmd+P e resolve. Não existe caminho em que ela
 * fique sem saída.
 */

const ATRIBUTO_TEMA = "data-theme";

/** O que nunca vai para o papel. */
const FORA_DO_PAPEL = [
  ".topbar",
  ".subbar",
  ".skip-link",
  ".fin-nav",
  ".fin-nav-abrir",
  ".fin-nav-fundo",
  ".theme-toggle",
  ".exportar-flutuante",
  ".exportar-painel",
  "[data-exportar='ignorar']",
  ".fin-cap-barra",
  ".fin-cap-tudo",
  ".fin-cap-col-sel",
  ".fin-cap-comando-lado",
  ".fin-cap-pedacos-toggle"
].join(", ");

/** A raiz do conteúdo, na ordem em que os dois cascos da casa a nomeiam. */
function raizDoConteudo(): Element {
  return document.querySelector("#conteudo") ?? document.querySelector("main") ?? document.body;
}

function cabecalhoImpresso(titulo: string, quando: string): string {
  const escapar = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<p class="xpe-print-cab"><strong>${escapar(titulo)}</strong><span>gerado em ${escapar(quando)}</span></p>`;
}

/**
 * O CSS que só vale no papel.
 *
 * Some o que é gesto de tela, o grid de duas colunas do financeiro vira uma
 * coluna só, e nada é cortado por `overflow` — numa folha não existe rolar.
 */
const CSS_DO_PAPEL = `
  @page { margin: 12mm; }
  html, body { background: #fff !important; }
  body { margin: 0; padding: 0; }
  .xpe-print-cab {
    display: flex; justify-content: space-between; align-items: baseline; gap: 16px;
    margin: 0 0 12px; padding-bottom: 8px; border-bottom: 1px solid #d8dcdf;
    font-size: 12px; color: #111;
  }
  .xpe-print-cab strong { font-size: 14px; }
  .xpe-print-cab span { color: #667; }
  .fin-layout, .shell { display: block !important; grid-template-columns: none !important; }
  /* Rolagem não existe no papel: o que estava escondido tem de aparecer. */
  .fin-table-wrap, .table-wrap, .chart-frame-viewport, [class*="-scroll"] {
    overflow: visible !important; max-height: none !important;
  }
  .fin-table-wrap .fin-table, .fin-table-wrap .fin-cap-tabela, .fin-table-wrap .fin-apr-tabela {
    min-width: 0 !important;
  }
  /* Elemento grudado no topo vira uma faixa repetida no meio da folha. */
  [style*="position: sticky"], .sticky, thead th { position: static !important; }
  table { break-inside: auto; }
  tr, .card, .fin-custo-parte, .chart-frame { break-inside: avoid; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
`;

export type OpcoesImpressao = {
  titulo: string;
  quando: string;
};

function escaparHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * O documento de impressão, como texto.
 *
 * Devolver string em vez de mexer num DOM vivo é o que torna isto conferível:
 * `scripts/test-exportar-telas.mjs` lê o resultado com `DOMParser`, sem
 * precisar de aba, de iframe nem de diálogo aberto.
 */
export function montarHtmlDeImpressao(opcoes: OpcoesImpressao): string {
  const clone = raizDoConteudo().cloneNode(true) as HTMLElement;
  for (const lixo of Array.from(clone.querySelectorAll(FORA_DO_PAPEL))) lixo.remove();
  // `<script>` não tem o que fazer no papel. Hoje o clone não pega nenhum — o
  // payload do Next mora fora de `#conteudo` —, mas isso é detalhe de como o
  // framework monta a página, e não uma promessa dele.
  for (const script of Array.from(clone.querySelectorAll("script"))) script.remove();
  // `<details>` fechado esconde conteúdo que existe. No papel não há clique.
  for (const bloco of Array.from(clone.querySelectorAll("details"))) bloco.setAttribute("open", "");

  const estilos = Array.from(document.querySelectorAll("link[rel='stylesheet'], style"))
    .map((el) => el.outerHTML)
    .join("\n");

  // As variáveis de fonte moram na classe do <html> (next/font). Sem elas o
  // documento imprime na fonte do sistema, com outra métrica.
  const classeRaiz = escaparHtml(document.documentElement.className);
  const idioma = escaparHtml(document.documentElement.lang || "pt-BR");

  return `<!doctype html>
<html lang="${idioma}" data-theme="claro" class="${classeRaiz}">
<head>
<meta charset="utf-8">
<!-- Sem base, a aba nova e about:blank e nao tem URL de referencia: todo
     href relativo de folha de estilo e de imagem quebraria em silencio. -->
<base href="${escaparHtml(location.origin)}/">
<title>${escaparHtml(opcoes.titulo)}</title>
${estilos}
<style>${CSS_DO_PAPEL}</style>
</head>
<body>
${cabecalhoImpresso(opcoes.titulo, opcoes.quando)}
${clone.outerHTML}
</body>
</html>`;
}

/** Espera as folhas de estilo da aba nova antes de mandar para o papel. */
async function esperarEstilos(doc: Document, tetoMs = 6000): Promise<void> {
  const inicio = Date.now();
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>("link[rel='stylesheet']"));
  while (Date.now() - inicio < tetoMs) {
    // `sheet` só deixa de ser null quando a folha terminou de carregar.
    // Imprimir antes disso produz uma página sem estilo nenhum.
    if (links.every((l) => l.sheet !== null)) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  if (doc.fonts?.ready) await Promise.race([doc.fonts.ready, new Promise((r) => setTimeout(r, 2000))]);
  await new Promise((r) => setTimeout(r, 120));
}

/** O que a aba mostra se o diálogo não abrir sozinho. */
const AVISO_MANUAL = `
  <div id="xpe-manual" style="position:fixed;top:0;left:0;right:0;z-index:999999;
       background:#111;color:#fff;font:600 13px/1.5 system-ui,sans-serif;padding:10px 14px;text-align:center">
    Se o diálogo de impressão não abrir, use Cmd+P (ou Ctrl+P) para salvar como PDF.
  </div>
  <style>@media print { #xpe-manual { display: none !important; } }</style>`;

export type ResultadoImpressao = { ok: boolean; aviso?: string };

/**
 * Abre o documento numa aba nova e pede a impressão.
 *
 * Precisa ser chamada DENTRO do clique: `window.open` fora do gesto do usuário
 * é bloqueada por padrão em todo navegador.
 */
export async function imprimirPagina(opcoes: OpcoesImpressao): Promise<ResultadoImpressao> {
  const html = montarHtmlDeImpressao(opcoes);

  const aba = window.open("", "_blank");
  if (!aba) {
    return { ok: false, aviso: "o navegador bloqueou a aba de impressão — libere o pop-up para este site e tente de novo" };
  }

  try {
    aba.document.open();
    aba.document.write(html);
    aba.document.close();
  } catch {
    aba.close();
    return { ok: false, aviso: "não consegui montar o documento de impressão" };
  }

  await esperarEstilos(aba.document);
  aba.document.body.insertAdjacentHTML("afterbegin", AVISO_MANUAL);

  try {
    aba.focus();
    aba.print();
    return { ok: true };
  } catch (erro) {
    // A aba FICA ABERTA de propósito: mesmo sem diálogo, a pessoa tem o
    // documento pronto e resolve com Cmd+P. Fechar aqui seria tirar a única
    // saída que sobrou.
    console.error("imprimir:", erro);
    return { ok: false, aviso: "abri o documento numa aba nova — use Cmd+P por lá para salvar em PDF" };
  }
}
