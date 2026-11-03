import { AppShell } from "@/components/layout/AppShell";
import { FinComissoes } from "@/components/financeiro/FinComissoes";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinPagarPorPessoa } from "@/components/financeiro/FinPagarPorPessoa";
import { getPainelComissoes } from "@/lib/financeiro/comissoes";
import { getContasAPagar } from "@/lib/financeiro/contas-a-pagar";
import { monthKeyLabel } from "@/lib/financeiro/format";
import { linhasPagarPorPessoa } from "@/lib/financeiro/pagar-por-pessoa";

export const metadata = {
  title: "Comissões — Financeiro XPE"
};

export const dynamic = "force-dynamic";

export default async function ComissoesPage() {
  const [dados, contas] = await Promise.all([getPainelComissoes(), getContasAPagar()]);
  const mesPagamento = `${contas.competencia.slice(0, 7)}-01`;

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
        <section className="fin-card" style={{ marginBottom: 16 }}>
          <h2 className="fin-sub-titulo">Pagar comissões de {monthKeyLabel(mesPagamento)}</h2>
          <FinPagarPorPessoa
            linhas={linhasPagarPorPessoa(contas, "comissao")}
            mesPagamento={mesPagamento}
            hoje={contas.hoje}
            vazio={`Nenhuma comissão a pagar em ${monthKeyLabel(mesPagamento)}.`}
            cabecalho={
              <>
                Um PIX por pessoa e por tipo (consultoria, obras, diárias), com as comissões de competência{" "}
                {monthKeyLabel(mesPagamento)} — a comissão vale no mês em que é paga.
              </>
            }
          />
        </section>
        <FinComissoes dados={dados} />
      </FinShell>
    </AppShell>
  );
}
