"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { brl, Ressalva } from "./Certeza";
import type {
  Analise,
  LinhaAnaliseMensal,
  LinhaAnaliseNucleo,
  LinhaAnaliseReceita
} from "@/lib/financeiro/contratos/analise";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function mesRotulo(mes: string): string {
  const [ano, m] = mes.split("-");
  return `${MESES[Number(m) - 1]}/${ano.slice(2)}`;
}

/**
 * Percentual formatado. `null` vira travessão, nunca "0%".
 *
 * A distinção não é estética: um mês sem receita não tem margem de zero por
 * cento — ele não tem margem. Desenhar 0% ali faz o leitor comparar um número
 * que não existe com números que existem.
 */
function pct(v: number | null, casas = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(casas)}%`;
}

/** Variação com sinal explícito: +12,4% e −8,1% se leem diferente de 12,4%. */
function delta(v: number | null): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${s}${Math.abs(v).toFixed(1)}%`;
}

function tomDelta(v: number | null, bomQuandoSobe = true): string {
  if (v === null || Math.abs(v) < 0.05) return "neutro";
  const sobe = v > 0;
  return sobe === bomQuandoSobe ? "bom" : "ruim";
}

function tomValor(cents: number): string {
  if (cents > 0) return "bom";
  if (cents < 0) return "ruim";
  return "neutro";
}

type Aba = "resultado" | "composicao" | "receita";

type Props = {
  dados: Analise;
  disponivel: boolean;
  ressalvas: string[];
};

export function FinAnalise({ dados, disponivel, ressalvas }: Props) {
  const [aba, setAba] = useState<Aba>("resultado");
  const [mesFoco, setMesFoco] = useState<string | null>(null);

  const meses = useMemo(() => dados.mensal.map((m) => m.mes), [dados.mensal]);
  const mesAtivo = mesFoco && meses.includes(mesFoco) ? mesFoco : meses[meses.length - 1] ?? null;

  const totais = useMemo(() => {
    const t = dados.mensal.reduce(
      (acc, m) => ({
        receita: acc.receita + m.receitaBrutaCents,
        custo: acc.custo + m.custoOperacionalCents,
        ebitda: acc.ebitda + m.ebitdaCents,
        impostos: acc.impostos + m.impostosCents,
        caixa: acc.caixa + m.resultadoCaixaCents,
        lacunas: acc.lacunas + Math.abs(m.lacunasCents)
      }),
      { receita: 0, custo: 0, ebitda: 0, impostos: 0, caixa: 0, lacunas: 0 }
    );
    return {
      ...t,
      margemEbitda: t.receita > 0 ? (t.ebitda * 100) / t.receita : null,
      pctCusto: t.receita > 0 ? (t.custo * 100) / t.receita : null
    };
  }, [dados.mensal]);

  if (!disponivel) {
    return (
      <div className="fin-alert">
        <strong>Análise indisponível.</strong>
        <p>{ressalvas[0] ?? "não foi possível ler a base."}</p>
      </div>
    );
  }

  if (!dados.mensal.length) {
    return (
      <div className="fin-alert">
        <strong>Sem movimento no período.</strong>
        <p>Nenhum lançamento entre {dados.de} e {dados.ate}.</p>
      </div>
    );
  }

  const nucleosDoMes = dados.nucleos.filter((n) => n.mes === mesAtivo);
  const receitasDoMes = dados.receitas.filter((r) => r.mes === mesAtivo);

  return (
    <div className="fin-analise">
      <section className="fin-analise-kpis">
        <Kpi rotulo="Receita bruta" valor={brl(totais.receita)} nota={`${dados.mensal.length} meses`} />
        <Kpi rotulo="Custo operacional" valor={brl(totais.custo)} nota={pct(totais.pctCusto)} tom="ruim" />
        <Kpi
          rotulo="EBITDA"
          valor={brl(totais.ebitda)}
          nota={`margem ${pct(totais.margemEbitda)}`}
          tom={tomValor(totais.ebitda)}
          destaque
        />
        <Kpi rotulo="Impostos" valor={brl(totais.impostos)} nota="Simples + ISS + encargos" tom="ruim" />
        <Kpi
          rotulo="Resultado de caixa"
          valor={brl(totais.caixa)}
          nota="após impostos, cartão e capex"
          tom={tomValor(totais.caixa)}
        />
      </section>

      <nav className="fin-analise-abas" role="tablist">
        {(
          [
            ["resultado", "Resultado mês a mês"],
            ["composicao", "Composição por área"],
            ["receita", "Receita por linha"]
          ] as [Aba, string][]
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aba === id}
            className={aba === id ? "fin-aba fin-aba-ativa" : "fin-aba"}
            onClick={() => setAba(id)}
          >
            {rotulo}
          </button>
        ))}
      </nav>

      {aba === "resultado" ? <TabelaResultado linhas={dados.mensal} /> : null}

      {aba !== "resultado" && mesAtivo ? (
        <div className="fin-analise-seletor">
          <span>Mês</span>
          <div className="fin-analise-meses">
            {meses.map((m) => (
              <button
                key={m}
                type="button"
                className={m === mesAtivo ? "fin-chip fin-chip-ativo" : "fin-chip"}
                onClick={() => setMesFoco(m)}
              >
                {mesRotulo(m)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {aba === "composicao" && mesAtivo ? (
        <TabelaNucleos linhas={nucleosDoMes} mes={mesAtivo} />
      ) : null}

      {aba === "receita" && mesAtivo ? (
        <TabelaReceita linhas={receitasDoMes} mes={mesAtivo} />
      ) : null}

      {ressalvas.length ? (
        <div className="fin-analise-ressalvas">
          {ressalvas.map((r) => (
            <Ressalva key={r}>{r}</Ressalva>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Kpi(props: {
  rotulo: string;
  valor: string;
  nota: string;
  tom?: string;
  destaque?: boolean;
}) {
  return (
    <div className={props.destaque ? "fin-kpi fin-kpi-destaque" : "fin-kpi"}>
      <span className="fin-kpi-rotulo">{props.rotulo}</span>
      <strong className={`fin-kpi-valor tom-${props.tom ?? "neutro"}`}>{props.valor}</strong>
      <span className="fin-kpi-nota">{props.nota}</span>
    </div>
  );
}

function TabelaResultado({ linhas }: { linhas: LinhaAnaliseMensal[] }) {
  return (
    <div className="fin-table-wrap">
      <table className="fin-table fin-analise-tabela">
        <caption className="fin-analise-caption">
          Percentuais sobre a receita bruta do mês. A variação compara com o mês anterior.
        </caption>
        <thead>
          <tr>
            <th scope="col">mês</th>
            <th scope="col" className="num">receita</th>
            <th scope="col" className="num">Δ</th>
            <th scope="col" className="num">custo direto</th>
            <th scope="col" className="num">pessoal</th>
            <th scope="col" className="num">custo op.</th>
            <th scope="col" className="num">EBITDA</th>
            <th scope="col" className="num">margem</th>
            <th scope="col" className="num">result. caixa</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.mes}>
              <th scope="row">{mesRotulo(l.mes)}</th>
              <td className="num forte">{brl(l.receitaBrutaCents)}</td>
              <td className={`num delta tom-${tomDelta(l.receitaVariacaoPct)}`}>
                {delta(l.receitaVariacaoPct)}
              </td>
              <td className="num">
                {brl(l.custosDiretosCents)}
                <small>{pct(l.pctCustosDiretos)}</small>
              </td>
              <td className="num">
                {brl(l.pessoalCents)}
                <small>{pct(l.pctPessoal)}</small>
              </td>
              <td className="num">
                {brl(l.custoOperacionalCents)}
                <small>{pct(l.pctCustoOperacional)}</small>
              </td>
              <td className={`num forte tom-${tomValor(l.ebitdaCents)}`}>{brl(l.ebitdaCents)}</td>
              <td className={`num tom-${tomValor(l.ebitdaCents)}`}>{pct(l.margemEbitdaPct)}</td>
              <td className={`num tom-${tomValor(l.resultadoCaixaCents)}`}>
                {brl(l.resultadoCaixaCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaNucleos({ linhas, mes }: { linhas: LinhaAnaliseNucleo[]; mes: string }) {
  if (!linhas.length) {
    return <p className="fin-card-hint">Sem movimento em {mesRotulo(mes)}.</p>;
  }
  const maiorCusto = Math.max(...linhas.map((l) => Math.abs(l.custoCents)), 1);
  return (
    <div className="fin-table-wrap">
      <table className="fin-table fin-analise-tabela">
        <caption className="fin-analise-caption">
          Participação de cada área na receita e no custo de {mesRotulo(mes)}. Núcleo marcado como
          overhead não tem receita própria — a margem negativa ali é estrutural, não desempenho.
        </caption>
        <thead>
          <tr>
            <th scope="col">área</th>
            <th scope="col" className="num">receita</th>
            <th scope="col" className="num">% rec.</th>
            <th scope="col" className="num">custo</th>
            <th scope="col" className="num">% custo</th>
            <th scope="col">peso do custo</th>
            <th scope="col" className="num">resultado</th>
            <th scope="col" className="num">margem</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.nucleo}>
              <th scope="row">
                {l.nucleoNome ?? "(sem área)"}
                {l.isOverhead ? <span className="fin-tag">overhead</span> : null}
              </th>
              <td className="num forte">{brl(l.receitaCents)}</td>
              <td className="num">{pct(l.participacaoReceitaPct)}</td>
              <td className="num">{brl(l.custoCents)}</td>
              <td className="num">{pct(l.participacaoCustoPct)}</td>
              <td className="fin-barra-cel">
                <span
                  className="fin-barra"
                  style={{ width: `${Math.round((Math.abs(l.custoCents) / maiorCusto) * 100)}%` }}
                  aria-hidden="true"
                />
              </td>
              <td className={`num forte tom-${tomValor(l.resultadoCents)}`}>{brl(l.resultadoCents)}</td>
              <td className={`num tom-${l.isOverhead ? "neutro" : tomValor(l.resultadoCents)}`}>
                {l.isOverhead ? "—" : pct(l.margemPct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaReceita({ linhas, mes }: { linhas: LinhaAnaliseReceita[]; mes: string }) {
  if (!linhas.length) {
    return <p className="fin-card-hint">Sem receita em {mesRotulo(mes)}.</p>;
  }
  return (
    <div className="fin-table-wrap">
      <table className="fin-table fin-analise-tabela">
        <caption className="fin-analise-caption">
          Receita de {mesRotulo(mes)} por linha. <strong>Recorrência</strong> conta em quantos dos
          últimos seis meses aquela linha teve receita — 6/6 é assinatura, 1/6 é projeto pontual.
        </caption>
        <thead>
          <tr>
            <th scope="col">linha</th>
            <th scope="col">produto</th>
            <th scope="col" className="num">receita</th>
            <th scope="col" className="num">%</th>
            <th scope="col" className="num">mês anterior</th>
            <th scope="col" className="num">clientes</th>
            <th scope="col">recorrência</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const variou =
              l.mesAnteriorCents !== null && l.mesAnteriorCents !== 0
                ? ((l.receitaCents - l.mesAnteriorCents) * 100) / Math.abs(l.mesAnteriorCents)
                : null;
            return (
              <tr key={`${l.categoriaCode}`}>
                <th scope="row">
                  <span className="fin-code">{l.categoriaCode ?? "—"}</span> {l.categoriaNome ?? ""}
                </th>
                <td>{l.linhaProduto ?? <span className="fin-vazio">—</span>}</td>
                <td className="num forte">{brl(l.receitaCents)}</td>
                <td className="num">{pct(l.participacaoPct)}</td>
                <td className="num">
                  {l.mesAnteriorCents === null ? "—" : brl(l.mesAnteriorCents)}
                  {variou !== null ? (
                    <small className={`tom-${tomDelta(variou)}`}>{delta(variou)}</small>
                  ) : null}
                </td>
                <td className="num">{l.clientes}</td>
                <td>
                  <span
                    className={`fin-recorrencia fin-recorrencia-${l.mesesComReceitaEm6 >= 5 ? "alta" : l.mesesComReceitaEm6 >= 3 ? "media" : "baixa"}`}
                  >
                    {l.mesesComReceitaEm6}/6
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="fin-card-hint">
        Para ver os lançamentos de uma linha,{" "}
        <Link className="fin-link-btn" href={`/financeiro/categorizacao?de=${mes}-01`}>
          abra a categorização do mês
        </Link>
        .
      </p>
    </div>
  );
}
