import { brlCents, pct } from "@/lib/financeiro/format";

type Props = {
  contas: number;
  classificacao: number;
  conciliacao: number;
  planejamento: number;
  composto: number;
  naoClassificadoCents: number;
  filaItens: number;
};

/**
 * O placar do módulo.
 *
 * Fica no topo porque a pergunta "posso confiar neste número?" vem antes de
 * qualquer número. Cada componente mostra a meta ao lado do valor: um índice sem
 * meta é decoração, e um que nunca pode ser atingido é pior — as pessoas param
 * de olhar.
 *
 * Enquanto o composto não passa de 95%, todo relatório derivado carrega selo de
 * cobertura parcial. Número financeiro incompleto apresentado como completo é
 * pior que número nenhum.
 */
const COMPONENTES = [
  {
    key: "contas" as const,
    label: "Cobertura de contas",
    meta: 100,
    ajuda: "Contas com extrato dos últimos 30 dias. Hoje só o Asaas — que é 100% da receita e 0% da despesa."
  },
  {
    key: "classificacao" as const,
    label: "Classificação",
    meta: 98,
    ajuda: "Quanto do dinheiro tem categoria. Medido em reais, não em número de linhas."
  },
  {
    key: "conciliacao" as const,
    label: "Conciliação",
    meta: 95,
    ajuda: "Quanto do dinheiro está ligado a uma cobrança ou a um pagamento previsto."
  },
  {
    key: "planejamento" as const,
    label: "Planejamento",
    meta: 90,
    ajuda: "Quanto das saídas tinha pagamento registrado antes de o dinheiro sair."
  }
];

export function FinReliabilityPanel(props: Props) {
  const abaixo = props.composto < 95;

  return (
    <section className="card fin-reliability" aria-labelledby="fin-conf-titulo">
      <div className="fin-reliability-head">
        <div>
          <h2 className="card-title" id="fin-conf-titulo">
            Índice de Confiabilidade
          </h2>
          <p className="fin-reliability-hint">
            Enquanto não passar de 95%, os relatórios derivados saem marcados como cobertura parcial.
          </p>
        </div>
        <div className={abaixo ? "fin-reliability-score baixo" : "fin-reliability-score"}>
          <strong>{pct(props.composto, 0)}</strong>
          <span>composto</span>
        </div>
      </div>

      <div className="fin-reliability-grid">
        {COMPONENTES.map((item) => {
          const valor = props[item.key];
          const ok = valor >= item.meta;
          return (
            <div key={item.key} className={ok ? "fin-reliability-item ok" : "fin-reliability-item"}>
              <div className="fin-reliability-item-head">
                <span className="fin-reliability-label">{item.label}</span>
                <span className="fin-reliability-value">{pct(valor, 0)}</span>
              </div>
              <div className="fin-reliability-bar" role="img" aria-label={`${item.label}: ${pct(valor, 0)} de ${item.meta}%`}>
                <span style={{ width: `${Math.min(100, Math.max(0, valor))}%` }} />
                <em style={{ left: `${item.meta}%` }} aria-hidden="true" />
              </div>
              <p className="fin-reliability-help">
                meta {item.meta}% · {item.ajuda}
              </p>
            </div>
          );
        })}
      </div>

      {props.naoClassificadoCents > 0 ? (
        <p className="fin-reliability-foot">
          <strong>{brlCents(props.naoClassificadoCents)}</strong> ainda sem categoria, em{" "}
          <strong>{props.filaItens.toLocaleString("pt-BR")}</strong> itens na fila. A fila é ordenada por valor: as
          primeiras decisões cobrem a maior parte do montante.
        </p>
      ) : null}
    </section>
  );
}
