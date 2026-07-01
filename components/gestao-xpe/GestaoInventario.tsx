"use client";

import type { GestaoInventario } from "@/lib/gestao-xpe/types";

type Props = {
  inventario: GestaoInventario;
};

function cell(value: string | null) {
  return value?.trim() || "—";
}

export function GestaoInventarioSection({ inventario }: Props) {
  return (
    <div className="gestao-inventory">
      <div className="section-title subsection-title">
        <h2>Inventário</h2>
        <p>{inventario.descricao}</p>
      </div>

      {inventario.categorias.map((categoria) => (
        <div className="card gestao-inventory-category" key={categoria.id}>
          <h3>{categoria.nome}</h3>
          <p className="gestao-muted">{categoria.descricao}</p>

          {categoria.itens.length === 0 ? (
            <p className="gestao-muted gestao-inventory-empty">Itens a mapear nesta categoria.</p>
          ) : (
            <div className="gestao-table-wrap">
              <table className="gestao-table gestao-inventory-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Capacidade atual</th>
                    <th>Potencial</th>
                    <th>Utilização</th>
                    <th>Retorno</th>
                    <th>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {categoria.itens.map((item) => (
                    <tr key={item.id}>
                      <td>{item.nome}</td>
                      <td>{cell(item.capacidadeAtual)}</td>
                      <td>{cell(item.potencial)}</td>
                      <td>{cell(item.utilizacao)}</td>
                      <td>{cell(item.retorno)}</td>
                      <td>{item.observacao.trim() || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
