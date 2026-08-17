import type { DreTributos } from "@/lib/financeiro/dre";
import { brlCents, pct } from "@/lib/financeiro/format";

/**
 * O DAS estimado sobre a receita — a única parte de `FinDre` que sobreviveu.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `FinDre` FOI REMOVIDO, E ISTO FICOU
 * ---------------------------------------------------------------------------
 * Existiam duas DREs nesta plataforma, e elas divergiam por construção:
 *
 *   · `FinDre` lia `lib/financeiro/dre.ts`, que soma `fin_document` (100% "a
 *     receber") mais o que sobra de `fin_transaction`. Daí o aviso que ele
 *     mesmo carregava: "receita real e despesa quase zero — lucro e margem
 *     aqui são teto, não resultado".
 *   · `/financeiro/resultado` lê `fin_dre_v`, derivada do ledger, e prova a
 *     regra de ouro: abertura + DRE de caixa = saldo, resíduo R$ 0,00.
 *
 * Duas telas chamadas "DRE" mostrando números diferentes não é redundância, é
 * a pergunta "de onde veio este número?" passando a ter duas respostas. A que
 * fecha com o caixa ficou; a outra saiu.
 *
 * Esta seção não é DRE: é a estimativa do DAS, e ela se declara como
 * PREMISSA em toda linha. Ela continua aqui porque não tem substituto — o
 * comparativo de regime da 0092 mede a carga real, mas a 0092 ainda não foi
 * aplicada. Quando for, esta seção é a próxima a ser revista.
 */
export function FinTributosPremissa({ dados }: { dados: DreTributos }) {
  return (
    <section className="card">
      <h2 className="card-title">Simples Nacional — estimativa do DAS</h2>
      <div className="fin-dre-premissa" role="note">
        <strong>Este número é premissa, não apuração.</strong>
        <p>
          Alíquota efetiva estimada de <b>{pct(dados.aliquotaEfetivaPct, 2)}</b> sobre um RBT12 de{" "}
          <b>{brlCents(dados.rbt12Cents)}</b> — {dados.anexo}, {dados.faixaRotulo} (
          {pct(dados.aliquotaNominalPct, 2)} nominal menos parcela a deduzir de {brlCents(dados.deducaoCents)}).
        </p>
        <p>
          A premissa que mais pesa: <b>{dados.anexo}</b> {dados.premissaAnexo}. Se a empresa estiver no Anexo V, a
          alíquota da mesma faixa sobe cerca de cinco pontos e esta estimativa erra por dezenas de milhares de reais no
          ano. Para ajustar, edite <code>ANEXO_SIMPLES</code> em <code>lib/financeiro/dre.ts</code>.
        </p>
      </div>

      <div className="table-wrap">
        <table className="fin-table">
          <tbody>
            <tr>
              <td>RBT12 — receita bruta dos últimos 12 meses</td>
              <td className="num fin-table-money">{brlCents(dados.rbt12Cents)}</td>
            </tr>
            <tr>
              <td>Receita bruta do período selecionado</td>
              <td className="num fin-table-money">{brlCents(dados.receitaPeriodoCents)}</td>
            </tr>
            <tr>
              <td>
                DAS estimado no período <span className="fin-tag">premissa</span>
              </td>
              <td className="num fin-table-money">{brlCents(dados.dasEstimadoCents)}</td>
            </tr>
            <tr>
              <td>
                ISS destacado nas NFS-e autorizadas <span className="fin-tag">real</span>
                <span className="fin-desc-sub">
                  {dados.nNotas.toLocaleString("pt-BR")} notas no período. Não soma ao DAS: no Simples o ISS já está
                  dentro da guia — contar os dois inflaria a carga em vários pontos.
                </span>
              </td>
              <td className="num fin-table-money">{brlCents(dados.issDestacadoCents)}</td>
            </tr>
            <tr>
              <td>
                ISS retido na fonte <span className="fin-tag">real</span>
                <span className="fin-desc-sub">Este sim é dinheiro a mais: retido pelo tomador, por fora da guia.</span>
              </td>
              <td className="num fin-table-money">{brlCents(dados.issRetidoCents)}</td>
            </tr>
            <tr>
              <td>
                <strong>Carga tributária efetiva</strong>
                <span className="fin-desc-sub">(DAS estimado + ISS retido) ÷ receita bruta do período</span>
              </td>
              <td className="num fin-table-money">
                <strong>{pct(dados.cargaEfetivaPct, 2)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
