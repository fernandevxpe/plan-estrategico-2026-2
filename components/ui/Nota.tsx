"use client";

import { useState, type ReactNode } from "react";

/**
 * Nota técnica sob demanda — nasce fechada.
 *
 * A auditoria da plataforma achou o mesmo padrão repetido em Caixa, Custos,
 * Pessoas e Modelo: um parágrafo de regra estável (fórmula, cláusula,
 * definição) plantado sempre aberto entre os dados, competindo por atenção
 * com o número que a pessoa veio ver. `PorQue` (`FinLedgerTable.tsx`) já
 * tinha resolvido isso uma vez, só que específico para categorização — esta
 * é a versão genérica, para qualquer tela usar.
 *
 * Regra de uso: texto que MUDA a cada carregamento (uma ressalva sobre o
 * dado de hoje) continua em `Ressalva`, sempre visível — é sinal, não regra
 * estável. Texto que é sempre a mesma explicação (como uma fórmula é
 * calculada) vira `Nota`.
 */
export function Nota({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  const [aberta, setAberta] = useState(false);

  return (
    <div className="nota">
      <button
        type="button"
        className="nota-gatilho"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
      >
        <span className="nota-icone" aria-hidden="true">
          {aberta ? "–" : "+"}
        </span>
        {rotulo}
      </button>
      {aberta && <div className="nota-corpo">{children}</div>}
    </div>
  );
}
