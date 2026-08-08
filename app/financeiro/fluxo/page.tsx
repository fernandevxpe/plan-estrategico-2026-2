import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinForecastView } from "@/components/financeiro/FinForecastView";
import { getPrevisaoFluxo } from "@/lib/financeiro/forecast";

export const metadata = {
  title: "Fluxo de caixa — Financeiro XPE"
};

// Saldo em cache é pior que saldo lento: uma pessoa decide pagamento em cima
// deste número. Mesma regra das outras rotas do módulo.
export const dynamic = "force-dynamic";

export default async function FluxoPage() {
  const dados = await getPrevisaoFluxo();

  return (
    <AppShell>
      <div className="page-header">
        <h1>Fluxo de caixa</h1>
        <p>
          Previsão em camadas separadas: saldo, contratado a receber (ajustado pela curva de recuperação), recorrência
          e saídas. Hoje só o lado da entrada existe no banco — a tela diz onde a projeção é teto, não previsão.
        </p>
      </div>
      <FinShell>
        <FinForecastView dados={dados} />
      </FinShell>
    </AppShell>
  );
}
