import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "Minhas Comissões — XPE" };

export const dynamic = "force-dynamic";

export default async function TimeComissoesPage() {
  const { disponivel, motivo } = await estadoDoTime();

  return <TimeApp aba="comissoes" disponivel={disponivel} motivo={motivo} />;
}
