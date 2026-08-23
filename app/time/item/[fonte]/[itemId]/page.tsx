import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "Item — XPE" };

export const dynamic = "force-dynamic";

export default async function TimeItemPage({
  params
}: {
  params: Promise<{ fonte: string; itemId: string }>;
}) {
  const { disponivel, motivo } = await estadoDoTime();
  const { fonte, itemId } = await params;
  const id = Number(itemId);

  return (
    <TimeApp
      aba="item"
      disponivel={disponivel}
      motivo={motivo}
      itemFonte={fonte === "planilha" || fonte === "app" ? fonte : undefined}
      itemId={Number.isFinite(id) ? id : undefined}
    />
  );
}
