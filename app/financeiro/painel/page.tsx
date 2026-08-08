import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinExecutivePanel } from "@/components/financeiro/FinExecutivePanel";
import { getPainelExecutivo } from "@/lib/financeiro/painel";

export const metadata = {
  title: "Painel executivo — Financeiro XPE"
};

/**
 * Como o resto do módulo, lê o PostgreSQL em tempo de request.
 *
 * `force-dynamic` aqui não é sobre saldo: é sobre o TÍTULO dos gráficos. Eles
 * são derivados do dado ("Receita cresceu 137%…"), então uma página em cache
 * afirmaria com todas as letras um crescimento que já mudou. Título derivado e
 * cache são incompatíveis por construção.
 */
export const dynamic = "force-dynamic";

export default async function PainelPage() {
  const dados = await getPainelExecutivo();

  return (
    <AppShell>
      <div className="page-header">
        <h1>Painel executivo</h1>
        <p>
          O briefing de quem decide: leitura do mês em português, quatro números com comparação, quatro gráficos que
          já dizem a conclusão no título, os riscos com a ação ao lado — e, no fim, o que este painel ainda não sabe.
          Linguagem de Throughput (doc 17), não de contabilidade rateada.
        </p>
      </div>
      <FinShell>
        <FinExecutivePanel dados={dados} />
      </FinShell>
    </AppShell>
  );
}
