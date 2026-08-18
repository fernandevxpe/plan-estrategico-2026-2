import { AppShell } from "@/components/layout/AppShell";
import { FinObras } from "@/components/financeiro/FinObras";
import { getObras } from "@/lib/financeiro/contratos/obras";

export const metadata = {
  title: "Obras — XPE"
};

// Mesma regra do financeiro: ninguém decide em cima de número em cache.
export const dynamic = "force-dynamic";

/**
 * A pergunta financeira sobre as obras, não a execução delas.
 *
 * Cronograma, checklist e composição de serviço continuam só no erp-obras —
 * de propósito, para não duplicar o que ele já faz melhor. Esta tela lê só o
 * agregado financeiro (migration 0121/0122): quanto foi contratado, recebido,
 * guardado na reserva, gasto e orçado, por uma sincronização manual e
 * somente-leitura (scripts/sync-erp-obras-painel.mjs).
 */
export default async function ObrasPage() {
  const contrato = await getObras();

  return (
    <AppShell>
      <div className="page-header">
        <h1>Obras</h1>
        <p>
          O que o erp-obras já sabe sobre o dinheiro das obras — quantas, contratado, recebido, na
          reserva, gasto. A execução da obra em si continua só no erp-obras.
        </p>
      </div>
      {contrato.disponivel ? (
        <FinObras dado={contrato.dado} ressalvas={contrato.ressalvas} />
      ) : (
        <p className="fin-card-hint">
          O módulo financeiro não respondeu neste ambiente. A tela prefere dizer isso a mostrar zeros.
        </p>
      )}
    </AppShell>
  );
}
