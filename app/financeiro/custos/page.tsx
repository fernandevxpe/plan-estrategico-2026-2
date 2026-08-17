import { AppShell } from "@/components/layout/AppShell";
import { FinCustos } from "@/components/financeiro/FinCustos";
import { FinShell } from "@/components/financeiro/FinShell";
import { getOpcoesContas } from "@/lib/financeiro/contas";

export const metadata = {
  title: "Previsão de custos do mês — Financeiro XPE"
};

// Uma pessoa confirma saída de caixa em cima destes números. Número em cache é
// pior que número lento — a mesma regra do resto do módulo.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * A previsão de custos do mês.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTA PÁGINA NÃO CARREGA O MÊS NO SERVIDOR
 * ---------------------------------------------------------------------------
 * O contrato (`getCustosDoMes`) devolve o dado; as ressalvas MEDIDAS — quantos
 * dias do mês corrente já saíram do horizonte, quanto existe e não soma, quais
 * itens acendem alerta — nascem em `app/api/financeiro/gerencial/custos`, de
 * propósito: elas são derivadas da resposta e mudam a cada requisição.
 *
 * Se esta página lesse o contrato direto, teria de recalcular essas frases aqui
 * — uma segunda cópia da mesma regra, que divergiria da primeira no dia em que
 * alguém corrigisse só uma das duas. Então a página entrega o cabeçalho e as
 * opções do formulário, e o mês vem da rota, que é a mesma fonte para a
 * navegação de mês e para todo recarregamento depois de uma escrita.
 *
 * As opções (plano de contas, núcleos, contrapartes) vêm daqui porque são
 * catálogo, não medida: mudam de mês em mês tanto quanto o plano de contas
 * muda, ou seja, nunca dentro de uma sessão. Buscá-las de uma rota nova seria
 * criar rota para o que uma leitura de Server Component já resolve.
 */
export default async function CustosPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { mes } = await searchParams;
  const opcoes = await getOpcoesContas();

  return (
    <AppShell>
      <div className="page-header">
        <h1>Previsão de custos do mês</h1>
        <p>
          Tudo que a base sabe que vai sair, categorizado, com o dia esperado e a regra que produziu aquele dia. Cada
          custo aparece <strong>uma vez</strong>: onde duas fontes falam do mesmo dinheiro, uma delas cala e diz por
          quê. Confirmar é assinar o valor — e permite ajustá-lo, porque a diferença entre o previsto e o confirmado é
          a única medida que esta base tem do erro da própria projeção de saída.
        </p>
      </div>
      <FinShell>
        <FinCustos mesInicial={mesValido(mes)} opcoes={opcoes} />
      </FinShell>
    </AppShell>
  );
}

/**
 * `?mes=` só entra se for competência de verdade.
 *
 * Vazio devolve `null` e o componente resolve o mês corrente em São Paulo — não
 * em UTC, pela mesma razão que a rota: às 21h do dia 31, UTC já virou o mês, e a
 * tela abriria na competência seguinte, vazia, exatamente na noite de fechamento
 * em que alguém está olhando.
 */
function mesValido(bruto: string | undefined): string | null {
  if (!bruto || !/^\d{4}-\d{2}(-\d{2})?$/.test(bruto)) return null;
  return `${bruto.slice(0, 7)}-01`;
}
