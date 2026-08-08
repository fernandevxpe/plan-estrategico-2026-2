import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinDre } from "@/components/financeiro/FinDre";
import { FinIndicadores } from "@/components/financeiro/FinIndicadores";
import { getDre } from "@/lib/financeiro/dre";
import { getIndicadores } from "@/lib/financeiro/indicadores";

export const metadata = {
  title: "Indicadores — Financeiro XPE"
};

// Mesma regra das outras rotas do módulo: número financeiro em cache é pior que
// número financeiro lento, porque alguém decide pagamento em cima dele.
export const dynamic = "force-dynamic";

export default async function IndicadoresPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const primeiro = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor);

  // Os indicadores recebem a DRE já calculada em vez de recalcular receita por
  // conta própria: é o que garante que o cartão "receita do período" e a
  // primeira linha da DRE mostrem o MESMO número. Duas consultas com a mesma
  // intenção divergem, e quando divergem ninguém confia em nenhuma das duas.
  const dre = await getDre({ periodo: primeiro(params.periodo), nucleo: primeiro(params.nucleo) });
  const indicadores = await getIndicadores(dre);

  return (
    <AppShell>
      <div className="page-header">
        <h1>Indicadores</h1>
        <p>
          A DRE por competência e os indicadores de gestão que saem dela. Somente leitura, direto do banco: nada aqui é
          digitado à mão. Enquanto só o Asaas estiver importado, a receita é real e a despesa é quase nula — a tela diz
          isso em toda linha onde a diferença importa.
        </p>
      </div>
      <FinShell>
        <FinDre dados={dre} />
        <FinIndicadores dados={indicadores} semDespesa={dre.cobertura.semDespesa} />
      </FinShell>
    </AppShell>
  );
}
