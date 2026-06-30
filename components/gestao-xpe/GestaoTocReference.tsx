"use client";

import { BookOpen } from "lucide-react";
import type { GestaoDashboard } from "@/lib/gestao-xpe/types";

type Props = {
  toc: GestaoDashboard["toc"];
};

export function GestaoTocReference({ toc }: Props) {
  return (
    <div className="gestao-toc card">
      <div className="gestao-toc-header">
        <BookOpen size={20} />
        <h2>Referência TOC</h2>
      </div>

      <div className="gestao-toc-block">
        <h3>5 passos da TOC</h3>
        <ol className="gestao-toc-steps">
          {toc.passos.map((passo) => (
            <li key={passo.numero} className="gestao-toc-step">
              <span className="gestao-toc-step-num">{passo.numero}</span>
              <div>
                <strong>{passo.titulo}</strong>
                <p>{passo.descricao}</p>
                {passo.perguntas?.length ? (
                  <ul className="gestao-list compact">
                    {passo.perguntas.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ) : null}
                {passo.exemplos?.length ? (
                  <ul className="gestao-list compact gestao-examples">
                    {passo.exemplos.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="gestao-toc-block">
        <h3>10 regras estratégicas</h3>
        <ol className="gestao-rules-list">
          {toc.regras.map((regra) => (
            <li key={regra}>{regra}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
