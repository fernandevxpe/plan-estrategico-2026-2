/**
 * UM ESCRITOR DE PDF, À MÃO — e por que não entrou biblioteca.
 *
 * O que esta casa exporta é tabela de número em real e imagem de gráfico. Isso
 * cabe em Helvetica base-14 com `WinAnsiEncoding`, que é uma das 14 fontes que
 * TODO leitor de PDF é obrigado a ter — nada para embutir, nada para baixar.
 * WinAnsi cobre o português inteiro (á à â ã é ê í ó ô õ ú ç), e o que sobra —
 * travessão, aspas curvas, reticências — tem posição própria e é mapeado
 * abaixo.
 *
 * Uma lib resolveria o mesmo com ~100KB de JavaScript novo no cliente. O app do
 * time é um PWA que abre no celular de quem está na obra; e o build é o do
 * Railway, sem `next.config` para ajustar nada. Duzentas linhas de escrita de
 * bytes valem mais barato que uma dependência — e são testáveis no Node, fora
 * do navegador, que é como este arquivo foi conferido.
 *
 * Precisão de medida: a largura dos dígitos é EXATA (556 para todos, em
 * Helvetica), então dinheiro alinhado à direita fecha na casa decimal. Letra
 * acentuada herda a largura da letra base — aproximação que só afeta onde
 * truncar um texto longo, nunca o alinhamento de número.
 */

// ── Métrica da Helvetica ────────────────────────────────────────────────────
// Larguras do AFM oficial, em milésimos do corpo. Só o intervalo imprimível:
// o que cair fora vira largura de "n", que é a média boa o bastante.
const LARGURA_NORMAL: Record<string, number> = {};
const LARGURA_NEGRITO: Record<string, number> = {};

function semear(alvo: Record<string, number>, caracteres: string, larguras: number[]) {
  for (let i = 0; i < caracteres.length; i++) alvo[caracteres[i]] = larguras[i];
}

semear(
  LARGURA_NORMAL,
  " !\"#$%&'()*+,-./0123456789:;<=>?@",
  [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
   556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015]
);
semear(
  LARGURA_NORMAL,
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`",
  [667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667,
   778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333]
);
semear(
  LARGURA_NORMAL,
  "abcdefghijklmnopqrstuvwxyz{|}~",
  [556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556,
   556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
);

semear(
  LARGURA_NEGRITO,
  " !\"#$%&'()*+,-./0123456789:;<=>?@",
  [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
   556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975]
);
semear(
  LARGURA_NEGRITO,
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`",
  [722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667,
   778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333]
);
semear(
  LARGURA_NEGRITO,
  "abcdefghijklmnopqrstuvwxyz{|}~",
  [556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611,
   611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584]
);

/** Acentuada herda a base: o acento não muda o avanço na Helvetica. */
const BASE_ACENTUADA: Record<string, string> = {
  á: "a", à: "a", â: "a", ã: "a", ä: "a", å: "a",
  é: "e", è: "e", ê: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", õ: "o", ö: "o",
  ú: "u", ù: "u", û: "u", ü: "u",
  ç: "c", ñ: "n", ý: "y",
  Á: "A", À: "A", Â: "A", Ã: "A", Ä: "A",
  É: "E", È: "E", Ê: "E", Ë: "E",
  Í: "I", Ì: "I", Î: "I", Ï: "I",
  Ó: "O", Ò: "O", Ô: "O", Õ: "O", Ö: "O",
  Ú: "U", Ù: "U", Û: "U", Ü: "U",
  Ç: "C", Ñ: "N", º: "o", ª: "a", "°": "o"
};

export function larguraDoTexto(texto: string, corpo: number, negrito = false): number {
  const tabela = negrito ? LARGURA_NEGRITO : LARGURA_NORMAL;
  let milesimos = 0;
  for (const ch of texto) {
    const chave = tabela[ch] !== undefined ? ch : BASE_ACENTUADA[ch];
    milesimos += (chave !== undefined ? tabela[chave] : undefined) ?? tabela["n"] ?? 556;
  }
  return (milesimos * corpo) / 1000;
}

// ── Codificação WinAnsi ─────────────────────────────────────────────────────
/**
 * WinAnsi é Latin-1 exceto na faixa 0x80–0x9F, onde a Microsoft pôs a
 * tipografia. Estes sete aparecem no texto da casa: travessão de intervalo,
 * aspas curvas que o editor insere sozinho, e as reticências de truncamento
 * que este próprio arquivo escreve.
 */
const WINANSI_ESPECIAIS: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87,
  "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f
};

function paraWinAnsi(texto: string): number[] {
  const saida: number[] = [];
  for (const ch of texto) {
    const especial = WINANSI_ESPECIAIS[ch];
    if (especial !== undefined) {
      saida.push(especial);
      continue;
    }
    const cod = ch.codePointAt(0) ?? 63;
    if (cod >= 32 && cod <= 255) {
      saida.push(cod);
      continue;
    }
    // Fora do alfabeto: melhor a letra sem acento do que um bloco preto.
    const base = BASE_ACENTUADA[ch];
    saida.push(base ? (base.codePointAt(0) ?? 63) : 63);
  }
  return saida;
}

/** String literal de PDF: `\`, `(` e `)` mudam o sentido do fluxo. */
function literal(texto: string): number[] {
  const bytes = paraWinAnsi(texto);
  const saida: number[] = [0x28]; // (
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) saida.push(0x5c);
    saida.push(b);
  }
  saida.push(0x29); // )
  return saida;
}

// ── Montagem do arquivo ─────────────────────────────────────────────────────
class Bytes {
  private partes: Uint8Array[] = [];
  private tamanho = 0;

  ascii(texto: string) {
    const arr = new Uint8Array(texto.length);
    for (let i = 0; i < texto.length; i++) arr[i] = texto.charCodeAt(i) & 0xff;
    this.crus(arr);
  }

  numeros(valores: number[]) {
    this.crus(Uint8Array.from(valores));
  }

  crus(arr: Uint8Array) {
    this.partes.push(arr);
    this.tamanho += arr.length;
  }

  get comprimento() {
    return this.tamanho;
  }

  juntar(): Uint8Array {
    const saida = new Uint8Array(this.tamanho);
    let pos = 0;
    for (const p of this.partes) {
      saida.set(p, pos);
      pos += p.length;
    }
    return saida;
  }
}

export type CorRgb = [number, number, number];

/** Um comando de desenho já resolvido em coordenada de página. */
type Ordem =
  | { op: "texto"; x: number; y: number; texto: string; corpo: number; negrito: boolean; cor: CorRgb }
  | { op: "retangulo"; x: number; y: number; largura: number; altura: number; cor: CorRgb }
  | { op: "imagem"; x: number; y: number; largura: number; altura: number; nome: string };

type PaginaMontada = { ordens: Ordem[] };

type ImagemEmbutida = { nome: string; jpeg: Uint8Array; largura: number; altura: number };

function corpoDoStream(ordens: Ordem[]): number[] {
  const fluxo: number[] = [];
  const escrever = (texto: string) => {
    for (let i = 0; i < texto.length; i++) fluxo.push(texto.charCodeAt(i) & 0xff);
  };

  for (const ordem of ordens) {
    if (ordem.op === "retangulo") {
      const [r, g, b] = ordem.cor;
      escrever(`${r} ${g} ${b} rg\n${ordem.x.toFixed(2)} ${ordem.y.toFixed(2)} ${ordem.largura.toFixed(2)} ${ordem.altura.toFixed(2)} re f\n`);
      continue;
    }
    if (ordem.op === "imagem") {
      escrever(
        `q\n${ordem.largura.toFixed(2)} 0 0 ${ordem.altura.toFixed(2)} ${ordem.x.toFixed(2)} ${ordem.y.toFixed(2)} cm\n/${ordem.nome} Do\nQ\n`
      );
      continue;
    }
    const [r, g, b] = ordem.cor;
    escrever(`BT\n${r} ${g} ${b} rg\n/${ordem.negrito ? "FB" : "FN"} ${ordem.corpo} Tf\n${ordem.x.toFixed(2)} ${ordem.y.toFixed(2)} Td\n`);
    for (const byte of literal(ordem.texto)) fluxo.push(byte);
    escrever(" Tj\nET\n");
  }
  return fluxo;
}

function montarArquivo(paginas: PaginaMontada[], largura: number, altura: number, imagens: ImagemEmbutida[]): Uint8Array {
  const saida = new Bytes();
  const deslocamentos: number[] = [];
  // 1 catálogo, 2 páginas, 3 fonte normal, 4 fonte negrito, depois as imagens,
  // depois um par (página, conteúdo) por página.
  const primeiraImagem = 5;
  const primeiraPagina = primeiraImagem + imagens.length;

  const abrir = (numero: number) => {
    deslocamentos[numero] = saida.comprimento;
    saida.ascii(`${numero} 0 obj\n`);
  };
  const fechar = () => saida.ascii("endobj\n");

  saida.ascii("%PDF-1.4\n");
  // Comentário com bytes altos: marca o arquivo como binário para servidor e
  // cliente que ainda tratam texto e binário de formas diferentes.
  saida.numeros([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

  abrir(1);
  saida.ascii("<< /Type /Catalog /Pages 2 0 R >>\n");
  fechar();

  const idsPagina = paginas.map((_, i) => primeiraPagina + i * 2);
  abrir(2);
  saida.ascii(`<< /Type /Pages /Count ${paginas.length} /Kids [${idsPagina.map((id) => `${id} 0 R`).join(" ")}] >>\n`);
  fechar();

  abrir(3);
  saida.ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n");
  fechar();

  abrir(4);
  saida.ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\n");
  fechar();

  imagens.forEach((img, i) => {
    abrir(primeiraImagem + i);
    saida.ascii(
      `<< /Type /XObject /Subtype /Image /Width ${img.largura} /Height ${img.altura} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`
    );
    saida.crus(img.jpeg);
    saida.ascii("\nendstream\n");
    fechar();
  });

  const recursoImagens = imagens.length
    ? ` /XObject << ${imagens.map((img, i) => `/${img.nome} ${primeiraImagem + i} 0 R`).join(" ")} >>`
    : "";

  paginas.forEach((pagina, i) => {
    const idPagina = primeiraPagina + i * 2;
    const idConteudo = idPagina + 1;

    abrir(idPagina);
    saida.ascii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${largura.toFixed(2)} ${altura.toFixed(2)}] ` +
        `/Resources << /Font << /FN 3 0 R /FB 4 0 R >>${recursoImagens} >> /Contents ${idConteudo} 0 R >>\n`
    );
    fechar();

    const fluxo = corpoDoStream(pagina.ordens);
    abrir(idConteudo);
    saida.ascii(`<< /Length ${fluxo.length} >>\nstream\n`);
    saida.numeros(fluxo);
    saida.ascii("\nendstream\n");
    fechar();
  });

  const totalObjetos = primeiraPagina + paginas.length * 2;
  const inicioXref = saida.comprimento;
  saida.ascii(`xref\n0 ${totalObjetos}\n0000000000 65535 f \n`);
  for (let i = 1; i < totalObjetos; i++) {
    saida.ascii(`${String(deslocamentos[i] ?? 0).padStart(10, "0")} 00000 n \n`);
  }
  saida.ascii(`trailer\n<< /Size ${totalObjetos} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);

  return saida.juntar();
}

// ── A camada de conteúdo ────────────────────────────────────────────────────
export type CelulaPdf = { texto: string; numerica: boolean; enfase: boolean; colspan: number };
export type LinhaPdf = { celulas: CelulaPdf[]; tipo: "dado" | "grupo" | "total" };

export type Secao =
  | { tipo: "tabela"; titulo: string; colunas: string[]; linhas: LinhaPdf[]; rodape: LinhaPdf[] }
  | { tipo: "imagem"; titulo: string; jpeg: Uint8Array; largura: number; altura: number }
  | { tipo: "nota"; texto: string };

export type Documento = {
  titulo: string;
  subtitulo?: string;
  /** Carimbo de geração. Entra como parâmetro para o arquivo ser reproduzível. */
  gerado: string;
  secoes: Secao[];
};

const TINTA: CorRgb = [0.07, 0.09, 0.11];
const TINTA_FRACA: CorRgb = [0.42, 0.46, 0.5];
const FAIXA: CorRgb = [0.93, 0.94, 0.95];
const LINHA_FINA: CorRgb = [0.87, 0.88, 0.89];
const BRANCO: CorRgb = [1, 1, 1];

const MARGEM = 34;
const CORPO_TABELA = 8.2;
const ALTURA_LINHA = 15;

/** Corta com reticências até caber. Devolve o texto original se já couber. */
function encolher(texto: string, limite: number, corpo: number, negrito: boolean): string {
  if (larguraDoTexto(texto, corpo, negrito) <= limite) return texto;
  let corte = texto;
  while (corte.length > 1 && larguraDoTexto(`${corte}…`, corpo, negrito) > limite) {
    corte = corte.slice(0, -1);
  }
  return `${corte}…`;
}

type MetricaColunas = { natural: number[]; numerica: boolean[] };

/**
 * A largura que cada coluna PEDE, e se ela é coluna de número.
 *
 * Amostra as 300 primeiras linhas em vez de todas: numa competência cheia
 * `FinContasAPagar` passa de 1.500 linhas, e medir todas custa mais do que
 * melhora — a coluna mais larga aparece muito antes disso. O rodapé entra na
 * medida junto, porque é lá que mora o total geral, o número mais longo da
 * tabela inteira.
 *
 * A medida usa o MESMO negrito que o desenho vai usar. Medir em normal e
 * desenhar em negrito foi o que cortou "R$ 63.900,30" em "R$ 63.900,…".
 */
function medirColunas(colunas: string[], linhas: LinhaPdf[]): MetricaColunas {
  const quantidade = colunas.length;
  const natural = colunas.map((c) => larguraDoTexto(c, CORPO_TABELA, true) + 12);
  const numericas = colunas.map(() => 0);
  const preenchidas = colunas.map(() => 0);

  for (const linha of linhas.slice(0, 300)) {
    if (linha.celulas.length !== quantidade) continue; // grupo esticado não mede coluna
    linha.celulas.forEach((celula, i) => {
      const negrito = celula.enfase || linha.tipo !== "dado";
      const w = larguraDoTexto(celula.texto, CORPO_TABELA, negrito) + 12;
      if (w > natural[i]) natural[i] = w;
      if (celula.texto) {
        preenchidas[i]++;
        if (celula.numerica) numericas[i]++;
      }
    });
  }

  return {
    natural,
    // 60% já basta: a coluna de valor tem célula vazia nas linhas de subtotal,
    // e a de vencimento tem "—" onde não há data.
    numerica: numericas.map((n, i) => preenchidas[i] > 0 && n / preenchidas[i] >= 0.6)
  };
}

const PISO_TEXTO = 54; // ~9 caracteres em corpo 8,2 — abaixo disso não informa nada

/**
 * Encaixa as colunas na largura da página.
 *
 * COLUNA DE NÚMERO NUNCA ENCOLHE. Num relatório financeiro, "R$ 63.900,30"
 * virando "R$ 63.900,…" não é um texto cortado: é um número errado, e o leitor
 * não tem como saber que faltou dígito. Quem cede espaço é sempre a coluna de
 * texto — descrição e favorecido continuam úteis truncadas.
 */
function ajustarLarguras(metrica: MetricaColunas, disponivel: number): number[] {
  const { natural, numerica } = metrica;
  const total = natural.reduce((s, w) => s + w, 0);

  if (total <= disponivel) {
    // Sobra vai só para as colunas de texto, proporcional ao que já ocupam:
    // esticar a coluna de data deixa um vão entre o número e o cabeçalho.
    const somaTexto = natural.reduce((s, w, i) => s + (numerica[i] ? 0 : w), 0);
    if (somaTexto === 0) return natural.map((w) => w + (disponivel - total) / natural.length);
    const folga = disponivel - total;
    return natural.map((w, i) => (numerica[i] ? w : w + (folga * w) / somaTexto));
  }

  const colunasDeTexto = natural.filter((_, i) => !numerica[i]).length;
  const ocupadoPorNumero = natural.reduce((s, w, i) => s + (numerica[i] ? w : 0), 0);
  const sobraParaTexto = disponivel - ocupadoPorNumero;
  const somaTexto = natural.reduce((s, w, i) => s + (numerica[i] ? 0 : w), 0);

  if (colunasDeTexto > 0 && sobraParaTexto >= PISO_TEXTO * colunasDeTexto) {
    const fator = sobraParaTexto / somaTexto;
    return natural.map((w, i) => (numerica[i] ? w : Math.max(PISO_TEXTO, w * fator)));
  }

  // Nem os números cabem — tabela larga demais para o papel. Não há saída boa;
  // todo mundo encolhe junto e o texto avisa por estar truncado.
  const fator = disponivel / total;
  return natural.map((w) => w * fator);
}

export type OpcoesDocumento = {
  /** Retrato por padrão; paisagem quando a tabela tem muita coluna. */
  paisagem?: boolean;
};

/**
 * Monta o PDF inteiro. Duas passadas: a primeira distribui o conteúdo em
 * páginas, a segunda escreve o rodapé — que precisa saber o TOTAL de páginas,
 * e esse número só existe quando a primeira termina.
 */
export function montarPdf(documento: Documento, opcoes: OpcoesDocumento = {}): Uint8Array {
  // Mede TODAS as tabelas antes de escolher o papel. Decidir a orientação pela
  // contagem de colunas errava nos dois sentidos: seis colunas de descrição
  // longa não cabem em retrato, e nove colunas de data cabem folgadas.
  const metricas = documento.secoes.map((s) =>
    s.tipo === "tabela" ? medirColunas(s.colunas, [...s.linhas, ...s.rodape]) : null
  );
  const UTIL_RETRATO = 595.28 - MARGEM * 2;
  const naoCabeEmRetrato = metricas.some((m) => m !== null && m.natural.reduce((soma, w) => soma + w, 0) > UTIL_RETRATO);
  const paisagem = opcoes.paisagem ?? naoCabeEmRetrato;
  const largura = paisagem ? 841.89 : 595.28;
  const altura = paisagem ? 595.28 : 841.89;
  const util = largura - MARGEM * 2;

  const paginas: PaginaMontada[] = [];
  let ordens: Ordem[] = [];
  let y = 0;

  function novaPagina() {
    if (ordens.length) paginas.push({ ordens });
    ordens = [];
    y = altura - MARGEM;

    ordens.push({ op: "texto", x: MARGEM, y: y - 12, texto: documento.titulo, corpo: 13, negrito: true, cor: TINTA });
    y -= 20;
    const legenda = [documento.subtitulo, `gerado em ${documento.gerado}`].filter(Boolean).join(" · ");
    ordens.push({ op: "texto", x: MARGEM, y: y - 9, texto: legenda, corpo: 8, negrito: false, cor: TINTA_FRACA });
    y -= 16;
    ordens.push({ op: "retangulo", x: MARGEM, y, largura: util, altura: 0.7, cor: LINHA_FINA });
    y -= 16;
  }

  function garantirEspaco(precisa: number) {
    if (y - precisa < MARGEM + 22) novaPagina();
  }

  novaPagina();

  const imagens: ImagemEmbutida[] = [];

  for (let indice = 0; indice < documento.secoes.length; indice++) {
    const secao = documento.secoes[indice];
    if (secao.tipo === "nota") {
      garantirEspaco(20);
      ordens.push({ op: "texto", x: MARGEM, y: y - 9, texto: encolher(secao.texto, util, 9, false), corpo: 9, negrito: false, cor: TINTA_FRACA });
      y -= 20;
      continue;
    }

    if (secao.tipo === "imagem") {
      const escala = Math.min(1, util / secao.largura);
      const larguraFinal = secao.largura * escala;
      const alturaFinal = secao.altura * escala;
      garantirEspaco(alturaFinal + 26);
      ordens.push({ op: "texto", x: MARGEM, y: y - 10, texto: encolher(secao.titulo, util, 10, true), corpo: 10, negrito: true, cor: TINTA });
      y -= 18;
      const nome = `Im${imagens.length}`;
      imagens.push({ nome, jpeg: secao.jpeg, largura: secao.largura, altura: secao.altura });
      y -= alturaFinal;
      ordens.push({ op: "imagem", x: MARGEM, y, largura: larguraFinal, altura: alturaFinal, nome });
      y -= 16;
      continue;
    }

    // `secao` é união; a função declarada abaixo é içada e perde o estreitamento.
    // O apelido carrega o tipo já resolvido para dentro dela.
    const tabela = secao;
    const larguras = ajustarLarguras(metricas[indice] ?? medirColunas(tabela.colunas, tabela.linhas), util);

    function escreverCabecalhoDaTabela(comTitulo: boolean) {
      if (comTitulo) {
        garantirEspaco(40);
        ordens.push({ op: "texto", x: MARGEM, y: y - 10, texto: encolher(tabela.titulo, util, 10, true), corpo: 10, negrito: true, cor: TINTA });
        y -= 20;
      }
      if (!tabela.colunas.length) return;
      garantirEspaco(ALTURA_LINHA);
      ordens.push({ op: "retangulo", x: MARGEM, y: y - ALTURA_LINHA + 4, largura: util, altura: ALTURA_LINHA, cor: FAIXA });
      let x = MARGEM;
      tabela.colunas.forEach((coluna, i) => {
        const w = larguras[i] ?? 0;
        const texto = encolher(coluna, w - 8, CORPO_TABELA, true);
        ordens.push({ op: "texto", x: x + 4, y: y - ALTURA_LINHA + 9, texto, corpo: CORPO_TABELA, negrito: true, cor: TINTA });
        x += w;
      });
      y -= ALTURA_LINHA;
    }

    escreverCabecalhoDaTabela(true);

    const escreverLinha = (linha: LinhaPdf) => {
      const antes = y;
      garantirEspaco(ALTURA_LINHA);
      // Quebrou a página: o cabeçalho da tabela repete. Uma tabela de 40
      // páginas cujo cabeçalho só existe na primeira é ilegível da segunda
      // em diante.
      if (y > antes) escreverCabecalhoDaTabela(false);

      if (linha.tipo === "grupo") {
        ordens.push({ op: "retangulo", x: MARGEM, y: y - ALTURA_LINHA + 4, largura: util, altura: ALTURA_LINHA, cor: FAIXA });
      }
      if (linha.tipo === "total") {
        ordens.push({ op: "retangulo", x: MARGEM, y: y - ALTURA_LINHA + 3.4, largura: util, altura: 0.7, cor: LINHA_FINA });
      }

      const esticada = linha.celulas.length !== tabela.colunas.length || linha.tipo === "grupo";
      let x = MARGEM;
      linha.celulas.forEach((celula, i) => {
        // Linha que não bate com as colunas (grupo, subtotal com colspan) é
        // desenhada em faixa livre: forçá-la na grade cortaria o texto.
        const w = esticada
          ? (larguras[i] ?? util / Math.max(1, linha.celulas.length)) * (celula.colspan || 1)
          : larguras[i] ?? 0;
        const negrito = celula.enfase || linha.tipo !== "dado";
        const disponivelNaCelula = Math.max(10, w - 8);
        const texto = encolher(celula.texto, disponivelNaCelula, CORPO_TABELA, negrito);
        const posX = celula.numerica && !esticada
          ? x + w - 4 - larguraDoTexto(texto, CORPO_TABELA, negrito)
          : x + 4;
        ordens.push({ op: "texto", x: posX, y: y - ALTURA_LINHA + 9, texto, corpo: CORPO_TABELA, negrito, cor: TINTA });
        x += w;
      });
      y -= ALTURA_LINHA;
    };

    for (const linha of tabela.linhas) escreverLinha(linha);
    for (const linha of tabela.rodape) escreverLinha(linha);
    y -= 14;
  }

  if (ordens.length) paginas.push({ ordens });

  // Segunda passada: o rodapé de cada página, agora que o total é conhecido.
  paginas.forEach((pagina, i) => {
    const rotulo = `${documento.titulo} · página ${i + 1} de ${paginas.length}`;
    pagina.ordens.push({ op: "retangulo", x: MARGEM, y: MARGEM + 12, largura: util, altura: 0.5, cor: LINHA_FINA });
    pagina.ordens.push({
      op: "texto",
      x: MARGEM,
      y: MARGEM,
      texto: encolher(rotulo, util, 7.5, false),
      corpo: 7.5,
      negrito: false,
      cor: TINTA_FRACA
    });
  });

  // Fundo branco por página: sem ele, um leitor com tema escuro pinta o papel
  // de preto e o texto (que é escuro) desaparece.
  for (const pagina of paginas) {
    pagina.ordens.unshift({ op: "retangulo", x: 0, y: 0, largura, altura, cor: BRANCO });
  }

  return montarArquivo(paginas, largura, altura, imagens);
}
