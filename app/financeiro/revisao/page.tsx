import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinReviewQueue } from "@/components/financeiro/FinReviewQueue";
import { getFilaRevisao, getOpcoesClassificacao } from "@/lib/financeiro/revisao";

export const metadata = {
  title: "Revisão — Financeiro XPE"
};

export const dynamic = "force-dynamic";

export default async function RevisaoPage() {
  const [fila, opcoes] = await Promise.all([getFilaRevisao(), getOpcoesClassificacao()]);

  return (
    <AppShell>
      <div className="page-header">
        <h1>Revisão</h1>
        <p>
          O que o motor de regras não conseguiu decidir sozinho. Cada decisão aqui trava a coluna contra o sync
          noturno e vira histórico — a próxima cobrança parecida já chega classificada.
        </p>
      </div>
      <FinShell>
        <FinReviewQueue fila={fila} opcoes={opcoes} />
      </FinShell>
    </AppShell>
  );
}
