import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

// "Histórico", como o H1 e como a aba. O título é o que aparece no alternador
// de apps do celular — um terceiro nome ali é a pessoa não achando a tela que
// deixou aberta.
export const metadata = { title: "Histórico — XPE" };

export const dynamic = "force-dynamic";

export default async function TimeEnviosPage() {
  const { disponivel, motivo } = await estadoDoTime();

  return <TimeApp aba="envios" disponivel={disponivel} motivo={motivo} />;
}
