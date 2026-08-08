import { interCsvParser } from "./inter-csv";
import { nubankCsvParser } from "./nubank-csv";
import { ofxParser } from "./ofx";
import type { BankParser } from "./types";

/**
 * Detecção de formato: cada parser dá uma nota 0..1 para uma amostra do
 * arquivo e o melhor acima do limiar vence. O usuário NUNCA escolhe formato num
 * menu — escolher formato é exatamente o tipo de pergunta que transforma uma
 * ação de 15 segundos em uma de 2 minutos. Ele só corrige a CONTA quando o
 * palpite de conta estiver errado (um OFX serve a Inter e às duas da Caixa).
 */
export const PARSERS: BankParser[] = [nubankCsvParser, interCsvParser, ofxParser];

/** Abaixo disso, é mais honesto dizer "não reconheci" que chutar. */
const THRESHOLD = 0.5;

export function detectParser(sample: string): { parser: BankParser; score: number } | null {
  let best: { parser: BankParser; score: number } | null = null;
  for (const parser of PARSERS) {
    const score = parser.detect(sample);
    if (!best || score > best.score) best = { parser, score };
  }
  return best && best.score >= THRESHOLD ? best : null;
}

export function parserById(id: string): BankParser | null {
  return PARSERS.find((parser) => parser.id === id) ?? null;
}

/**
 * Bytes → texto, com a realidade dos bancos brasileiros: o Inter exporta CSV em
 * windows-1252. Decodifica como utf-8 primeiro; se aparecer U+FFFD (o "�" de
 * byte inválido), o arquivo não era utf-8 — redecodifica como latin1, que
 * coincide com windows-1252 em todos os acentos do português.
 */
export function decodeStatement(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("�")) return utf8;
  return buffer.toString("latin1");
}
