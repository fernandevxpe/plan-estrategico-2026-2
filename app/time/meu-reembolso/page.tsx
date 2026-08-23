import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "Meu reembolso — XPE" };
export const dynamic = "force-dynamic";

export default async function MeuReembolsoPage() {
  const { disponivel, motivo } = await estadoDoTime();
  return <TimeApp aba="meu-reembolso" disponivel={disponivel} motivo={motivo} />;
}
