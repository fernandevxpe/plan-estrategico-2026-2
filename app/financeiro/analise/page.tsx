import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinAnalise } from "@/components/financeiro/FinAnalise";
import { getAnalise } from "@/lib/financeiro/contratos/analise";

export const metadata = { title: "Análise gerencial — Financeiro XPE" };
export const dynamic = "force-dynamic";

/**
 * A DRE lida como gestão, não como contabilidade.
 *
 * A tela de Resultado responde "quanto". Esta responde as três perguntas que
 * vêm depois e que hoje só se responde somando de cabeça: quanto isso
 * representa da receita, cresceu ou caiu, e qual área puxou.
 *
 * Todo percentual vem pronto de `fin_analise_*_v` (0131) — nenhum é calculado
 * aqui. O motivo está no contrato: margem calculada na tela diverge de margem
 * calculada no relatório assim que alguém troca um denominador, e a divergência
 * fica invisível até alguém comparar as duas.
 */
export default async function AnalisePage() {
  const hoje = new Date();
  const ano = hoje.getUTCFullYear();
  const analise = await getAnalise({ de: `${ano}-01`, ate: `${ano}-12` });

  return (
    <AppShell>
      <div className="page-header">
        <h1>Análise gerencial</h1>
        <p>
          O resultado do ano em percentual, crescimento e composição. Os números vêm da mesma régua
          da DRE — a soma bate ao centavo, e a participação por área fecha 100% em todo mês com
          receita. Onde não há receita, a margem aparece como travessão: um mês sem faturamento não
          tem margem de zero por cento.
        </p>
      </div>
      <FinShell>
        <FinAnalise
          dados={analise.dado}
          disponivel={analise.disponivel}
          ressalvas={analise.ressalvas}
        />
      </FinShell>
    </AppShell>
  );
}
