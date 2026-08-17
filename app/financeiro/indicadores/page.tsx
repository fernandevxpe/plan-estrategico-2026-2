import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinIndicadores } from "@/components/financeiro/FinIndicadores";
import { FinTributosPremissa } from "@/components/financeiro/FinTributosPremissa";
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
          Os indicadores de gestão e a estimativa do DAS. Somente leitura, direto do banco: nada aqui é digitado à mão.
        </p>
      </div>
      <FinShell>
        {/* A DRE saiu daqui de propósito. Havia duas nesta plataforma e elas
            divergiam por construção — esta somava fin_document (100% "a
            receber"), aquela é derivada do ledger e fecha com o caixa a
            resíduo R$ 0,00. Duas telas chamadas "DRE" com números diferentes
            fazem a pergunta "de onde veio este número?" ter duas respostas. */}
        <section className="card">
          <h2 className="card-title">A DRE mora em Resultado</h2>
          <p className="fin-card-hint">
            Ela saiu desta página. A que ficou é a de <Link href="/financeiro/resultado">/financeiro/resultado</Link>:
            derivada do ledger, expansível até o lançamento, e com a regra de ouro à vista —{" "}
            <b>abertura + DRE de caixa = saldo</b>, resíduo R$ 0,00. A que existia aqui somava{" "}
            <code>fin_document</code>, que é 100% “a receber”, e por isso mostrava despesa quase nula e chamava o
            próprio lucro de teto. Manter as duas seria manter duas respostas para a mesma pergunta.
          </p>
        </section>

        {dre.disponivel ? <FinTributosPremissa dados={dre.tributos} /> : null}
        <FinIndicadores dados={indicadores} semDespesa={dre.cobertura.semDespesa} />
      </FinShell>
    </AppShell>
  );
}
