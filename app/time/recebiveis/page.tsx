import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "Recebíveis — XPE" };
export const dynamic = "force-dynamic";

export default async function RecebiveisPage() {
  const { disponivel, motivo } = await estadoDoTime();
  return <TimeApp aba="recebiveis" disponivel={disponivel} motivo={motivo} />;
}
