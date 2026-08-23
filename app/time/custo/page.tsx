import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "Registrar compra — XPE" };

export const dynamic = "force-dynamic";

export default async function TimeCustoPage() {
  const { disponivel, motivo } = await estadoDoTime();

  return <TimeApp aba="custo" disponivel={disponivel} motivo={motivo} />;
}
