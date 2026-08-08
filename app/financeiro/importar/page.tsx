import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinImportWizard } from "@/components/financeiro/FinImportWizard";
import { getContasImportaveis, listarLotes } from "@/lib/financeiro/importacao";

export const metadata = {
  title: "Importar extrato — Financeiro XPE"
};

export const dynamic = "force-dynamic";

export default async function ImportarPage() {
  const [contas, lotes] = await Promise.all([getContasImportaveis(), listarLotes()]);

  return (
    <AppShell>
      <div className="page-header">
        <h1>Importar extrato</h1>
        <p>
          Nubank, Inter e Caixa entram por arquivo — o Asaas atualiza sozinho pela API. É esta tela que fecha o buraco
          da despesa: hoje o ledger tem toda a receita e nenhum custo.
        </p>
      </div>
      <FinShell>
        <FinImportWizard contas={contas} lotes={lotes} />
      </FinShell>
    </AppShell>
  );
}
