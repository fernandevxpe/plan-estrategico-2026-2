/**
 * IMPRIMIR A PÁGINA — o PDF do navegador, com a cara da tela.
 *
 * É a outra metade do que a exportação precisa oferecer. O PDF montado a
 * partir do dado (`pdf.ts`) ganha em tabela: pagina, repete cabeçalho, alinha
 * dinheiro. Mas ele redesenha a tela num formato só dele. Quando o que a pessoa
 * quer é a TELA — os cartões, os KPIs, a ordem visual, o gráfico onde ele está —
 * quem faz isso bem é o próprio navegador.
 *
 * POR QUE NUM IFRAME, E NÃO `window.print()` DIRETO
 *
 * Porque `window.print()` foi exatamente o que travava esta casa. Medido em
 * 01/09/2026 com o Chrome headless sobre o app local, o reflow de impressão é
 * barato — 0ms em `/financeiro/custos-empresa`, 115ms em `/financeiro/caixa` —
 * então a explicação que eu tinha escrito antes ("reflow da árvore inteira num
 * quadro só") NÃO se sustenta nesses volumes — a tabela com os números está em
 * `components/financeiro/FinCustosEmpresa.tsx`, sobre `exportarPdf`. O que sobra é o que a medição não
 * alcança: a pré-visualização do Chromium sobre a árvore VIVA, com React,
 * observadores de resize dos gráficos e elementos fixos ainda montados.
 *
 * O iframe tira todos esses da conta. O documento impresso é um clone estático:
 * sem React, sem `ResponsiveContainer` remedindo, sem menu, sem botão
 * flutuante. E o documento da aplicação nunca entra em layout de impressão —
 * então, trave o que travar lá dentro, a tela por trás continua de pé.
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
  /** Só para teste: monta o documento e devolve o iframe sem chamar imprimir. */
  naoImprimir?: boolean;
};

/**
 * Monta o documento de impressão num iframe oculto e devolve o iframe.
 *
 * Separado de `imprimirPagina` porque `print()` bloqueia e não tem retorno —
 * a montagem, que é a parte que pode errar, fica conferível sozinha.
 */
export function montarDocumentoDeImpressao(opcoes: OpcoesImpressao): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("title", "documento para impressão");
  // Fora da tela, mas com tamanho: um iframe de 0x0 não calcula layout, e o
  // gráfico sairia com largura zero.
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:1200px;height:900px;opacity:0;border:0;pointer-events:none;z-index:-1;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) return iframe;

  doc.open();
  doc.write("<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>");
  doc.close();

  // Tema claro no papel, sempre. O escuro imprime cartão preto e gasta tinta
  // para devolver um documento que ninguém consegue ler numa cópia.
  doc.documentElement.setAttribute(ATRIBUTO_TEMA, "claro");
  doc.documentElement.lang = document.documentElement.lang || "pt-BR";
  // As variáveis de fonte moram na classe do <html> (next/font). Sem elas o
  // clone imprime na fonte padrão do sistema, com outra métrica.
  doc.documentElement.className = document.documentElement.className;

  // O CSS da aplicação, como ele estiver: <link> em produção, <style> em dev.
  for (const folha of Array.from(document.querySelectorAll("link[rel='stylesheet'], style"))) {
    doc.head.appendChild(folha.cloneNode(true));
  }
  const doPapel = doc.createElement("style");
  doPapel.textContent = CSS_DO_PAPEL;
  doc.head.appendChild(doPapel);

  const clone = raizDoConteudo().cloneNode(true) as HTMLElement;
  for (const lixo of Array.from(clone.querySelectorAll(FORA_DO_PAPEL))) lixo.remove();
  // `<details>` fechado esconde conteúdo que existe. No papel não há clique.
  for (const bloco of Array.from(clone.querySelectorAll("details"))) bloco.setAttribute("open", "");

  doc.body.insertAdjacentHTML("afterbegin", cabecalhoImpresso(opcoes.titulo, opcoes.quando));
  doc.body.appendChild(clone);

  return iframe;
}

/** Espera as folhas de estilo do clone antes de mandar para o papel. */
async function esperarEstilos(iframe: HTMLIFrameElement, tetoMs = 4000): Promise<void> {
  const doc = iframe.contentDocument;
  if (!doc) return;
  const inicio = performance.now();
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>("link[rel='stylesheet']"));
  while (performance.now() - inicio < tetoMs) {
    // `sheet` só fica não-nulo quando a folha terminou de carregar. Imprimir
    // antes disso produz uma página sem estilo nenhum.
    if (links.every((l) => l.sheet !== null)) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  if (doc.fonts?.ready) await Promise.race([doc.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

/**
 * Abre o diálogo de impressão do navegador sobre uma cópia da tela.
 *
 * Quem escolhe "Salvar como PDF" ali recebe a página com a cara dela — que é
 * o que o PDF montado do dado não entrega, e vice-versa. As duas saídas
 * existem porque respondem a perguntas diferentes.
 */
export async function imprimirPagina(opcoes: OpcoesImpressao): Promise<void> {
  const iframe = montarDocumentoDeImpressao(opcoes);
  try {
    await esperarEstilos(iframe);
    if (opcoes.naoImprimir) return;
    const janela = iframe.contentWindow;
    if (!janela) throw new Error("não consegui montar o documento de impressão");
    janela.focus();
    janela.print();
  } finally {
    if (!opcoes.naoImprimir) {
      // O iframe some DEPOIS do diálogo. Removê-lo na hora cancela a impressão
      // no Safari, que lê o documento de forma assíncrona.
      const remover = () => iframe.remove();
      iframe.contentWindow?.addEventListener("afterprint", remover, { once: true });
      setTimeout(remover, 60_000);
    }
  }
}
