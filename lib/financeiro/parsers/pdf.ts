import { inflateSync, inflateRawSync } from "node:zlib";

/**
 * Extração de texto de PDF, sem dependência nova.
 *
 * POR QUE ESCREVER ISTO EM VEZ DE INSTALAR UMA BIBLIOTECA: o extrato de
 * rendimentos do Nubank (Caixinhas PJ) só sai em PDF — não há CSV nem OFX. Sem
 * ler PDF, esse dinheiro entra na plataforma digitado à mão, e o que se digita
 * uma vez por mês se erra uma vez por mês.
 *
 * O que este extrator faz e não faz:
 *
 *   · LÊ PDF de texto — o que bancos geram. Percorre os objetos `stream`,
 *     descomprime os que estão em FlateDecode e recolhe os operadores de texto
 *     (Tj, TJ, ') do content stream.
 *   · NÃO lê PDF escaneado (imagem). Não há OCR aqui, e não deve haver: um
 *     extrato escaneado é foto de papel, e adivinhar números de uma foto é
 *     exatamente o que um ledger não pode fazer.
 *   · NÃO tenta reconstruir layout de colunas com precisão tipográfica. Junta o
 *     texto na ordem do stream e preserva quebras, o que basta para um extrato
 *     tabular — o parser de cada banco faz o resto com expressão regular.
 *
 * Se o resultado vier vazio, o chamador deve dizer "não consegui ler este PDF"
 * em vez de importar zero linhas silenciosamente.
 */

/** Quantos bytes nulos há no texto — a assinatura de fonte CID de 2 bytes. */
function contarNulos(texto: string): number {
  let total = 0;
  for (let i = 0; i < texto.length; i += 1) if (texto.charCodeAt(i) === 0) total += 1;
  return total;
}

/**
 * Junta pares de bytes em códigos de 16 bits (big-endian), preservando as
 * quebras de linha que o extrator inseriu entre os operadores de posição.
 */
function recombinarPares(texto: string): string {
  let saida = "";
  for (let i = 0; i < texto.length; ) {
    const atual = texto.charCodeAt(i);
    if (atual === 10) {
      saida += "\n";
      i += 1;
      continue;
    }
    const proximo = i + 1 < texto.length ? texto.charCodeAt(i + 1) : 0;
    saida += String.fromCharCode((atual << 8) | proximo);
    i += 2;
  }
  return saida;
}

/** Um PDF começa com %PDF- nos primeiros bytes. */
export function isPdf(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

/**
 * Desescapa uma string literal PDF: `\(`, `\)`, `\\`, `\n`, e octais `\ddd`.
 * O octal importa: acento em PDF Latin-1 vem como `\351` (é), e sem tratar isso
 * "Rendimento até" viraria "Rendimento at\351".
 */
function decodeLiteral(raw: string): string {
  let saida = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== "\\") {
      saida += ch;
      continue;
    }
    const proximo = raw[i + 1];
    if (proximo === undefined) break;
    if (proximo >= "0" && proximo <= "7") {
      const octal = raw.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? "";
      saida += String.fromCharCode(parseInt(octal, 8));
      i += octal.length;
      continue;
    }
    const mapa: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
    saida += mapa[proximo] ?? proximo;
    i += 1;
  }
  return saida;
}

/** Converte `<48656C6C6F>` em texto. Bancos usam isso para fontes embutidas. */
function decodeHex(raw: string): string {
  const limpo = raw.replace(/\s+/g, "");
  const pares = limpo.match(/.{1,2}/g) ?? [];
  return pares
    .map((par) => String.fromCharCode(parseInt(par.padEnd(2, "0"), 16)))
    .join("");
}

/**
 * Recolhe o texto de um content stream já descomprimido.
 *
 * Operadores que interessam: `(texto) Tj`, `[(a) -250 (b)] TJ`, `(texto) '`.
 * `TD`/`Td`/`T*` viram quebra de linha — é o que separa uma linha da tabela da
 * seguinte, e sem isso o extrato inteiro vira uma única string.
 */
function textoDoStream(conteudo: string): string {
  let saida = "";
  const regex = /(\[[^\]]*\]\s*TJ)|(\((?:\\.|[^\\)])*\)\s*(?:Tj|'|"))|(<[0-9A-Fa-f\s]*>\s*Tj)|(T\*|TD|Td|ET)/g;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(conteudo)) !== null) {
    const token = m[0];

    if (m[4]) {
      saida += "\n";
      continue;
    }

    if (m[1]) {
      // Array TJ: junta só as strings, ignorando os ajustes de kerning.
      const partes = token.matchAll(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>/g);
      for (const parte of partes) {
        const bruto = parte[0];
        saida += bruto.startsWith("<") ? decodeHex(bruto.slice(1, -1)) : decodeLiteral(bruto.slice(1, -1));
      }
      continue;
    }

    if (m[2]) {
      const literal = token.slice(token.indexOf("(") + 1, token.lastIndexOf(")"));
      saida += decodeLiteral(literal);
      continue;
    }

    if (m[3]) {
      saida += decodeHex(token.slice(token.indexOf("<") + 1, token.indexOf(">")));
    }
  }
  return saida;
}

/**
 * Mapa de códigos de glifo → caractere real, montado a partir dos `/ToUnicode`
 * do próprio PDF.
 *
 * POR QUE ISTO É NECESSÁRIO: o extrato do Nubank embute a fonte como *subset*
 * com codificação própria. O byte `0x28` — que em ASCII é `(` — representa a
 * letra `E`. Lido cru, "Extrato de Rendimentos" sai como "( [ W U D W R". Todo
 * dígito também está deslocado, então os VALORES sairiam errados em silêncio,
 * que é o pior desfecho possível num extrato.
 *
 * O PDF carrega a tradução: cada fonte tem um stream `/ToUnicode` com um CMap
 * (`beginbfchar` para códigos avulsos, `beginbfrange` para faixas). Este mapa é
 * a única forma correta de ler — deduzir o deslocamento por tentativa
 * funcionaria neste arquivo e quebraria no próximo.
 *
 * Simplificação assumida: junta os CMaps de TODAS as fontes num mapa só, em vez
 * de rastrear qual `Tf` está ativo em cada trecho. Em documento de família
 * tipográfica única — que é o caso de extrato bancário — dá no mesmo. Colisões
 * são contadas e devolvidas para o chamador poder desconfiar.
 */
function montarCMap(buffer: Buffer): { mapa: Map<number, string>; colisoes: number } {
  const mapa = new Map<number, string>();
  let colisoes = 0;

  const hexParaTexto = (hex: string) => {
    const limpo = hex.replace(/[^0-9A-Fa-f]/g, "");
    let saida = "";
    for (let i = 0; i + 3 < limpo.length + 1; i += 4) {
      const ponto = parseInt(limpo.slice(i, i + 4), 16);
      if (Number.isFinite(ponto) && ponto > 0) saida += String.fromCharCode(ponto);
    }
    return saida;
  };

  const registrar = (codigo: number, texto: string) => {
    if (!texto) return;
    const anterior = mapa.get(codigo);
    if (anterior !== undefined && anterior !== texto) colisoes += 1;
    else mapa.set(codigo, texto);
  };

  for (const conteudo of streamsDescomprimidos(buffer)) {
    if (!conteudo.includes("beginbfchar") && !conteudo.includes("beginbfrange")) continue;

    for (const bloco of conteudo.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const par of bloco[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        registrar(parseInt(par[1], 16), hexParaTexto(par[2]));
      }
    }

    for (const bloco of conteudo.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      // Forma 1: <ini> <fim> <destino> — a faixa inteira mapeia em sequência.
      for (const faixa of bloco[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const inicio = parseInt(faixa[1], 16);
        const fim = parseInt(faixa[2], 16);
        const base = parseInt(faixa[3], 16);
        if (fim - inicio > 65_535) continue;
        for (let i = 0; inicio + i <= fim; i += 1) registrar(inicio + i, String.fromCharCode(base + i));
      }
      // Forma 2: <ini> <fim> [<a> <b> …] — um destino por código.
      for (const faixa of bloco[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
        const inicio = parseInt(faixa[1], 16);
        const destinos = [...faixa[3].matchAll(/<([0-9A-Fa-f]+)>/g)];
        destinos.forEach((destino, i) => registrar(inicio + i, hexParaTexto(destino[1])));
      }
    }
  }

  return { mapa, colisoes };
}

/** Percorre os streams do PDF já descomprimidos, em latin1. */
function* streamsDescomprimidos(buffer: Buffer): Generator<string> {
  const marcadorInicio = Buffer.from("stream");
  const marcadorFim = Buffer.from("endstream");
  let cursor = 0;

  while (cursor < buffer.length) {
    const inicio = buffer.indexOf(marcadorInicio, cursor);
    if (inicio === -1) return;
    const fim = buffer.indexOf(marcadorFim, inicio);
    if (fim === -1) return;

    let dados = inicio + marcadorInicio.length;
    if (buffer[dados] === 0x0d) dados += 1;
    if (buffer[dados] === 0x0a) dados += 1;

    const bruto = buffer.subarray(dados, fim);
    let inflado: Buffer | null = null;
    try {
      inflado = inflateSync(bruto);
    } catch {
      try {
        inflado = inflateRawSync(bruto);
      } catch {
        const texto = bruto.toString("latin1");
        if (/\(|TJ|Tj|beginbf/.test(texto)) inflado = bruto;
      }
    }
    if (inflado) yield inflado.toString("latin1");

    cursor = fim + marcadorFim.length;
  }
}

/**
 * Extrai todo o texto de um PDF.
 *
 * Recolhe o texto dos content streams e o traduz pelo CMap das fontes. Stream
 * que não infla é imagem — ignorado, porque num extrato é o logotipo.
 */
export function extractPdfText(buffer: Buffer): string {
  const { mapa } = montarCMap(buffer);
  const pedacos: string[] = [];

  for (const conteudo of streamsDescomprimidos(buffer)) {
    if (!/Tj|TJ/.test(conteudo)) continue;
    pedacos.push(textoDoStream(conteudo));
  }

  const cru = pedacos.join("\n");

  // FONTE CID: cada glifo ocupa DOIS bytes, não um.
  //
  // O extrato do Nubank usa fonte CID, então "Extrato" chega como
  // \u0000E\u0000x\u0000t… — cada código de 16 bits lido byte a byte vira dois
  // caracteres. As chaves do CMap são de 16 bits; procurar por 8 não acha nada,
  // e o texto sai como se cada letra estivesse separada por espaço.
  //
  // Detecta pela presença maciça de bytes nulos e recombina os pares antes de
  // traduzir. Sem isto o parser não casa nenhuma linha e o extrato importa zero
  // lançamentos em silêncio.
  const ehDoisBytes = contarNulos(cru) > cru.length * 0.25;
  const unidades = ehDoisBytes ? recombinarPares(cru) : cru;

  // Traduz pelo CMap quando ele existe. Sem tradução, os DÍGITOS sairiam
  // deslocados e o extrato entraria com valores errados sem erro nenhum — que é
  // o desfecho que este módulo inteiro existe para impedir.
  const traduzido = mapa.size
    ? [...unidades].map((ch) => mapa.get(ch.charCodeAt(0)) ?? ch).join("")
    : unidades;

  return traduzido
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

