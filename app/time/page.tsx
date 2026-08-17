import { TimeApp } from "@/components/time/TimeApp";
import { schemaTimeDisponivel } from "@/lib/financeiro/time";

export const metadata = { title: "Meus envios — XPE" };

export const dynamic = "force-dynamic";

export default async function TimeInicioPage() {
  // A disponibilidade é resolvida no SERVIDOR e passada pronta: o cliente
  // perguntando "existe schema?" mostraria a tela quebrada por um instante
  // antes de descobrir que não existe.
  const disponivel = await schemaTimeDisponivel();

  return (
    <>
      <div className="page-header">
        <h1>O que você precisa mandar para o financeiro</h1>
        <p>Reembolso, custo, nota e pedido de compra — os quatro caminhos que o time tem para dentro do financeiro, sem ver nada do que não é seu.</p>
      </div>
      <TimeApp
        aba="inicio"
        disponivel={disponivel}
        motivo={disponivel ? null : "a migration 0105 ainda não foi aplicada neste banco"}
      />
    </>
  );
}
