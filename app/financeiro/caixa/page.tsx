import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinCaixa } from "@/components/financeiro/FinCaixa";
import { getCaixa } from "@/lib/financeiro/contratos/caixa";

export const metadata = {
  title: "Caixa e empréstimo — Financeiro XPE"
};

// Ninguém decide pagamento em cima de saldo em cache. Mesma regra do módulo.
export const dynamic = "force-dynamic";

/**
 * POR QUE UMA TELA NOVA E NÃO UMA ABA EM /financeiro/contas
 *
 * `/financeiro/contas` é "contas a pagar e a receber" — obrigação, não banco.
 * A palavra "conta" carrega os dois sentidos em português, e é exatamente por
 * isso que juntá-los seria ruim: numa tela chamada "Contas" com uma aba
 * "Caixa", "R$ 119.613,47" fica ao lado de "R$ 334.498,66 a receber" sem que
 * nada diga que um é dinheiro que existe e o outro é promessa.
 *
 * O caixa por conta bancária tem outro dono de pergunta ("quanto eu tenho
 * agora, e onde") e outra cadência (extrato, não vencimento). Fica separado.
 */
export default async function CaixaPage() {
  const contrato = await getCaixa();

  return (
    <AppShell>
      <div className="page-header">
        <h1>Caixa e empréstimo</h1>
        <p>
          Quanto a empresa tem, em que conta, e como isso andou no tempo — e, ao lado e nunca
          somado, quanto ela deve à CAIXA pelo Pronampe. Conta sem extrato aparece como
          indeterminada; dívida aparece como passivo.
        </p>
      </div>
      <FinShell>
        {contrato.disponivel ? (
          <FinCaixa dado={contrato.dado} ressalvas={contrato.ressalvas} />
        ) : (
          <p className="fin-card-hint">
            O módulo financeiro não respondeu neste ambiente. A tela prefere dizer isso a mostrar
            zeros.
          </p>
        )}
      </FinShell>
    </AppShell>
  );
}
