import { AppShell } from "@/components/layout/AppShell";
import { FinMei } from "@/components/financeiro/FinMei";
import { FinShell } from "@/components/financeiro/FinShell";
import { getPanoramaMei } from "@/lib/financeiro/contratos";

export const metadata = {
  title: "Teto do MEI e regime tributário — Financeiro XPE"
};

// Alguém decide parar de pagar um prestador em cima destes números. Número em
// cache é pior que número lento.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * A janela do teto de cada MEI.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTA PÁGINA LÊ O CONTRATO DIRETO, SEM PASSAR PELA ROTA
 * ---------------------------------------------------------------------------
 * Ela não tem navegação de mês nem escrita. `custos` busca pela rota porque as
 * ressalvas dela nascem da resposta e mudam a cada requisição; aqui as
 * ressalvas são do contrato — elas vêm da lei e do próprio `fin_mei_teto_v`, e
 * recalculá-las no cliente criaria a segunda cópia da mesma regra que a
 * `custos` evitou.
 *
 * A rota `GET /api/financeiro/gerencial/mei` existe assim mesmo, para quem
 * quiser o dado bruto — e nasce dentro de `/api/financeiro`, não em
 * `/api/time`: a janela mostra quanto cada prestador recebeu no ano, o que é
 * dado de folha. O perfil comum leva 404 por estar onde está, não por uma
 * checagem que alguém pode esquecer de escrever.
 */
export default async function MeiPage({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const { ano } = await searchParams;
  const contrato = await getPanoramaMei({ ano: anoValido(ano) });

  return (
    <AppShell>
      <div className="page-header">
        <h1>Teto do MEI e regime tributário</h1>
        <p>
          A empresa não tem CLT: alguns sócios recebem salário mínimo e o resto do time é pago como
          MEI — e a XPE paga o DAS deles. Isso põe dois limites no mesmo lugar: o{" "}
          <strong>teto de receita bruta de cada prestador</strong>, que é dele e não da casa, e o{" "}
          <strong>anexo do Simples</strong>, que depende de quanto a casa paga a pessoa física. Esta
          tela mostra os dois com o dispositivo legal ao lado de cada número, e o que a base não sabe
          fica hachurado em vez de virar zero.
        </p>
      </div>
      <FinShell>
        <FinMei contrato={contrato} />
      </FinShell>
    </AppShell>
  );
}

function anoValido(bruto: string | undefined): number | undefined {
  if (!bruto || !/^\d{4}$/.test(bruto)) return undefined;
  const n = Number(bruto);
  return n >= 2020 && n <= 2100 ? n : undefined;
}
