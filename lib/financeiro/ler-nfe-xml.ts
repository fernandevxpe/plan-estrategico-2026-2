/**
 * O XML da NF-e lido como XML — sem modelo, sem custo, sem chute.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO NÃO PASSA PELA IA
 * ---------------------------------------------------------------------------
 * `ler-comprovante.ts` manda a foto para o Haiku porque um cupom amassado no
 * bolso não tem estrutura. O XML da NF-e tem: ele é gerado por software
 * homologado pela SEFAZ, segue um layout publicado, e traz o valor, o CNPJ, a
 * chave de 44 dígitos e a data em campos nomeados.
 *
 * Mandar isso para um modelo seria pagar por token para adivinhar o que está
 * escrito ao lado de uma etiqueta. Pior: aceitaria o risco de a resposta vir
 * diferente do arquivo — e o número de uma nota fiscal é justamente o que não
 * pode ser aproximado.
 *
 * Aqui a extração é EXATA ou é nula. Não há legibilidade "parcial".
 *
 * ---------------------------------------------------------------------------
 * POR QUE REGEX E NÃO UM PARSER DE XML
 * ---------------------------------------------------------------------------
 * Trocar precisão por conveniência normalmente é um mau negócio, e para XML de
 * origem desconhecida seria. Este não é: o arquivo vem de emissor homologado,
 * o layout é o da NT 2019.001, e os campos que interessam são folhas de texto
 * simples — sem atributos, sem CDATA, sem recursão. Uma dependência nova para
 * ler oito etiquetas custaria mais do que resolve.
 *
 * O que compensa o risco é a validação depois: chave de 44 dígitos ou nada,
 * CNPJ de 14 ou CPF de 11 ou nada, valor que sobrevive a `Number()` ou nada.
 * Um XML torto não produz campo errado — produz campo vazio, e a pessoa digita.
 */

export type NotaLida = {
  /** Chave de acesso, 44 dígitos, ou `null`. */
  chaveNfe: string | null;
  numero: string | null;
  serie: string | null;
  /** AAAA-MM-DD, do fuso do emitente. */
  data: string | null;
  emitente: string | null;
  /** CNPJ ou CPF, só dígitos. */
  documento: string | null;
  /** Total da nota em reais. */
  valorTotal: number | null;
  /** Descrição curta, montada com os itens. */
  resumo: string;
  /**
   * Mesma forma que a leitura por IA devolve — de propósito.
   *
   * A tela preenche o formulário a partir de um objeto só, e dois formatos
   * obrigariam cada campo a perguntar de onde veio. Aqui a quantidade e o
   * unitário são EXATOS (`qCom` e `vUnCom` do layout), enquanto na foto são
   * leitura; o que muda é a confiança, não o formato.
   */
  itens: ItemLido[];
  /** O XML não classifica: quem sugere categoria e área é a leitura da foto. */
  categoriaCode: null;
  areaNome: null;
  porQue: string;
  numeroPedido: string | null;
  formaPagamento: FormaPagamento;
  cartaoFinal: string | null;
  cartaoBandeira: string;
  parcelas: number | null;
};

export type FormaPagamento =
  | "pix"
  | "cartao_credito"
  | "cartao_debito"
  | "boleto"
  | "dinheiro"
  | "indeterminado";

export type ItemLido = {
  descricao: string;
  quantidade: number | null;
  valorUnitario: number | null;
};

export class XmlNaoEhNota extends Error {}

/** `<tag>conteúdo</tag>`, tolerando prefixo de namespace e espaço no atributo. */
function texto(xml: string, tag: string): string | null {
  const m = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([^<]*)</(?:\\w+:)?${tag}>`, "i").exec(xml);
  const v = m?.[1]?.trim();
  return v ? decodificar(v) : null;
}

/** As cinco entidades que o XML 1.0 define. Emissor não usa mais que isso. */
function decodificar(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function digitos(s: string | null): string {
  return (s ?? "").replace(/\D/g, "");
}

/**
 * Tabela `tPag` do layout da NF-e.
 *
 * Só os códigos que a casa encontra. Qualquer outro vira `indeterminado` em vez
 * de virar o mais parecido: o campo existe para a pessoa confirmar, e um chute
 * plausível é o que ela não confere.
 */
const PAGAMENTO: Record<string, FormaPagamento> = {
  "01": "dinheiro",
  "03": "cartao_credito",
  "04": "cartao_debito",
  "15": "boleto",
  "17": "pix"
};

/** Tabela `tBand`, as bandeiras que o `fin_card_brand_ck` aceita. */
const BANDEIRA: Record<string, string> = {
  "01": "visa",
  "02": "mastercard",
  "03": "amex",
  "06": "elo",
  "07": "hipercard"
};

/**
 * Lê o XML e devolve o que ele afirma. Lança `XmlNaoEhNota` se o arquivo não
 * for uma NF-e — o que inclui o caso comum de alguém anexar o XML errado.
 */
export function lerNotaXml(bruto: string): NotaLida {
  // BOM do Windows: emissor desktop grava com ele, e ele quebra a primeira tag.
  const xml = bruto.replace(/^﻿/, "");

  if (!/<(?:\w+:)?infNFe/i.test(xml)) {
    // CT-e é frete e tem layout próprio; dizer o nome certo poupa a pessoa de
    // tentar de novo com o mesmo arquivo.
    if (/<(?:\w+:)?infCte/i.test(xml)) throw new XmlNaoEhNota("isto é um CT-e (conhecimento de transporte), não uma NF-e");
    throw new XmlNaoEhNota("este XML não é uma NF-e");
  }

  // A chave vive no atributo `Id` do `infNFe`, prefixada por "NFe".
  const idBruto = /<(?:\w+:)?infNFe[^>]*\bId\s*=\s*["']([^"']+)["']/i.exec(xml)?.[1] ?? "";
  const chaveCandidata = digitos(idBruto);
  const chaveNfe = chaveCandidata.length === 44 ? chaveCandidata : null;

  // O emitente é quem RECEBEU o dinheiro. O destinatário (`dest`) é a XPE, e
  // trocar os dois é o mesmo erro que a instrução da IA combate no print: o
  // fornecedor não é quem pagou. Recorto o bloco para o `xNome` não casar com
  // o do destinatário, que aparece depois no documento.
  const blocoEmit = /<(?:\w+:)?emit\b[^>]*>([\s\S]*?)<\/(?:\w+:)?emit>/i.exec(xml)?.[1] ?? "";
  const emitente = texto(blocoEmit, "xNome") ?? texto(blocoEmit, "xFant");
  const doc = digitos(texto(blocoEmit, "CNPJ")) || digitos(texto(blocoEmit, "CPF"));
  const documento = doc.length === 14 || doc.length === 11 ? doc : null;

  // `vNF` é o total da nota — depois de desconto, frete e imposto. É o que sai
  // da conta, e é o único que casa com a fatura.
  const blocoTotal = /<(?:\w+:)?ICMSTot\b[^>]*>([\s\S]*?)<\/(?:\w+:)?ICMSTot>/i.exec(xml)?.[1] ?? xml;
  const vNF = Number(texto(blocoTotal, "vNF"));
  const valorTotal = Number.isFinite(vNF) && vNF > 0 ? Number(vNF.toFixed(2)) : null;

  // `dhEmi` é ISO com fuso ("2026-08-12T10:30:00-03:00"); `dEmi` é o campo da
  // versão 3.10, só a data. Fatiar em vez de `new Date()`: converter para o
  // fuso do servidor mudaria o dia de uma nota emitida à noite.
  const dh = texto(xml, "dhEmi") ?? texto(xml, "dEmi");
  const data = dh && /^\d{4}-\d{2}-\d{2}/.test(dh) ? dh.slice(0, 10) : null;

  // Cada `<det>` é um item, e é dentro dele que `qCom` e `vUnCom` fazem
  // sentido — pegar as tags soltas pelo documento inteiro casaria a quantidade
  // de um item com a descrição de outro.
  const itens: ItemLido[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?det\b[^>]*>([\s\S]*?)<\/(?:\w+:)?det>/gi)) {
    const prod = /<(?:\w+:)?prod\b[^>]*>([\s\S]*?)<\/(?:\w+:)?prod>/i.exec(m[1])?.[1] ?? m[1];
    const descricao = texto(prod, "xProd");
    if (!descricao) continue;
    const q = Number(texto(prod, "qCom"));
    const vu = Number(texto(prod, "vUnCom"));
    itens.push({
      descricao: descricao.replace(/\s+/g, " ").slice(0, 200),
      quantidade: Number.isFinite(q) && q > 0 ? Number(q.toFixed(4)) : null,
      valorUnitario: Number.isFinite(vu) && vu > 0 ? Number(vu.toFixed(2)) : null
    });
    if (itens.length >= 40) break;
  }
  const numero = texto(xml, "nNF");
  const serie = texto(xml, "serie");

  // Pagamento: o bloco `detPag` pode repetir (compra dividida em dois meios).
  // Pego o de maior valor — é o que descreve a compra; os centavos no dinheiro
  // ao lado de R$ 190 no cartão não mudam quem cobrou.
  let formaPagamento: FormaPagamento = "indeterminado";
  let cartaoFinal: string | null = null;
  let cartaoBandeira = "indeterminado";
  let maior = -1;
  for (const m of xml.matchAll(/<(?:\w+:)?detPag\b[^>]*>([\s\S]*?)<\/(?:\w+:)?detPag>/gi)) {
    const bloco = m[1];
    const v = Number(texto(bloco, "vPag"));
    if (!Number.isFinite(v) || v <= maior) continue;
    maior = v;
    formaPagamento = PAGAMENTO[texto(bloco, "tPag") ?? ""] ?? "indeterminado";
    const band = texto(bloco, "tBand");
    cartaoBandeira = band ? (BANDEIRA[band] ?? "outra") : "indeterminado";
    // `cAut` é o código de autorização, não o final do cartão — o layout da
    // NF-e NÃO traz os quatro dígitos. Deixar null é honesto; inventar a partir
    // do cAut gravaria um número que nunca casa com a fatura.
    cartaoFinal = null;
  }

  // Parcelas: cada `detPag` com `<card>` é um meio, não uma parcela. O layout
  // não tem contagem de parcelas, e derivar do número de blocos misturaria
  // "pagou com dois cartões" com "parcelou em dois". Fica null.
  const parcelas = null;

  return {
    chaveNfe,
    numero,
    serie,
    data,
    emitente,
    documento,
    valorTotal,
    resumo: montarResumo(itens, emitente),
    itens,
    // A nota diz o que foi comprado, não para que área. Classificar a partir
    // dela seria adivinhar com cara de dado fiscal — o palpite fica com a
    // leitura da foto, que é onde ele é apresentado COMO palpite.
    categoriaCode: null,
    areaNome: null,
    porQue: `lido do XML da nota${numero ? ` nº ${numero}` : ""} — valores exatos, não é leitura de imagem`,
    numeroPedido: null,
    formaPagamento,
    cartaoFinal,
    cartaoBandeira,
    parcelas
  };
}

/**
 * O título do lançamento. Um item vira o próprio nome; vários viram
 * "primeiro item +N", porque a lista inteira estoura o campo e a pessoa
 * reescreve — e reescrever é o que se queria evitar.
 */
function montarResumo(itens: ItemLido[], emitente: string | null): string {
  const limpo = itens.map((i) => i.descricao.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (limpo.length === 0) return emitente ? `Compra em ${emitente}` : "Compra com nota fiscal";
  const base = limpo.length === 1 ? limpo[0] : `${limpo[0]} +${limpo.length - 1}`;
  return base.length > 90 ? `${base.slice(0, 87)}…` : base;
}

/** O arquivo é XML? Decidido pelo conteúdo, não pela extensão nem pelo mime. */
export function pareceXml(bytes: Buffer): boolean {
  // `<?xml` ou direto a raiz. Alguns emissores gravam sem declaração.
  const inicio = bytes.subarray(0, 200).toString("utf8").replace(/^﻿/, "").trimStart();
  return inicio.startsWith("<?xml") || /^<(?:\w+:)?(nfeProc|NFe|cteProc|CTe|envi)/i.test(inicio);
}
