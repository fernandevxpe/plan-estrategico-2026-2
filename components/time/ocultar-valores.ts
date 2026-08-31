"use client";

import { useEffect, useState } from "react";

import { brl } from "@/components/financeiro/Certeza";

/**
 * Preferência de privacidade do app do time.
 *
 * Salário, pró-labore e comissão aparecem no ônibus, na fila e na mesa
 * compartilhada. Reembolso é o número que a pessoa confere na hora de
 * cobrar — esse continua visível. A chave vive no aparelho, como o tema:
 * não tem o que guardar no servidor.
 */
const CHAVE = "xpe-ocultar-valores";
const EVENTO = "xpe-ocultar-valores";

export const MASCARA_VALOR = "R$ ••••";

export function ehValorLivre(natureza?: string | null) {
  return natureza === "reembolso";
}

export function formatarValorOcultavel(
  cents: number,
  ocultar: boolean,
  livre = false
) {
  if (ocultar && !livre) return MASCARA_VALOR;
  return brl(cents);
}

export function useOcultarValores() {
  const [ocultar, setOcultarState] = useState(false);

  useEffect(() => {
    const ler = () => {
      try {
        return localStorage.getItem(CHAVE) === "1";
      } catch {
        return false;
      }
    };
    setOcultarState(ler());
    const on = () => setOcultarState(ler());
    window.addEventListener(EVENTO, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(EVENTO, on);
      window.removeEventListener("storage", on);
    };
  }, []);

  function setOcultar(v: boolean) {
    try {
      localStorage.setItem(CHAVE, v ? "1" : "0");
    } catch {
      /* localStorage bloqueado: a preferência vale só nesta sessão */
    }
    setOcultarState(v);
    window.dispatchEvent(new Event(EVENTO));
  }

  function valor(cents: number, livre = false) {
    return formatarValorOcultavel(cents, ocultar, livre);
  }

  return { ocultar, setOcultar, valor };
}
