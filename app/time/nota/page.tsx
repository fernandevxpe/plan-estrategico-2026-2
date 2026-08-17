import { TimeApp } from "@/components/time/TimeApp";
import { schemaTimeDisponivel } from "@/lib/financeiro/time";

export const metadata = { title: "Nota — XPE" };

export const dynamic = "force-dynamic";

export default async function TimeNotaPage() {
  // A disponibilidade é resolvida no SERVIDOR e passada pronta: o cliente
  // perguntando "existe schema?" mostraria a tela quebrada por um instante
  // antes de descobrir que não existe.
  const disponivel = await schemaTimeDisponivel();

  return (
    <>
      <div className="page-header">
        <h1>Enviar uma nota</h1>
        <p>Nota fiscal que chegou para a empresa. Hoje a base só conhece nota de saída; a de entrada não tem por onde chegar, e este é o caminho.</p>
      </div>
      <TimeApp
        aba="nota"
        disponivel={disponivel}
        motivo={disponivel ? null : "a migration 0105 ainda não foi aplicada neste banco"}
      />
    </>
  );
}
