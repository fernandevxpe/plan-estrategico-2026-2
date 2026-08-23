import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "Solicitar compra — XPE" };

export const dynamic = "force-dynamic";

export default async function TimeCompraPage() {
  const { disponivel, motivo } = await estadoDoTime();

  return <TimeApp aba="compra" disponivel={disponivel} motivo={motivo} />;
}
