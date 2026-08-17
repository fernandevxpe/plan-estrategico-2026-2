import { FinFontes } from "@/components/financeiro/FinFontes";
import { FinShell } from "@/components/financeiro/FinShell";
import { AppShell } from "@/components/layout/AppShell";
import { getFontes } from "@/lib/financeiro/contratos/fontes";

export const metadata = { title: "Fontes — Financeiro XPE" };

// Nada aqui pode vir de cache: a pergunta desta tela é literalmente "isto é de
// quando?", e uma resposta servida do CDN teria data desconhecida.
export const dynamic = "force-dynamic";

/**
 * De onde vêm os números, e se estão atualizados.
 *
 * A tela nasceu de um feedback de quatro perguntas —
 *
 *   "e tbm tem dizendo que tem fontes sem atualizar... precisa mesmo ficar
 *    mostrando? é importante atualizar? pq n tem botão para atualizar as
 *    fontes? mostrar quais nao estão atualizadas?"
 *
 * — e ela existe porque as respostas não cabiam numa notificação. O sino podia,
 * no máximo, dizer que algo estava atrasado; ele não tinha onde mostrar de qual
 * fonte, o que ela alimenta, quando foi a última vez que alguém olhou, ou um
 * botão.
 */
export default async function FontesPage() {
  const contrato = await getFontes();

  return (
    <AppShell>
      <div className="page-header">
        <h1>Fontes</h1>
        <p>
          De onde vêm os números desta plataforma, uma linha por fonte: o que ela alimenta, até
          quando ela tem dado, quando foi a última vez que nós olhamos, quanto atraso ainda é normal
          para ela — e o botão de atualizar. O atraso é contado em <strong>dias úteis</strong>: o
          banco não lança no sábado, e cobrar D+1 corrido fazia toda segunda-feira nascer vermelha.
        </p>
      </div>
      <FinShell>
        <FinFontes contrato={contrato} />
      </FinShell>
    </AppShell>
  );
}
