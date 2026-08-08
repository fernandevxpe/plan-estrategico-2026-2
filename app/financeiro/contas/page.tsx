import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinPayables } from "@/components/financeiro/FinPayables";
import { getContas, direcaoValida } from "@/lib/financeiro/contas";

export const metadata = {
  title: "Contas a pagar e a receber — Financeiro XPE"
};

// Ninguém decide pagamento em cima de número em cache. Mesma regra do resto do
// módulo.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ aba?: string }> };

export default async function ContasPage({ searchParams }: Props) {
  const { aba } = await searchParams;
  const direcao = direcaoValida(aba) ? aba : "pagar";

  // As duas direções carregam juntas porque a barra de abas mostra o total de
  // cada uma: uma aba que só sabe o próprio número obriga a clicar para
  // descobrir se vale a pena clicar.
  const [pagar, receber] = await Promise.all([
    getContas({ direcao: "pagar" }),
    getContas({ direcao: "receber" })
  ]);

  return (
    <AppShell>
      <div className="page-header">
        <h1>Contas a pagar e a receber</h1>
        <p>
          O que o extrato não conta. A cobrança a receber chega do Asaas sozinha; o pagamento a fazer só existe se
          alguém o registrar aqui — e registrá-lo ANTES de o dinheiro sair é o que transforma o fluxo de caixa em
          previsão em vez de retrato do passado.
        </p>
      </div>
      <FinShell>
        <FinPayables pagar={pagar} receber={receber} direcaoInicial={direcao} />
      </FinShell>
    </AppShell>
  );
}
