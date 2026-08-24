"use client";

import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import type { BandaRemuneracao, CustoPessoas, Pessoa, PrevisaoCadastro } from "@/lib/financeiro/pessoas";
import { brlPrecise, monthKeyLabel } from "@/lib/financeiro/format";

import { FinSecaoColapsavel } from "./FinSecaoColapsavel";

/** Ordem estável — a mesma do perfil. */
const NATUREZAS = [
  "salario",
  "prolabore",
  "comissao",
  "estagio",
  "extra",
  "encargo_beneficio",
  "reembolso"
] as const;

const ROTULO: Record<string, string> = {
  salario: "Salário",
  prolabore: "Pró-labore",
  comissao: "Comissão",
  estagio: "Estágio",
  extra: "Extra",
  encargo_beneficio: "Encargo",
  reembolso: "Reembolso"
};

/** Mesmas tokens do perfil (`FinPessoaPerfil` / `--nat-*`). */
const COR: Record<string, string> = {
  salario: "var(--nat-salario)",
  prolabore: "var(--nat-recorrente)",
  estagio: "var(--nat-recorrente)",
  comissao: "var(--nat-comissao)",
  reembolso: "var(--nat-reembolso)",
  encargo_beneficio: "var(--nat-encargo)",
  extra: "var(--nat-extra)"
};

type Ativos = Record<string, boolean>;

function ativosIniciais(tipos: { slug: string }[]): Ativos {
  const base: Ativos = {};
  for (const slug of NATUREZAS) base[slug] = true;
  for (const t of tipos) base[t.slug] = true;
  return base;
}

function somarAtivos(porTipo: Record<string, number> | undefined, ativos: Ativos) {
  if (!porTipo) return 0;
  let s = 0;
  for (const [nat, cents] of Object.entries(porTipo)) {
    if (ativos[nat]) s += cents;
  }
  return s;
}

function compsAtivos(
  porTipo: Record<string, number> | undefined,
  ativos: Ativos,
  ordem: readonly string[]
) {
  if (!porTipo) return [] as { slug: string; cents: number }[];
  return ordem
    .filter((slug) => ativos[slug] && (porTipo[slug] ?? 0) > 0)
    .map((slug) => ({ slug, cents: porTipo[slug] }));
}

/**
 * Matriz pessoa × mês. Cada natureza ligada soma no total e aparece pequena,
 * colorida e entre parênteses. A última coluna de mês é a previsão do mês
 * seguinte a partir dos cadastros — não do extrato.
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
  const [pessoaId, setPessoaId] = useState<number | "">("");
  const [ativos, setAtivos] = useState<Ativos>(() => ativosIniciais(dados.tiposRemuneracao));

  const mesPrevisto = dados.mesPrevisto;
  const previsaoPorId = useMemo(() => {
    const m = new Map<number, PrevisaoCadastro>();
    for (const p of dados.previsaoCadastro) m.set(p.personId, p);
    return m;
  }, [dados.previsaoCadastro]);

  const naturezasDisponiveis = useMemo(() => {
    const presentes = new Set(bandas.map((b) => b.natureza));
    for (const t of dados.tiposRemuneracao) presentes.add(t.slug);
    for (const p of dados.previsaoCadastro) {
      for (const nat of Object.keys(p.porNatureza)) presentes.add(nat);
    }
    return NATUREZAS.filter((slug) => presentes.has(slug));
  }, [bandas, dados.tiposRemuneracao, dados.previsaoCadastro]);

  const bandasBase = useMemo(
    () =>
      bandas.filter((b) => {
        if (!meses.includes(b.mes)) return false;
        if (pessoaId !== "" && b.personId !== pessoaId) return false;
        return true;
      }),
    [bandas, meses, pessoaId]
  );

  const linhas = useMemo(() => {
    const mapa = new Map<
      number,
      {
        pessoa: Pessoa;
        porTipoMes: Record<string, Record<string, number>>;
        totalAtivoCents: number;
        previsao: Record<string, number>;
      }
    >();

    for (const b of bandasBase) {
      const pessoa = pessoaPorId.get(b.personId);
      if (!pessoa) continue;
      const atual = mapa.get(b.personId) ?? {
        pessoa,
        porTipoMes: {},
        totalAtivoCents: 0,
        previsao: previsaoPorId.get(b.personId)?.porNatureza ?? {}
      };
      if (!atual.porTipoMes[b.mes]) atual.porTipoMes[b.mes] = {};
      atual.porTipoMes[b.mes][b.natureza] = (atual.porTipoMes[b.mes][b.natureza] ?? 0) + b.cents;
      if (ativos[b.natureza]) atual.totalAtivoCents += b.cents;
      mapa.set(b.personId, atual);
    }

    return [...mapa.values()]
      .filter((l) => {
        for (const porTipo of Object.values(l.porTipoMes)) {
          for (const [nat, cents] of Object.entries(porTipo)) {
            if (ativos[nat] && cents > 0) return true;
          }
        }
        return somarAtivos(l.previsao, ativos) > 0;
      })
      .sort((a, b) => b.totalAtivoCents - a.totalAtivoCents);
  }, [bandasBase, pessoaPorId, ativos, previsaoPorId]);

  const mesesVisiveis = useMemo(() => {
    const comValor = new Set<string>();
    for (const l of linhas) {
      for (const [mes, porTipo] of Object.entries(l.porTipoMes)) {
        for (const [nat, cents] of Object.entries(porTipo)) {
          if (ativos[nat] && cents > 0) comValor.add(mes);
        }
      }
    }
    if (pessoaId !== "") return meses;
    const primeiro = meses.findIndex((m) => comValor.has(m));
    return primeiro <= 0 ? meses : meses.slice(primeiro);
  }, [meses, linhas, ativos, pessoaId]);

  const totalPorMes = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const mes of mesesVisiveis) {
      mapa[mes] = linhas.reduce((s, l) => s + somarAtivos(l.porTipoMes[mes], ativos), 0);
    }
    return mapa;
  }, [linhas, mesesVisiveis, ativos]);

  const totalPrevisao = linhas.reduce((s, l) => s + somarAtivos(l.previsao, ativos), 0);
  const totalGeral = linhas.reduce((s, l) => s + l.totalAtivoCents, 0);

  const pessoasComBanda = useMemo(() => {
    const ids = new Set(bandas.filter((b) => meses.includes(b.mes)).map((b) => b.personId));
    return [...ids]
      .map((id) => pessoaPorId.get(id))
      .filter((p): p is Pessoa => Boolean(p))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [bandas, meses, pessoaPorId]);

  function alternar(slug: string) {
    setAtivos((antes) => ({ ...antes, [slug]: !antes[slug] }));
  }

  const colunas = mesesVisiveis.length + 3; // pessoa + meses + previsto + total

  return (
    <FinSecaoColapsavel
      className="fin-painel-grafico fin-pessoas-matriz"
      titulo="Custo por pessoa, mês a mês"
      meta={`${pessoasComBanda.length} ${pessoasComBanda.length === 1 ? "pessoa" : "pessoas"} · ${mesesVisiveis.length} ${mesesVisiveis.length === 1 ? "mês" : "meses"}`}
      ariaLabel="Custo por pessoa, mês a mês"
    >
      <div className="fin-pessoas-matriz-filtros">
        <div className="fin-pessoas-matriz-chips" role="group" aria-label="Componentes visíveis">
          {naturezasDisponiveis.map((slug) => {
            const ligado = Boolean(ativos[slug]);
            return (
              <button
                key={slug}
                type="button"
                className={ligado ? "fin-pessoas-matriz-chip ativo" : "fin-pessoas-matriz-chip"}
                style={{ ["--chip-cor" as string]: COR[slug] ?? "var(--muted)" }}
                aria-pressed={ligado}
                onClick={() => alternar(slug)}
              >
                <i className="fin-pessoas-matriz-chip-ponto" aria-hidden />
                {ROTULO[slug] ?? slug}
              </button>
            );
          })}
        </div>
        <label className="fin-pessoas-matriz-campo">
          <span>Pessoa</span>
          <select
            className="fin-select"
            value={pessoaId === "" ? "" : String(pessoaId)}
            onChange={(e) => setPessoaId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Todas as pessoas</option>
            {pessoasComBanda.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="fin-matrix-wrap">
        <table className="fin-table fin-matrix fin-pessoas-matriz-tabela">
          <thead>
            <tr>
              <th className="fin-matrix-head">Pessoa</th>
              {mesesVisiveis.map((mes) => (
                <th key={mes} className="num">
                  {monthKeyLabel(mes)}
                  {mes === mesAtual ? <span className="fin-tag">parcial</span> : null}
                </th>
              ))}
              {mesPrevisto ? (
                <th
                  className="num fin-previsao"
                  title="Soma dos cadastros vigentes: salário-base, pró-labore esperado, comissão do mês e reembolso com parcela a cair"
                >
                  {monthKeyLabel(mesPrevisto)}
                  <span className="fin-tag">previsto</span>
                </th>
              ) : null}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => {
              const prevTotal = somarAtivos(linha.previsao, ativos);
              const prevComps = compsAtivos(linha.previsao, ativos, naturezasDisponiveis);
              return (
                <tr key={linha.pessoa.id}>
                  <th className="fin-matrix-head" scope="row">
                    <a
                      className="fin-pessoas-nome-link fin-pessoas-matriz-pessoa"
                      href={`/financeiro/pessoas/${linha.pessoa.id}`}
                    >
                      <span className="fin-pessoas-nome">
                        <span className="fin-pessoas-nome-texto">
                          <span className="fin-desc">{linha.pessoa.nome}</span>
                          <span className="fin-desc-sub">
                            {linha.pessoa.vinculoRotulo} · {linha.pessoa.timeRotulo}
                          </span>
                        </span>
                        <ChevronRight
                          className="fin-pessoas-nome-seta"
                          size={15}
                          strokeWidth={2.2}
                          aria-hidden
                        />
                      </span>
                    </a>
                  </th>
                  {mesesVisiveis.map((mes) => {
                    const total = somarAtivos(linha.porTipoMes[mes], ativos);
                    const comps = compsAtivos(linha.porTipoMes[mes], ativos, naturezasDisponiveis);
                    return (
                      <td key={mes} className="num fin-table-money">
                        {total ? (
                          <CelulaComposta total={total} comps={comps} />
                        ) : (
                          <span className="fin-zero">—</span>
                        )}
                      </td>
                    );
                  })}
                  {mesPrevisto ? (
                    <td className="num fin-table-money fin-previsao">
                      {prevTotal ? (
                        <CelulaComposta total={prevTotal} comps={prevComps} />
                      ) : (
                        <span className="fin-zero">—</span>
                      )}
                    </td>
                  ) : null}
                  <td className="num fin-table-money">
                    {linha.totalAtivoCents ? (
                      <CelulaComposta
                        total={linha.totalAtivoCents}
                        comps={naturezasDisponiveis
                          .map((slug) => ({
                            slug,
                            cents: mesesVisiveis.reduce(
                              (s, mes) => s + (linha.porTipoMes[mes]?.[slug] ?? 0),
                              0
                            )
                          }))
                          .filter((c) => ativos[c.slug] && c.cents > 0)}
                        forte
                      />
                    ) : (
                      <span className="fin-zero">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!linhas.length ? (
              <tr>
                <td colSpan={colunas} className="fin-empty-row">
                  Nenhuma pessoa com os componentes ligados neste recorte.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <th className="fin-matrix-head">Total do mês</th>
              {mesesVisiveis.map((mes) => (
                <td key={mes} className="num fin-table-money">
                  {totalPorMes[mes] ? (
                    <CelulaComposta
                      total={totalPorMes[mes]}
                      comps={naturezasDisponiveis
                        .map((slug) => ({
                          slug,
                          cents: linhas.reduce((s, l) => s + (l.porTipoMes[mes]?.[slug] ?? 0), 0)
                        }))
                        .filter((c) => ativos[c.slug] && c.cents > 0)}
                      forte
                    />
                  ) : (
                    <span className="fin-zero">—</span>
                  )}
                </td>
              ))}
              {mesPrevisto ? (
                <td className="num fin-table-money fin-previsao">
                  {totalPrevisao ? (
                    <CelulaComposta
                      total={totalPrevisao}
                      comps={naturezasDisponiveis
                        .map((slug) => ({
                          slug,
                          cents: linhas.reduce((s, l) => s + (l.previsao[slug] ?? 0), 0)
                        }))
                        .filter((c) => ativos[c.slug] && c.cents > 0)}
                      forte
                    />
                  ) : (
                    <span className="fin-zero">—</span>
                  )}
                </td>
              ) : null}
              <td className="num fin-table-money">
                <strong>{brlPrecise(totalGeral)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </FinSecaoColapsavel>
  );
}

function CelulaComposta({
  total,
  comps,
  forte
}: {
  total: number;
  comps: { slug: string; cents: number }[];
  forte?: boolean;
}) {
  return (
    <span className="fin-pessoas-matriz-cel">
      {forte ? <strong>{brlPrecise(total)}</strong> : brlPrecise(total)}
      {comps.map((c) => (
        <small
          key={c.slug}
          className="fin-pessoas-matriz-comp"
          style={{ color: COR[c.slug] ?? "var(--muted)" }}
          title={ROTULO[c.slug] ?? c.slug}
        >
          ({brlPrecise(c.cents)})
        </small>
      ))}
    </span>
  );
}
