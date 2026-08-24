"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  BarChart3,
  ChevronRight,
  CreditCard,
  Database,
  Landmark,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  Users,
  type LucideIcon
} from "lucide-react";

import { FINANCEIRO_GRUPOS, financeiroAtivo, rotaAtiva, type Rota } from "@/lib/nav/mapa";

const CHAVE_COMPACTA = "fin-nav-compacta";

const ICONE_GRUPO: Record<string, LucideIcon> = {
  Caixa: Landmark,
  Receber: ArrowDownToLine,
  Pagar: CreditCard,
  Pessoas: Users,
  Resultado: PieChart,
  Dados: Database
};

/**
 * A barra lateral do módulo financeiro.
 *
 * Seis grupos; o da página aberta começa expandido. Compactar reduz a coluna a
 * ícones — útil em tela estreita de notebook sem perder o mapa. A preferência
 * fica em localStorage para não resetar a cada navegação.
 *
 * `<details>`/`<summary>` cuidam de abrir/fechar cada tema: teclado e leitor
 * de tela já resolvidos. O estado "compacta" é nosso porque o HTML não tem
 * modo ícone-só.
 */
export function FinShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [compacta, setCompacta] = useState(false);
  /** Grupos que o usuário abriu/fechou à mão — prevalecem sobre o da rota. */
  const [abertosManual, setAbertosManual] = useState<Record<string, boolean>>({});
  const atual = financeiroAtivo(pathname);
  const grupoDaRota = atual?.grupo.label ?? FINANCEIRO_GRUPOS[0]?.label;

  useEffect(() => {
    try {
      setCompacta(window.localStorage.getItem(CHAVE_COMPACTA) === "1");
    } catch {
      /* private mode */
    }
  }, []);

  // Nova rota: limpa overrides manuais para o tema da página voltar a abrir.
  useEffect(() => {
    setAbertosManual({});
    setGavetaAberta(false);
  }, [pathname]);

  useEffect(() => {
    if (!gavetaAberta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGavetaAberta(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [gavetaAberta]);

  function alternarCompacta() {
    setCompacta((antes) => {
      const proximo = !antes;
      try {
        window.localStorage.setItem(CHAVE_COMPACTA, proximo ? "1" : "0");
      } catch {
        /* private mode */
      }
      return proximo;
    });
  }

  function grupoEstaAberto(label: string) {
    if (compacta) return false;
    if (label in abertosManual) return abertosManual[label];
    return label === grupoDaRota;
  }

  return (
    <div className={compacta ? "fin-layout compacta" : "fin-layout"}>
      <button
        type="button"
        className="fin-nav-abrir"
        aria-expanded={gavetaAberta}
        aria-controls="fin-nav"
        onClick={() => setGavetaAberta(true)}
      >
        Seções do financeiro
      </button>

      {gavetaAberta ? (
        <button
          type="button"
          className="fin-nav-fundo"
          aria-label="Fechar as seções do financeiro"
          onClick={() => setGavetaAberta(false)}
        />
      ) : null}

      <nav
        id="fin-nav"
        className={gavetaAberta ? "fin-nav aberta" : "fin-nav"}
        aria-label="Seções do financeiro"
        data-compacta={compacta ? "sim" : "nao"}
      >
        <div className="fin-nav-topo">
          {!compacta ? <span className="fin-nav-topo-rotulo">Financeiro</span> : null}
          <button
            type="button"
            className="fin-nav-compactar"
            onClick={alternarCompacta}
            aria-pressed={compacta}
            title={compacta ? "Expandir menu" : "Comprimir menu"}
            aria-label={compacta ? "Expandir menu" : "Comprimir menu"}
          >
            {compacta ? <PanelLeftOpen size={16} strokeWidth={2} /> : <PanelLeftClose size={16} strokeWidth={2} />}
          </button>
        </div>

        {FINANCEIRO_GRUPOS.map((grupo) => {
          const Icone = ICONE_GRUPO[grupo.label] ?? Database;
          const aberto = grupoEstaAberto(grupo.label);
          const temAtivo = grupo.rotas.some(
            (rota) =>
              rotaAtiva(rota.href, pathname) ||
              rota.filhos?.some((f) => rotaAtiva(f.href, pathname))
          );

          return (
            <details
              key={grupo.label}
              className={temAtivo ? "fin-nav-grupo ativo" : "fin-nav-grupo"}
              open={aberto}
              onToggle={(e) => {
                if (compacta) return;
                const el = e.currentTarget;
                setAbertosManual((antes) => ({ ...antes, [grupo.label]: el.open }));
              }}
            >
              <summary
                className={temAtivo ? "fin-nav-summary ativo" : "fin-nav-summary"}
                title={compacta ? grupo.label : undefined}
                onClick={
                  compacta
                    ? (e) => {
                        e.preventDefault();
                        setCompacta(false);
                        setAbertosManual({ [grupo.label]: true });
                        try {
                          window.localStorage.setItem(CHAVE_COMPACTA, "0");
                        } catch {
                          /* */
                        }
                      }
                    : undefined
                }
              >
                <span className="fin-nav-summary-icone" aria-hidden>
                  <Icone size={16} strokeWidth={2} />
                </span>
                <span className="fin-nav-summary-texto">{grupo.label}</span>
                <span className="fin-nav-summary-seta" aria-hidden>
                  <ChevronRight size={14} strokeWidth={2} />
                </span>
                {compacta && temAtivo ? <span className="fin-nav-summary-ponto" aria-hidden /> : null}
              </summary>
              {!compacta ? (
                <div className="fin-nav-itens">
                  {grupo.rotas.map((rota) => (
                    <ItemDeRota key={rota.href} rota={rota} pathname={pathname} />
                  ))}
                </div>
              ) : null}
            </details>
          );
        })}
      </nav>

      <div className="fin-shell">{children}</div>
    </div>
  );
}

function ItemDeRota({ rota, pathname }: { rota: Rota; pathname: string }) {
  const ativa = rotaAtiva(rota.href, pathname);
  const filhoAtivo = rota.filhos?.some((f) => rotaAtiva(f.href, pathname)) ?? false;

  return (
    <>
      <Link
        href={rota.href}
        className={ativa ? "fin-nav-item active" : "fin-nav-item"}
        aria-current={ativa ? "page" : undefined}
      >
        {rota.label}
      </Link>
      {rota.filhos && (ativa || filhoAtivo) ? (
        <div className="fin-nav-filhos">
          {rota.filhos.map((filho) => {
            const aberto = rotaAtiva(filho.href, pathname);
            return (
              <Link
                key={filho.href}
                href={filho.href}
                className={aberto ? "fin-nav-item filho active" : "fin-nav-item filho"}
                aria-current={aberto ? "page" : undefined}
              >
                {filho.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
