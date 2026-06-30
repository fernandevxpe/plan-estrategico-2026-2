"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import type { GestaoDashboard } from "@/lib/gestao-xpe/types";

type Props = {
  boletim: GestaoDashboard["boletim"];
};

export function GestaoWeeklyBulletin({ boletim }: Props) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(["resumo"]));

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="gestao-bulletin card">
      <div className="gestao-bulletin-header">
        <FileText size={20} />
        <div>
          <h2>Boletim semanal</h2>
          <p className="gestao-muted">
            Estrutura do template — preencher semanalmente via JSON ou futura geração automática.
          </p>
        </div>
      </div>

      <dl className="gestao-dl gestao-bulletin-meta">
        <div>
          <dt>Semana</dt>
          <dd>{boletim.semana.trim() || "—"}</dd>
        </div>
        <div>
          <dt>Responsável</dt>
          <dd>{boletim.responsavel.trim() || "—"}</dd>
        </div>
      </dl>

      <div className="gestao-bulletin-sections">
        {boletim.secoes.map((secao) => {
          const isOpen = openIds.has(secao.id);
          return (
            <div className="gestao-bulletin-section" key={secao.id}>
              <button
                type="button"
                className="gestao-bulletin-section-header"
                onClick={() => toggle(secao.id)}
                aria-expanded={isOpen}
              >
                <span>{secao.titulo}</span>
                {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              {isOpen ? (
                <ul className="gestao-list gestao-bulletin-items">
                  {secao.itens.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
