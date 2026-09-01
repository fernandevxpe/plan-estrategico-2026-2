/**
 * O DADO DE UMA TABELA, LIDO DA TELA — e por que é da tela e não da fonte.
 *
 * A plataforma tem ~150 tabelas em 77 arquivos. Refatorar cada uma para
 * declarar suas colunas num formato de exportação seria semanas de trabalho e,
 * pior, criaria DUAS verdades: o que o `<td>` mostra e o que o exportador
 * afirma. Toda vez que alguém mudasse uma coluna, uma das duas ficaria para
 * trás — e a que fica para trás é sempre a que ninguém olha, o PDF.
 *
 * Lendo o DOM, o PDF é por construção o que está na tela: os mesmos filtros, a
 * mesma ordenação, as mesmas linhas. Em `FinContasAPagar` isso não é detalhe —
 * a tela filtra por ciclo, área e eixo em chips de estado do React, e um
 * exportador que fosse buscar o dado na origem exportaria o recorte errado,
 * calado.
 *
 * NÃO É `innerText`. Uma célula desta casa carrega botão de programar, selo de
 * certeza, ícone do lucide e `<input>` de valor editável. `innerText` devolve
 * "Programar" e "R$ 1.234,00" grudados, e o ícone vira caractere invisível.
 * Aqui a leitura desce nó a nó e descarta o que é comando, não conteúdo.
 */

export type Celula = {
  texto: string;
  /** Alinha à direita no PDF. Dinheiro e contagem à esquerda é ilegível numa coluna. */
  numerica: boolean;
  /** `<th>` no corpo, ou `<strong>`: nome de grupo e subtotal. */
  enfase: boolean;
  colspan: number;
};

export type TipoLinha = "dado" | "grupo" | "total";

export type LinhaTabela = {
  celulas: Celula[];
  tipo: TipoLinha;
};

export type TabelaExtraida = {
  titulo: string;
  colunas: string[];
  linhas: LinhaTabela[];
  /** `<tfoot>` separado: no PDF ele repete no fim de cada página. */
  rodape: LinhaTabela[];
  /** Só as linhas de dado. `linhas.length` conta cabeçalho de grupo junto. */
  totalDeDados: number;
};

/**
 * O que é comando e não conteúdo.
 *
 * `svg` cobre todo ícone do lucide-react. `[aria-hidden="true"]` cobre os
 * separadores decorativos. `[data-exportar="ignorar"]` é a saída de escape para
 * quem quiser tirar algo do PDF sem tirar da tela.
 */
const COMANDOS = 'button, select, svg, [aria-hidden="true"], [data-exportar="ignorar"]';

/** Tem dígito e nada além de moeda, sinal, separador e percentual. */
function pareceNumero(texto: string): boolean {
  const limpo = texto.trim();
  if (!limpo || !/\d/.test(limpo)) return false;
  return /^[-+]?\s*(R\$)?\s*[\d.,\s]+\s*(%|x|un|d)?$/i.test(limpo);
}

/** Fora do fluxo de layout = filtrado ou colapsado. Não entra no PDF. */
function estaVisivel(el: HTMLElement): boolean {
  if (el.hidden) return false;
  // `offsetParent` é null para `display:none` e para todo ancestral escondido.
  // Não serve sozinho: `position:fixed` também devolve null, e a tabela nunca
  // é fixa — por isso a checagem extra só cobre o caso raro.
  if (el.offsetParent !== null) return true;
  return el.getClientRects().length > 0;
}

/**
 * O texto que uma pessoa LÊ dentro de um elemento.
 *
 * Serve para célula e também para título. Usar `textContent` cru no cabeçalho
 * do cartão produziu "Pessoasjá contado — abrir": o `<h2>` carrega um selo e um
 * link, e `textContent` cola tudo sem nem um espaço no meio.
 */
export function textoVisivel(raiz: Element, opcoes: { semLinks?: boolean } = {}): string {
  const partes: string[] = [];

  function descer(no: Node) {
    if (no.nodeType === Node.TEXT_NODE) {
      const t = no.textContent ?? "";
      if (t.trim()) partes.push(t);
      return;
    }
    if (no.nodeType !== Node.ELEMENT_NODE) return;
    const el = no as HTMLElement;

    if (el.matches(COMANDOS)) return;
    if (!estaVisivel(el)) return;

    // Tabela dentro de célula é alvo PRÓPRIO, não texto desta célula. Em
    // `FinContasAPagar` cada linha abre `.fin-cap-pedacos-tabela` com o rateio
    // do lançamento; achatá-la aqui grudaria a tabela inteira numa célula só.
    if (el.tagName === "TABLE") return;

    // Link dentro de TÍTULO é navegação, não nome: o `<h2>` de cada grupo em
    // `FinContasAPagar` carrega um selo `<a>já contado — abrir</a>`, e ele
    // entrava no nome do arquivo. Dentro de CÉLULA o link é conteúdo (o nome da
    // pessoa que leva ao perfil dela), e por isso a regra é opcional.
    if (opcoes.semLinks && el.tagName === "A") return;

    // Campo editável: o VALOR é o dado. A matriz do plano
    // (`.fin-cell-input`) guarda o número digitado aqui, e ele não existe
    // como texto em lugar nenhum do DOM.
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.type === "checkbox" || el.type === "radio") return;
      if (el.value.trim()) partes.push(el.value);
      return;
    }

    for (const filho of Array.from(el.childNodes)) descer(filho);
  }

  for (const filho of Array.from(raiz.childNodes)) descer(filho);

  // Junta com espaço e colapsa: "R$ 1.234,00" quebrado em três nós de texto
  // tem de voltar a ser uma string só.
  return partes.join(" ").replace(/\s+/g, " ").trim();
}

const textoDaCelula = textoVisivel;

function lerCelula(celula: HTMLTableCellElement): Celula {
  const texto = textoDaCelula(celula);
  return {
    texto,
    numerica: pareceNumero(texto),
    enfase: celula.tagName === "TH" || celula.querySelector("strong, b") !== null,
    colspan: Math.max(1, celula.colSpan || 1)
  };
}

function lerLinha(tr: HTMLTableRowElement, tipoPadrao: TipoLinha): LinhaTabela | null {
  if (!estaVisivel(tr)) return null;
  const celulas = Array.from(tr.cells).filter(estaVisivel).map(lerCelula);
  if (!celulas.length) return null;
  // Linha inteira em branco: acontece nas tabelas que usam `<tr>` como
  // espaçador entre blocos. No PDF isso é uma faixa vazia sem significado.
  if (celulas.every((c) => !c.texto)) return null;

  // Uma célula só, esticada pela largura toda, é cabeçalho de grupo — o padrão
  // de `.fin-mes-titulo` e dos `<tbody>` por pessoa de FinContasAPagar.
  const tipo: TipoLinha = celulas.length === 1 && celulas[0].colspan > 1 ? "grupo" : tipoPadrao;
  return { celulas, tipo };
}

/**
 * O nome que vai no topo do PDF.
 *
 * Ordem deliberada: `<caption>` é a legenda que o autor da tabela escreveu, e
 * ganha de tudo. Depois o título do cartão que a envolve — é o que o usuário lê
 * na tela logo acima da tabela, então é o nome que ele espera no arquivo.
 */
/** Acima disso não é nome, é frase — e frase não vira nome de arquivo. */
const LIMITE_DE_NOME = 80;

function tituloDaTabela(tabela: HTMLTableElement, indice: number): string {
  const marcado = tabela.closest("[data-exportar-titulo]")?.getAttribute("data-exportar-titulo");
  if (marcado?.trim()) return marcado.trim();

  /*
   * `<caption>` PRIMEIRO, mas só quando é nome.
   *
   * A da tabela de Throughput em `FinExecutivePanel.tsx:159` tem 197
   * caracteres — ela explica a fórmula, não batiza a tabela. Como nome de
   * arquivo virava uma frase inteira; como cabeçalho do PDF, ocupava duas
   * linhas antes da primeira coluna. Acima do limite ela perde para o rótulo da
   * seção, que ali é exatamente "Throughput por núcleo".
   */
  const caption = tabela.caption ? textoVisivel(tabela.caption) : "";
  if (caption && caption.length <= LIMITE_DE_NOME) return caption;

  const rotulo = tabela.getAttribute("aria-label")?.trim();
  if (rotulo) return rotulo;

  const secaoRotulada = tabela.closest("section[aria-label], article[aria-label], [role='region'][aria-label]");
  const rotuloDaSecao = secaoRotulada?.getAttribute("aria-label")?.trim();
  if (rotuloDaSecao) return rotuloDaSecao;

  const cartao = tabela.closest("section, .card, .fin-mes-bloco, article");
  const cabecalho = cartao?.querySelector("h1, h2, h3, h4, .card-title, .fin-mes-titulo");
  const texto = cabecalho ? textoVisivel(cabecalho, { semLinks: true }) : "";
  if (texto) return texto.slice(0, 120);

  // A frase longa ainda é melhor que "Tabela 3" — só entra cortada.
  if (caption) return caption.slice(0, LIMITE_DE_NOME).trimEnd();

  return `Tabela ${indice + 1}`;
}

/**
 * Colunas a partir do `<thead>`.
 *
 * Cabeçalho de duas alturas (`FinCustosEmpresaMatriz` empilha mês sobre
 * trimestre) devolve a ÚLTIMA linha: é ela que tem uma célula por coluna real.
 * A de cima agrupa, e repetir "3º trimestre" quatro vezes no PDF não informa.
 */
function colunasDe(tabela: HTMLTableElement): string[] {
  const linhas = Array.from(tabela.tHead?.rows ?? []).filter(estaVisivel);
  if (!linhas.length) return [];
  const ultima = linhas[linhas.length - 1];
  const colunas: string[] = [];
  for (const celula of Array.from(ultima.cells)) {
    if (!estaVisivel(celula)) continue;
    const texto = textoDaCelula(celula);
    const vezes = Math.max(1, celula.colSpan || 1);
    for (let i = 0; i < vezes; i++) colunas.push(texto);
  }
  return colunas;
}

/** Lê uma `<table>` viva e devolve o dado que ela está mostrando agora. */
export function extrairTabela(tabela: HTMLTableElement, indice = 0): TabelaExtraida {
  const colunas = colunasDe(tabela);

  const linhas: LinhaTabela[] = [];
  for (const corpo of Array.from(tabela.tBodies)) {
    if (!estaVisivel(corpo)) continue;
    for (const tr of Array.from(corpo.rows)) {
      const linha = lerLinha(tr, "dado");
      if (linha) linhas.push(linha);
    }
  }

  // Sem `<thead>` e sem `<tbody>`: tabela escrita direto com `<tr>` solta.
  // Acontece em `AreasOverview` e `MixSections` — 14 tabelas do repo não têm
  // className nenhuma, e várias delas são assim.
  if (!linhas.length && !tabela.tBodies.length) {
    for (const tr of Array.from(tabela.rows)) {
      const linha = lerLinha(tr, "dado");
      if (linha) linhas.push(linha);
    }
  }

  const rodape: LinhaTabela[] = [];
  for (const tr of Array.from(tabela.tFoot?.rows ?? [])) {
    const linha = lerLinha(tr, "total");
    if (linha) rodape.push(linha);
  }

  return {
    titulo: tituloDaTabela(tabela, indice),
    colunas,
    linhas,
    rodape,
    totalDeDados: linhas.filter((l) => l.tipo === "dado").length
  };
}

/** CSV com BOM: sem ele o Excel em pt-BR abre "Consultoria" como "ConsultorÃ­a". */
export function tabelaParaCsv(dados: TabelaExtraida): string {
  const escapar = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const linhas: string[] = [];
  if (dados.colunas.length) linhas.push(dados.colunas.map(escapar).join(";"));
  for (const linha of [...dados.linhas, ...dados.rodape]) {
    linhas.push(linha.celulas.map((c) => escapar(c.texto)).join(";"));
  }
  return `﻿${linhas.join("\r\n")}`;
}
