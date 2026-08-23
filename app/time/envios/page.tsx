import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "Meus envios — XPE" };

export const dynamic = "force-dynamic";

export default async function TimeEnviosPage() {
  const { disponivel, motivo } = await estadoDoTime();

  return <TimeApp aba="envios" disponivel={disponivel} motivo={motivo} />;
}
