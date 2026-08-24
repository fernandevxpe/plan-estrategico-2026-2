"use client";

import { useEffect, useState } from "react";

/**
 * O botão de instalar o app na tela inicial do celular.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O EVENTO É CAPTURADO NO ESCOPO DO MÓDULO, E NÃO NUM `useEffect`
 * ---------------------------------------------------------------------------
 * `beforeinstallprompt` é disparado UMA vez, pelo navegador, quando ele decide
 * que o site é instalável — normalmente logo depois do carregamento. Se o
 * ouvinte só existisse dentro do componente, o evento já teria passado quando a
 * pessoa navegasse até `/time/perfil`, e o botão nunca apareceria: o evento não
 * se repete, e não há como pedi-lo de novo.
 *
 * Registrar no corpo do módulo faz o ouvinte existir assim que este arquivo é
 * avaliado — o mais cedo que dá do lado do cliente. O evento fica guardado em
 * `guardado` até alguém montar o componente e usar.
 *
 * `preventDefault()` é o que impede o Chrome de mostrar o próprio banner: a
 * partir daí a instalação só acontece se NÓS chamarmos `prompt()`. É a troca
 * que o padrão oferece — controle de onde o convite aparece em troca de
 * assumir a responsabilidade de oferecê-lo.
 */
type EventoInstalar = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let guardado: EventoInstalar | null = null;
const ouvintes = new Set<(e: EventoInstalar | null) => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    guardado = e as EventoInstalar;
    ouvintes.forEach((f) => f(guardado));
  });
  window.addEventListener("appinstalled", () => {
    // O evento vira lixo depois de aceito: `prompt()` só pode ser chamado uma vez.
    guardado = null;
    ouvintes.forEach((f) => f(null));
  });
}

/**
 * Já está rodando instalado?
 *
 * `display-mode: standalone` é o sinal do padrão e vale em Android e desktop.
 * `navigator.standalone` é a versão da Apple, que nunca implementou o resto —
 * é a única forma de saber no iPhone, e por isso o `any` fica.
 */
function estaInstalado(): boolean {
  if (typeof window === "undefined") return false;
  const modo = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const apple = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return modo || apple;
}

/**
 * iPhone e iPad, onde o botão é IMPOSSÍVEL.
 *
 * O iOS não implementa `beforeinstallprompt` e não expõe nenhuma API de
 * instalação — a única porta é o menu Compartilhar do Safari. Não há como
 * contornar pelo lado do site, então aqui a honestidade é dizer os dois toques
 * em vez de mostrar um botão que não faria nada.
 *
 * iPad com iPadOS 13+ se apresenta como "Macintosh" no user agent; o que o
 * denuncia é a tela sensível ao toque.
 */
function ehApple(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

export function InstalarApp() {
  const [evento, setEvento] = useState<EventoInstalar | null>(null);
  const [instalado, setInstalado] = useState(false);
  const [apple, setApple] = useState(false);
  const [recusado, setRecusado] = useState(false);

  useEffect(() => {
    /*
     * Tudo isto só existe no cliente. Lido no efeito e não na primeira
     * renderização porque o servidor não tem `window`: decidir no corpo do
     * componente daria um HTML diferente do que o navegador monta, e o React
     * reclamaria da hidratação.
     */
    setEvento(guardado);
    setInstalado(estaInstalado());
    setApple(ehApple());

    const aoMudar = (e: EventoInstalar | null) => setEvento(e);
    ouvintes.add(aoMudar);

    // Instalar pelo menu do navegador não dispara `appinstalled` em toda versão;
    // a mudança de modo de exibição dispara.
    const mq = window.matchMedia?.("(display-mode: standalone)");
    const aoTrocarModo = () => setInstalado(estaInstalado());
    mq?.addEventListener?.("change", aoTrocarModo);

    return () => {
      ouvintes.delete(aoMudar);
      mq?.removeEventListener?.("change", aoTrocarModo);
    };
  }, []);

  async function instalar() {
    if (!evento) return;
    setRecusado(false);
    await evento.prompt();
    const { outcome } = await evento.userChoice;
    /*
     * `prompt()` é de uso único: aceito ou recusado, o evento morre. Quem
     * recusar e mudar de ideia precisa do menu do navegador — ou de recarregar
     * a página, que faz o Chrome disparar o evento de novo.
     */
    guardado = null;
    setEvento(null);
    if (outcome === "accepted") setInstalado(true);
    else setRecusado(true);
  }

  if (instalado) {
    return (
      <p className="instalar-ok" role="status">
        <IconeCelular />
        Você já está no app instalado.
      </p>
    );
  }

  return (
    <section className="instalar-caixa" aria-labelledby="instalar-titulo">
      <div className="instalar-texto">
        <strong id="instalar-titulo">Instalar no celular</strong>
        <p>
          Abre em tela cheia, sem a barra do navegador, e o ícone fica na tela inicial junto com os
          outros apps.
        </p>
      </div>

      {evento ? (
        <button type="button" className="instalar-botao" onClick={() => void instalar()}>
          <IconeCelular />
          Instalar app
        </button>
      ) : apple ? (
        /*
         * Dois toques, na ordem e com o nome exato do que aparece na tela do
         * iPhone. "Menu de compartilhamento" não ajuda ninguém a achar o botão.
         */
        <ol className="instalar-passos">
          <li>
            Toque em <strong>Compartilhar</strong> — o quadrado com a seta para cima, embaixo no
            Safari.
          </li>
          <li>
            Role e toque em <strong>Adicionar à Tela de Início</strong>.
          </li>
        </ol>
      ) : (
        <p className="instalar-passos-sub">
          {recusado
            ? "Instalação cancelada. Para instalar depois, recarregue esta página ou use o menu do navegador."
            : "Abra o menu do navegador (⋮) e toque em Instalar app. Se não aparecer, use o Chrome no Android ou o Safari no iPhone."}
        </p>
      )}
    </section>
  );
}

function IconeCelular() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M12 7v7m0 0 3-3m-3 3-3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
