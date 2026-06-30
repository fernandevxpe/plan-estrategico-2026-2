"use client";

import type { GestaoEstoqueInvisivel } from "@/lib/gestao-xpe/types";

type Props = {
  estoques: GestaoEstoqueInvisivel[];
};

function cell(value: string | null) {
  return value?.trim() || "—";
}

export function GestaoInvisibleInventory({ estoques }: Props) {
  return (
    <div className="gestao-inventory">
      <div className="section-title subsection-title">
        <h2>Estoques invisíveis</h2>
        <p>Trabalho parado, dados faltantes e pendências que consomem capacidade sem gerar throughput.</p>
      </div>

      <div className="card gestao-table-wrap">
        <table className="gestao-table gestao-inventory-table">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Área</th>
              <th>Quantidade</th>
              <th>Impacto</th>
              <th>Responsável</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {estoques.map((item) => (
              <tr key={item.id}>
                <td>{item.tipo}</td>
                <td>{item.area}</td>
                <td>{cell(item.quantidade)}</td>
                <td>{cell(item.impacto)}</td>
                <td>{item.responsavel.trim() || "—"}</td>
                <td>{item.acao.trim() || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
