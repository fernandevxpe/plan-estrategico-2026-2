import { AppShell } from "@/components/layout/AppShell";
import { FinCartoes } from "@/components/financeiro/FinCartoes";
import { FinShell } from "@/components/financeiro/FinShell";
import { getCartaoDetalhe } from "@/lib/financeiro/contratos";

export const metadata = {
  title: "Cartões — Financeiro XPE"
};

// Alguém decide sobre um gasto em cima destes números. Número em cache é pior
// que número lento — a mesma regra do resto do módulo.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * O detalhamento de cartão.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UMA TELA, E NÃO UMA ABA EM `/financeiro/custos`
 * ---------------------------------------------------------------------------
 * `/financeiro/custos` responde "quanto sai neste mês" — é uma tela de CAIXA, e
 * ali a fatura de cartão já aparece como uma linha de saída (`pagar_cartao_ciclo`,
 * `pagar_cartao_parcela`, `pagar_cartao_estimado`). O que faltava não era outra
 * cópia daquela linha: era o que existe DENTRO dela.
 *
 * E a composição não cabe naquela tela porque ela é de outra natureza. O item de
 * cartão não é `fin_transaction`, não tem saldo, não move conta e vive em outra
 * competência que a saída que o paga. Empurrá-lo para dentro de uma tabela de
 * caixa terminaria no único erro que este módulo não pode cometer: alguém
 * somando a fatura com os itens dela.
 *
 * A tela fica em PAGAR, ao lado de "Custos do mês", que é onde a pergunta nasce.
 *
 * ---------------------------------------------------------------------------
 * ELA LÊ O CONTRATO DIRETO, E DEGRADA DIZENDO O QUE FALTA
 * ---------------------------------------------------------------------------
 * As ressalvas desta tela vêm do modelo (a regra de não somar é permanente, não
 * é o estado de hoje), então não há motivo para passar pela rota — que existe
 * assim mesmo, em `/api/financeiro/gerencial/cartao/detalhe`, e é ela que a
 * árvore chama para buscar os itens de um subcartão.
 *
 * Enquanto `0114_fin_cartao_detalhe.sql` não estiver aplicada, o contrato volta
 * indisponível com o nome das views que faltam, e esta página mostra isso em vez
 * de uma tela vazia — que seria indistinguível de "não há gasto em cartão".
 */
export default async function CartoesPage() {
  const contrato = await getCartaoDetalhe();

  return (
    <AppShell>
      <div className="page-header">
        <h1>Cartões</h1>
        <p>
          O gasto de cartão até o item: emissor, linha de crédito, fatura, subcartão e compra. A{" "}
          <strong>fatura é o que saiu do caixa</strong>; os <strong>itens são a composição dela</strong>.
          Os dois aparecem lado a lado e nunca somados — somar conta a mesma despesa duas vezes. O que
          a fonte não itemiza aparece com linha própria e motivo, hachurado, em vez de ser diluído
          entre as compras conhecidas.
        </p>
      </div>
      <FinShell>
        {contrato.disponivel ? (
          <FinCartoes dado={contrato.dado} ressalvas={contrato.ressalvas} />
        ) : (
          <section className="fin-card">
            <div className="fin-card-head">
              <h2>O detalhamento de cartão ainda não está de pé neste ambiente</h2>
            </div>
            <p className="fin-card-hint">
              {contrato.ressalvas[0] ?? "motivo não declarado pelo contrato"}
            </p>
            <p className="fin-card-hint">
              O modelo de cartão existe e está conferido — 3 emissores, 12 subcartões, 21 faturas e
              781 itens, com <code>node scripts/validar-cartoes.mjs</code> em 0 falhas. O que falta é
              a camada de leitura que esta tela consome.
            </p>
          </section>
        )}
      </FinShell>
    </AppShell>
  );
}
