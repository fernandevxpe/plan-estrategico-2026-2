import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "Comprar — XPE" };
export const dynamic = "force-dynamic";

export default async function ComprarPage() {
  const { disponivel, motivo } = await estadoDoTime();
  return (
    <>
      <div className="page-header">
        <h1>Comprar</h1>
        <p>O que foi aprovado e ainda não foi comprado. Comprou? Registre aqui o que gastou de verdade.</p>
      </div>
      <TimeApp aba="comprar" disponivel={disponivel} motivo={motivo} />
    </>
  );
}
