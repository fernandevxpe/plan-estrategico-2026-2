import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "Minhas compras — XPE" };
export const dynamic = "force-dynamic";

export default async function TimeComprasPage() {
  const { disponivel, motivo } = await estadoDoTime();
  return <TimeApp aba="compras" disponivel={disponivel} motivo={motivo} />;
}
