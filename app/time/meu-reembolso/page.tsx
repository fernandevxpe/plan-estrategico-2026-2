import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "Meu reembolso — XPE" };
export const dynamic = "force-dynamic";

export default async function MeuReembolsoPage() {
  const { disponivel, motivo } = await estadoDoTime();
  return (
    <>
      <div className="page-header">
        <h1>Meu reembolso</h1>
        <p>Quanto a empresa ainda te deve, quando cai, e o que já foi pago. Só o seu.</p>
      </div>
      <TimeApp aba="meu-reembolso" disponivel={disponivel} motivo={motivo} />
    </>
  );
}
