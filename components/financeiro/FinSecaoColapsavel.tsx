"use client";

import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

type Props = {
  titulo: string;
  /** Linha sob o título — útil quando está fechado (resumo). */
  meta?: ReactNode;
  abertoPadrao?: boolean;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
};

/**
 * Card com título clicável que esconde o miolo.
 * A tela de pessoas fica longa; o padrão é começar fechado e abrir o que importa.
 */
export function FinSecaoColapsavel({
  titulo,
  meta,
  abertoPadrao = false,
  className = "",
  ariaLabel,
  children
}: Props) {
  const [aberto, setAberto] = useState(abertoPadrao);

  return (
    <section
      className={`card fin-secao-colapsavel${aberto ? " aberta" : ""}${className ? ` ${className}` : ""}`}
      aria-label={ariaLabel ?? titulo}
    >
      <button
        type="button"
        className="fin-secao-colapsavel-cab"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
      >
        <span className="fin-secao-colapsavel-titulos">
          <span className="card-title">{titulo}</span>
          {meta ? <span className="fin-secao-colapsavel-meta">{meta}</span> : null}
        </span>
        <ChevronRight
          size={16}
          strokeWidth={2.2}
          className={aberto ? "fin-chevron-aberto" : undefined}
          aria-hidden
        />
      </button>
      {aberto ? <div className="fin-secao-colapsavel-corpo">{children}</div> : null}
    </section>
  );
}
