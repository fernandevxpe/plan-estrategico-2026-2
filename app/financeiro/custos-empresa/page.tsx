import { AppShell } from "@/components/layout/AppShell";
import { FinCustosEmpresa } from "@/components/financeiro/FinCustosEmpresa";
import { FinShell } from "@/components/financeiro/FinShell";
import { getCustosEmpresa } from "@/lib/financeiro/custos-empresa";

export const metadata = {
  title: "Custo da empresa — Financeiro XPE"
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Custo da empresa — o que sai e não é pessoa.
 *
 * Carrega no SERVIDOR, como Pessoas: um objeto só, buscado em request-time. É
 * o oposto de /financeiro/custos-fixos, que busca da API no cliente — lá o
 * dado muda a cada escrita (ligar, desligar, reajustar) e a tela precisa
 * recarregar sozinha; aqui é leitura, e o estado de carregamento seria custo
 * sem contrapartida.
 */
export default async function CustosEmpresaPage() {
  const dados = await getCustosEmpresa();

  return (
    <AppShell>
      <div className="page-header">
        <h1>Custo da empresa</h1>
      </div>
      <FinShell>
        <FinCustosEmpresa dados={dados} />
      </FinShell>
    </AppShell>
  );
}
