import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinModelo } from "@/components/financeiro/FinModelo";
import { FinModeloResumo } from "@/components/financeiro/FinModeloResumo";
import { carregarModelo } from "@/lib/financeiro/modelo";

export const metadata = {
  title: "Modelo de gestão — Financeiro XPE"
};

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ ano?: string }> };

export default async function ModeloPage({ searchParams }: Props) {
  const { ano } = await searchParams;
  const anoAlvo = Number(ano) >= 2000 && Number(ano) <= 2100 ? Number(ano) : new Date().getFullYear();
  const dados = await carregarModelo(anoAlvo);

  return (
    <AppShell>
      <div className="page-header">
        <h1>Modelo de gestão · {anoAlvo}</h1>
        <p>
          A aba "Fluxo de Caixa" da planilha, alimentada pelo extrato em vez de digitação. Cada linha diz de onde
          vem seu número, e o modo <em>Comparar</em> põe o que o banco prova ao lado do que a planilha afirma —
          divergência por célula, sem escolher um lado por você.
        </p>
      </div>
      <FinShell>
        {dados ? (
          <>
            <FinModeloResumo dados={dados} />
            <FinModelo dados={dados} />
          </>
        ) : (
          <p className="fin-alert">
            Banco do financeiro indisponível. As telas do módulo leem PostgreSQL em tempo de request; sem{" "}
            <code className="fin-code">FINANCE_DATABASE_URL</code> não há o que mostrar.
          </p>
        )}
      </FinShell>
    </AppShell>
  );
}
