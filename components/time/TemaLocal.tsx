"use client";

import { useLayoutEffect } from "react";

/**
 * Reaplica o tema escolhido em páginas que o Next serve fora do layout raiz.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO PRECISA EXISTIR
 * ---------------------------------------------------------------------------
 * O tema é aplicado por um script síncrono no `<head>` de `app/layout.tsx`,
 * antes da primeira pintura, para a tela não piscar clara antes de virar
 * escura. Funciona em toda rota — menos no 404.
 *
 * Medido: `/time` responde com `<html lang="pt-BR">` e duas ocorrências de
 * `xpe-tema`; `/time/nao-existe` responde com `<html id="__next_error__">`,
 * ZERO `<link rel="stylesheet">` e uma só ocorrência de `xpe-tema` — a cópia
 * inerte dentro do payload RSC. O Next monta o 404 num documento de erro
 * próprio, que não é o layout raiz, então o script nunca roda.
 *
 * Consequência: quem TOCOU no seletor de tema via o 404 na paleta oposta à do
 * resto do app. Quem nunca tocou não percebia, porque aí o
 * `@media (prefers-color-scheme)` resolve sozinho.
 *
 * `useLayoutEffect` e não `useEffect`: roda antes da pintura do navegador, e
 * como esta página já é renderizada no cliente de qualquer forma, não há SSR
 * para divergir. Um `<script>` dentro do componente NÃO serve — o React não
 * executa script em render de cliente, e este 404 é render de cliente.
 */
export function TemaLocal() {
  useLayoutEffect(() => {
    try {
      const t = localStorage.getItem("xpe-tema");
      if (t === "claro" || t === "escuro") document.documentElement.setAttribute("data-theme", t);
    } catch {
      /* localStorage bloqueado: o @media resolve, e é o mesmo que já acontecia */
    }
  }, []);
  return null;
}
