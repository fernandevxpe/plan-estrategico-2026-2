import { AppShell } from "@/components/layout/AppShell";
import { FinCustosEmpresa } from "@/components/financeiro/FinCustosEmpresa";
import { FinShell } from "@/components/financeiro/FinShell";
import { getContasAPagar } from "@/lib/financeiro/contas-a-pagar";
import { abaValida } from "@/lib/financeiro/custo-empresa-abas";
import { getCustosEmpresa } from "@/lib/financeiro/custos-empresa";

export const metadata = {
  title: "Custo da empresa — Financeiro XPE"
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { searchParams: Promise<{ aba?: string; mes?: string }> };

/**
 * Custo da empresa — o que sai e não é pessoa — em duas abas.
 *
 * `matriz` (padrão) olha para trás: o gasto do ano por (contraparte ×
 * categoria). `contas-a-pagar` olha para frente: o que sai neste mês, nos
 * mesmos blocos.
 *
 * Carrega no SERVIDOR, como Pessoas: um objeto por aba, buscado em
 * request-time. É o oposto de /financeiro/custos-fixos, que busca da API no
 * cliente — lá o dado muda a cada escrita (ligar, desligar, reajustar) e a tela
 * precisa recarregar sozinha; aqui é leitura, e o estado de carregamento seria
 * custo sem contrapartida.
 *
 * As DUAS carregam sempre, mesmo na aba que não está aberta, porque a barra de
 * abas mostra o total de cada uma — a mesma razão escrita em
 * app/financeiro/contas/page.tsx. O custo disso é uma varredura de
 * `fin_agenda_dia_v`, que o pool com `jit=off` resolve em ~440ms para a janela
 * de um mês (medido em 23/08; com JIT ligado eram 23s — ver AGENTS.md §6).
 *
 * Gente (folha, comissão, PIX de quem está no roster) não entra na MATRIZ:
 * Pessoas já conta, e somar aqui é o mesmo dinheiro duas vezes. Na aba de
 * contas a pagar ela VOLTA, em bloco próprio e com total separado, porque ali a
 * pergunta é de caixa e não de custo.
 */
export default async function CustosEmpresaPage({ searchParams }: Props) {
  const { aba, mes } = await searchParams;
  const abaAtiva = abaValida(aba) ? aba : "matriz";

  const [dados, contas] = await Promise.all([getCustosEmpresa(), getContasAPagar(mes)]);

  return (
    <AppShell>
      <div className="page-header">
        <h1>Custo da empresa</h1>
      </div>
      <FinShell>
        <FinCustosEmpresa dados={dados} contas={contas} aba={abaAtiva} />
      </FinShell>
    </AppShell>
  );
}
