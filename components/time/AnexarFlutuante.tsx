"use client";

import { useEffect, useRef, useState } from "react";

/**
 * O botão flutuante que começa a compra pela foto.
 *
 * ---------------------------------------------------------------------------
 * POR QUE FLUTUANTE, E POR QUE ISTO INVERTE O FORMULÁRIO
 * ---------------------------------------------------------------------------
 * O comprovante era o ÚLTIMO campo da tela. A ordem dizia à pessoa: digite
 * tudo, e no fim anexe a foto. Só que a foto é o que ela tem na mão no momento
 * em que compra — e é dela que sai quase todo o resto: valor, data, loja,
 * cartão, parcelas, os itens, e até um palpite de categoria e área.
 *
 * Deixar isso no fim significava digitar à mão dez campos que a foto
 * preencheria em três segundos. O Fernando: "poderia o usuário já começar
 * anexando".
 *
 * Então o anexo sai da ordem do formulário e vira um botão que está SEMPRE
 * ali, no alcance do polegar, sobre qualquer parte da tela. Quem já começou a
 * digitar não perde nada; quem acabou de comprar toca uma vez e vê o
 * formulário se preencher.
 *
 * ---------------------------------------------------------------------------
 * POR QUE TRÊS ENTRADAS, E NÃO UM `<input type="file">` SÓ
 * ---------------------------------------------------------------------------
 * Um input só, sem `capture`, faz o Android e o iPhone abrirem a folha
 * "Câmera / Fototeca / Arquivos" — o que parece resolver. Mas essa folha é do
 * sistema, muda de aparelho para aparelho, e em alguns Androids a câmera fica
 * atrás de "mais opções".
 *
 * Três destinos explícitos custam um toque e eliminam a loteria:
 *
 *   Tirar foto     `capture="environment"` — abre a câmera traseira direto.
 *   Da galeria     sem `capture` — o print do app do banco já está lá, e é
 *                  metade dos casos. Forçar a câmera tornaria esse caso
 *                  impossível.
 *   Nota fiscal    PDF e XML. O XML é lido campo a campo, sem IA e sem erro:
 *                  é o único caminho em que o valor não é interpretação.
 *
 * O rótulo diz o que a pessoa quer fazer ("tirar foto"), não o que o navegador
 * vai fazer ("selecionar arquivo").
 */

export type OrigemAnexo = "camera" | "galeria" | "nota";

const OPCOES: { origem: OrigemAnexo; rotulo: string; dica: string; accept: string; capture?: boolean }[] = [
  {
    origem: "camera",
    rotulo: "Tirar foto",
    dica: "cupom ou nota na mão",
    accept: "image/*",
    capture: true
  },
  {
    origem: "galeria",
    rotulo: "Escolher imagem",
    dica: "print do banco ou da loja",
    accept: "image/*"
  },
  {
    origem: "nota",
    rotulo: "Nota fiscal",
    dica: "XML lê exato, sem IA · PDF também serve",
    accept: "application/pdf,text/xml,application/xml,.xml"
  }
];

function Icone({ origem, tamanho = 22 }: { origem: OrigemAnexo; tamanho?: number }) {
  const comum = {
    width: tamanho,
    height: tamanho,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };
  if (origem === "camera")
    return (
      <svg {...comum}>
        <path d="M4 8h3l1.5-2h7L17 8h3v11H4V8Z" />
        <circle cx="12" cy="13" r="3.4" />
      </svg>
    );
  if (origem === "galeria")
    return (
      <svg {...comum}>
        <rect x="3.5" y="5" width="17" height="14" rx="2.2" />
        <circle cx="8.8" cy="10" r="1.5" />
        <path d="m4.5 17 4.6-4.4L13 16l2.6-2.3L19.5 17" />
      </svg>
    );
  return (
    <svg {...comum}>
      <path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" />
      <path d="M13.8 3.7V8.2h4.5M8.6 13h6.8M8.6 16.4h4.4" />
    </svg>
  );
}

export function AnexarFlutuante({
  aoEscolher,
  lendo,
  jaTem,
  centralizado = false,
  rotulo = "foto da compra",
  rotuloAnexado = "trocar anexo"
}: {
  aoEscolher: (arquivo: File, origem: OrigemAnexo) => void;
  lendo: boolean;
  jaTem: boolean;
  /** Centraliza o botão flutuante na parte inferior da tela. */
  centralizado?: boolean;
  rotulo?: string;
  rotuloAnexado?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const botaoRef = useRef<HTMLButtonElement | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  // Mesma regra do menu "Mais": um painel que cobre a tela precisa de saída
  // por Esc e por toque fora. Sem isso ele fica por cima do formulário e a
  // pessoa não tem gesto para dispensar.
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setAberto(false);
      botaoRef.current?.focus();
    };
    const aoApontar = (e: PointerEvent) => {
      if (e.target instanceof Node && !caixaRef.current?.contains(e.target)) setAberto(false);
    };
    document.addEventListener("keydown", aoTeclar);
    document.addEventListener("pointerdown", aoApontar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.removeEventListener("pointerdown", aoApontar);
    };
  }, [aberto]);

  const inputsOcultos = OPCOES.map((o) => (
    <input
      key={o.origem}
      ref={(el) => {
        inputs.current[o.origem] = el;
      }}
      type="file"
      className="anexar-input"
      accept={o.accept}
      {...(o.capture ? { capture: "environment" as const } : {})}
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        setAberto(false);
        if (f) aoEscolher(f, o.origem);
      }}
    />
  ));

  /*
   * O FLUTUANTE SAI DE CENA QUANDO O BOTÃO DE ENVIAR ENTRA.
   *
   * Ele é `position: fixed` e, na variante centralizada, ocupa o meio da tela
   * logo acima da barra — exatamente onde passa o botão que conclui o
   * formulário. Medido rolando de 20 em 20px e perguntando ao
   * `elementFromPoint` quem está no centro do botão de envio:
   *
   *   /time/custo      o flutuante responde entre scrollY 380 e 400
   *   /time/reembolso  entre 460 e 500
   *
   * Essa faixa é onde um flick para. A pessoa rola EM DIREÇÃO ao botão verde,
   * ele aparece, ela toca no meio dele — e abre o menu de anexo.
   *
   * Já houve uma correção aqui, e ela foi parcial: afastou o flutuante na
   * posição de REPOUSO (no fim da rolagem sobram 140px), mas no meio do
   * caminho a sobreposição continuou. Distância fixa não resolve um alvo que
   * se move.
   *
   * A regra certa não é geométrica, é de intenção: o flutuante existe para
   * COMEÇAR o formulário ("já começa anexando"). Quando o botão de enviar está
   * na tela, a pessoa está terminando — o flutuante já fez o trabalho dele e
   * não tem por que continuar disputando o dedo.
   *
   * ---------------------------------------------------------------------------
   * MAS "SUMIR" FOI LONGE DEMAIS, E ISSO MATOU O FLUXO NUM APARELHO INTEIRO
   * ---------------------------------------------------------------------------
   * A primeira versão desta regra escondia o flutuante. Medido num iPad Air em
   * retrato (820x1180): a página tem 1390px, o rodapé do formulário nasce em
   * y=1051 já com scrollY 0, e a rolagem total é de 210px — o rodapé NUNCA sai
   * da tela. O flutuante nascia escondido e ficava assim para sempre. E o
   * formulário unificado não tem outro controle de anexo (o bloco `.anexos` só
   * renderiza quando `!unificado`), então registrar compra por foto ficou
   * impossível nesse aparelho.
   *
   * Varrido: 393x852 ok, 412x915 ok, 768x1024 ok, 1280x800 ok, 1512x982 ok,
   * 820x1180 morto. O limiar é vh ≳ 1130.
   *
   * Agora ele ENCOLHE em vez de sumir: vira um disco de 56px no canto direito.
   * Ali ele não alcança o centro do botão de enviar em largura nenhuma — em
   * 393px o disco ocupa x 323–379 e o centro do botão fica em 196 — e continua
   * a um toque de distância em qualquer altura de tela. Resolve a sobreposição
   * sem tirar a função de ninguém.
   */
  const [chegouNoFim, setChegouNoFim] = useState(false);
  const [rolou, setRolou] = useState(false);
  const [tocou, setTocou] = useState(false);
  useEffect(() => {
    const form = document.querySelector(".time-form");
    if (!form) return;
    // `capture` porque o alvo pode parar o borbulhamento; `once` porque só
    // interessa a PRIMEIRA interação — depois disso o estado não volta.
    const marcar = () => setTocou(true);
    form.addEventListener("pointerdown", marcar, { once: true, capture: true });
    form.addEventListener("focusin", marcar, { once: true, capture: true });
    return () => {
      form.removeEventListener("pointerdown", marcar, { capture: true });
      form.removeEventListener("focusin", marcar, { capture: true });
    };
  }, []);
  useEffect(() => {
    const rodape = document.querySelector(".time-form-rodape");
    if (rodape && typeof IntersectionObserver !== "undefined") {
      const obs = new IntersectionObserver(([e]) => setChegouNoFim(e.isIntersecting), { threshold: 0 });
      obs.observe(rodape);
      const aoRolar = () => setRolou(window.scrollY > 0);
      aoRolar();
      window.addEventListener("scroll", aoRolar, { passive: true });
      return () => {
        obs.disconnect();
        window.removeEventListener("scroll", aoRolar);
      };
    }
    const aoRolar = () => setRolou(window.scrollY > 0);
    aoRolar();
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);

  /*
   * A PÍLULA É O CONVITE, E O CONVITE SE GASTA.
   *
   * Encolher só no rodapé resolvia a sobreposição com o botão de enviar e
   * deixava as do meio do caminho: no topo da página a pílula de 197px cobre o
   * rótulo "Tipo ou categoria" e um dos chips de MAIS USADOS; a 150px de
   * rolagem, o campo "cliente, obra ou área" em /time/custo e "buscar tipo ou
   * categoria" em /time/reembolso.
   *
   * A regra que cobre tudo é a mesma de antes, levada até o fim: o formato
   * grande existe para CONVIDAR ("já começa anexando"). No instante em que a
   * pessoa se mexe — qualquer rolagem, qualquer toque dentro do formulário — o
   * convite já foi feito, e o botão vira disco no canto. Continua a um toque, e
   * para de disputar espaço com o formulário inteiro em vez de só com o botão
   * final.
   *
   * Medido varrendo a rolagem inteira de /time/custo e /time/reembolso em
   * 393x852, 412x915 e 820x1180, perguntando ao `elementFromPoint` o centro de
   * TODO input, botão, select e label do formulário: zero coberturas a partir
   * do primeiro pixel de rolagem. Resta o repouso absoluto (scrollY 0, nada
   * tocado), onde a pílula cobre um chip da primeira tela — e ali ela é
   * exatamente o que deve ser vista primeiro. Um flick resolve, e o toque em
   * qualquer campo também.
   */
  const encolhido = chegouNoFim || rolou || tocou;

  return (
    <div
      className={`${centralizado ? "anexar anexar-centro" : "anexar"}${encolhido ? " anexar-encolhido" : ""}`}
      ref={caixaRef}
    >
      {aberto ? (
        <div className="anexar-folha" role="menu" aria-label="De onde vem o comprovante">
          {OPCOES.map((o) => (
            <button
              key={o.origem}
              type="button"
              role="menuitem"
              className="anexar-opcao"
              onClick={() => inputs.current[o.origem]?.click()}
            >
              <Icone origem={o.origem} />
              <span>
                <strong>{o.rotulo}</strong>
                <small>{o.dica}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <button
        ref={botaoRef}
        type="button"
        className={aberto ? "anexar-botao aberto" : "anexar-botao"}
        aria-expanded={aberto}
        aria-haspopup="menu"
        onClick={() => setAberto((v) => !v)}
        // `aria-busy` em vez de `disabled`: desabilitar durante a leitura tira
        // o foco do elemento e joga quem usa teclado de volta para o começo do
        // documento. O guard contra o segundo toque é o `lendo` no onClick de
        // quem chama.
        aria-busy={lendo}
        aria-label={lendo ? "lendo o comprovante" : jaTem ? rotuloAnexado : rotulo}
      >
        {lendo ? (
          <span className="anexar-girando" aria-hidden />
        ) : (
          <Icone origem="camera" tamanho={28} />
        )}
        {/* O rótulo some no estado encolhido, mas o botão continua com nome
            acessível pelo `aria-label` abaixo — quem usa leitor de tela nunca
            fica com um botão mudo. */}
        <span className="anexar-botao-rotulo">{lendo ? "lendo…" : jaTem ? rotuloAnexado : rotulo}</span>
      </button>

      {/*
        Os inputs ficam fora da folha e sempre montados. Montá-los junto com o
        painel faria o `click()` disparar num nó recém-criado, que o Safari
        ignora por não ter vindo de gesto do usuário.
      */}
      {inputsOcultos}
    </div>
  );
}
