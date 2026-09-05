"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";

import { monthKeyLabel, shortDateLabel } from "@/lib/financeiro/format";

const DIAS_SEM = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

function isoLocal(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function partesIso(iso: string): { ano: number; mes: number; dia: number } {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return { ano, mes, dia };
}

function gradeDoMes(ano: number, mes: number): (number | null)[] {
  const primeiro = new Date(ano, mes - 1, 1).getDay();
  const ultimo = new Date(ano, mes, 0).getDate();
  const celulas: (number | null)[] = Array.from({ length: primeiro }, () => null);
  for (let d = 1; d <= ultimo; d++) celulas.push(d);
  while (celulas.length % 7 !== 0) celulas.push(null);
  return celulas;
}

export function FinCapEscolherDia({
  valor,
  diaOriginal,
  hoje,
  competencia,
  desabilitado = false,
  rotulo,
  onChange
}: {
  valor: string;
  diaOriginal: string;
  hoje: string;
  competencia: string;
  desabilitado?: boolean;
  rotulo?: string;
  onChange: (dia: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const painelId = useId();
  const ancoraRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);

  const comp = partesIso(competencia);
  const [mesVisivel, setMesVisivel] = useState(comp.mes);
  const [anoVisivel, setAnoVisivel] = useState(comp.ano);

  const ajustado = valor !== diaOriginal;
  const noPassado = valor < hoje;

  useEffect(() => {
    if (!aberto) return;
    const compAbrir = partesIso(valor);
    setMesVisivel(compAbrir.mes);
    setAnoVisivel(compAbrir.ano);
  }, [aberto, valor]);

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      const alvo = e.target as Node;
      if (ancoraRef.current?.contains(alvo) || painelRef.current?.contains(alvo)) return;
      setAberto(false);
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  const celulas = useMemo(() => gradeDoMes(anoVisivel, mesVisivel), [anoVisivel, mesVisivel]);

  const noMesCompetencia = anoVisivel === comp.ano && mesVisivel === comp.mes;

  function escolher(dia: number) {
    const iso = isoLocal(anoVisivel, mesVisivel, dia);
    if (iso < hoje) return;
    onChange(iso);
    setAberto(false);
  }

  if (desabilitado) {
    return (
      <span className="fin-cap-dia-estatico" title={valor}>
        {shortDateLabel(valor)}
      </span>
    );
  }

  return (
    <div className="fin-cap-dia-wrap">
      <button
        ref={ancoraRef}
        type="button"
        className={[
          "fin-cap-dia-btn",
          aberto ? "aberto" : "",
          ajustado ? "ajustado" : "",
          noPassado ? "passado" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        aria-controls={painelId}
        title={ajustado ? `Cadastro: ${shortDateLabel(diaOriginal)} · clique para mudar` : "Escolher dia do pagamento"}
        onClick={() => setAberto((v) => !v)}
      >
        <CalendarDays size={13} strokeWidth={2.2} aria-hidden />
        <span>{shortDateLabel(valor)}</span>
        {ajustado ? <span className="fin-cap-dia-ponto" aria-hidden /> : null}
      </button>

      {aberto ? (
        <div
          ref={painelRef}
          id={painelId}
          className="fin-cap-cal"
          role="dialog"
          aria-label={rotulo ? `Dia do pagamento — ${rotulo}` : "Dia do pagamento"}
        >
          <header className="fin-cap-cal-cab">
            <button
              type="button"
              className="fin-cap-cal-nav"
              disabled={noMesCompetencia}
              aria-label="Mês anterior"
              onClick={() => {
                const d = new Date(anoVisivel, mesVisivel - 2, 1);
                setAnoVisivel(d.getFullYear());
                setMesVisivel(d.getMonth() + 1);
              }}
            >
              <ChevronLeft size={16} strokeWidth={2.2} />
            </button>
            <div className="fin-cap-cal-titulo">
              <strong>{monthKeyLabel(`${anoVisivel}-${String(mesVisivel).padStart(2, "0")}`)}</strong>
              <small>competência {monthKeyLabel(competencia)}</small>
            </div>
            <button
              type="button"
              className="fin-cap-cal-nav"
              disabled={noMesCompetencia}
              aria-label="Próximo mês"
              onClick={() => {
                const d = new Date(anoVisivel, mesVisivel, 1);
                setAnoVisivel(d.getFullYear());
                setMesVisivel(d.getMonth() + 1);
              }}
            >
              <ChevronRight size={16} strokeWidth={2.2} />
            </button>
          </header>

          <div className="fin-cap-cal-semana" aria-hidden>
            {DIAS_SEM.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          <div className="fin-cap-cal-grade" role="grid">
            {celulas.map((dia, i) => {
              if (dia == null) return <span key={`v-${i}`} className="fin-cap-cal-vazio" />;
              const iso = isoLocal(anoVisivel, mesVisivel, dia);
              const sel = iso === valor;
              const hojeCel = iso === hoje;
              const cadastro = iso === diaOriginal;
              const bloqueado = iso < hoje;
              return (
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  disabled={bloqueado}
                  className={[
                    "fin-cap-cal-dia",
                    sel ? "sel" : "",
                    hojeCel ? "hoje" : "",
                    cadastro && !sel ? "cadastro" : "",
                    bloqueado ? "bloqueado" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-label={`${dia} de ${monthKeyLabel(`${anoVisivel}-${String(mesVisivel).padStart(2, "0")}`)}`}
                  aria-selected={sel}
                  onClick={() => escolher(dia)}
                >
                  {dia}
                </button>
              );
            })}
          </div>

          <footer className="fin-cap-cal-rodape">
            {ajustado ? (
              <button
                type="button"
                className="fin-cap-cal-reset"
                onClick={() => {
                  onChange(diaOriginal);
                  setAberto(false);
                }}
              >
                <RotateCcw size={12} strokeWidth={2.2} aria-hidden />
                Voltar ao dia {shortDateLabel(diaOriginal)}
              </button>
            ) : (
              <span className="fin-cap-cal-dica">Dias antes de hoje não podem ser agendados</span>
            )}
          </footer>
        </div>
      ) : null}
    </div>
  );
}
