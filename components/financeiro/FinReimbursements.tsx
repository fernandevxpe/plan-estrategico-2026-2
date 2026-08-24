"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { PainelReembolsos, PessoaReembolso } from "@/lib/financeiro/reembolsos";
import { brlCents, brlPrecise, dateLabel, monthKeyLabel } from "@/lib/financeiro/format";

const ROTULO_STATUS: Record<string, string> = {
  rascunho: "rascunho",
  enviado: "enviado",
  aprovado: "aprovado",
  pago: "pago",
  rejeitado: "rejeitado"
};

const ROTULO_VINCULO: Record<string, string> = {
  clt: "CLT",
  pj: "PJ",
  socio: "sócio",
  estagiario: "estágio"
};

function cabecalhoMes(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return {
    mes: d.toLocaleDateString("pt-BR", { month: "long" }),
    ano: d.toLocaleDateString("pt-BR", { year: "numeric" })
  };
}

function paraCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(/[R$\s]/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const valor = Number(normalizado);
  if (!Number.isFinite(valor)) return null;
  return Math.round(valor * 100);
}

/**
 * Reembolsos: matriz pessoa × mês, gaveta por pessoa e previsão.
 *
 * A matriz reproduz a forma da aba "Reembolso 2026" porque é a forma que as
 * pessoas já sabem ler — trocar o desenho junto com a ferramenta faria a
 * migração custar duas aprendizagens em vez de uma.
 *
 * O que a planilha não tinha, e é o motivo real desta tela:
 *
 *  · PARCELAMENTO COM SALDO. "Impressora 3D 7/12 — faltam 5, R$ 1.424,55" é caixa
 *    já comprometido. Na planilha isso vivia na cabeça de alguém.
 *  · PREVISÃO DO MÊS SEGUINTE. Soma das próximas cotas em fin_reembolso_saldo_v
 *    (mesma conta do perfil). É a linha de reembolso que entra em contas a pagar
 *    ANTES do PIX.
 *  · APROVAR GERA A CONTA A PAGAR. O reembolso aprovado vira documento a pagar
 *    com data de planejamento carimbada, em vez de aparecer no extrato no fim do
 *    mês como surpresa.
 */
export function FinReimbursements({
  dados,
  pessoaInicial = null
}: {
  dados: PainelReembolsos;
  /** Abre a gaveta desta pessoa ao carregar — vem de `?pessoa=` no perfil. */
  pessoaInicial?: number | null;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<number | null>(() => {
    if (pessoaInicial && dados.pessoas.some((p) => p.id === pessoaInicial)) return pessoaInicial;
    return null;
  });
  const [mostrarForm, setMostrarForm] = useState(false);
  const [somenteAtivos, setSomenteAtivos] = useState(true);

  const pessoas = useMemo(
    () => (somenteAtivos ? dados.pessoas.filter((p) => p.status === "ativo") : dados.pessoas),
    [dados.pessoas, somenteAtivos]
  );

  const totalColuna = useMemo(() => pessoas.reduce((s, p) => s + p.totalCents, 0), [pessoas]);
  const previsaoTotal = useMemo(() => pessoas.reduce((s, p) => s + p.previsaoCents, 0), [pessoas]);
  const restanteTotal = useMemo(() => pessoas.reduce((s, p) => s + p.restanteCents, 0), [pessoas]);
  const totalPorMes = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const mes of dados.meses) mapa[mes] = pessoas.reduce((s, p) => s + (p.porMes[mes] ?? 0), 0);
    return mapa;
  }, [dados.meses, pessoas]);
  // Corta só o prefixo de meses todos zerados (set–dez/2025). O mês corrente
  // fica sempre, mesmo em —, para não pular de julho para setembro.
  const mesesVisiveis = useMemo(() => {
    const primeiroComValor = dados.meses.findIndex((mes) => (totalPorMes[mes] ?? 0) > 0);
    return primeiroComValor <= 0 ? dados.meses : dados.meses.slice(primeiroComValor);
  }, [dados.meses, totalPorMes]);
  const cabecalhoProximo = cabecalhoMes(dados.mesSeguinte);

  async function enviar(url: string, metodo: string, corpo?: unknown) {
    setErro(null);
    const resposta = await fetch(url, {
      method: metodo,
      headers: corpo ? { "Content-Type": "application/json" } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    if (!resposta.ok) {
      const json = await resposta.json().catch(() => ({}));
      setErro(json.error ?? `falha na operação (HTTP ${resposta.status})`);
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  if (!dados.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">Reembolsos indisponíveis</h2>
        <p>
          Sem conexão com o banco do financeiro. O restante da plataforma segue funcionando — só esta tela depende do
          PostgreSQL em tempo de request.
        </p>
      </section>
    );
  }

  return (
    <>
      {erro ? (
        <div className="fin-alert" role="alert">
          {erro}
        </div>
      ) : null}

      <section className="fin-kpi-row" aria-label="Indicadores de reembolso">
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Reembolsado em 12 meses</p>
          <p className="fin-kpi-value">{brlCents(totalColuna)}</p>
          <p className="fin-kpi-hint">{pessoas.length} pessoas no período</p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Mês corrente ({monthKeyLabel(dados.mesAtual)})</p>
          <p className="fin-kpi-value">{brlCents(totalPorMes[dados.mesAtual] ?? 0)}</p>
          <p className="fin-kpi-hint">o que já foi lançado até agora</p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Previsão {monthKeyLabel(dados.mesSeguinte)}</p>
          <p className="fin-kpi-value">{brlCents(previsaoTotal)}</p>
          <p className="fin-kpi-hint">próximas cotas das séries em aberto</p>
        </article>
      </section>

      <div className="fin-contas-acoes">
        <button type="button" className="fin-btn-primary" onClick={() => setMostrarForm((v) => !v)}>
          {mostrarForm ? "Fechar" : "Lançar reembolso"}
        </button>
        <label className="fin-check">
          <input type="checkbox" checked={somenteAtivos} onChange={(e) => setSomenteAtivos(e.target.checked)} />
          somente pessoas ativas
        </label>
      </div>

      {mostrarForm ? (
        <FormItemReembolso
          dados={dados}
          pendente={pendente}
          onCancelar={() => setMostrarForm(false)}
          onEnviar={async (corpo) => {
            const ok = await enviar("/api/financeiro/reembolsos", "POST", corpo);
            if (ok) setMostrarForm(false);
            return ok;
          }}
        />
      ) : null}

      <section className="card">
        <h2 className="card-title">Reembolso por pessoa, mês a mês</h2>
        <p className="fin-card-hint">
          Cada coluna é o mês em que o dinheiro saiu no extrato (PIX), não a competência do pedido. Pedido de julho
          pago em agosto aparece em agosto. Restante é o saldo ainda a pagar das séries parceladas; a última coluna de
          mês é previsão.
        </p>

        <div className="fin-matrix-wrap">
          <table className="fin-table fin-matrix fin-matrix-reembolso">
            <thead>
              <tr>
                <th className="fin-matrix-head">Pessoa</th>
                {mesesVisiveis.map((mes) => (
                  <th key={mes} className="num">
                    <span className="fin-mes-head">
                      <span>{cabecalhoMes(mes).mes}</span>
                      <small>{cabecalhoMes(mes).ano}</small>
                    </span>
                  </th>
                ))}
                <th className="num">
                  <span className="fin-mes-head">
                    <span>{cabecalhoProximo.mes}</span>
                    <small>{cabecalhoProximo.ano}</small>
                  </span>
                </th>
                <th className="num">Restante</th>
              </tr>
            </thead>
            <tbody>
              {pessoas.map((pessoa) => (
                <tr key={pessoa.id} className={aberta === pessoa.id ? "fin-linha-aberta" : undefined}>
                  <th className="fin-matrix-head">
                    {pessoa.itensMesAtual.length || pessoa.planos.length || pessoa.historico.length ? (
                      <button
                        type="button"
                        className="fin-pessoa-toggle"
                        aria-expanded={aberta === pessoa.id}
                        onClick={() => setAberta(aberta === pessoa.id ? null : pessoa.id)}
                      >
                        {aberta === pessoa.id ? "▾" : "▸"} {pessoa.nome}
                        <span className="fin-tag">{ROTULO_VINCULO[pessoa.employmentType] ?? pessoa.employmentType}</span>
                        {pessoa.status !== "ativo" ? <span className="fin-tag">inativo</span> : null}
                      </button>
                    ) : (
                      <span className="fin-pessoa-toggle fin-pessoa-toggle-estatico">
                        {pessoa.nome}
                        <span className="fin-tag">{ROTULO_VINCULO[pessoa.employmentType] ?? pessoa.employmentType}</span>
                        {pessoa.status !== "ativo" ? <span className="fin-tag">inativo</span> : null}
                      </span>
                    )}
                  </th>
                  {mesesVisiveis.map((mes) => {
                    const valor = pessoa.porMes[mes] ?? 0;
                    const status = pessoa.statusPorMes[mes];
                    return (
                      <td key={mes} className="num fin-table-money" title={status ? ROTULO_STATUS[status] : undefined}>
                        {valor ? (
                          <span className={status === "pago" ? "fin-in" : undefined}>{brlPrecise(valor)}</span>
                        ) : (
                          <span className="fin-zero">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="num fin-table-money fin-previsao">
                    {pessoa.previsaoCents ? brlPrecise(pessoa.previsaoCents) : <span className="fin-zero">—</span>}
                  </td>
                  <td className="num fin-table-money">
                    {pessoa.restanteCents ? brlPrecise(pessoa.restanteCents) : <span className="fin-zero">—</span>}
                  </td>
                </tr>
              ))}
              {!pessoas.length ? (
                <tr>
                  <td colSpan={mesesVisiveis.length + 3} className="fin-empty-row">
                    Nenhuma pessoa cadastrada.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <th className="fin-matrix-head">Total</th>
                {mesesVisiveis.map((mes) => (
                  <td key={mes} className="num fin-table-money">
                    {totalPorMes[mes] ? brlPrecise(totalPorMes[mes]) : <span className="fin-zero">—</span>}
                  </td>
                ))}
                <td className="num fin-table-money fin-previsao">
                  <strong>{brlPrecise(previsaoTotal)}</strong>
                </td>
                <td className="num fin-table-money">
                  <strong>{brlPrecise(restanteTotal)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="fin-card-hint">
          Colunas de mês = movimentação no caixa. A previsão de {cabecalhoProximo.mes} {cabecalhoProximo.ano} soma{" "}
          {brlPrecise(previsaoTotal)} (próximas cotas das séries). Restante das séries:{" "}
          {brlPrecise(restanteTotal)}.
        </p>
      </section>

      {aberta !== null ? (
        <GavetaPessoa
          pessoa={pessoas.find((p) => p.id === aberta) ?? dados.pessoas.find((p) => p.id === aberta)!}
          dados={dados}
          pendente={pendente}
          onAcao={enviar}
          onFechar={() => setAberta(null)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Gaveta: itens do mês, parcelamentos e histórico
// ---------------------------------------------------------------------------
function GavetaPessoa({
  pessoa,
  dados,
  pendente,
  onAcao,
  onFechar
}: {
  pessoa: PessoaReembolso;
  dados: PainelReembolsos;
  pendente: boolean;
  onAcao: (url: string, metodo: string, corpo?: unknown) => Promise<boolean>;
  onFechar: () => void;
}) {
  const reembolsoDoMes = pessoa.reimbursementIdPorMes[dados.mesAtual] ?? null;
  const statusDoMes = pessoa.statusPorMes[dados.mesAtual] ?? null;

  return (
    <section className="card fin-gaveta">
      <div className="fin-gaveta-head">
        <div>
          <h2 className="card-title">
            {pessoa.nome} · {monthKeyLabel(dados.mesAtual)}
          </h2>
          <p className="fin-card-hint">
            {brlPrecise(pessoa.porMes[dados.mesAtual] ?? 0)} no mês corrente
            {statusDoMes ? ` · ${ROTULO_STATUS[statusDoMes]}` : " · nada lançado"}
          </p>
        </div>
        <div className="fin-gaveta-acoes">
          {reembolsoDoMes && statusDoMes !== "pago" ? (
            <>
              {statusDoMes === "rascunho" ? (
                <button
                  type="button"
                  className="fin-btn-ghost"
                  disabled={pendente}
                  onClick={() => void onAcao(`/api/financeiro/reembolsos/${reembolsoDoMes}`, "PATCH", { status: "enviado" })}
                >
                  Enviar
                </button>
              ) : null}
              {statusDoMes !== "aprovado" ? (
                <button
                  type="button"
                  className="fin-btn-primary"
                  disabled={pendente}
                  onClick={() => void onAcao(`/api/financeiro/reembolsos/${reembolsoDoMes}`, "PATCH", { status: "aprovado" })}
                  title="Aprovar gera a conta a pagar com data de planejamento"
                >
                  Aprovar
                </button>
              ) : (
                <button
                  type="button"
                  className="fin-btn-primary"
                  disabled={pendente}
                  onClick={() => void onAcao(`/api/financeiro/reembolsos/${reembolsoDoMes}`, "PATCH", { status: "pago" })}
                >
                  Marcar como pago
                </button>
              )}
              <button
                type="button"
                className="fin-btn-ghost fin-btn-perigo"
                disabled={pendente}
                onClick={() => void onAcao(`/api/financeiro/reembolsos/${reembolsoDoMes}`, "PATCH", { status: "rejeitado" })}
              >
                Rejeitar
              </button>
            </>
          ) : null}
          <button type="button" className="fin-btn-ghost" onClick={onFechar}>
            Fechar
          </button>
        </div>
      </div>

      <h3 className="fin-sub-titulo">Itens de {monthKeyLabel(dados.mesAtual)}</h3>
      <table className="fin-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Tipo</th>
            <th>Descrição</th>
            <th>Categoria</th>
            <th>NF-e</th>
            <th className="num">Valor</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {pessoa.itensMesAtual.map((item) => (
            <tr key={item.id}>
              <td className="fin-nowrap">{dateLabel(item.expenseDate)}</td>
              <td className="fin-nowrap">{item.tipoNome ?? item.tipo ?? "—"}</td>
              <td>
                <span className="fin-desc">{item.descricao}</span>
                {item.installmentTotal ? (
                  <span className="fin-desc-sub">
                    parcela {item.installmentNumber}/{item.installmentTotal}
                  </span>
                ) : null}
              </td>
              <td>{item.categoriaCode ? <span className="fin-code">{item.categoriaCode}</span> : "—"}</td>
              <td className="fin-nowrap">
                {item.nfeKey ? <span className="fin-badge-ok">chave anexada</span> : <span className="fin-zero">—</span>}
              </td>
              <td className="num fin-table-money">{brlPrecise(item.amountCents)}</td>
              <td className="fin-nowrap">
                {statusDoMes !== "pago" ? (
                  <button
                    type="button"
                    className="fin-btn-ghost fin-btn-mini fin-btn-perigo"
                    disabled={pendente}
                    onClick={() => void onAcao(`/api/financeiro/reembolsos/${item.id}`, "DELETE")}
                  >
                    excluir
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
          {!pessoa.itensMesAtual.length ? (
            <tr>
              <td colSpan={7} className="fin-empty-row">
                Nada lançado neste mês.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <h3 className="fin-sub-titulo">Parcelamentos em curso</h3>
      {pessoa.planos.length ? (
        <ul className="fin-planos">
          {pessoa.planos.map((plano) => (
            <li key={plano.id} className="fin-plano">
              <strong>{plano.rotulo}</strong>
              <span>
                faltam {plano.parcelasRestantes}, {brlPrecise(plano.saldoRestanteCents)}
              </span>
              <em>
                {brlPrecise(plano.mensalCents)}/mês · total {brlPrecise(plano.totalCents)} · desde{" "}
                {monthKeyLabel(plano.primeiraParcela)}
              </em>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fin-empty-row">Nenhum parcelamento ativo.</p>
      )}

      <h3 className="fin-sub-titulo">Previsão de {monthKeyLabel(dados.mesSeguinte)}</h3>
      <p className="fin-previsao-detalhe">
        <strong>{brlPrecise(pessoa.previsaoCents)}</strong> = soma das próximas cotas das séries ainda em aberto
        (mesma conta do perfil).
      </p>

      <h3 className="fin-sub-titulo">Histórico</h3>
      <table className="fin-table">
        <thead>
          <tr>
            <th>Mês</th>
            <th>Status</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {pessoa.historico.map((linha) => (
            <tr key={linha.mes}>
              <td className="fin-nowrap">{monthKeyLabel(linha.mes)}</td>
              <td>
                <span className="fin-tag">{linha.status ? ROTULO_STATUS[linha.status] : "—"}</span>
              </td>
              <td className="num fin-table-money">{brlPrecise(linha.totalCents)}</td>
            </tr>
          ))}
          {!pessoa.historico.length ? (
            <tr>
              <td colSpan={3} className="fin-empty-row">
                Sem histórico nos últimos 12 meses.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Formulário de lançamento
// ---------------------------------------------------------------------------
function FormItemReembolso({
  dados,
  pendente,
  onEnviar,
  onCancelar
}: {
  dados: PainelReembolsos;
  pendente: boolean;
  onEnviar: (corpo: Record<string, unknown>) => Promise<boolean>;
  onCancelar: () => void;
}) {
  const [personId, setPersonId] = useState(String(dados.pessoas[0]?.id ?? ""));
  const [mes, setMes] = useState(dados.mesAtual.slice(0, 7));
  const [tipo, setTipo] = useState(dados.tipos[0]?.slug ?? "");
  const [descricao, setDescricao] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [valor, setValor] = useState("");
  const [parcelado, setParcelado] = useState(false);
  const [parcelasTotal, setParcelasTotal] = useState("12");
  const [nfeKey, setNfeKey] = useState("");
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  const tipoAtual = dados.tipos.find((t) => t.slug === tipo);
  const podeParcelar = tipoAtual?.allowsInstallment ?? false;
  const exigeNfe = tipoAtual?.requiresNfe ?? false;

  return (
    <section className="card fin-form-novo">
      <h2 className="card-title">Lançar reembolso</h2>
      <p className="fin-card-hint">
        Cada lançamento entra no reembolso da pessoa naquele mês — que é criado sozinho na primeira despesa. Parcelado,
        o lançamento gera um item por mês de uma vez: um compromisso que só aparece mês a mês é um compromisso
        invisível.
      </p>

      <div className="fin-form-grid">
        <label className="fin-field">
          <span>Pessoa</span>
          <select className="fin-select" value={personId} onChange={(e) => setPersonId(e.target.value)}>
            {dados.pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="fin-field">
          <span>Mês de referência</span>
          <input className="fin-select" type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
        </label>

        <label className="fin-field">
          <span>Tipo</span>
          <select
            className="fin-select"
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value);
              const proximo = dados.tipos.find((t) => t.slug === e.target.value);
              if (!proximo?.allowsInstallment) setParcelado(false);
            }}
          >
            {dados.tipos.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
                {t.categoriaCode ? ` · ${t.categoriaCode}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="fin-field">
          <span>Data da despesa</span>
          <input className="fin-select" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
        </label>

        <label className="fin-field fin-field-wide">
          <span>Descrição</span>
          <input
            className="fin-input"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder={parcelado ? "Impressora 3D" : "Uber para a obra de Fortaleza"}
          />
        </label>

        <label className="fin-field">
          <span>{parcelado ? "Valor da parcela" : "Valor"}</span>
          <input
            className="fin-input"
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="284,91"
          />
        </label>

        {podeParcelar ? (
          <label className="fin-field">
            <span>Parcelamento</span>
            <span className="fin-parcelado">
              <label className="fin-check">
                <input type="checkbox" checked={parcelado} onChange={(e) => setParcelado(e.target.checked)} />
                parcelado
              </label>
              {parcelado ? (
                <input
                  className="fin-input fin-input-parcelas"
                  inputMode="numeric"
                  value={parcelasTotal}
                  onChange={(e) => setParcelasTotal(e.target.value)}
                  aria-label="Total de parcelas"
                />
              ) : null}
            </span>
          </label>
        ) : null}

        <label className="fin-field fin-field-wide">
          <span>Chave da NF-e {exigeNfe ? "(obrigatória para este tipo)" : "(opcional)"}</span>
          <input
            className="fin-input"
            inputMode="numeric"
            value={nfeKey}
            onChange={(e) => setNfeKey(e.target.value)}
            placeholder="44 dígitos, sem máscara"
          />
          <em className="fin-field-hint">
            Só a chave por enquanto. O anexo do arquivo (PDF/XML) entra junto com a etapa de armazenamento — a coluna
            já existe no banco esperando por ele.
          </em>
        </label>
      </div>

      {parcelado ? (
        <p className="fin-card-hint">
          Serão gerados {parcelasTotal || "?"} itens de {valor || "?"} a partir de {mes} — total{" "}
          {brlPrecise((paraCentavos(valor) ?? 0) * (Number(parcelasTotal) || 0))}.
        </p>
      ) : null}

      {erroLocal ? (
        <p className="fin-alert" role="alert">
          {erroLocal}
        </p>
      ) : null}

      <div className="fin-form-acoes">
        <button
          type="button"
          className="fin-btn-primary"
          disabled={pendente}
          onClick={async () => {
            setErroLocal(null);
            const centavos = paraCentavos(valor);
            if (!personId) return setErroLocal("escolha a pessoa");
            if (!descricao.trim()) return setErroLocal("informe a descrição");
            if (!centavos || centavos <= 0) return setErroLocal("informe um valor maior que zero");
            const ok = await onEnviar({
              personId: Number(personId),
              referenceMonth: mes,
              tipo: tipo || null,
              descricao: descricao.trim(),
              expenseDate: expenseDate || null,
              valorCents: parcelado ? undefined : centavos,
              parcelado,
              parcelasTotal: parcelado ? Number(parcelasTotal) : undefined,
              parcelaCents: parcelado ? centavos : undefined,
              nfeKey: nfeKey.trim() || null
            });
            if (ok) {
              setDescricao("");
              setValor("");
              setNfeKey("");
            }
          }}
        >
          {parcelado ? `Lançar ${parcelasTotal || ""} parcelas` : "Lançar"}
        </button>
        <button type="button" className="fin-btn-ghost" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </section>
  );
}
