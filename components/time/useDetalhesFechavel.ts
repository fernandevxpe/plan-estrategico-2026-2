"use client";

import { useEffect, useRef } from "react";

/**
 * Faz um `<details>` fechar com Esc e com toque fora.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO PRECISA EXISTIR
 * ---------------------------------------------------------------------------
 * O `<details>` nativo abre e fecha sem JavaScript, que é justamente por que o
 * app usa ele no menu "Mais" e no bloco de campos extras — sem hidratação, sem
 * o piscar de um menu que aparece depois da página já ter pintado.
 *
 * O que ele NÃO faz é fechar. Medido: depois de abrir, `Escape` não fecha,
 * clique fora não fecha. E o menu "Mais" (`z-index: 70`) cobre o botão de
 * enviar — o Playwright chegou a recusar o clique com "time-mais-lista
 * intercepts pointer events". Quem abre o menu sem querer, no meio de um
 * formulário preenchido, fica sem gesto de saída e com o envio bloqueado.
 *
 * Um menu que não fecha é pior que um menu que não abre: o segundo a pessoa
 * contorna, o primeiro ela não sabe que está lá.
 *
 * O foco volta para o `summary` no Esc porque é de onde ele saiu — devolver ao
 * `<body>` mandaria quem usa teclado percorrer a página inteira de novo.
 */
export function useDetalhesFechavel<T extends HTMLDetailsElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const no = ref.current;
    if (!no) return;

    const fechar = (devolverFoco: boolean) => {
      if (!no.open) return;
      no.open = false;
      if (devolverFoco) no.querySelector("summary")?.focus();
    };

    // No documento, e não no próprio `<details>`: a tecla precisa funcionar
    // mesmo com o foco num link de dentro do menu.
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar(true);
    };

    // `pointerdown` e não `click`: o clique num link de dentro navega, e
    // esperar o `click` deixaria o menu aberto por cima da tela nova.
    const aoApontar = (e: PointerEvent) => {
      if (e.target instanceof Node && !no.contains(e.target)) fechar(false);
    };

    document.addEventListener("keydown", aoTeclar);
    document.addEventListener("pointerdown", aoApontar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.removeEventListener("pointerdown", aoApontar);
    };
  }, []);

  return ref;
}
