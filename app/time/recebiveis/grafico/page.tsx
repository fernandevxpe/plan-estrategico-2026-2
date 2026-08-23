import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "Mês a mês — XPE" };
export const dynamic = "force-dynamic";

export default async function RecebiveisGraficoPage() {
  const { disponivel, motivo } = await estadoDoTime();
  return <TimeApp aba="recebiveis-grafico" disponivel={disponivel} motivo={motivo} />;
}
