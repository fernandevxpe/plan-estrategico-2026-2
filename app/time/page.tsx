import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "XPE Time" };

export const dynamic = "force-dynamic";

export default async function TimeInicioPage() {
  // A disponibilidade é resolvida no SERVIDOR e passada pronta: o cliente
  // perguntando "existe schema?" mostraria a tela quebrada por um instante
  // antes de descobrir que não existe.
  const { disponivel, motivo } = await estadoDoTime();

  return (
    <TimeApp
      aba="inicio"
      disponivel={disponivel}
      motivo={motivo}
    />
  );
}
