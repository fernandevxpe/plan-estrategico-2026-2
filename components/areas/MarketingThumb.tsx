"use client";

import { useState } from "react";

/**
 * Miniatura de criativo do Meta.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO EXISTE
 * ---------------------------------------------------------------------------
 * As URLs de imagem que a Graph API devolve são ASSINADAS e expiram. Medido em
 * 16/08/2026: as 13 imagens dos 12 anúncios ativos do acervo de 11/08 voltavam
 * `403 · "URL signature expired"`, com a expiração carimbada na própria URL
 * (`oe=`) para as 04:19 UTC daquele dia.
 *
 * O `src` continua sendo uma string não-nula, então o teste `thumbnailUrl ?
 * <img> : <placeholder>` passa reto e o navegador desenha o ícone de imagem
 * quebrada. Ou seja: a tela não erra por falta de dado, erra por dado que
 * caducou — e mostra isso como defeito, não como informação.
 *
 * Aqui a falha vira frase. Quem olhar sabe que o criativo existe e que o que
 * venceu foi o link para ele, o que aponta para a sincronização, não para o
 * anúncio.
 * ---------------------------------------------------------------------------
 */
export function MarketingThumb({
  url,
  alt = "",
  vazio = "Sem miniatura"
}: {
  url: string | null | undefined;
  alt?: string;
  /** Texto de quando nunca houve URL — diferente de URL que expirou. */
  vazio?: string;
}) {
  const [falhou, setFalhou] = useState(false);

  if (!url) return <div className="marketing-creative-placeholder">{vazio}</div>;

  if (falhou) {
    return (
      <div
        className="marketing-creative-placeholder is-expirada"
        title="A Meta assina as URLs de imagem com prazo. Esta venceu: o criativo existe, o endereço dele é que caducou. Uma sincronização nova traz o endereço válido."
      >
        Miniatura expirada
      </div>
    );
  }

  return <img src={url} alt={alt} loading="lazy" onError={() => setFalhou(true)} />;
}
