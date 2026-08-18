import type { ReactNode } from "react";

type Acento = "neutro" | "purple" | "green" | "pink";

/**
 * O card de KPI canônico — a auditoria da plataforma achou 15 variações
 * diferentes deste mesmo componente (`.comercial-kpi`, `.escala-kpi-card`,
 * `.fin-kpi-card`, `.gestao-kpi-executive`, `.mix-kpi-grid`...), cada área
 * reinventando do zero. Este não substitui as 15 de uma vez — telas
 * existentes continuam como estão até passarem por revisão — mas é o que
 * qualquer tela NOVA, ou tela em revisão, deve usar.
 *
 * `acento` pinta só o traço lateral e o número, nunca o texto ao redor —
 * o glow neon é para UM dado por vez, não para a tela inteira.
 */
export function KpiCard({
  rotulo,
  valor,
  detalhe,
  acento = "neutro",
  brilho = false
}: {
  rotulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
  acento?: Acento;
  /** Glow sutil no valor — reservado para O número que a tela existe para mostrar. */
  brilho?: boolean;
}) {
  return (
    <div className={`kpi-card kpi-acento-${acento}`}>
      <span className="kpi-rotulo">{rotulo}</span>
      <span className={`kpi-valor${brilho ? " kpi-brilho" : ""}`}>{valor}</span>
      {detalhe ? <span className="kpi-detalhe">{detalhe}</span> : null}
    </div>
  );
}
