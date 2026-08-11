import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinQualificar } from "@/components/financeiro/FinQualificar";
import { getFilaQualificacao } from "@/lib/financeiro/qualificar";

export const metadata = { title: "Qualificar — Financeiro XPE" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ ano?: string }> };

export default async function QualificarPage({ searchParams }: Props) {
  const { ano } = await searchParams;
  const anoAlvo = Number(ano) >= 2000 && Number(ano) <= 2100 ? Number(ano) : new Date().getFullYear();
  const fila = await getFilaQualificacao(anoAlvo);

  return (
    <AppShell>
      <div className="page-header">
        <h1>Qualificar · {anoAlvo}</h1>
        <p>
          O que ainda não tem categoria, agrupado pelo que o torna decidível junto — mesma contraparte, mesma
          descrição, mesmo padrão. Do mais recente para o mais antigo. Cada sugestão mostra a evidência que a
          sustenta, para você poder discordar com fundamento.
        </p>
      </div>
      <FinShell>
        {fila.disponivel ? (
          <FinQualificar fila={fila} />
        ) : (
          <p className="fin-alert">Banco do financeiro indisponível.</p>
        )}
      </FinShell>
    </AppShell>
  );
}
