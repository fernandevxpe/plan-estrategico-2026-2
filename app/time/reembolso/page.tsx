import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "Reembolso — XPE" };

export const dynamic = "force-dynamic";

export default async function TimeReembolsoPage() {
  // A disponibilidade é resolvida no SERVIDOR e passada pronta: o cliente
  // perguntando "existe schema?" mostraria a tela quebrada por um instante
  // antes de descobrir que não existe.
  const { disponivel, motivo } = await estadoDoTime();

  return (
    <>
      <div className="page-header">
        <h1>Pedir reembolso</h1>
        <p>O que você pagou do bolso, com o comprovante. É o anexo que faz aprovar deixar de ser confiar num número digitado.</p>
      </div>
      <TimeApp
        aba="reembolso"
        disponivel={disponivel}
        motivo={motivo}
      />
    </>
  );
}
