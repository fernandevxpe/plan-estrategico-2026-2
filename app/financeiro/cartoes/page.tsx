import { AppShell } from "@/components/layout/AppShell";
import { FinCartaoAnalise } from "@/components/financeiro/FinCartaoAnalise";
import { FinCartaoDescrito } from "@/components/financeiro/FinCartaoDescrito";
import { FinCartaoPainelTopo } from "@/components/financeiro/FinCartaoPainelTopo";
import { FinCartaoPlasticos } from "@/components/financeiro/FinCartaoPlasticos";
import { FinCartaoQualificar } from "@/components/financeiro/FinCartaoQualificar";
import { FinCartaoTransacoes } from "@/components/financeiro/FinCartaoTransacoes";
import { FinCartoes } from "@/components/financeiro/FinCartoes";
import { FinShell } from "@/components/financeiro/FinShell";
import { getCartoesDescritos } from "@/lib/financeiro/cartao-descrito";
import { getVocabularioCartao } from "@/lib/financeiro/cartao-vocabulario";
import { getCartaoDetalhe } from "@/lib/financeiro/contratos";
import { getCartaoPainel } from "@/lib/financeiro/contratos/cartao-painel";

export const metadata = {
  title: "Cartões — Financeiro XPE"
};

// Alguém decide sobre um gasto em cima destes números. Número em cache é pior
// que número lento — a mesma regra do resto do módulo.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * A tela de cartões.
 *
 * ---------------------------------------------------------------------------
 * DUAS PERGUNTAS, NESTA ORDEM
 * ---------------------------------------------------------------------------
 * 1. **QUANTO SE GASTOU** — o painel de cima. Gasto é evento de compra, na
 *    competência: acontece quando o cartão passa. É a pergunta que se faz todo
 *    dia, e por isso vem primeiro.
 * 2. **O QUE SAIU DO CAIXA E COMO SE COMPÕE** — a seção de fatura, embaixo. É
 *    a pergunta de fechamento, e ela tem uma disciplina própria que a primeira
 *    não precisa: fatura e item são o mesmo dinheiro visto de dois lugares e
 *    NUNCA se somam.
 *
 * As duas convivem porque são respostas diferentes, não porque uma é resumo da
 * outra. O que as mantém honestas é nenhum número atravessar de uma para a
 * outra: o painel de cima não conhece `pagamento_fatura`, e a seção de baixo
 * não conhece o recorte por plástico.
 *
 * ---------------------------------------------------------------------------
 * O NÚMERO QUE FALTAVA, E QUASE PASSOU
 * ---------------------------------------------------------------------------
 * Em 2026 o cartão custou R$ 115.095,91. Só R$ 62.421,09 disso vem itemizado —
 * o resto (R$ 52.674,82) são faturas que o emissor não detalha, das quais
 * R$ 40.862,41 são o Banco Inter inteiro, que só entrega o pagamento.
 *
 * Um painel que quebrasse só o itemizado por cartão e chamasse aquilo de "o
 * ano" subnotificaria o gasto em quase metade, sem que nada na tela avisasse.
 * Por isso o não itemizado tem número próprio no topo e faixa própria no
 * gráfico — nunca rateado entre os plásticos conhecidos, porque não se sabe de
 * qual plástico saiu.
 */
export default async function CartoesPage() {
  const [painel, contrato, descrito, vocabulario] = await Promise.all([
    getCartaoPainel(),
    getCartaoDetalhe(),
    getCartoesDescritos(),
    getVocabularioCartao()
  ]);

  return (
    <AppShell>
      <div className="page-header">
        <h1>Cartões</h1>
        <p>
          Quanto se gastou em cartão, em qual plástico e com o quê — e o que ainda não tem dono.
        </p>
      </div>

      <FinShell>
        {painel.disponivel ? (
          <>
            <FinCartaoPainelTopo dado={painel.dado} />

            <FinCartaoPlasticos
              plasticos={painel.dado.plasticos}
              serie={painel.dado.serie}
              transacoes={painel.dado.transacoes}
            />

            <FinCartaoQualificar
              transacoes={painel.dado.transacoes}
              categorias={vocabulario.categorias}
              nucleos={vocabulario.nucleos}
              centros={vocabulario.centros}
              aQualificar={painel.dado.aQualificar}
            />

            <FinCartaoAnalise
              ranking={painel.dado.ranking}
              porCategoria={painel.dado.porCategoria}
              porNucleo={painel.dado.porNucleo}
              porCentro={painel.dado.porCentro}
              transacoes={painel.dado.transacoes}
              serie={painel.dado.serie}
              naoItemizado={painel.dado.naoItemizado}
              ano={painel.dado.ano}
            />

            <FinCartaoTransacoes
              transacoes={painel.dado.transacoes}
              plasticos={painel.dado.plasticos}
              categorias={vocabulario.categorias}
              nucleos={vocabulario.nucleos}
              centros={vocabulario.centros}
            />
          </>
        ) : (
          <section className="fin-card">
            <div className="fin-card-head">
              <h2>O painel de cartões não está de pé neste ambiente</h2>
            </div>
            <p className="fin-card-hint">{painel.ressalvas[0] ?? "motivo não declarado pelo contrato"}</p>
          </section>
        )}

        {/*
          A FATURA, embaixo do gasto.
          Ela responde outra pergunta — o que saiu do caixa — e carrega a regra
          de não somar fatura com item. Fica depois porque é consulta de
          fechamento, não de todo dia.
        */}
        {contrato.disponivel ? (
          <FinCartoes dado={contrato.dado} ressalvas={contrato.ressalvas} />
        ) : null}

        <FinCartaoDescrito cartoes={descrito.cartoes} totalCents={descrito.totalCents} />
      </FinShell>
    </AppShell>
  );
}
