import { AppShell } from "@/components/layout/AppShell";
import { FinAgenda } from "@/components/financeiro/FinAgenda";
import { FinShell } from "@/components/financeiro/FinShell";
import { getAgenda } from "@/lib/financeiro/contratos/agenda";

export const metadata = {
  title: "Agenda de obrigações — Financeiro XPE"
};

// Uma pessoa decide pagamento em cima destes números. Saldo em cache é pior que
// saldo lento — mesma regra das outras rotas do módulo.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * A agenda diária: contas a pagar e a receber, dia a dia, do passado ao futuro.
 *
 * A primeira carga vem do servidor com a janela padrão (30 dias atrás → 90 à
 * frente) para a tela nascer com conteúdo; a partir daí o componente busca a
 * própria janela conforme a pessoa navega. Renderizar vazio e buscar depois
 * mostraria um esqueleto onde deveria estar o mês, e "hoje" é justamente o que
 * a pessoa abre a tela para ver.
 */
export default async function AgendaPage() {
  const hoje = new Date();
  const desloca = (dias: number) => {
    const d = new Date(hoje);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  };

  const contrato = await getAgenda({ de: desloca(-30), ate: desloca(90), porPagina: 500 });

  return (
    <AppShell>
      <div className="page-header">
        <h1>Agenda de obrigações</h1>
        <p>
          Tudo que é previsível numa linha do tempo só: cobranças do Asaas, assinaturas, parcelamentos, salários,
          tributos, faturas de cartão e o que você cadastrar à mão. Cada obrigação aparece <strong>uma vez</strong> —
          onde duas fontes falam do mesmo dinheiro, uma delas cala e diz por quê.
        </p>
      </div>
      <FinShell>
        <FinAgenda inicial={{ ...contrato.dado, disponivel: contrato.disponivel, ressalvas: contrato.ressalvas }} />
      </FinShell>
    </AppShell>
  );
}
