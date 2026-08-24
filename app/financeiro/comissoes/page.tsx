import { AppShell } from "@/components/layout/AppShell";
import { FinComissoes } from "@/components/financeiro/FinComissoes";
import { FinShell } from "@/components/financeiro/FinShell";
import { getPainelComissoes } from "@/lib/financeiro/comissoes";

export const metadata = {
  title: "Comissões — Financeiro XPE"
};

export const dynamic = "force-dynamic";

export default async function ComissoesPage() {
  const dados = await getPainelComissoes();

  return (
    <AppShell>
      <div className="page-header">
        <h1>Comissões</h1>
        <p>
          Variável declarado por pessoa e por mês — à vista ou parcelado, com descrição. Várias comissões no mesmo mês
          somam. É a mesma conta que o perfil usa para separar comissão do salário dentro do PIX.
        </p>
      </div>
      <FinShell>
        <FinComissoes dados={dados} />
      </FinShell>
    </AppShell>
  );
}
