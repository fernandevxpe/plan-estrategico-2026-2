import { TimeApp } from "@/components/time/TimeApp";
import { schemaTimeDisponivel } from "@/lib/financeiro/time";

export const metadata = { title: "Compra — XPE" };

export const dynamic = "force-dynamic";

export default async function TimeCompraPage() {
  // A disponibilidade é resolvida no SERVIDOR e passada pronta: o cliente
  // perguntando "existe schema?" mostraria a tela quebrada por um instante
  // antes de descobrir que não existe.
  const disponivel = await schemaTimeDisponivel();

  return (
    <>
      <div className="page-header">
        <h1>Pedir uma compra</h1>
        <p>Com o link do que precisa ser comprado — vários, se você achou em mais de um lugar. É o que transforma um pedido em cotação.</p>
      </div>
      <TimeApp
        aba="compra"
        disponivel={disponivel}
        motivo={disponivel ? null : "a migration 0105 ainda não foi aplicada neste banco"}
      />
    </>
  );
}
