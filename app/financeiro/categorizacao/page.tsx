import { AppShell } from "@/components/layout/AppShell";
import { FinCategorizacao } from "@/components/financeiro/FinCategorizacao";
import { FinShell } from "@/components/financeiro/FinShell";
import { getBuscaCategorizacao, getPlanoDeContas } from "@/lib/financeiro/contratos/categorizacao";
import { getOpcoesLancamentos } from "@/lib/financeiro/contratos/lancamentos";

export const metadata = { title: "Categorização — Financeiro XPE" };
export const dynamic = "force-dynamic";

/**
 * A central de categorização.
 *
 * O servidor entrega três coisas prontas para a primeira pintura, e nenhuma
 * delas é a busca em si — a busca é do usuário, e nasce com o filtro que ele
 * escolher:
 *
 *   1. o PLANO DE CONTAS com o uso medido nos três universos, porque o seletor
 *      de categoria do lote precisa dele antes de qualquer clique;
 *   2. núcleos e centros de custo, que são as listas dos filtros;
 *   3. a MEDIDA DA LACUNA — quantos itens indeterminados existem em cada
 *      universo, e quanto valem. É o número que justifica a tela, e ele tem de
 *      estar na tela antes de o usuário digitar qualquer coisa.
 *
 * A lacuna é medida com `apenasClassificavel`: os 14 pagamentos de fatura do
 * cartão são indeterminados **declarados não classificáveis** (categorizá-los
 * contaria a mesma despesa duas vezes, porque a fatura já está itemizada linha
 * a linha). Contá-los como trabalho pendente inflaria a lacuna com trabalho que
 * não existe.
 */
export default async function CategorizacaoPage() {
  const [plano, opcoes, lacuna] = await Promise.all([
    getPlanoDeContas(true),
    getOpcoesLancamentos(),
    // `porPagina: 1` porque só o resumo por universo interessa aqui — a lista
    // vem da busca do usuário, não desta chamada.
    getBuscaCategorizacao({ estado: "indeterminado", apenasClassificavel: true }, { porPagina: 1 })
  ]);

  const foraDaRegua = lacuna.disponivel ? lacuna.dado.porUniverso : [];
  const foraDoPainel = foraDaRegua
    .filter((u) => u.universo !== "lancamento")
    .reduce((soma, u) => soma + u.indeterminados, 0);

  return (
    <AppShell>
      <div className="page-header">
        <h1>Categorização</h1>
        <p>
          Tudo o que tem categoria — ou deveria ter — nos três universos onde ela existe: lançamentos do extrato,
          cobranças e itens de fatura de cartão. Busque por texto, faixa de valor, tipo, categoria, período,
          estado ou por quem decidiu; troque a categoria de um item ou de vários; cadastre a linha que falta no
          plano de contas.{" "}
          {foraDoPainel > 0 ? (
            <>
              <strong>{foraDoPainel.toLocaleString("pt-BR")} destes itens não aparecem em indicador nenhum</strong>{" "}
              — o painel mede lançamentos, e documento e item de cartão ficam fora da régua.
            </>
          ) : null}
        </p>
      </div>
      <FinShell>
        <FinCategorizacao
          plano={plano.dado}
          planoDisponivel={plano.disponivel}
          ressalvasPlano={plano.ressalvas}
          nucleos={opcoes.dado.nucleos}
          centrosCusto={opcoes.dado.centrosCusto}
          foraDaRegua={foraDaRegua}
        />
      </FinShell>
    </AppShell>
  );
}
