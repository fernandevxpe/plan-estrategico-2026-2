"use client";

/**
 * Casco do app do time.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO HÁ MAIS BARRA INFERIOR
 * ---------------------------------------------------------------------------
 * Existiu barra de cinco destinos (Recebíveis, Registrar, Início, Reembolso,
 * Histórico) porque o polegar alcança embaixo e o app é usado com uma mão,
 * na rua, com a outra segurando a nota. Antes disso foram sete abas no topo
 * — 210px de menu numa tela de 852px.
 *
 * A barra saiu quando o Início passou a ser o índice completo: as mesmas
 * portas + Minhas compras + pendências. Volta ao hub pelo cabeçalho
 * (casa + “Início”) em qualquer tela que não seja o próprio Início.
 *
 * Pedir compra continua no topo: `fin_purchase_request` teve zero linhas
 * enquanto ocupava 20% da barra — ação rara não compete por pixel fixo.
 */
export function TimeShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="time-shell">
      <div className="time-conteudo">{children}</div>
    </div>
  );
}
