import { TimeApp } from "@/components/time/TimeApp";
import { schemaTimeDisponivel } from "@/lib/financeiro/time";

export const metadata = { title: "Meus envios — XPE" };

export const dynamic = "force-dynamic";

export default async function TimeEnviosPage() {
  // A disponibilidade é resolvida no SERVIDOR e passada pronta: o cliente
  // perguntando "existe schema?" mostraria a tela quebrada por um instante
  // antes de descobrir que não existe.
  const disponivel = await schemaTimeDisponivel();

  return (
    <>
      <div className="page-header">
        <h1>O que eu enviei</h1>
        <p>Tudo que você mandou, o que foi aprovado, o que voltou e por quê. Só o que é seu.</p>
      </div>
      <TimeApp
        aba="envios"
        disponivel={disponivel}
        motivo={disponivel ? null : "a migration 0105 ainda não foi aplicada neste banco"}
      />
    </>
  );
}
