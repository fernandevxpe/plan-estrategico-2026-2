import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "Meus Reembolsos — XPE" };

export const dynamic = "force-dynamic";

export default async function TimeReembolsosPage() {
  const { disponivel, motivo } = await estadoDoTime();

  return <TimeApp aba="reembolsos" disponivel={disponivel} motivo={motivo} />;
}
