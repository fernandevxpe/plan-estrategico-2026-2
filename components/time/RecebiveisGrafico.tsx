"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { brl } from "@/components/financeiro/Certeza";
import { CLASSE, ROTULO, mesCurto, nomeMes, type Recebiveis } from "@/components/time/recebiveis-dado";

/**
 * O histórico inteiro, com filtro por natureza e o mês aberto.
 *
 * ---------------------------------------------------------------------------
 * ROTA, E NÃO SOBREPOSIÇÃO EM TELA CHEIA
 * ---------------------------------------------------------------------------
 * A vontade era um painel cobrindo a tela. Seria o TERCEIRO elemento fixo por
 * cima do conteúdo neste app, e os dois primeiros custaram caro: o menu "Mais"
 * cobrindo o botão que conclui a tarefa, e o botão flutuante cobrindo "enviar
 * custo" (medido: y 710–762 sobre y 729–775).
 *
 * Como rota, a barra inferior continua no lugar, o gesto de voltar é o do
 * sistema, não há armadilha de foco para construir nem Esc para lembrar — e a
 * classe inteira desses bugs deixa de existir. Custa 78px de altura.
 *
 * ---------------------------------------------------------------------------
 * O FILTRO É A LEGENDA
 * ---------------------------------------------------------------------------
 * Duas listas — uma que explica as cores e outra que filtra — seriam a mesma
 * informação duas vezes, e a segunda ficaria desatualizada na primeira mudança.
 * Aqui tocar na natureza tira e põe a banda; o total ao lado acompanha o que
 * está visível.
 *
 * Marcado não é só cor: o ponto fica cheio, o desmarcado fica vazado (anel).
 * Quem não distingue as duas cores ainda vê a diferença de forma — e é o mesmo
 * motivo de `aria-pressed` estar em cada botão.
 */

export function RecebiveisGrafico() {
  const [dado, setDado] = useState<Recebiveis | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  const [mesAberto, setMesAberto] = useState<string | null>(null);
  const trilhoRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/time/recebiveis", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        setDado(j.recebiveis ?? null);
      } finally {
        setCarregando(false);
      }
    })();
  }, []);

  // Começa rolado no mês MAIS RECENTE. Sem isso, o mês que a pessoa abriu a
  // tela para ver nasce fora do quadro — e o problema piora sozinho a cada mês
  // novo que entra na série.
  useEffect(() => {
    const t = trilhoRef.current;
    if (t) t.scrollLeft = t.scrollWidth;
  }, [dado, ocultas]);

  const visiveis = useMemo(() => {
    if (!dado) return [];
    return dado.porMes.map((m) => {
      const naturezas = Object.fromEntries(
        Object.entries(m.porNatureza).filter(([n]) => !ocultas.has(n))
      );
      return {
        mes: m.mes,
        total: Object.values(naturezas).reduce((s, v) => s + v, 0),
        porNatureza: naturezas
      };
    });
  }, [dado, ocultas]);

  if (carregando) return <div className="time-aviso">carregando…</div>;
  if (!dado || dado.porMes.length === 0) {
    return (
      <div className="time-tela-padrao">
        <p className="time-sub">Nada para mostrar ainda.</p>
      </div>
    );
  }

  const teto = Math.max(...visiveis.map((m) => m.total), 1);
  const totalVisivel = visiveis.reduce((s, m) => s + m.total, 0);
  const aberto = mesAberto ? dado.porMes.find((m) => m.mes === mesAberto) : null;
  const linhasDoMes = mesAberto ? dado.linhas.filter((l) => l.mes === mesAberto && !ocultas.has(l.natureza)) : [];

  const alternar = (nat: string) =>
    setOcultas((antes) => {
      const novo = new Set(antes);
      // A última natureza visível não pode ser desligada: um gráfico sem
      // nenhuma banda não comunica nada, e a pessoa fica sem caminho de volta
      // óbvio.
      if (novo.has(nat)) novo.delete(nat);
      else if (dado.porNatureza.length - novo.size > 1) novo.add(nat);
      return novo;
    });

  return (
    <div className="time-tela-padrao">
      <header className="time-form-cabeca">
        <h1>Mês a mês</h1>
        <p>
          Todo o histórico desde {nomeMes(dado.porMes[0].mes)}. Toque numa natureza para tirar ou pôr, e num mês para
          ver o que entrou nele.
        </p>
      </header>

      <ul className="rec-filtros">
        {dado.porNatureza.map((n) => {
          const ligada = !ocultas.has(n.natureza);
          return (
            <li key={n.natureza}>
              <button
                type="button"
                className={ligada ? "rec-filtro ligado" : "rec-filtro"}
                aria-pressed={ligada}
                onClick={() => alternar(n.natureza)}
              >
                <i className={`rec-ponto ${CLASSE[n.natureza] ?? "nat-encargo"}${ligada ? "" : " vazado"}`} />
                <span>{ROTULO[n.natureza] ?? n.natureza}</span>
                <b>{brl(n.cents)}</b>
              </button>
            </li>
          );
        })}
      </ul>

      <section className="rec-plot rec-plot-cheio">
        <div className="rec-plot-trilho" ref={trilhoRef}>
          <div
            className="rec-grade"
            role="img"
            aria-label={`Recebido mês a mês. ${visiveis
              .map((m) => `${mesCurto(m.mes)}: ${brl(m.total)}`)
              .join("; ")}`}
          >
            {visiveis.map((m) => (
              <button
                key={m.mes}
                type="button"
                className={mesAberto === m.mes ? "rec-col ativa" : "rec-col"}
                aria-pressed={mesAberto === m.mes}
                aria-label={`${nomeMes(m.mes)}: ${brl(m.total)}`}
                onClick={() => setMesAberto(mesAberto === m.mes ? null : m.mes)}
              >
                <span className="rec-col-area">
                  <span className="rec-pilha" style={{ height: `${(m.total / teto) * 100}%` }}>
                    {Object.entries(m.porNatureza)
                      .sort((a, b) => b[1] - a[1])
                      .map(([nat, v]) => (
                        <i
                          key={nat}
                          className={CLASSE[nat] ?? "nat-encargo"}
                          style={{ height: `${(v / m.total) * 100}%` }}
                        />
                      ))}
                  </span>
                </span>
                <span className="rec-col-mes">{mesCurto(m.mes)}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="rec-plot-nota">
          {ocultas.size > 0
            ? `${brl(totalVisivel)} no que está ligado, de ${brl(dado.totalCents)} no total.`
            : `${brl(dado.totalCents)} em ${dado.porMes.length} meses.`}
        </p>
      </section>

      {aberto ? (
        <section className="time-secao">
          <h2>{nomeMes(aberto.mes)}</h2>
          {linhasDoMes.length === 0 ? (
            <p className="time-sub">Nada deste mês nas naturezas ligadas.</p>
          ) : (
            <ul className="rec-linhas">
              {linhasDoMes.map((l, k) => (
                <li key={`${l.data}-${k}`}>
                  <span className="rec-linha-dia">
                    {l.data.slice(8, 10)}/{l.data.slice(5, 7)}
                  </span>
                  <i className={`rec-ponto ${CLASSE[l.natureza] ?? "nat-encargo"}`} />
                  <span className="rec-linha-nat">
                    {ROTULO[l.natureza] ?? l.natureza}
                    <span className="rec-linha-conta">{l.conta}</span>
                  </span>
                  <span className="rec-linha-valor">{brl(l.valorCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <Link href="/time/recebiveis" className="time-botao secundario time-botao-largo">
        Voltar para Recebíveis
      </Link>
    </div>
  );
}
