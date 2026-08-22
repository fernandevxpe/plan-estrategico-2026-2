import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "Custo — XPE" };

export const dynamic = "force-dynamic";

export default async function TimeCustoPage() {
  // A disponibilidade é resolvida no SERVIDOR e passada pronta: o cliente
  // perguntando "existe schema?" mostraria a tela quebrada por um instante
  // antes de descobrir que não existe.
  const { disponivel, motivo } = await estadoDoTime();

  return (
    <>
      <div className="page-header">
        <h1>Lançar um custo</h1>
        <p>Uma despesa que a empresa pagou ou vai pagar. Vira pedido aguardando decisão — não vira lançamento nem mexe em saldo.</p>
      </div>
      <TimeApp
        aba="custo"
        disponivel={disponivel}
        motivo={motivo}
      />
    </>
  );
}
