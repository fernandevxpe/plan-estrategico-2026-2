import { brl, Medida, Ressalva, SeloCamada } from "@/components/financeiro/Certeza";
import type { AliquotaMes, JanelaMei, PanoramaMei, VeredictoAnexo } from "@/lib/financeiro/contratos";
import type { Contrato } from "@/lib/financeiro/contratos/base";

/**
 * A tela do teto do MEI.
 *
 * ---------------------------------------------------------------------------
 * A ORDEM DA PÁGINA É A ORDEM DA URGÊNCIA, NÃO A DO SCHEMA
 * ---------------------------------------------------------------------------
 * Quem estoura primeiro aparece primeiro, e a ressalva de que a medida é PISO
 * vem ANTES da primeira barra — pelo mesmo motivo do componente `Ressalva`: um
 * rodapé explicando chega tarde, a pessoa já leu o número e formou opinião.
 *
 * A barra tem DOIS marcos, não um. O teto (100%) e o teto mais 20% (120%) são
 * consequências jurídicas diferentes — desenquadrar em janeiro do ano que vem
 * ou reapurar o ano inteiro que já passou —, e uma barra com um marco só faria
 * as duas parecerem a mesma coisa.
 */

const ROTULO_SITUACAO: Record<JanelaMei["situacao"], string> = {
  dentro: "dentro do teto",
  projeta_exceder_ate_20: "projeta exceder até 20%",
  projeta_exceder_acima_20: "projeta exceder ACIMA de 20%",
  excedido_ate_20: "excedido até 20%",
  excedido_acima_20: "EXCEDIDO acima de 20%"
};

export function FinMei({ contrato }: { contrato: Contrato<PanoramaMei> }) {
  if (!contrato.disponivel) {
    return (
      <Ressalva>
        A janela do teto não está disponível neste ambiente:{" "}
        <strong>{contrato.ressalvas[0] ?? "motivo não informado"}</strong>. A tela existe, a medida
        ainda não — e dizer isso vale mais que mostrar zero.
      </Ressalva>
    );
  }

  const d = contrato.dado;
  const emRisco = d.janelas.filter((j) => j.situacao !== "dentro");
  const dentro = d.janelas.filter((j) => j.situacao === "dentro");
  const limite = d.janelas[0]?.limiteCents ?? null;

  return (
    <div style={{ display: "grid", gap: 26 }}>
      {/* ---- a ressalva vem antes de qualquer número ---- */}
      <Ressalva>
        <strong>Esta janela é piso, não valor.</strong> Ela conta apenas o que a XPE pagou. O teto do{" "}
        art. 18-A incide sobre a receita bruta <em>total</em> do MEI, de todos os clientes dele — se
        houver outro contratante, o percentual real é maior que o mostrado aqui. Leitura gerencial:
        não substitui apuração nem parecer, e depende de validação do contador.
      </Ressalva>

      {/* ---- o cabeçalho de medidas ---- */}
      <section style={{ display: "grid", gap: 12 }}>
        <div className="medida-grid" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}>
          <Medida
            rotulo={`Teto do MEI · ${d.ano}`}
            valorCents={limite ?? 0}
            detalhe={
              d.janelas[0]
                ? `${d.janelas[0].baseLegal.slice(0, 64)}… · conferido em ${fmtData(d.janelas[0].fonteConsultadaEm)}`
                : undefined
            }
          />
          <Medida
            rotulo="Pago a MEIs no ano"
            valorCents={d.janelas.reduce((s, j) => s + j.recebidoCents, 0)}
            detalhe={`${d.janelas.length} prestadores`}
          />
          <Medida
            rotulo="Multa e juros medidos"
            valorCents={d.multaTotalCents}
            detalhe={
              d.multas.length
                ? `${d.multas.length} pagamento(s) com acréscimo · acervo inteiro`
                : "nenhum acréscimo achado no acervo"
            }
          />
          {d.dasReferenciaCount === 0 ? (
            <Medida
              rotulo="DAS de referência"
              valorCents={null}
              motivo="nenhum anexado ainda — a estrutura existe e espera o papel"
            />
          ) : (
            <Medida rotulo="DAS de referência" valorCents={0} detalhe={`${d.dasReferenciaCount} anexados`} />
          )}
        </div>
        <p className="fin-nota" style={{ fontSize: 12.5, opacity: 0.8, margin: 0 }}>
          {d.multaNaoMedivelMotivo}
        </p>
      </section>

      {/* ---- quem está em risco, primeiro ---- */}
      {emRisco.length > 0 ? (
        <section>
          <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Em risco de estourar o teto</h2>
          <p style={{ fontSize: 13, opacity: 0.8, margin: "0 0 12px" }}>
            O ritmo é medido só sobre meses <strong>completos</strong>: incluir o mês corrente, que
            hoje tem metade dos dias, puxaria o ritmo para baixo e adiaria o cruzamento — erro para o
            lado errado justamente em quem está perto do teto.
          </p>
          <div style={{ display: "grid", gap: 14 }}>
            {emRisco.map((j) => (
              <CartaoJanela key={j.personId} j={j} destaque />
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- os demais ---- */}
      {dentro.length > 0 ? (
        <section>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Dentro do teto no ritmo medido</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="fin-tabela-simples">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>prestador</th>
                  <th>recebido da XPE</th>
                  <th>% do teto</th>
                  <th>ritmo/mês</th>
                  <th>projeção do ano</th>
                  <th>% projetado</th>
                  <th style={{ textAlign: "left" }}>espaço que sobra</th>
                </tr>
              </thead>
              <tbody>
                {dentro.map((j) => (
                  <tr key={j.personId}>
                    <td style={{ textAlign: "left" }}>
                      {j.pessoa}
                      {j.situacaoCadastro === "inativo" ? (
                        <span style={{ opacity: 0.6, fontSize: 11 }}> · inativo no cadastro</span>
                      ) : null}
                    </td>
                    <td>{brl(j.recebidoCents)}</td>
                    <td>{pct(j.pctDoLimite)}</td>
                    <td>{j.ritmoMensalCents === null ? "—" : brl(j.ritmoMensalCents)}</td>
                    <td>{j.projecaoFechamentoCents === null ? "—" : brl(j.projecaoFechamentoCents)}</td>
                    <td>{j.pctProjetado === null ? "—" : pct(j.pctProjetado)}</td>
                    <td style={{ textAlign: "left" }}>{brl(j.faltaParaOLimiteCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* ---- a faixa de alerta que NÃO foi inventada ---- */}
      {d.janelas[0] ? (
        <section className="cert-hachura" style={{ padding: "12px 14px", borderRadius: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <SeloCamada camada="indeterminado" texto="faixa de alerta antecipado" />
          </div>
          <p style={{ margin: 0, fontSize: 13 }}>{d.janelas[0].alertaAntecipadoMotivo}</p>
        </section>
      ) : null}

      {/* ---- as multas ---- */}
      <section>
        <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>As multas, achadas pela aritmética</h2>
        <p style={{ fontSize: 13, opacity: 0.8, margin: "0 0 12px" }}>
          Nesta base a multa nunca é um rótulo — é um excedente embutido no valor de um pagamento.
          Só o DAS-MEI tem valor esperado derivável da lei, e é por isso que ele é o único lugar onde
          o excedente aparece.
        </p>
        {d.multas.length === 0 ? (
          <Medida
            rotulo="Acréscimos no acervo"
            valorCents={null}
            motivo="nenhum pagamento com valor diferente do esperado — o que não é o mesmo que nenhuma multa"
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="fin-tabela-simples">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>data</th>
                  <th>pago</th>
                  <th>principal</th>
                  <th>multa</th>
                  <th>juros</th>
                  <th>atraso mínimo</th>
                  <th style={{ textAlign: "left" }}>como se sabe</th>
                </tr>
              </thead>
              <tbody>
                {d.multas.map((m) => (
                  <tr key={m.transactionId}>
                    <td style={{ textAlign: "left" }}>{fmtData(m.postedOn)}</td>
                    <td>{brl(m.valorCents)}</td>
                    <td>{brl(m.principalCents)}</td>
                    <td>{brl(m.multaCents)}</td>
                    <td>{brl(m.jurosCents)}</td>
                    <td>{m.diasAtrasoMinimo === null ? "—" : `${m.diasAtrasoMinimo} dias`}</td>
                    <td style={{ textAlign: "left", fontSize: 12 }}>
                      {m.contemJurosProvado ? (
                        <SeloCamada camada="firme" texto="juros provado pelo teto de 20%" />
                      ) : (
                        <SeloCamada camada="observado" />
                      )}
                      <div style={{ opacity: 0.75, marginTop: 4 }}>{m.memoria}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- o veredito sobre o anexo ---- */}
      <section>
        <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>O anexo do Simples: três leituras lado a lado</h2>
        <p style={{ fontSize: 13, opacity: 0.8, margin: "0 0 12px" }}>
          O Fator R é razão entre <strong>12 meses de folha</strong> e 12 meses de receita. Os
          extratos começam em 01/01/2026, então a folha da janela é curta e a receita é inteira — a
          coluna “medido” compara janelas diferentes e por isso é piso. A coluna “recomposto” põe as
          duas em 12 meses. A terceira leitura é independente das outras duas: qual anexo o DAS
          efetivamente pago reproduz.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="fin-tabela-simples">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>competência</th>
                <th>meses de folha</th>
                <th>Fator R medido</th>
                <th>recomposto 12m</th>
                <th>limiar</th>
                <th>pelo recomposto</th>
                <th>pelo DAS pago</th>
                <th style={{ textAlign: "left" }}>concordam?</th>
              </tr>
            </thead>
            <tbody>
              {d.veredito.map((v) => (
                <tr key={v.competencia}>
                  <td style={{ textAlign: "left" }}>{v.competencia.slice(0, 7)}</td>
                  <td>{v.mesesComFolha} / 12</td>
                  <td>{v.fatorRMedido === null ? "—" : pct(v.fatorRMedido)}</td>
                  <td>{v.fatorRRecomposto === null ? "—" : pct(v.fatorRRecomposto)}</td>
                  <td>{pct(v.limiarLegal)}</td>
                  <td>{v.anexoPeloRecomposto ?? "—"}</td>
                  <td>{v.anexoPeloDasPago ?? "—"}</td>
                  <td style={{ textAlign: "left" }}>{selo(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- a alíquota mês a mês ---- */}
      <section>
        <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>A alíquota efetiva, mês a mês</h2>
        <p style={{ fontSize: 13, opacity: 0.8, margin: "0 0 12px" }}>
          Não é a alíquota nominal da faixa: é a efetiva do art. 18 § 1º-A, que muda todo mês porque
          o RBT12 muda todo mês. O DAS calculado usa as NFS-e desta base e por isso é piso — nota
          emitida fora do Asaas não está aqui.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="fin-tabela-simples">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>competência</th>
                <th>anexo</th>
                <th>RBT12</th>
                <th>receita</th>
                <th>nominal</th>
                <th>efetiva</th>
                <th>DAS calculado</th>
                <th>DAS pago</th>
                <th>diferença</th>
              </tr>
            </thead>
            <tbody>
              {d.aliquotas.map((a) => (
                <LinhaAliquota key={`${a.competencia}-${a.anexo}`} a={a} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function CartaoJanela({ j, destaque }: { j: JanelaMei; destaque?: boolean }) {
  const acima20 = j.situacao.endsWith("acima_20");
  // Escala da barra: 130% do teto, para que o marco dos 120% caiba dentro dela
  // em vez de encostar na borda e virar decoração.
  const escala = 1.3;
  const larguraAtual = Math.min(100, (j.pctDoLimite / escala) * 100);
  const larguraProj =
    j.pctProjetado === null ? null : Math.min(100, (j.pctProjetado / escala) * 100);

  return (
    <div
      style={{
        border: `1px solid ${destaque ? "var(--cert-atrasado, #c0392b)" : "var(--line)"}`,
        borderLeft: `3px solid ${destaque ? "var(--cert-atrasado, #c0392b)" : "var(--line)"}`,
        borderRadius: "0 6px 6px 0",
        padding: "14px 16px"
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10 }}>
        <strong style={{ fontSize: 15 }}>{j.pessoa}</strong>
        {j.cnpj ? <span style={{ opacity: 0.6, fontSize: 12 }}>CNPJ {j.cnpj}</span> : null}
        <SeloCamada camada={acima20 ? "atrasado" : "provavel"} texto={ROTULO_SITUACAO[j.situacao]} />
      </div>

      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
          margin: "12px 0"
        }}
      >
        <Medida rotulo="recebido da XPE no ano" valorCents={j.recebidoCents} detalhe={pct(j.pctDoLimite) + " do teto"} />
        <Medida rotulo="espaço que sobra" valorCents={j.faltaParaOLimiteCents} />
        <Medida
          rotulo="ritmo mensal"
          valorCents={j.ritmoMensalCents ?? 0}
          detalhe="média dos meses completos"
        />
        <Medida
          rotulo="projeção de fechamento"
          valorCents={j.projecaoFechamentoCents ?? 0}
          detalhe={j.pctProjetado === null ? undefined : pct(j.pctProjetado) + " do teto"}
        />
      </div>

      {/* A barra com os DOIS marcos da lei. */}
      <div style={{ position: "relative", height: 20, marginBottom: 6 }}>
        <div style={{ position: "absolute", inset: 0, background: "var(--line)", borderRadius: 3 }} />
        {larguraProj !== null ? (
          <div
            title="projeção de fechamento no ritmo medido"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${larguraProj}%`,
              background: "var(--cert-provavel-bg, rgba(120,120,120,.35))",
              borderRadius: 3
            }}
          />
        ) : null}
        <div
          title="recebido até hoje"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${larguraAtual}%`,
            background: acima20 ? "var(--cert-atrasado, #c0392b)" : "var(--cert-firme, #2d7)",
            borderRadius: 3
          }}
        />
        <Marco pos={(1 / escala) * 100} rotulo="teto" />
        <Marco pos={(1.2 / escala) * 100} rotulo="+20%" />
      </div>

      {j.mesCruzamento ? (
        <p style={{ margin: "10px 0 0", fontSize: 13 }}>
          No ritmo medido, cruza o teto em <strong>{j.mesCruzamento.slice(0, 7)}</strong>
          {j.mesesAteCruzar !== null ? ` (${j.mesesAteCruzar.toFixed(2)} mês de ritmo)` : ""}.
        </p>
      ) : null}

      <p style={{ margin: "8px 0 0", fontSize: 13 }}>{j.efeitoLegal}</p>

      {j.ressalvaLimiteProporcional ? (
        <p style={{ margin: "8px 0 0", fontSize: 12.5, opacity: 0.8 }}>
          {j.ressalvaLimiteProporcional}
        </p>
      ) : null}

      <p style={{ margin: "8px 0 0", fontSize: 12, opacity: 0.75 }}>{j.porQueEPiso}</p>

      <p style={{ margin: "8px 0 0", fontSize: 11.5, opacity: 0.65 }}>
        {j.baseLegal} ·{" "}
        <a href={j.fonteUrl} target="_blank" rel="noreferrer">
          fonte
        </a>{" "}
        · conferido em {fmtData(j.fonteConsultadaEm)}
      </p>
    </div>
  );
}

function Marco({ pos, rotulo }: { pos: number; rotulo: string }) {
  return (
    <span
      style={{
        position: "absolute",
        left: `${pos}%`,
        top: -3,
        bottom: -3,
        width: 2,
        background: "var(--ink)",
        opacity: 0.55
      }}
      title={rotulo}
    >
      <span
        style={{
          position: "absolute",
          top: -14,
          left: 3,
          fontSize: 10,
          opacity: 0.8,
          whiteSpace: "nowrap"
        }}
      >
        {rotulo}
      </span>
    </span>
  );
}

function LinhaAliquota({ a }: { a: AliquotaMes }) {
  return (
    <tr title={a.memoria}>
      <td style={{ textAlign: "left" }}>{a.competencia.slice(0, 7)}</td>
      <td>{a.anexo}</td>
      <td>{brl(a.rbt12Cents)}</td>
      <td>{brl(a.receitaCents)}</td>
      <td>{pct(a.aliquotaNominal)}</td>
      <td>
        <strong>{a.aliquotaEfetiva === null ? "—" : pct(a.aliquotaEfetiva, 4)}</strong>
      </td>
      <td>{a.dasCalculadoCents === null ? "—" : brl(a.dasCalculadoCents)}</td>
      <td>{a.dasPagoCents === null ? "—" : brl(a.dasPagoCents)}</td>
      <td>{a.diferencaCents === null ? "—" : brl(a.diferencaCents)}</td>
    </tr>
  );
}

function selo(v: VeredictoAnexo) {
  if (v.concorda === null) {
    return <SeloCamada camada="indeterminado" texto="DAS da competência ainda não venceu" />;
  }
  return v.concorda ? (
    <SeloCamada camada="firme" texto={`as duas dizem Anexo ${v.anexoPeloRecomposto}`} />
  ) : (
    <SeloCamada camada="indeterminado" texto="leituras divergem" />
  );
}

const pct = (v: number, casas = 1) => `${(v * 100).toFixed(casas)}%`;

const fmtData = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "—");
