import { AppShell } from "@/components/layout/AppShell";
import { FinCustoFixo } from "@/components/financeiro/FinCustoFixo";
import { FinShell } from "@/components/financeiro/FinShell";

export const metadata = {
  title: "Catálogo de custos fixos — Financeiro XPE"
};

// Alguém liga e desliga compromisso de caixa em cima destes números. Número em
// cache é pior que número lento — a mesma regra do resto do módulo.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * O catálogo do que a empresa paga todo mês.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTA PÁGINA NÃO CARREGA O CATÁLOGO NO SERVIDOR
 * ---------------------------------------------------------------------------
 * As ressalvas MEDIDAS — quantos itens venceram, quantos acendem alerta,
 * quanto do detectado já é folha — nascem em
 * `app/api/financeiro/gerencial/custo-fixo`, e mudam a cada escrita. Se esta
 * página lesse o contrato direto, teria de recalculá-las aqui, e a segunda
 * cópia divergiria da primeira no dia em que alguém corrigisse só uma.
 *
 * Então a página entrega o cabeçalho e o componente busca da rota — que é a
 * mesma fonte para a carga inicial e para todo recarregamento depois de ligar,
 * desligar ou reajustar.
 */
export default function CustosFixosPage() {
  return (
    <AppShell>
      <div className="page-header">
        <h1>Catálogo de custos fixos</h1>
        <p>
          Tudo que a empresa paga todo mês, encontrado no extrato e organizado por categoria: quantas vezes ocorreu,
          quanto varia, em que dia sai e desde quando. Cada item traz um <strong>valor sugerido com o critério
          declarado</strong> — e o erro medido desse critério — para você revisar, ajustar, ligar ou desligar. O que
          colide com a folha, com o DAS ou com a fatura do cartão aparece, mas não liga: seria o mesmo dinheiro contado
          duas vezes.
        </p>
      </div>
      <FinShell>
        <FinCustoFixo />
      </FinShell>
    </AppShell>
  );
}
