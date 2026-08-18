import { Medida, Ressalva, SeloCamada } from "@/components/financeiro/Certeza";
import { brlCompact, brlPrecise, shortDateLabel } from "@/lib/financeiro/format";
import type { ObrasDado } from "@/lib/financeiro/contratos/obras";

const ROTULO_FASE: Record<string, string> = {
  OPORTUNIDADE: "Oportunidade",
  PROPOSTA: "Proposta",
  CONTRATADO: "Contratado",
  PLANEJAMENTO: "Planejamento",
  EXECUCAO: "Execução",
  ENCERRADO: "Encerrado",
  CANCELADO: "Cancelado"
};

export function FinObras({ dado, ressalvas }: { dado: ObrasDado; ressalvas: string[] }) {
  const { pipeline } = dado;
  const maiorFase = Math.max(1, ...dado.funil.map((f) => f.projetos));
  const semReserva = dado.reservaPorProjeto.filter((r) => r.saldoCents < 0);

  return (
    <div className="fin-caixa">
      {ressalvas.map((r) => (
        <Ressalva key={r}>{r}</Ressalva>
      ))}

      {/* ================= HERO ================= */}
      <section className="fin-card">
        <header className="fin-card-head">
          <h2>Hoje</h2>
          <p className="fin-card-hint">
            {dado.totalProjetos} projeto(s) de obras · última leitura do erp-obras{" "}
            {dado.ultimoSyncEm ? shortDateLabel(dado.ultimoSyncEm) : "indisponível"}
          </p>
        </header>
        <div className="medida-grid">
          {pipeline ? (
            <Medida rotulo="Contratado (ativo)" valorCents={pipeline.contratadoCents} detalhe="soma dos contratos ativos" />
          ) : (
            <Medida rotulo="Contratado (ativo)" valorCents={null} motivo="pipeline indisponível" />
          )}
          {pipeline ? (
            <Medida
              rotulo="Recebido"
              valorCents={pipeline.recebidoCents}
              detalhe="conferido contra o Asaas, não o status do erp"
            />
          ) : (
            <Medida rotulo="Recebido" valorCents={null} motivo="pipeline indisponível" />
          )}
          {dado.reservaObrasTotalCents !== null ? (
            <Medida rotulo="Reserva de obras hoje" valorCents={dado.reservaObrasTotalCents} detalhe="caixinha Nubank, por projeto abaixo" />
          ) : (
            <Medida rotulo="Reserva de obras hoje" valorCents={null} motivo="sem sincronização do erp-obras ainda" />
          )}
          {pipeline ? (
            <Medida
              rotulo="Vencido sem receber"
              valorCents={pipeline.inadimplenciaCents + pipeline.vencidoSemCobrancaCents}
              detalhe="inadimplência real + nunca cobrado, ver abaixo"
            />
          ) : (
            <Medida rotulo="Vencido sem receber" valorCents={null} motivo="pipeline indisponível" />
          )}
        </div>
      </section>

      {/* ================= FUNIL ================= */}
      <section className="fin-card">
        <header className="fin-card-head">
          <h2>Quantas obras, em que fase</h2>
          <p className="fin-card-hint">Projeto.status no erp-obras, só segmento Obras.</p>
        </header>
        <div className="obras-funil">
          {dado.funil.map((f) => (
            <div key={f.status} className="obras-funil-passo">
              <span className="obras-funil-n">{f.projetos}</span>
              <div className="obras-funil-barra">
                <i style={{ width: `${Math.round((f.projetos / maiorFase) * 100)}%` }} />
              </div>
              <span className="obras-funil-lab">{ROTULO_FASE[f.status] ?? f.status}</span>
            </div>
          ))}
        </div>
        {!dado.funil.some((f) => f.status === "EXECUCAO" || f.status === "ENCERRADO") && (
          <p className="fin-card-hint">
            Nenhum projeto está hoje em Execução ou Encerrado — a frente de obras é recente.
          </p>
        )}
      </section>

      {/* ================= PIPELINE ================= */}
      {pipeline && (
        <section className="fin-card">
          <header className="fin-card-head">
            <h2>Do contrato ao caixa</h2>
            <p className="fin-card-hint">
              Cada barra é o funil de dinheiro dos contratos ativos: quanto tem data marcada, quanto já
              entrou de fato.
            </p>
          </header>
          <div className="obras-ponte">
            <PonteLinha rotulo="Contratado" cents={pipeline.contratadoCents} base={pipeline.contratadoCents} cor="neutro" />
            <PonteLinha rotulo="Com cronograma" cents={pipeline.cronogramaCents} base={pipeline.contratadoCents} cor="accent" />
            <PonteLinha rotulo="Recebido" cents={pipeline.recebidoCents} base={pipeline.contratadoCents} cor="firme" />
            <PonteLinha rotulo="Cobrado, aguardando" cents={pipeline.emitidoCents} base={pipeline.contratadoCents} cor="observado" />
            <PonteLinha rotulo="Nunca cobrado" cents={pipeline.nuncaCobradoCents} base={pipeline.contratadoCents} cor="atrasado" />
          </div>

          <div className="medida-grid" style={{ marginTop: 14 }}>
            <div className="obras-nota">
              <SeloCamada camada="atrasado" texto="inadimplência real" />
              <strong>{brlPrecise(pipeline.inadimplenciaCents)}</strong>
              <span>Cobrança emitida, cliente ainda não pagou.</span>
            </div>
            <div className="obras-nota">
              <SeloCamada camada="indeterminado" texto="falha de processo" />
              <strong>{brlPrecise(pipeline.vencidoSemCobrancaCents)}</strong>
              <span>Já venceu e ninguém emitiu cobrança — não é dívida do cliente.</span>
            </div>
            <div className="obras-nota">
              <SeloCamada camada="provavel" texto="sem cronograma" />
              <strong>{brlPrecise(pipeline.contratadoCents - pipeline.cronogramaCents)}</strong>
              <span>Contratado sem parcela definida ainda.</span>
            </div>
            {pipeline.marcadoPagoSemDocumentoCents > 0 && (
              <div className="obras-nota">
                <SeloCamada camada="indeterminado" texto="conferir" />
                <strong>{brlPrecise(pipeline.marcadoPagoSemDocumentoCents)}</strong>
                <span>Marcado pago no erp-obras, sem documento do Asaas confirmando.</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ================= RESERVA DE OBRAS POR PROJETO ================= */}
      <section className="fin-card">
        <header className="fin-card-head">
          <h2>A reserva de obras, por projeto</h2>
          <p className="fin-card-hint">
            O erp-obras sabe de qual projeto cada real da caixinha veio — o app do banco só mostra o
            total.
          </p>
        </header>
        {dado.reservaPorProjeto.length ? (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>projeto</th>
                  <th>fase</th>
                  <th className="num">saldo na reserva</th>
                </tr>
              </thead>
              <tbody>
                {dado.reservaPorProjeto.map((r) => (
                  <tr key={r.projetoErpId ?? r.projetoNome ?? Math.random()}>
                    <td>{r.projetoNome ?? "sem projeto vinculado"}</td>
                    <td>{r.projetoStatus ? ROTULO_FASE[r.projetoStatus] ?? r.projetoStatus : "—"}</td>
                    <td className={`num fin-table-money${r.saldoCents < 0 ? " obras-negativo" : ""}`}>
                      {brlPrecise(r.saldoCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="fin-card-hint">Sem projetos vinculados à reserva ainda.</p>
        )}
        {semReserva.length > 0 && (
          <p className="fin-card-hint" style={{ marginTop: 10 }}>
            {semReserva.length} projeto(s) já resgataram da reserva mais do que depositaram — estão
            consumindo o pote de outro projeto, e isso só aparece olhando lançamento a lançamento.
          </p>
        )}
      </section>

      {/* ================= CUSTO ================= */}
      <section className="fin-card">
        <header className="fin-card-head">
          <h2>Custo real, por categoria</h2>
          <p className="fin-card-hint">
            Só o que foi pago de fato, sem contar aplicação/resgate de CDB — isso é caixa mudando de
            lugar, não despesa.
          </p>
        </header>
        {dado.custoPorCategoria.length ? (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>categoria</th>
                  <th className="num">lançamentos</th>
                  <th className="num">valor pago</th>
                </tr>
              </thead>
              <tbody>
                {dado.custoPorCategoria.map((c) => (
                  <tr key={c.categoria}>
                    <td>{c.categoria}</td>
                    <td className="num">{c.lancamentos}</td>
                    <td className="num fin-table-money">{brlPrecise(c.valorCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="fin-card-hint">Sem custo pago registrado ainda.</p>
        )}
      </section>

      {/* ================= ORÇAMENTO ================= */}
      <section className="fin-card">
        <header className="fin-card-head">
          <h2>Meta de orçamento x comprado</h2>
          <p className="fin-card-hint">
            Só os projetos com meta ou compra registrada — não finge cobertura dos {dado.totalProjetos}{" "}
            projetos de obras.
          </p>
        </header>
        {dado.orcamento.length ? (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>projeto</th>
                  <th className="num">meta de orçamento</th>
                  <th className="num">comprado</th>
                </tr>
              </thead>
              <tbody>
                {dado.orcamento.map((o) => (
                  <tr key={o.projetoErpId}>
                    <td>{o.projetoNome}</td>
                    <td className="num fin-table-money">
                      {o.metaCents !== null ? brlCompact(o.metaCents) : "—"}
                    </td>
                    <td className="num fin-table-money">
                      {o.compradoCents !== null ? brlCompact(o.compradoCents) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="fin-card-hint">Sem meta ou compra registrada ainda.</p>
        )}
      </section>
    </div>
  );
}

function PonteLinha({
  rotulo,
  cents,
  base,
  cor
}: {
  rotulo: string;
  cents: number;
  base: number;
  cor: "neutro" | "accent" | "firme" | "observado" | "atrasado";
}) {
  const pct = base > 0 ? Math.min(100, Math.round((cents / base) * 100)) : 0;
  return (
    <div className="obras-ponte-linha">
      <span className="obras-ponte-lab">{rotulo}</span>
      <div className="obras-ponte-barra">
        <i className={`obras-ponte-cor-${cor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="obras-ponte-val">{brlPrecise(cents)}</span>
    </div>
  );
}
