"use client";

import { Fragment, useMemo, useState } from "react";

import type { BandaRemuneracao, CustoPessoas, Pessoa } from "@/lib/financeiro/pessoas";
import { brlCents, brlPrecise, monthKeyLabel, pct } from "@/lib/financeiro/format";

const ROTULO_BANDA: Record<string, string> = {
  salario: "Salário",
  prolabore: "Pró-labore",
  comissao: "Comissão",
  estagio: "Estágio",
  extra: "Extra",
  encargo_beneficio: "Encargo / benefício",
  reembolso: "Reembolso"
};

/**
 * Matriz pessoa × mês com composição (salário, pró-labore, comissão…).
 *
 * Fonte: `fin_time_remuneracao_mes_v` — a mesma do perfil da pessoa. O extrato
 * não corta as fatias; a view reconstrói. Reembolso fica de fora por padrão:
 * tem tela própria e somá-lo aqui misturava custo de gente com devolução.
 */
export function FinPessoasMatriz({
  dados,
  bandas,
  meses,
  pessoaPorId,
  mesAtual
}: {
  dados: CustoPessoas;
  bandas: BandaRemuneracao[];
  meses: string[];
  pessoaPorId: Map<number, Pessoa>;
  mesAtual: string;
}) {
  const [tipo, setTipo] = useState("");
  const [pessoaId, setPessoaId] = useState<number | "">("");
  const [incluirReembolso, setIncluirReembolso] = useState(false);
  const [aberta, setAberta] = useState<number | null>(null);

  const bandasVisiveis = useMemo(
    () =>
      bandas.filter((b) => {
        if (!meses.includes(b.mes)) return false;
        if (!incluirReembolso && b.natureza === "reembolso") return false;
        if (tipo && b.natureza !== tipo) return false;
        if (pessoaId !== "" && b.personId !== pessoaId) return false;
        return true;
      }),
    [bandas, meses, incluirReembolso, tipo, pessoaId]
  );

  const linhas = useMemo(() => {
    const mapa = new Map<
      number,
      {
        pessoa: Pessoa;
        porMes: Record<string, number>;
        porTipoMes: Record<string, Record<string, number>>;
        totalCents: number;
      }
    >();
    for (const b of bandasVisiveis) {
      const pessoa = pessoaPorId.get(b.personId);
      if (!pessoa) continue;
      const atual = mapa.get(b.personId) ?? {
        pessoa,
        porMes: {},
        porTipoMes: {},
        totalCents: 0
      };
      atual.porMes[b.mes] = (atual.porMes[b.mes] ?? 0) + b.cents;
      if (!atual.porTipoMes[b.mes]) atual.porTipoMes[b.mes] = {};
      atual.porTipoMes[b.mes][b.natureza] = (atual.porTipoMes[b.mes][b.natureza] ?? 0) + b.cents;
      atual.totalCents += b.cents;
      mapa.set(b.personId, atual);
    }
    return [...mapa.values()].sort((a, b) => b.totalCents - a.totalCents);
  }, [bandasVisiveis, pessoaPorId]);

  const mesesVisiveis = useMemo(() => {
    const comValor = new Set(bandasVisiveis.map((b) => b.mes));
    // Sem filtro de tipo/pessoa: corta só o prefixo vazio (set–dez/2025).
    // Com filtro ativo: mostra o recorte pedido para não “sumir” meses.
    if (tipo || pessoaId !== "") return meses;
    const primeiro = meses.findIndex((m) => comValor.has(m));
    return primeiro <= 0 ? meses : meses.slice(primeiro);
  }, [meses, bandasVisiveis, tipo, pessoaId]);

  const totalPorMes = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const mes of mesesVisiveis) mapa[mes] = linhas.reduce((s, l) => s + (l.porMes[mes] ?? 0), 0);
    return mapa;
  }, [linhas, mesesVisiveis]);

  const totalPorTipo = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const b of bandasVisiveis) mapa[b.natureza] = (mapa[b.natureza] ?? 0) + b.cents;
    return mapa;
  }, [bandasVisiveis]);

  const totalGeral = linhas.reduce((s, l) => s + l.totalCents, 0);

  const tiposNoFiltro = useMemo(() => {
    const base = incluirReembolso
      ? dados.tiposRemuneracao
      : dados.tiposRemuneracao.filter((t) => t.slug !== "reembolso");
    return base;
  }, [dados.tiposRemuneracao, incluirReembolso]);

  const pessoasComBanda = useMemo(() => {
    const ids = new Set(bandas.filter((b) => meses.includes(b.mes)).map((b) => b.personId));
    return [...ids]
      .map((id) => pessoaPorId.get(id))
      .filter((p): p is Pessoa => Boolean(p))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [bandas, meses, pessoaPorId]);

  const mesesFechados = mesesVisiveis.filter((mes) => mes !== mesAtual && totalPorMes[mes] > 0);
  const primeiroFechado = mesesFechados[0] ?? null;
  const ultimoFechado = mesesFechados[mesesFechados.length - 1] ?? null;
  const crescimentoPct =
    primeiroFechado && ultimoFechado && primeiroFechado !== ultimoFechado && totalPorMes[primeiroFechado]
      ? ((totalPorMes[ultimoFechado] - totalPorMes[primeiroFechado]) / totalPorMes[primeiroFechado]) * 100
      : null;

  const maiorAlta = useMemo(() => {
    if (!primeiroFechado || !ultimoFechado || primeiroFechado === ultimoFechado) return null;
    const candidatos = linhas
      .map((linha) => ({
        nome: linha.pessoa.nome,
        de: linha.porMes[primeiroFechado] ?? 0,
        para: linha.porMes[ultimoFechado] ?? 0
      }))
      .filter((c) => c.de > 0)
      .map((c) => ({ ...c, delta: c.para - c.de, pctVar: ((c.para - c.de) / c.de) * 100 }))
      .sort((a, b) => b.delta - a.delta);
    return candidatos[0] ?? null;
  }, [linhas, primeiroFechado, ultimoFechado]);

  return (
    <section className="card fin-painel-grafico" aria-label="Custo por pessoa, mês a mês">
      <header className="fin-painel-grafico-head">
        <h3>
          {crescimentoPct === null
            ? "Custo por pessoa, mês a mês"
            : `A folha ${crescimentoPct >= 0 ? "subiu" : "caiu"} ${pct(Math.abs(crescimentoPct), 0)} de ${monthKeyLabel(primeiroFechado!)} a ${monthKeyLabel(ultimoFechado!)}${maiorAlta && maiorAlta.delta > 0 ? `, e ${maiorAlta.nome} responde pela maior alta individual` : ""}`}
        </h3>
        <p>
          {primeiroFechado && ultimoFechado
            ? `${brlCents(totalPorMes[primeiroFechado])} em ${monthKeyLabel(primeiroFechado)} contra ${brlCents(totalPorMes[ultimoFechado])} em ${monthKeyLabel(ultimoFechado)}, considerando só meses fechados. `
            : ""}
          {maiorAlta && maiorAlta.delta > 0
            ? `${maiorAlta.nome} passou de ${brlCents(maiorAlta.de)} para ${brlCents(maiorAlta.para)} (${maiorAlta.pctVar >= 0 ? "+" : "−"}${pct(Math.abs(maiorAlta.pctVar), 0)}). `
            : ""}
          Composição = mesma conta do perfil (salário, pró-labore, comissão…). Reembolso{" "}
          {incluirReembolso ? "incluído" : "fora por padrão"} — tem tela própria.
        </p>
      </header>

      <div className="fin-contas-acoes" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <label className="fin-check">
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Filtrar por tipo">
            <option value="">Todos os tipos</option>
            {tiposNoFiltro.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="fin-check">
          Pessoa
          <select
            value={pessoaId === "" ? "" : String(pessoaId)}
            onChange={(e) => setPessoaId(e.target.value ? Number(e.target.value) : "")}
            aria-label="Filtrar por pessoa"
          >
            <option value="">Todas as pessoas</option>
            {pessoasComBanda.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="fin-check">
          <input
            type="checkbox"
            checked={incluirReembolso}
            onChange={(e) => setIncluirReembolso(e.target.checked)}
          />
          incluir reembolso
        </label>
      </div>

      {Object.keys(totalPorTipo).length > 1 || tipo ? (
        <p className="fin-card-hint" style={{ marginTop: "0.5rem" }}>
          No recorte:{" "}
          {tiposNoFiltro
            .filter((t) => (totalPorTipo[t.slug] ?? 0) > 0)
            .map((t) => `${t.nome} ${brlPrecise(totalPorTipo[t.slug] ?? 0)}`)
            .join(" · ") || "—"}
          {" · "}
          <strong>Total {brlPrecise(totalGeral)}</strong>
        </p>
      ) : null}

      <div className="fin-matrix-wrap">
        <table className="fin-table fin-matrix">
          <thead>
            <tr>
              <th className="fin-matrix-head">Pessoa</th>
              {mesesVisiveis.map((mes) => (
                <th key={mes} className="num">
                  {monthKeyLabel(mes)}
                  {mes === mesAtual ? <span className="fin-tag">parcial</span> : null}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => {
              const expandida = aberta === linha.pessoa.id;
              const tiposLinha = tiposNoFiltro.filter((t) =>
                mesesVisiveis.some((mes) => (linha.porTipoMes[mes]?.[t.slug] ?? 0) > 0)
              );
              return (
                <Fragment key={linha.pessoa.id}>
                  <tr className={expandida ? "fin-linha-aberta" : undefined}>
                    <th className="fin-matrix-head" scope="row">
                      <button
                        type="button"
                        className="fin-pessoa-toggle"
                        aria-expanded={expandida}
                        onClick={() => setAberta(expandida ? null : linha.pessoa.id)}
                      >
                        {expandida ? "▾" : "▸"} {linha.pessoa.nome}
                        <span className="fin-tag">{linha.pessoa.vinculoRotulo}</span>
                      </button>
                      <span className="fin-desc-sub">{linha.pessoa.timeRotulo}</span>
                    </th>
                    {mesesVisiveis.map((mes, indice) => {
                      const valor = linha.porMes[mes] ?? 0;
                      const anterior = indice > 0 ? linha.porMes[mesesVisiveis[indice - 1]] ?? 0 : 0;
                      const salto = anterior > 0 && valor > anterior * 1.15;
                      return (
                        <td key={mes} className="num fin-table-money">
                          {valor ? (
                            <span
                              className={salto ? "fin-badge-atencao" : undefined}
                              title={
                                salto
                                  ? `Alta de ${pct(((valor - anterior) / anterior) * 100, 0)} contra ${monthKeyLabel(mesesVisiveis[indice - 1])}`
                                  : detalheMes(linha.porTipoMes[mes])
                              }
                            >
                              {brlPrecise(valor)}
                            </span>
                          ) : (
                            <span className="fin-zero">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="num fin-table-money">
                      <strong>{brlPrecise(linha.totalCents)}</strong>
                    </td>
                  </tr>
                  {expandida
                    ? tiposLinha.map((t) => (
                        <tr key={`${linha.pessoa.id}-${t.slug}`} className="fin-linha-detalhe">
                          <th className="fin-matrix-head" scope="row">
                            <span className="fin-desc-sub">{t.nome}</span>
                          </th>
                          {mesesVisiveis.map((mes) => {
                            const valor = linha.porTipoMes[mes]?.[t.slug] ?? 0;
                            return (
                              <td key={mes} className="num fin-table-money">
                                {valor ? brlPrecise(valor) : <span className="fin-zero">—</span>}
                              </td>
                            );
                          })}
                          <td className="num fin-table-money">
                            {brlPrecise(
                              mesesVisiveis.reduce((s, mes) => s + (linha.porTipoMes[mes]?.[t.slug] ?? 0), 0)
                            )}
                          </td>
                        </tr>
                      ))
                    : null}
                </Fragment>
              );
            })}
            {!linhas.length ? (
              <tr>
                <td colSpan={mesesVisiveis.length + 2} className="fin-empty-row">
                  Nenhuma pessoa com remuneração neste recorte
                  {!incluirReembolso ? " (reembolso oculto)" : ""}.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <th className="fin-matrix-head">Total do mês</th>
              {mesesVisiveis.map((mes) => (
                <td key={mes} className="num fin-table-money">
                  {totalPorMes[mes] ? <strong>{brlPrecise(totalPorMes[mes])}</strong> : <span className="fin-zero">—</span>}
                </td>
              ))}
              <td className="num fin-table-money">
                <strong>{brlPrecise(totalGeral)}</strong>
              </td>
            </tr>
            {tiposNoFiltro
              .filter((t) => (totalPorTipo[t.slug] ?? 0) > 0)
              .map((t) => (
                <tr key={`tot-${t.slug}`} className="fin-linha-detalhe">
                  <th className="fin-matrix-head">{t.nome}</th>
                  {mesesVisiveis.map((mes) => {
                    const valor = bandasVisiveis
                      .filter((b) => b.mes === mes && b.natureza === t.slug)
                      .reduce((s, b) => s + b.cents, 0);
                    return (
                      <td key={mes} className="num fin-table-money">
                        {valor ? brlPrecise(valor) : <span className="fin-zero">—</span>}
                      </td>
                    );
                  })}
                  <td className="num fin-table-money">
                    <strong>{brlPrecise(totalPorTipo[t.slug] ?? 0)}</strong>
                  </td>
                </tr>
              ))}
            <tr>
              <th className="fin-matrix-head">Sem favorecido no mês</th>
              {mesesVisiveis.map((mes) => {
                const buraco = dados.cobertura.buracos
                  .filter((b) => b.mes === mes)
                  .reduce((s, b) => s + b.semContraparteCents, 0);
                return (
                  <td key={mes} className="num fin-table-money">
                    {buraco ? (
                      <span className="fin-out" title="Saídas de conta corrente sem favorecido: não somam para ninguém">
                        {brlPrecise(buraco)}
                      </span>
                    ) : (
                      <span className="fin-zero">—</span>
                    )}
                  </td>
                );
              })}
              <td className="num fin-table-money fin-out">
                {brlPrecise(
                  dados.cobertura.buracos
                    .filter((b) => mesesVisiveis.includes(b.mes))
                    .reduce((s, b) => s + b.semContraparteCents, 0)
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="fin-card-hint">
        ▸ abre o detalhe por tipo. Célula destacada = alta de mais de 15% contra o mês anterior. A linha “Sem
        favorecido” não é custo de gente — é o que saiu sem contraparte no mesmo mês.
      </p>
    </section>
  );
}

function detalheMes(porTipo: Record<string, number> | undefined): string | undefined {
  if (!porTipo) return undefined;
  const partes = Object.entries(porTipo)
    .filter(([, v]) => v > 0)
    .map(([nat, v]) => `${ROTULO_BANDA[nat] ?? nat}: ${brlPrecise(v)}`);
  return partes.length ? partes.join(" · ") : undefined;
}
