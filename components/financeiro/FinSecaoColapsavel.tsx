"use client";

import { ChevronRight, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

type Props = {
  titulo: string;
  icone?: LucideIcon;
  /** Linha sob o título — útil quando está fechado (resumo). */
  meta?: ReactNode;
  /** Campo à direita do título (busca). Não fecha a seção ao clicar. */
  cabExtra?: ReactNode;
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
  icone: Icone,
  meta,
  cabExtra,
  abertoPadrao = false,
  className = "",
  ariaLabel,
  children
}: Props) {
  const [aberto, setAberto] = useState(abertoPadrao);

  return (
    <section
      className={`card fin-secao-colapsavel${aberto ? " aberta" : ""}${className ? ` ${className}` : ""}${cabExtra ? " com-extra" : ""}`}
      aria-label={ariaLabel ?? titulo}
    >
      <div className="fin-secao-colapsavel-cab">
        <button
          type="button"
          className="fin-secao-colapsavel-toggle"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
        >
          <span className="fin-secao-colapsavel-lado">
            {Icone ? (
              <span className="fin-secao-colapsavel-icone" aria-hidden>
                <Icone size={16} strokeWidth={2.1} />
              </span>
            ) : null}
            <span className="fin-secao-colapsavel-titulos">
              <span className="card-title">{titulo}</span>
              {meta ? <span className="fin-secao-colapsavel-meta">{meta}</span> : null}
            </span>
          </span>
          {cabExtra ? null : (
            <ChevronRight
              size={16}
              strokeWidth={2.2}
              className={aberto ? "fin-chevron-aberto" : undefined}
              aria-hidden
            />
          )}
        </button>
        {cabExtra ? <div className="fin-secao-colapsavel-extra">{cabExtra}</div> : null}
        {cabExtra ? (
          <button
            type="button"
            className="fin-secao-colapsavel-chevron"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            aria-label={aberto ? "Recolher seção" : "Abrir seção"}
          >
            <ChevronRight
              size={16}
              strokeWidth={2.2}
              className={aberto ? "fin-chevron-aberto" : undefined}
              aria-hidden
            />
          </button>
        ) : null}
      </div>
      {aberto ? <div className="fin-secao-colapsavel-corpo">{children}</div> : null}
    </section>
  );
}
