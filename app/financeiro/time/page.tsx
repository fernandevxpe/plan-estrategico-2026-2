import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinTimeFila } from "@/components/financeiro/FinTimeFila";

export const metadata = { title: "Fila do time — Financeiro XPE" };

/**
 * Sob `/financeiro` de propósito — é o prefixo que `lib/auth/perfis.ts` marca
 * como só-admin. Decidir sobre o envio de outra pessoa é exatamente o que o
 * time não pode fazer, então a página nasce protegida por estar onde está.
 */
export const dynamic = "force-dynamic";

export default function FinanceiroTimePage() {
  return (
    <AppShell>
      <div className="page-header">
        <h1>Fila do time</h1>
        <p>
          O que o time mandou pelo aplicativo: reembolso, custo, nota de entrada e pedido de compra — com o link, o
          comprovante e a força da identidade de quem enviou.
        </p>
      </div>
      <FinShell>
        <FinTimeFila />
      </FinShell>
    </AppShell>
  );
}
