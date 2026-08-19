import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinReconciliacao } from "@/components/financeiro/FinReconciliacao";
import { getReconciliacao } from "@/lib/financeiro/contratos/reconciliacao";

export const metadata = { title: "Reconciliação — Financeiro XPE" };
export const dynamic = "force-dynamic";

/**
 * Sistema × referência externa — a resposta a "o que está diferente, e por quê".
 *
 * O Fernando trouxe uma planilha de gestão; uma comparação manual achou 3
 * categorias batendo ao centavo e um bloco maior ("Consultorias com Base em
 * Economia") só parcialmente explicado. Esta tela é onde esse trabalho vira
 * rotina: salvar o valor que a referência esperava, ver a diferença viva
 * (recalcula sozinha se alguém reclassificar um lançamento), e marcar o
 * veredito — porque a referência externa também pode estar errada.
 */
export default async function ReconciliacaoPage() {
  const anoAtual = new Date().getFullYear();
  const reconciliacao = await getReconciliacao({ de: `${anoAtual}-01`, ate: `${anoAtual}-12` });

  return (
    <AppShell>
      <div className="page-header">
        <h1>Reconciliação</h1>
        <p>
          O sistema contra um número que veio de fora — planilha, relatório de terceiro. Maior diferença
          primeiro. Marque o veredito quando revisar: pode ser o sistema que está incompleto, ou a
          referência que está errada.
        </p>
      </div>
      <FinShell>
        <FinReconciliacao dados={reconciliacao.dado} disponivel={reconciliacao.disponivel} ressalvas={reconciliacao.ressalvas} />
      </FinShell>
    </AppShell>
  );
}
