import { TimeApp } from "@/components/time/TimeApp";
import { estadoDoTime } from "@/lib/financeiro/time";

export const metadata = { title: "Meu perfil — XPE" };
export const dynamic = "force-dynamic";

export default async function TimePerfilPage() {
  const { disponivel, motivo } = await estadoDoTime();
  return <TimeApp aba="perfil" disponivel={disponivel} motivo={motivo} />;
}
