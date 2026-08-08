import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinOverview } from "@/components/financeiro/FinOverview";
import { getVisaoGeral } from "@/lib/financeiro/queries";

export const metadata = {
  title: "Financeiro — XPE"
};

/**
 * Diferente do resto da plataforma, esta rota lê o PostgreSQL em tempo de
 * request em vez de ler artefatos do volume. É a consequência de o financeiro
 * ter escrita do usuário, conciliação e correção retroativa.
 *
 * `dynamic = "force-dynamic"` porque saldo em cache é pior que saldo lento: uma
 * pessoa decide pagamento em cima deste número.
 */
export const dynamic = "force-dynamic";

export default async function FinanceiroPage() {
  const dados = await getVisaoGeral();

  return (
    <AppShell>
      <div className="page-header">
        <h1>Financeiro</h1>
        <p>
          Caixa, receita, carteira e confiabilidade do dado. Hoje alimentado pelo Asaas — 100% da receita e nenhuma
          despesa, até os extratos dos outros bancos entrarem.
        </p>
      </div>
      <FinShell>
        <FinOverview dados={dados} />
      </FinShell>
    </AppShell>
  );
}
