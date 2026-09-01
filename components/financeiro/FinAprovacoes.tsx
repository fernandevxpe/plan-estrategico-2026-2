"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CirclePause,
  Clock,
  FileText,
  RefreshCw,
  Search,
  Send,
  Undo2,
  Wallet,
  X
} from "lucide-react";

import {
  coberturaDoDia,
  ordemEhHoje,
  ROTULO_TIPO,
  type SaldoConta,
  type SaldoInter,
  type TipoOrdem
} from "@/lib/financeiro/aprovacoes-caixa";
import type { Aprovacoes, EstadoCiclo, OrdemAprovacao } from "@/lib/financeiro/aprovacoes";
import { brlCents, brlPrecise, dateLabel } from "@/lib/financeiro/format";
import { urlDaOrigem } from "@/lib/url-origem";


/**
 * APROVAÇÕES — o que foi para o Inter e ainda espera um dedo humano.
 *
 * Quatro blocos, na ordem do ciclo: o que ainda não foi ao banco, o que está
 * esperando no aplicativo, o que já saiu e o que morreu no caminho. O bloco do
 * meio é o motivo da tela; o PRIMEIRO é onde ela virou ferramenta.
 *
 * O primeiro bloco deixou de ser só leitura em 01/09/2026. Ele é a SELEÇÃO
 * REGISTRADA: quem seleciona contas a pagar em produção cria as ordens em
 * `rascunho` — o POST só grava no Postgres — e o envio ao banco falha ali com
 * 503, porque a escrita bancária exige `NODE_ENV !== production` e
 * `INTER_PAGAMENTO_LOCAL` ligado, e as credenciais de pagamento só existem na
 * máquina local. Como o banco é o MESMO, essas ordens aparecem aqui para quem
 * tem a credencial, e é daqui que elas saem.
 *
 * O cartão gigante do topo saiu em 01/09/2026. A garantia ("nada aqui paga")
 * mora no subtítulo da página e no botão — que continua se chamando "Enviar ao
 * Inter para aprovação", nunca "Pagar". O espaço que o cartão ocupava agora
 * mostra o saldo do Inter e o que falta para cobrir o que vence hoje: em
 * 01/09 o banco apagou 10 ordens por falta de caixa, e um parágrafo de
 * onboarding não evitou isso.
 *
 * O SEGUNDO bloco também deixou de ser só leitura, no mesmo 01/09/2026. Das 39
 * ordens programadas, 27 ficaram pagas, 2 em rascunho e 10 presas em
 * `aguardando_autorizacao`. O dono abriu o aplicativo do banco e contou o que a
 * plataforma não tem como saber: "devido à demora em aprovar e falta de
 * dinheiro em caixa, o Inter apagou tudo que não tinha saldo". Do nosso lado
 * elas continuavam "aguardando" — que é a verdade do que NÓS sabemos, porque o
 * banco não avisa que apagou e a credencial de pagamento não tem endpoint de
 * consulta. Faltava a ação que devolve essas ordens à fila, e é a do bloco.
 *
 * ELA REGISTRA UMA AFIRMAÇÃO HUMANA, NUNCA UM FATO BANCÁRIO. A tela não diz "o
 * Inter apagou" em lugar nenhum: ela diz "você confirmou que não está mais lá",
 * e guarda o motivo digitado em `notes` e em `fin_audit_log` com o nome de quem
 * clicou. A diferença não é estilo — a primeira frase é mentira do lado de cá.
 *
 * ÂMBAR SIGNIFICA UMA COISA SÓ AQUI: ordem parada há dois dias ou mais no
 * aplicativo do banco. O aviso do topo usa o roxo da casa justamente para não
 * gastar o âmbar em algo que não é fila de decisão — se tudo alerta, nada
 * alerta. É a mesma lição que FinContasAPagar já pagou, quando hachurar por
 * `entra_no_total = false` rotulou 31 contas reais de R$ 40.044,75 como
 * duplicata. A devolução respeita isso: a barra que a abre é NEUTRA, e o âmbar
 * aparece só na frase de risco da confirmação — que é, literalmente, a mesma
 * coisa que ele já significa: uma decisão parada esperando uma pessoa.
 */

const ROTA_ENVIO = "/api/financeiro/contas-a-pagar/programar";

/**
 * 6.500ms ENTRE UMA ORDEM E A SEGUINTE. ISTO NÃO É FOLGA DE CONFORTO.
 *
 * O Inter limita a integração a ~10 chamadas por minuto, e foi exatamente isso
 * que partiu o primeiro lote real ao meio: das 38 ordens, 27 saíram e 11
 * (R$ 17.639,86) voltaram com recusa do banco e ficaram em `rascunho`. 6,5s dá
 * ~9,2 chamadas por minuto — abaixo do teto, com margem para a latência da
 * própria chamada empurrar o intervalo para cima, nunca para baixo.
 *
 * O cliente de LEITURA da casa (`scripts/lib/inter.mjs:19`) espera 7s pelo
 * mesmo motivo; o número aqui é menor só porque a leitura roda em lote longo e
 * o envio é um punhado de ordens com uma pessoa olhando.
 *
 * A espera vem ANTES de cada chamada, exceto a primeira: esperar depois faria
 * a última ordem cobrar 6,5s de nada.
 */
const ESPERA_MS = 6_500;
const ESPERA_ROTULO = "6,5s";

/**
 * Só `rascunho` e `aprovada` saem daqui, e a lista é a mesma de
 * `enviarOrdemAoInter` (pagar-programar.ts:490). Qualquer outro status devolve
 * 409 — deixar o checkbox clicável seria oferecer um botão que já se sabe que
 * vai falhar.
 */
const STATUS_QUE_SAEM = new Set(["rascunho", "aprovada"]);

/**
 * DEVOLVER À FILA — a mesma rota, `acao: "devolver"` no corpo.
 *
 * `POST { acao, ids, motivo }` → `{ devolvidas, recusadas }`, e 422 quando o
 * motivo tem menos de `MOTIVO_MINIMO` caracteres. A mecânica está em
 * `devolverParaRascunho` (pagar-programar.ts:798); daqui não sai nenhuma
 * chamada ao banco, e nada aqui aprova, paga ou cancela: a ordem volta para
 * `rascunho` com o MESMO `code`, e a obrigação continua devida.
 */
const ROTA_DEVOLVER = ROTA_ENVIO;

/**
 * O texto de partida — EDITÁVEL, e em primeira pessoa de propósito.
 *
 * Ele é o rascunho da afirmação de quem clica, não a conclusão da plataforma. O
 * campo abre com o cursor livre em vez de um checkbox "confirmo" porque o que
 * fica gravado em `fin_audit_log` precisa dizer QUEM afirmou O QUÊ — um
 * checkbox marcado grava só que alguém clicou.
 */
const MOTIVO_SUGERIDO =
  "Conferi no aplicativo do Inter e estas ordens não estão mais lá — apagadas por falta de saldo em caixa.";

/** O piso da rota. Menos que isto e ela responde 422 (pagar-programar.ts:806). */
const MOTIVO_MINIMO = 5;

/**
 * QUEM PODE VOLTAR PARA A FILA, e por que são três condições e não uma.
 *
 * Espelha o `WHERE` do UPDATE (pagar-programar.ts:826-833). O `status` é o que a
 * rota exige; `pagoCents` e `execucao` são a MESMA guarda vista de dois lados —
 * se uma execução foi registrada entre a pessoa olhar o aplicativo e clicar, o
 * gatilho já moveu a ordem para `pago`, e devolver para rascunho o que saiu da
 * conta apagaria um fato do caixa. Deixar o checkbox clicável nesse caso seria
 * oferecer um botão que a rota já vai recusar.
 */
function podeVoltarParaFila(o: OrdemAprovacao): boolean {
  return o.status === "aguardando_autorizacao" && o.pagoCents === 0 && o.execucao === null;
}

type Bloco = {
  estado: EstadoCiclo;
  titulo: string;
  explicacao: string;
  rotuloKpi: string;
  icone: typeof Clock;
};

const BLOCOS: Bloco[] = [
  {
    estado: "nao_enviada",
    titulo: "Rascunho",
    explicacao: "Selecionado, ainda não foi ao Inter. O envio para na aprovação — não paga.",
    rotuloKpi: "Rascunho",
    icone: FileText
  },
  {
    estado: "aguardando",
    titulo: "No app do Inter",
    explicacao: "Entregue ao banco. O dinheiro só sai quando você aprovar no aplicativo.",
    rotuloKpi: "No app",
    icone: Clock
  },
  {
    estado: "paga",
    titulo: "Paga",
    explicacao: "Saída confirmada no extrato — o que já aconteceu na conta.",
    rotuloKpi: "Paga",
    icone: CheckCircle2
  },
  {
    estado: "encerrada",
    titulo: "Encerrada",
    explicacao: "Rejeitada, cancelada ou devolvida. Some do caixa previsto.",
    rotuloKpi: "Encerrada",
    icone: Ban
  }
];

const ROTA_SALDO = "/api/financeiro/aprovacoes/saldo";
/** Uma chamada a cada 45s: o Inter limita ~10/min, e 45s é 1,3/min. */
const POLL_SALDO_MS = 60_000;

/**
 * O selo diz o `status` cru da 0075, não o do bloco.
 *
 * O bloco agrupa quatro perguntas; o selo é onde a linha continua sabendo
 * exatamente o que é. Sem ele, uma ordem em `em_lote` e uma em `rascunho`
 * ficariam indistinguíveis no primeiro bloco — e agora elas nem se comportam
 * igual: uma pode ser marcada para envio, a outra não.
 */
const ROTULO_STATUS: Record<string, string> = {
  rascunho: "Rascunho",
  em_aprovacao: "Em aprovação interna",
  aprovada: "Aprovada, não enviada",
  em_lote: "Em lote",
  aguardando_autorizacao: "No app do Inter",
  pago_parcial: "Paga em parte",
  pago: "Paga",
  rejeitada: "Rejeitada",
  cancelada: "Cancelada",
  devolvida: "Devolvida"
};

const CLASSE_SELO: Record<EstadoCiclo, string> = {
  nao_enviada: "fin-apr-selo-rascunho",
  aguardando: "fin-apr-selo-espera",
  paga: "fin-apr-selo-paga",
  encerrada: "fin-apr-selo-fim"
};

function dias(n: number | null): string {
  if (n === null) return "—";
  if (n === 0) return "hoje";
  return `${n} ${n === 1 ? "dia" : "dias"}`;
}

function plural(n: number, um: string, muitos: string): string {
  return `${n} ${n === 1 ? um : muitos}`;
}

/**
 * `restantes × 6,5s`, arredondado para uma unidade que a pessoa consiga usar.
 *
 * Segundos até um minuto, minutos depois disso: "~72s" não ajuda ninguém a
 * decidir se dá tempo de levantar da cadeira, "~1 min" ajuda.
 */
function tempoRestante(restantes: number): string {
  if (restantes <= 0) return "última";
  const segundos = Math.round((restantes * ESPERA_MS) / 1000);
  if (segundos < 60) return `~${segundos}s`;
  return `~${Math.round(segundos / 60)} min`;
}

/**
 * Espera cancelável.
 *
 * Um `setTimeout` de 6.500ms deixaria o botão Parar mudo por até 6,5 segundos —
 * e "parar" que só obedece daqui a seis segundos é um botão que a pessoa aperta
 * três vezes. Cochilos de 150ms conferem o pedido de parada entre eles; o
 * arredondamento sempre alonga o intervalo, nunca o encurta, então a proteção
 * contra o limite do Inter continua de pé.
 */
async function dormir(ms: number, cancelado: () => boolean): Promise<void> {
  const fim = Date.now() + ms;
  while (Date.now() < fim && !cancelado()) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function somaHoje(ordens: OrdemAprovacao[], hoje: string): number {
  return ordens.reduce((s, o) => s + (ordemEhHoje(o.scheduledFor, hoje) ? o.valorCents : 0), 0);
}

type CorpoSaldo = SaldoInter & { asaas?: SaldoConta; nubank?: SaldoConta; error?: string };

function contaOuNula(c: SaldoConta | null | undefined): SaldoConta | null {
  return c && c.disponivelCents !== null ? c : null;
}

function useSaldos(inicial: {
  inter: SaldoInter | null;
  asaas: SaldoConta | null;
  nubank: SaldoConta | null;
}) {
  const [saldo, setSaldo] = useState<SaldoInter | null>(inicial.inter);
  const [asaas, setAsaas] = useState<SaldoConta | null>(inicial.asaas);
  const [nubank, setNubank] = useState<SaldoConta | null>(inicial.nubank);
  const [atualizando, setAtualizando] = useState(false);

  const atualizar = useCallback(async () => {
    setAtualizando(true);
    try {
      const resposta = await fetch(urlDaOrigem(ROTA_SALDO), { cache: "no-store" });
      const corpo = (await resposta.json().catch(() => null)) as CorpoSaldo | null;
      if (!corpo) return;
      // Inter só atualiza no 200: um 503 do banco não pode apagar o número
      // que o SSR já mostrou. Asaas/Nubank vêm do ledger e chegam mesmo
      // quando o Inter falha — vale aplicar.
      if (resposta.ok && "disponivelCents" in corpo) setSaldo(corpo);
      if (corpo.asaas) setAsaas(contaOuNula(corpo.asaas));
      if (corpo.nubank) setNubank(contaOuNula(corpo.nubank));
    } catch {
      // Mantém o que já está na tela — ledger ou o último ao vivo. Sumir o
      // número porque o poll falhou é pior do que ele ficar 45s velho.
    } finally {
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    void atualizar();
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void atualizar();
    }, POLL_SALDO_MS);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [atualizar]);

  return { saldo, asaas, nubank, atualizando, atualizar };
}

function useFiltro(ordens: OrdemAprovacao[]) {
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<TipoOrdem | null>(null);

  const tipos = useMemo(() => {
    const mapa = new Map<TipoOrdem, { n: number; cents: number }>();
    for (const o of ordens) {
      const atual = mapa.get(o.tipo) ?? { n: 0, cents: 0 };
      atual.n += 1;
      atual.cents += o.valorCents;
      mapa.set(o.tipo, atual);
    }
    return [...mapa.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([slug, v]) => ({ slug, ...v }));
  }, [ordens]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return ordens.filter((o) => {
      if (tipo && o.tipo !== tipo) return false;
      if (!q) return true;
      return (
        o.favorecido.toLowerCase().includes(q) ||
        o.descricao.toLowerCase().includes(q) ||
        o.code.toLowerCase().includes(q)
      );
    });
  }, [ordens, busca, tipo]);

  const filtrando = Boolean(busca.trim() || tipo);
  const limpar = useCallback(() => {
    setBusca("");
    setTipo(null);
  }, []);

  return { busca, setBusca, tipo, setTipo, tipos, visiveis, filtrando, limpar };
}

export function FinAprovacoes({ dados }: { dados: Aprovacoes }) {
  const { saldo, asaas, nubank, atualizando, atualizar } = useSaldos({
    inter: dados.saldoInter,
    asaas: dados.saldoAsaas,
    nubank: dados.saldoNubank
  });
  const porEstado = useMemo(() => {
    const mapa = new Map<EstadoCiclo, OrdemAprovacao[]>();
    for (const bloco of BLOCOS) mapa.set(bloco.estado, []);
    // `dados.ordens` já vem ordenado do servidor, por bloco e dentro do bloco.
    // Filtrar preserva a ordem, então a regra de ordenação mora num lugar só.
    for (const ordem of dados.ordens) mapa.get(ordem.estado)?.push(ordem);
    return mapa;
  }, [dados.ordens]);

  const esquecidas = useMemo(() => dados.ordens.filter((o) => o.esquecida), [dados.ordens]);
  const aguardando = porEstado.get("aguardando") ?? [];
  const rascunho = porEstado.get("nao_enviada") ?? [];
  const hojeNoAppCents = somaHoje(aguardando, dados.hoje);
  const hojeRascunhoCents = somaHoje(rascunho, dados.hoje);
  const noAppCents = aguardando.reduce((s, o) => s + o.valorCents, 0);
  const rascunhoCents = rascunho.reduce((s, o) => s + o.valorCents, 0);
  const coberturaHoje = coberturaDoDia(
    saldo?.disponivelCents ?? null,
    hojeNoAppCents + hojeRascunhoCents
  );
  const coberturaApp = coberturaDoDia(saldo?.disponivelCents ?? null, hojeNoAppCents);
  const coberturaNoApp = coberturaDoDia(saldo?.disponivelCents ?? null, noAppCents);

  const [popupAbertura, setPopupAbertura] = useState(false);
  const mostrouRef = useRef(false);
  useEffect(() => {
    if (mostrouRef.current || !coberturaApp || coberturaApp.cabe) return;
    const chave = `fin-apr-caixa-${dados.hoje}`;
    try {
      if (sessionStorage.getItem(chave)) return;
    } catch {
      /* sessionStorage pode estar bloqueado; o popup ainda vale uma vez. */
    }
    mostrouRef.current = true;
    setPopupAbertura(true);
  }, [coberturaApp, dados.hoje]);

  const fecharPopupAbertura = useCallback(() => {
    setPopupAbertura(false);
    try {
      sessionStorage.setItem(`fin-apr-caixa-${dados.hoje}`, "1");
    } catch {
      /* sem persistência o popup só não volta neste render */
    }
  }, [dados.hoje]);

  return (
    <>
      {!dados.disponivel ? (
        <section className="card fin-empty">
          <h2 className="card-title">Aprovações indisponível</h2>
          <p>{dados.ressalva ?? "sem conexão com o banco do financeiro"}</p>
        </section>
      ) : dados.ordens.length === 0 ? (
        <section className="card fin-empty">
          <h2 className="card-title">Nenhuma ordem na fila</h2>
          <p>
            Nada foi programado ainda. As ordens nascem em{" "}
            <code>/financeiro/custos-empresa?aba=contas-a-pagar</code>, e aparecem aqui assim que
            existem.
          </p>
        </section>
      ) : (
        <>
          <FaixaSaldo
            saldo={saldo}
            asaas={asaas}
            nubank={nubank}
            atualizando={atualizando}
            onAtualizar={() => void atualizar()}
            cobertura={coberturaNoApp}
            coberturaHoje={coberturaHoje}
            noAppCents={noAppCents}
            rascunhoCents={rascunhoCents}
            hojeNoAppCents={hojeNoAppCents}
            esquecidas={esquecidas.length}
          />

          <FaixaCiclo
            porEstado={porEstado}
            esquecidas={esquecidas.length}
          />

          {BLOCOS.filter((b) => b.estado !== "encerrada").map((bloco) =>
            bloco.estado === "nao_enviada" ? (
              <BlocoParaEnviar
                key={bloco.estado}
                bloco={bloco}
                ordens={porEstado.get(bloco.estado) ?? []}
                hoje={dados.hoje}
                saldoCents={saldo?.disponivelCents ?? null}
                jaNoAppCents={noAppCents}
                jaNoAppHojeCents={hojeNoAppCents}
              />
            ) : bloco.estado === "aguardando" ? (
              <BlocoAguardando
                key={bloco.estado}
                bloco={bloco}
                ordens={porEstado.get(bloco.estado) ?? []}
                hoje={dados.hoje}
                saldoCents={saldo?.disponivelCents ?? null}
              />
            ) : (
              <BlocoAberto
                key={bloco.estado}
                bloco={bloco}
                ordens={porEstado.get(bloco.estado) ?? []}
                hoje={dados.hoje}
              />
            )
          )}

          <BlocoEncerrado ordens={porEstado.get("encerrada") ?? []} hoje={dados.hoje} />

          <p className="fin-apr-rodape">
            Posição de {dateLabel(dados.hoje)}. Nenhum botão desta página aprova, autoriza ou paga.
          </p>
        </>
      )}

      {popupAbertura && coberturaApp && !coberturaApp.cabe ? (
        <PopupCaixa
          cobertura={coberturaApp}
          contexto="aprovar"
          onFechar={fecharPopupAbertura}
        />
      ) : null}
    </>
  );
}

function somaSaldos(...valores: Array<number | null | undefined>): number | null {
  const nums = valores.filter((v): v is number => v != null && Number.isFinite(v));
  return nums.length === 0 ? null : nums.reduce((s, v) => s + v, 0);
}

function MiniSaldo({ rotulo, conta }: { rotulo: string; conta: SaldoConta | null }) {
  const cents = conta?.disponivelCents ?? null;
  const meta =
    conta?.fonte === "asaas"
      ? "ao vivo"
      : conta?.lastroAte
        ? `extrato ${conta.lastroAte}`
        : null;
  return (
    <div className="fin-apr-saldo-mini">
      <p className="fin-apr-saldo-rot">{rotulo}</p>
      <p className="fin-apr-saldo-valor">{cents === null ? "—" : brlPrecise(cents)}</p>
      {meta ? <p className="fin-apr-saldo-mini-meta">{meta}</p> : null}
    </div>
  );
}

function FaixaSaldo({
  saldo,
  asaas,
  nubank,
  atualizando,
  onAtualizar,
  cobertura,
  coberturaHoje,
  noAppCents,
  rascunhoCents,
  hojeNoAppCents,
  esquecidas
}: {
  saldo: SaldoInter | null;
  asaas: SaldoConta | null;
  nubank: SaldoConta | null;
  atualizando: boolean;
  onAtualizar: () => void;
  cobertura: ReturnType<typeof coberturaDoDia>;
  coberturaHoje: ReturnType<typeof coberturaDoDia>;
  noAppCents: number;
  rascunhoCents: number;
  hojeNoAppCents: number;
  esquecidas: number;
}) {
  const cents = saldo?.disponivelCents ?? null;
  const total = somaSaldos(cents, asaas?.disponivelCents, nubank?.disponivelCents);
  const fonte =
    saldo?.fonte === "inter"
      ? "ao vivo no Inter"
      : saldo?.fonte === "ledger"
        ? saldo.lastroAte
          ? `último extrato ${saldo.lastroAte}`
          : "saldo do ledger"
        : "sem leitura";

  return (
    <section className="fin-apr-saldo" aria-label="Saldos das contas">
      <div className="fin-apr-saldo-lado">
        <div className="fin-apr-saldo-contas">
          <div className="fin-apr-saldo-inter">
            <p className="fin-apr-saldo-rot">
              <Wallet size={15} strokeWidth={2.2} aria-hidden />
              Inter · disponível
            </p>
            <p className="fin-apr-saldo-valor">{cents === null ? "—" : brlPrecise(cents)}</p>
            <p className="fin-apr-saldo-meta">
              {fonte}
              {saldo?.bloqueadoCents ? ` · ${brlPrecise(saldo.bloqueadoCents)} bloqueado` : ""}
              <button
                type="button"
                className="fin-apr-saldo-att"
                onClick={onAtualizar}
                disabled={atualizando}
              >
                <RefreshCw size={12} strokeWidth={2.3} aria-hidden className={atualizando ? "gira" : undefined} />
                {atualizando ? "atualizando" : "atualizar"}
              </button>
            </p>
            {saldo?.ressalva ? <p className="fin-apr-saldo-ressalva">{saldo.ressalva}</p> : null}
          </div>
          <div className="fin-apr-saldo-outros">
            <MiniSaldo rotulo="Asaas" conta={asaas} />
            <MiniSaldo rotulo="Nubank" conta={nubank} />
          </div>
        </div>
        <p className="fin-apr-saldo-total">
          <span>Saldo total</span>
          <strong>{total === null ? "—" : brlPrecise(total)}</strong>
        </p>
      </div>
      <div className="fin-apr-saldo-hoje">
        <p className="fin-apr-saldo-rot">Para pagar no Inter</p>
        <dl>
          <div>
            <dt>No app</dt>
            <dd>{brlCents(noAppCents)}</dd>
          </div>
          <div>
            <dt>Em rascunho</dt>
            <dd>{brlCents(rascunhoCents)}</dd>
          </div>
          <div>
            <dt>{cobertura && !cobertura.cabe ? "Falta no Inter" : "Sobra no caixa"}</dt>
            <dd className={cobertura && !cobertura.cabe ? "falta" : "cabe"}>
              {cobertura
                ? cobertura.cabe
                  ? brlCents(cobertura.sobraCents)
                  : brlPrecise(cobertura.faltaCents)
                : "—"}
            </dd>
          </div>
        </dl>
        {cobertura && !cobertura.cabe ? (
          <p className="fin-apr-saldo-alerta">
            Adicione {brlPrecise(cobertura.faltaCents)} no Inter antes de aprovar no app — em 01/09 o
            banco apagou o que ficou sem saldo.
            {hojeNoAppCents > 0 && coberturaHoje && !coberturaHoje.cabe
              ? ` Disso, ${brlPrecise(hojeNoAppCents)} vence hoje.`
              : ""}
          </p>
        ) : null}
        {esquecidas > 0 ? (
          <p className="fin-apr-saldo-alerta suave">
            {esquecidas} ordem{esquecidas === 1 ? "" : "s"} parada{esquecidas === 1 ? "" : "s"} há 2
            dias ou mais no aplicativo.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function FaixaCiclo({
  porEstado,
  esquecidas
}: {
  porEstado: Map<EstadoCiclo, OrdemAprovacao[]>;
  esquecidas: number;
}) {
  return (
    <nav className="fin-apr-ciclo" aria-label="Ciclo das ordens">
      {BLOCOS.map((bloco, i) => {
        const lista = porEstado.get(bloco.estado) ?? [];
        const cents = lista.reduce((s, o) => s + o.valorCents, 0);
        const Icone = bloco.icone;
        return (
          <a
            key={bloco.estado}
            href={`#fin-apr-${bloco.estado}`}
            className={`fin-apr-ciclo-item${bloco.estado === "aguardando" ? " agora" : ""}`}
          >
            {i > 0 ? <span className="fin-apr-ciclo-seta" aria-hidden /> : null}
            <span className="fin-apr-ciclo-ico" aria-hidden>
              <Icone size={15} strokeWidth={2.1} />
            </span>
            <span className="fin-apr-ciclo-rot">{bloco.rotuloKpi}</span>
            <strong>{brlCents(cents)}</strong>
            <span className="fin-apr-ciclo-n">
              {plural(lista.length, "ordem", "ordens")}
              {bloco.estado === "aguardando" && esquecidas > 0
                ? ` · ${esquecidas} parada${esquecidas === 1 ? "" : "s"}`
                : ""}
            </span>
          </a>
        );
      })}
    </nav>
  );
}

function PopupCaixa({
  cobertura,
  contexto,
  onFechar,
  onContinuar
}: {
  cobertura: NonNullable<ReturnType<typeof coberturaDoDia>>;
  contexto: "enviar" | "aprovar";
  onFechar: () => void;
  onContinuar?: () => void;
}) {
  return (
    <div className="fin-apr-pop-overlay" role="presentation" onClick={onFechar}>
      <div
        className="fin-apr-pop"
        role="dialog"
        aria-labelledby="fin-apr-pop-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="fin-apr-pop-cab">
          <h2 id="fin-apr-pop-titulo">
            <AlertTriangle size={18} strokeWidth={2.2} aria-hidden />
            Falta {brlPrecise(cobertura.faltaCents)} no Inter
          </h2>
          <button type="button" className="fin-apr-pop-x" onClick={onFechar} aria-label="Fechar">
            <X size={16} strokeWidth={2.2} />
          </button>
        </header>
        <div className="fin-apr-pop-corpo">
          <p>
            {contexto === "enviar"
              ? "O que você está enviando hoje, somado ao que já espera no aplicativo, passa do saldo disponível."
              : "O que já está no aplicativo para hoje passa do saldo disponível."}{" "}
            O Inter apaga ordem sem saldo — medido em 01/09, 10 ordens sumiram assim.
          </p>
          <dl className="fin-apr-pop-conta">
            <div>
              <dt>Disponível no Inter</dt>
              <dd>{brlPrecise(cobertura.saldoCents)}</dd>
            </div>
            <div>
              <dt>A pagar hoje</dt>
              <dd>{brlPrecise(cobertura.hojeCents)}</dd>
            </div>
            <div className="falta">
              <dt>Falta adicionar</dt>
              <dd>{brlPrecise(cobertura.faltaCents)}</dd>
            </div>
          </dl>
          <p className="fin-apr-pop-rec">
            Transfira {brlPrecise(cobertura.faltaCents)} para o Inter{" "}
            <strong>antes de aprovar no aplicativo</strong>.
          </p>
        </div>
        <footer className="fin-apr-pop-acoes">
          <button type="button" className="fin-btn-primary" onClick={onFechar}>
            Entendi — vou adicionar
          </button>
          {onContinuar ? (
            <button type="button" className="fin-btn-ghost" onClick={onContinuar}>
              Enviar mesmo assim
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

/**
 * Os quatro blocos compartilham o MESMO cabeçalho: título à esquerda, total à
 * direita, seta para compactar. O de Pessoas (`FinSecaoColapsavel`) põe o
 * valor na linha do título e some com o total — aqui o número é o que se
 * compara, então ele fica à direita em todos, abertos ou fechados.
 */
function BlocoColapsavel({
  bloco,
  n,
  cents,
  abertoPadrao,
  principal,
  children
}: {
  bloco: Bloco;
  n: number;
  cents: number;
  abertoPadrao: boolean;
  principal?: boolean;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(abertoPadrao);
  const Icone = bloco.icone;
  return (
    <section
      id={`fin-apr-${bloco.estado}`}
      className={`card fin-apr-bloco${principal ? " principal" : ""}${aberto ? " aberto" : ""}`}
      aria-label={bloco.titulo}
    >
      <button
        type="button"
        className="fin-apr-cab"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <span className="fin-apr-cab-lado">
          <span className="fin-apr-cab-icone" aria-hidden>
            <Icone size={16} strokeWidth={2.1} />
          </span>
          <span className="fin-apr-cab-txt">
            <span className="card-title">{bloco.titulo}</span>
            {aberto ? <span className="fin-apr-explicacao">{bloco.explicacao}</span> : null}
          </span>
        </span>
        <span className="fin-apr-cab-total">
          <strong>{brlPrecise(cents)}</strong>
          <span>{plural(n, "ordem", "ordens")}</span>
        </span>
        <ChevronRight
          size={16}
          strokeWidth={2.2}
          className={`fin-apr-cab-seta${aberto ? " fin-chevron-aberto" : ""}`}
          aria-hidden
        />
      </button>
      {aberto ? <div className="fin-apr-bloco-corpo">{children}</div> : null}
    </section>
  );
}

function BlocoAberto({
  bloco,
  ordens,
  hoje
}: {
  bloco: Bloco;
  ordens: OrdemAprovacao[];
  hoje: string;
}) {
  const cents = ordens.reduce((s, o) => s + o.valorCents, 0);
  return (
    <BlocoColapsavel bloco={bloco} n={ordens.length} cents={cents} abertoPadrao={false}>
      <Tabela ordens={ordens} estado={bloco.estado} hoje={hoje} />
    </BlocoColapsavel>
  );
}

function FiltrosBloco({
  filtro,
  nTotal,
  centsVisiveis,
  nMarcadas = 0,
  centsMarcadas = 0,
  rotuloMarcadas = "Selecionado"
}: {
  filtro: ReturnType<typeof useFiltro>;
  nTotal: number;
  centsVisiveis: number;
  nMarcadas?: number;
  centsMarcadas?: number;
  rotuloMarcadas?: string;
}) {
  if (nTotal === 0) return null;
  const mostraResumo = filtro.filtrando || nMarcadas > 0;
  return (
    <div className={`fin-apr-filtro${mostraResumo ? " com-resumo" : ""}`} aria-label="Filtrar ordens">
      <div className="fin-apr-filtro-linha">
        <label className="fin-apr-filtro-busca">
          <Search size={14} strokeWidth={2.2} aria-hidden />
          <input
            type="search"
            value={filtro.busca}
            onChange={(e) => filtro.setBusca(e.target.value)}
            placeholder="Buscar pessoa, descrição ou ordem…"
          />
        </label>
        {filtro.tipos.length > 1 ? (
          <div className="fin-apr-filtro-tipos" role="group" aria-label="Filtrar por tipo">
            {filtro.tipos.map((t) => (
              <button
                key={t.slug}
                type="button"
                className={`fin-apr-chip${filtro.tipo === t.slug ? " ativo" : ""}`}
                aria-pressed={filtro.tipo === t.slug}
                onClick={() => filtro.setTipo(filtro.tipo === t.slug ? null : t.slug)}
              >
                {ROTULO_TIPO[t.slug]}
                <em>{t.n}</em>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {mostraResumo ? (
        <div className="fin-apr-filtro-resumo" role="status">
          {filtro.filtrando ? (
            <p className="fin-apr-filtro-dado">
              <span>Nesta busca</span>
              <strong>{brlPrecise(centsVisiveis)}</strong>
              <em>
                {filtro.visiveis.length} de {nTotal}
              </em>
            </p>
          ) : null}
          {nMarcadas > 0 ? (
            <p className="fin-apr-filtro-dado marcado">
              <span>{rotuloMarcadas}</span>
              <strong>{brlPrecise(centsMarcadas)}</strong>
              <em>{plural(nMarcadas, "ordem", "ordens")}</em>
            </p>
          ) : filtro.filtrando ? (
            <p className="fin-apr-filtro-dado vazio">
              <span>Marque para montar o total</span>
              <strong>—</strong>
            </p>
          ) : null}
          {filtro.filtrando ? (
            <button type="button" className="fin-apr-filtro-limpar" onClick={filtro.limpar}>
              limpar busca
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type Enviada = {
  id: number;
  code: string;
  favorecido: string;
  valorCents: number;
  codigoSolicitacao: string | null;
};

type Falha = {
  ordem: OrdemAprovacao;
  /** O texto do servidor, INTEIRO. Ver `PainelResultado`. */
  motivo: string;
  /** 0 quando a requisição nem chegou a ter resposta. */
  http: number;
};

type ResultadoEnvio = {
  enviadas: Enviada[];
  falharam: Falha[];
  /** As que sobraram quando alguém parou. Nenhuma chamada saiu para elas. */
  naoTentadas: OrdemAprovacao[];
};

type Progresso = {
  /** Índice zero-based na fila desta rodada. */
  posicao: number;
  total: number;
  ordem: OrdemAprovacao;
  /** true enquanto cumpre o intervalo; false enquanto a chamada está no ar. */
  esperando: boolean;
};

/**
 * Enviada nova vence enviada velha, e o resto sobrevive.
 *
 * Uma segunda rodada ("tentar de novo só as que falharam") não pode apagar da
 * tela as que saíram na primeira: no lote de 01/09 foi exatamente a falta desse
 * registro que obrigou o dono a conferir no banco quais das 38 tinham saído.
 */
function fundirEnviadas(antes: Enviada[], agora: Enviada[]): Enviada[] {
  const porId = new Map(antes.map((e) => [e.id, e]));
  for (const e of agora) porId.set(e.id, e);
  return [...porId.values()];
}

/**
 * A SELEÇÃO DE LINHAS, escrita uma vez para os dois blocos que a têm.
 *
 * "Ainda não foi ao banco" marca para ENVIAR; "aguardando" marca para DEVOLVER.
 * O gesto é idêntico e a regra de elegibilidade não é — ela entra por
 * `elegiveis`, que cada bloco calcula com o seu próprio critério. Duplicar as
 * quatro funções era duplicar também o `indeterminate` e o "todas", e é assim
 * que dois checkboxes que deveriam se comportar igual passam a divergir.
 */
function useSelecao(elegiveis: OrdemAprovacao[]) {
  const [marcadas, setMarcadas] = useState<Set<number>>(() => new Set());

  const escolhidas = useMemo(
    () => elegiveis.filter((o) => marcadas.has(o.id)),
    [elegiveis, marcadas]
  );

  const alternar = useCallback((id: number) => {
    setMarcadas((atual) => {
      const proxima = new Set(atual);
      if (proxima.has(id)) proxima.delete(id);
      else proxima.add(id);
      return proxima;
    });
  }, []);

  const alternarTodas = useCallback(() => {
    setMarcadas((atual) => {
      const todas = elegiveis.length > 0 && elegiveis.every((o) => atual.has(o.id));
      return todas ? new Set<number>() : new Set(elegiveis.map((o) => o.id));
    });
  }, [elegiveis]);

  const limpar = useCallback(() => setMarcadas(new Set<number>()), []);

  return {
    marcadas,
    escolhidas,
    totalCents: escolhidas.reduce((s, o) => s + o.valorCents, 0),
    todas: elegiveis.length > 0 && escolhidas.length === elegiveis.length,
    parcial: escolhidas.length > 0 && escolhidas.length < elegiveis.length,
    alternar,
    alternarTodas,
    limpar
  };
}

/**
 * O BLOCO QUE ENVIA.
 *
 * A escrita dele é uma só: `PUT` na rota de programar, uma ordem por vez. Nada
 * aqui aprova nem confirma pagamento — a rota termina em
 * `aguardando_autorizacao` e é onde o produto acaba.
 */
function BlocoParaEnviar({
  bloco,
  ordens,
  hoje,
  saldoCents,
  jaNoAppCents,
  jaNoAppHojeCents
}: {
  bloco: Bloco;
  ordens: OrdemAprovacao[];
  hoje: string;
  saldoCents: number | null;
  jaNoAppCents: number;
  jaNoAppHojeCents: number;
}) {
  const router = useRouter();
  const [emVoo, setEmVoo] = useState(false);
  const [parando, setParando] = useState(false);
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [resultado, setResultado] = useState<ResultadoEnvio | null>(null);
  /*
   * O pedido de parada mora num ref, não no estado: o laço de envio é uma
   * closure criada no clique e leria para sempre o `false` do render em que
   * nasceu. O estado `parando` existe só para o botão poder dizer "Parando…".
   */
  const pararRef = useRef(false);

  const cents = ordens.reduce((s, o) => s + o.valorCents, 0);
  const filtro = useFiltro(ordens);
  const enviaveis = useMemo(
    () => filtro.visiveis.filter((o) => STATUS_QUE_SAEM.has(o.status)),
    [filtro.visiveis]
  );
  const selecao = useSelecao(enviaveis);
  const { escolhidas, totalCents: totalEscolhido, limpar } = selecao;
  const [confirmarCaixa, setConfirmarCaixa] = useState<OrdemAprovacao[] | null>(null);

  const coberturaSelecao = coberturaDoDia(
    saldoCents,
    jaNoAppCents + escolhidas.reduce((s, o) => s + o.valorCents, 0)
  );
  const coberturaSelecaoHoje = coberturaDoDia(
    saldoCents,
    jaNoAppHojeCents + somaHoje(escolhidas, hoje)
  );

  const enviarFila = useCallback(
    async (fila: OrdemAprovacao[]) => {
      if (fila.length === 0 || emVoo) return;
      pararRef.current = false;
      setParando(false);
      setEmVoo(true);

      const enviadas: Enviada[] = [];
      const falharam: Falha[] = [];
      let parouEm = -1;

      for (let i = 0; i < fila.length; i += 1) {
        const ordem = fila[i];
        if (pararRef.current) {
          parouEm = i;
          break;
        }
        // A espera vem ANTES da chamada e nunca antes da primeira — ver
        // ESPERA_MS. É o intervalo que impede o lote de bater no teto de ~10
        // chamadas/min do Inter, que partiu o lote de 38 ao meio em 01/09.
        if (i > 0) {
          setProgresso({ posicao: i, total: fila.length, ordem, esperando: true });
          await dormir(ESPERA_MS, () => pararRef.current);
          if (pararRef.current) {
            parouEm = i;
            break;
          }
        }
        setProgresso({ posicao: i, total: fila.length, ordem, esperando: false });
        try {
          // `urlDaOrigem` e não o path cru: a plataforma abre com Basic Auth e
          // um fetch relativo herda o userinfo da barra de endereço, que o
          // Chromium recusa. Ver lib/url-origem.ts.
          const resposta = await fetch(urlDaOrigem(ROTA_ENVIO), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: ordem.id })
          });
          const corpo = (await resposta.json().catch(() => ({}))) as {
            code?: string;
            codigoSolicitacao?: string | null;
            error?: string;
          };
          if (!resposta.ok) {
            falharam.push({
              ordem,
              motivo: corpo.error ?? `o servidor respondeu ${resposta.status} sem dizer por quê`,
              http: resposta.status
            });
            continue;
          }
          enviadas.push({
            id: ordem.id,
            code: corpo.code ?? ordem.code,
            favorecido: ordem.favorecido,
            valorCents: ordem.valorCents,
            codigoSolicitacao: corpo.codigoSolicitacao ?? null
          });
        } catch (erro) {
          /*
           * Rede que cai é AMBÍGUA: a ordem pode ter sido entregue e a resposta
           * ter se perdido. Ela cai em "falharam" com o motivo cru, e tentar de
           * novo é seguro por duas travas — o servidor recusa com 409 o que já
           * está em `aguardando_autorizacao`, e a chave de idempotência do
           * envio é derivada do `code` por sha256, então o Inter reconhece o
           * mesmo pedido em vez de pagar duas vezes.
           */
          falharam.push({
            ordem,
            motivo: erro instanceof Error ? erro.message : "a requisição não completou",
            http: 0
          });
        }
      }

      const naoTentadas = parouEm >= 0 ? fila.slice(parouEm) : [];
      setProgresso(null);
      setEmVoo(false);
      setParando(false);
      pararRef.current = false;
      setResultado((antes) => ({
        enviadas: fundirEnviadas(antes?.enviadas ?? [], enviadas),
        falharam,
        naoTentadas
      }));
      // A seleção morre aqui de propósito: depois do refresh as enviadas nem
      // estão mais neste bloco, e um checkbox marcado apontando para uma linha
      // que sumiu é convite para reenviar sem querer. O que precisa continuar
      // acessível — falhas e não tentadas — está no painel, com botão próprio.
      limpar();
      // Recarrega do servidor: os status mudaram, e é a leitura do banco que
      // manda, não o que esta tela acha que aconteceu.
      router.refresh();
    },
    [emVoo, limpar, router]
  );

  const pedirEnvio = (fila: OrdemAprovacao[]) => {
    const doHoje = coberturaDoDia(saldoCents, jaNoAppHojeCents + somaHoje(fila, hoje));
    const doTotal = coberturaDoDia(
      saldoCents,
      jaNoAppCents + fila.reduce((s, o) => s + o.valorCents, 0)
    );
    // Popup só no mesmo dia — é quando o Inter debita e apaga o que não cabe.
    // O aviso na barra cobre o resto (lote marcado para amanhã).
    if ((doHoje && !doHoje.cabe) || (doTotal && !doTotal.cabe && somaHoje(fila, hoje) > 0)) {
      setConfirmarCaixa(fila);
      return;
    }
    void enviarFila(fila);
  };

  const restantes = progresso ? progresso.total - progresso.posicao - 1 : 0;
  const feitas = progresso ? progresso.posicao + (progresso.esperando ? 0 : 1) : 0;
  const pct = progresso ? Math.round((feitas / progresso.total) * 100) : 0;

  return (
    <BlocoColapsavel bloco={bloco} n={ordens.length} cents={cents} abertoPadrao>
      <FiltrosBloco
        filtro={filtro}
        nTotal={ordens.length}
        centsVisiveis={filtro.visiveis.reduce((s, o) => s + o.valorCents, 0)}
        nMarcadas={escolhidas.length}
        centsMarcadas={totalEscolhido}
        rotuloMarcadas="Para enviar"
      />

      {enviaveis.length > 0 ? (
        <div className={`fin-apr-acoes${(coberturaSelecao && !coberturaSelecao.cabe) || (coberturaSelecaoHoje && !coberturaSelecaoHoje.cabe) ? " alerta" : ""}`}>
          <button
            type="button"
            className="fin-btn-primary"
            disabled={emVoo || escolhidas.length === 0}
            onClick={() => pedirEnvio(escolhidas)}
          >
            <Send size={15} strokeWidth={2.2} aria-hidden />
            Enviar ao Inter para aprovação
            {escolhidas.length > 0
              ? ` · ${plural(escolhidas.length, "ordem", "ordens")} · ${brlPrecise(totalEscolhido)}`
              : ""}
          </button>
          <span className="fin-apr-acoes-nota">
            {coberturaSelecao && !coberturaSelecao.cabe ? (
              <>
                Falta <strong>{brlPrecise(coberturaSelecao.faltaCents)}</strong> no Inter para o que
                já está no app + o que você marcou. Adicione antes de aprovar.
              </>
            ) : (
              <>
                Uma ordem por vez, {ESPERA_ROTULO} entre elas. O envio para no app:{" "}
                <strong>quem aprova é você.</strong>
              </>
            )}
          </span>
        </div>
      ) : null}

      {progresso ? (
        <div className="fin-apr-prog" role="status" aria-live="polite">
          <div className="fin-apr-prog-linha">
            <strong>
              Enviando {progresso.posicao + 1} de {progresso.total}
            </strong>
            <span className="fin-apr-prog-quem">
              · {progresso.ordem.favorecido} — {progresso.ordem.descricao}
            </span>
            <span className="fin-apr-prog-eta">
              {restantes > 0 ? `restam ${tempoRestante(restantes)}` : "última da fila"}
            </span>
            <button
              type="button"
              className="fin-btn-ghost"
              disabled={parando}
              onClick={() => {
                pararRef.current = true;
                setParando(true);
              }}
            >
              {parando ? "Parando…" : "Parar"}
            </button>
          </div>
          <div
            className="fin-apr-prog-trilho"
            role="progressbar"
            aria-valuenow={feitas}
            aria-valuemin={0}
            aria-valuemax={progresso.total}
            aria-label="Andamento do envio nesta rodada"
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="fin-apr-prog-nota">
            {/* Onde a parada cai depende de onde o laço está: no intervalo ela
                para ANTES desta ordem; com a chamada no ar, depois dela. Dizer
                a coisa errada aqui é o que faria alguém procurar no banco uma
                ordem que nunca saiu. */}
            {parando
              ? progresso.esperando
                ? "Vai parar antes desta — ela entra na lista das não tentadas."
                : "Vai parar depois desta. O que não for tentado fica listado abaixo, intacto."
              : progresso.esperando
                ? `Esperando ${ESPERA_ROTULO} antes da próxima, para não bater no limite do Inter.`
                : "Entregando ao banco…"}
          </p>
        </div>
      ) : null}

      {resultado ? (
        <PainelResultado
          resultado={resultado}
          emVoo={emVoo}
          onReenviar={(fila) => pedirEnvio(fila)}
          onFechar={() => setResultado(null)}
        />
      ) : null}

      {confirmarCaixa
        ? (() => {
            const cob =
              coberturaDoDia(saldoCents, jaNoAppHojeCents + somaHoje(confirmarCaixa, hoje)) ??
              coberturaDoDia(
                saldoCents,
                jaNoAppCents + confirmarCaixa.reduce((s, o) => s + o.valorCents, 0)
              );
            return cob && !cob.cabe ? (
              <PopupCaixa
                cobertura={cob}
                contexto="enviar"
                onFechar={() => setConfirmarCaixa(null)}
                onContinuar={() => {
                  const fila = confirmarCaixa;
                  setConfirmarCaixa(null);
                  void enviarFila(fila);
                }}
              />
            ) : null;
          })()
        : null}

      <Tabela
        ordens={filtro.visiveis}
        estado={bloco.estado}
        hoje={hoje}
        selecao={{
          marcadas: selecao.marcadas,
          elegiveis: enviaveis.length,
          todas: selecao.todas,
          parcial: selecao.parcial,
          desabilitado: emVoo,
          aceita: (o) => STATUS_QUE_SAEM.has(o.status),
          rotuloTodas: "Selecionar todas as ordens que podem ir ao banco",
          tituloTodas: "marca as que estão em rascunho ou aprovada — as demais o envio recusa",
          tituloLinha: (o, aceita) =>
            aceita
              ? "vai ao Inter e para em aguardando aprovação"
              : `"${ROTULO_STATUS[o.status] ?? o.status}" não sai daqui: o envio só aceita rascunho e aprovada, e recusa o resto com 409`,
          alternar: selecao.alternar,
          alternarTodas: selecao.alternarTodas
        }}
      />
    </BlocoColapsavel>
  );
}

/**
 * O RESULTADO EM TRÊS GRUPOS, E A DISTINÇÃO QUE DÁ NOME AO PAINEL.
 *
 * "Falhou" e "nem foi tentada" são fatos diferentes e pedem gestos diferentes:
 * uma tem motivo para ler, a outra só precisa de retomada. No lote de 01/09 as
 * duas ficaram indistinguíveis — 11 ordens de R$ 17.639,86 sumiram no meio de
 * "não saiu" — e o dono só descobriu quais eram conferindo o banco.
 *
 * O painel NÃO some sozinho. Ele fecha no botão, e sobrevive ao `router.refresh`
 * porque é estado de um componente que não é remontado.
 */
function PainelResultado({
  resultado,
  emVoo,
  onReenviar,
  onFechar
}: {
  resultado: ResultadoEnvio;
  emVoo: boolean;
  onReenviar: (fila: OrdemAprovacao[]) => void;
  onFechar: () => void;
}) {
  const { enviadas, falharam, naoTentadas } = resultado;
  /*
   * 503 é a ignição desligada, não erro de dado: a escrita bancária exige
   * `NODE_ENV !== production` E `INTER_PAGAMENTO_LOCAL` ligado. Quem clicou
   * precisa ler, em uma linha, que a ordem continua em rascunho e que o
   * trabalho de selecionar não foi perdido.
   */
  const ignicaoDesligada = falharam.some((f) => f.http === 503);

  return (
    <div className="fin-apr-res" role="status">
      <div className="fin-apr-res-topo">
        <p className="fin-apr-res-contagens">
          <b>{enviadas.length}</b> enviada{enviadas.length === 1 ? "" : "s"} ·{" "}
          <b>{falharam.length}</b> falhara{falharam.length === 1 ? "" : "m"} ·{" "}
          <b>{naoTentadas.length}</b> não tentada{naoTentadas.length === 1 ? "" : "s"}
        </p>
        <button type="button" className="fin-btn-ghost" onClick={onFechar} disabled={emVoo}>
          Fechar
        </button>
      </div>

      {enviadas.length > 0 ? (
        <div className="fin-apr-res-grupo">
          <h3 className="fin-apr-res-titulo ok">
            <CheckCircle2 size={15} strokeWidth={2.2} aria-hidden />
            {plural(enviadas.length, "ordem entregue", "ordens entregues")} ao Inter
          </h3>
          <p className="fin-apr-res-nota">
            Nenhuma foi paga. Elas estão em <strong>aguardando sua aprovação</strong> no aplicativo
            do Inter — o dinheiro só sai quando você aprovar lá, uma a uma.
          </p>
          <ul className="fin-apr-res-lista">
            {enviadas.map((e) => (
              <li key={e.id}>
                <span className="fin-apr-code">{e.code}</span>
                <span className="fin-apr-res-quem">{e.favorecido}</span>
                <span className="fin-apr-res-valor">{brlPrecise(e.valorCents)}</span>
                {e.codigoSolicitacao ? (
                  <span
                    className="fin-apr-cod"
                    title="codigoSolicitacao devolvido pelo Inter. É por ele que o extrato reencontra esta ordem."
                  >
                    {e.codigoSolicitacao}
                  </span>
                ) : (
                  <span className="fin-apr-cod vazio">
                    o Inter respondeu sem código de solicitação
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {falharam.length > 0 ? (
        <div className="fin-apr-res-grupo">
          <h3 className="fin-apr-res-titulo erro">
            <CircleAlert size={15} strokeWidth={2.2} aria-hidden />
            {plural(falharam.length, "ordem falhou", "ordens falharam")}
          </h3>
          {ignicaoDesligada ? (
            <p className="fin-apr-res-nota">
              A escrita bancária está desligada nesta máquina: a ordem <strong>continua em
              rascunho</strong>, a seleção segue registrada e o envio pode ser feito depois, de onde
              a credencial de pagamento existe. Não é dinheiro perdido nem trabalho refeito.
            </p>
          ) : null}
          <ul className="fin-apr-res-lista">
            {falharam.map((f) => (
              <li key={f.ordem.id}>
                <span className="fin-apr-code">{f.ordem.code}</span>
                <span className="fin-apr-res-quem">{f.ordem.favorecido}</span>
                <span className="fin-apr-res-valor">{brlPrecise(f.ordem.valorCents)}</span>
                {/* O motivo NA ÍNTEGRA, sem cortar nem resumir: o texto do Inter
                    é o único diagnóstico que existe deste lado, e foi ele que
                    revelou que o `code` não servia como chave idempotente. */}
                <span className="fin-apr-res-motivo">{f.motivo}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="fin-btn-ghost"
            disabled={emVoo}
            onClick={() => onReenviar(falharam.map((f) => f.ordem))}
          >
            Tentar de novo só as que falharam ({falharam.length})
          </button>
        </div>
      ) : null}

      {naoTentadas.length > 0 ? (
        <div className="fin-apr-res-grupo">
          <h3 className="fin-apr-res-titulo espera">
            <CirclePause size={15} strokeWidth={2.2} aria-hidden />
            {plural(naoTentadas.length, "ordem não foi tentada", "ordens não foram tentadas")}
          </h3>
          <p className="fin-apr-res-nota">
            O envio parou antes de chegar nelas. <strong>Nenhuma chamada saiu para o banco</strong>
            {" "}— elas continuam exatamente como estavam, esperando.
          </p>
          <ul className="fin-apr-res-lista">
            {naoTentadas.map((o) => (
              <li key={o.id}>
                <span className="fin-apr-code">{o.code}</span>
                <span className="fin-apr-res-quem">{o.favorecido}</span>
                <span className="fin-apr-res-valor">{brlPrecise(o.valorCents)}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="fin-btn-ghost"
            disabled={emVoo}
            onClick={() => onReenviar(naoTentadas)}
          >
            Retomar as {naoTentadas.length} que faltaram
          </button>
        </div>
      ) : null}
    </div>
  );
}

type LinhaDevolucao = {
  id: number;
  code: string;
  favorecido: string;
  valorCents: number;
  /** Só nas recusadas: o texto do servidor, INTEIRO. */
  motivo?: string;
};

type ResultadoDevolucao = {
  devolvidas: LinhaDevolucao[];
  recusadas: LinhaDevolucao[];
};

/**
 * O BLOCO QUE DEVOLVE À FILA.
 *
 * Ele existe porque `aguardando_autorizacao` tem DOIS desfechos possíveis do
 * lado de lá e a plataforma só enxerga um: ou alguém aprova no aplicativo (e a
 * conciliação encontra a saída no extrato), ou o banco apaga a ordem por falta
 * de saldo — e nesse caso nada chega aqui, nunca. Foram 10 ordens assim em
 * 01/09/2026. Sem esta ação elas ficariam "aguardando" para sempre, inflando a
 * previsão de saída com dinheiro que já não vai sair por essa ordem.
 *
 * A ESCRITA É UMA SÓ E NÃO É PAGAMENTO: `POST { acao: "devolver" }`, que move
 * `aguardando_autorizacao` → `rascunho`. A ordem reaparece no bloco de cima com
 * o MESMO `code`, pronta para o botão de envio que já existe. Nada aqui aprova,
 * autoriza, paga ou cancela — cancelar diria que a dívida acabou, e ela não
 * acabou; o que morreu foi a ordem.
 */
function BlocoAguardando({
  bloco,
  ordens,
  hoje,
  saldoCents
}: {
  bloco: Bloco;
  ordens: OrdemAprovacao[];
  hoje: string;
  saldoCents: number | null;
}) {
  const router = useRouter();
  const cents = ordens.reduce((s, o) => s + o.valorCents, 0);
  const filtro = useFiltro(ordens);
  const devolviveis = useMemo(() => filtro.visiveis.filter(podeVoltarParaFila), [filtro.visiveis]);
  const selecao = useSelecao(devolviveis);
  const coberturaHoje = coberturaDoDia(saldoCents, somaHoje(ordens, hoje));
  const { escolhidas, totalCents, limpar } = selecao;

  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState(MOTIVO_SUGERIDO);
  const [emVoo, setEmVoo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoDevolucao | null>(null);

  const motivoLimpo = motivo.trim();
  const motivoCurto = motivoLimpo.length < MOTIVO_MINIMO;
  const nada = escolhidas.length === 0;

  const devolver = useCallback(async () => {
    if (emVoo || escolhidas.length === 0 || motivoCurto) return;
    setEmVoo(true);
    setErro(null);
    /*
     * A fila é FOTOGRAFADA antes da chamada. Depois do `router.refresh()` as
     * devolvidas não estão mais neste bloco, e a rota devolve só `{id, code}` —
     * sem esta foto o painel não teria como dizer de quem era cada ordem, que é
     * exatamente o que faltou no lote de 01/09 e obrigou a conferir no banco.
     */
    const alvo = new Map(escolhidas.map((o) => [o.id, o]));
    try {
      const resposta = await fetch(urlDaOrigem(ROTA_DEVOLVER), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "devolver", ids: [...alvo.keys()], motivo: motivoLimpo })
      });
      const corpo = (await resposta.json().catch(() => ({}))) as {
        devolvidas?: { id: number; code: string }[];
        recusadas?: { id: number; motivo: string }[];
        error?: string;
      };
      if (!resposta.ok) {
        // 422 é o motivo curto demais; qualquer outro código o servidor explica
        // em `error`. Fica na barra, sem apagar a seleção nem o texto digitado.
        setErro(corpo.error ?? `o servidor respondeu ${resposta.status} sem dizer por quê`);
        return;
      }
      const linha = (id: number, code?: string, motivoDela?: string): LinhaDevolucao => {
        const o = alvo.get(id);
        return {
          id,
          code: code ?? o?.code ?? `#${id}`,
          favorecido: o?.favorecido ?? "—",
          valorCents: o?.valorCents ?? 0,
          motivo: motivoDela
        };
      };
      setResultado({
        devolvidas: (corpo.devolvidas ?? []).map((d) => linha(d.id, d.code)),
        recusadas: (corpo.recusadas ?? []).map((r) => linha(r.id, undefined, r.motivo))
      });
      setConfirmando(false);
      limpar();
      // Recarrega do servidor: as devolvidas mudaram de bloco, e é a leitura do
      // banco que manda — não o que esta tela acha que aconteceu.
      router.refresh();
    } catch (e) {
      /*
       * Rede que cai é AMBÍGUA: a transação pode ter comitado e a resposta ter
       * se perdido. Por isso o refresh acontece mesmo aqui — quem responde "o
       * que ficou de pé" é o banco, e tentar de novo é seguro: o `WHERE
       * status = 'aguardando_autorizacao'` já não casa com o que voltou.
       */
      setErro(e instanceof Error ? e.message : "a requisição não completou");
      router.refresh();
    } finally {
      setEmVoo(false);
    }
  }, [emVoo, escolhidas, limpar, motivoCurto, motivoLimpo, router]);

  return (
    <BlocoColapsavel bloco={bloco} n={ordens.length} cents={cents} abertoPadrao principal>
      <FiltrosBloco
        filtro={filtro}
        nTotal={ordens.length}
        centsVisiveis={filtro.visiveis.reduce((s, o) => s + o.valorCents, 0)}
        nMarcadas={escolhidas.length}
        centsMarcadas={totalCents}
        rotuloMarcadas="Para devolver"
      />

      {coberturaHoje && !coberturaHoje.cabe ? (
        <p className="fin-apr-caixa-aviso" role="status">
          <AlertTriangle size={15} strokeWidth={2.2} aria-hidden />
          <span>
            Falta <strong>{brlPrecise(coberturaHoje.faltaCents)}</strong> no Inter para o que está
            no app hoje. Adicione antes de aprovar — o banco apaga o que fica sem saldo.
          </span>
        </p>
      ) : null}

      {devolviveis.length === 0 ? null : confirmando ? (
        /* PASSO 2. O total à vista, a frase de risco e o motivo — nesta ordem,
           porque o risco tem de ser lido antes de o dedo chegar ao campo. */
        <div className="fin-apr-dev-confirma" role="group" aria-label="Confirmar devolução à fila">
          <h3 className="fin-apr-dev-titulo">
            <Undo2 size={15} strokeWidth={2.2} aria-hidden />
            Devolver {plural(escolhidas.length, "ordem", "ordens")} para a fila
            <span className="fin-apr-dev-total">{brlCents(totalCents)}</span>
          </h3>

          <p className="fin-apr-dev-risco">
            <AlertTriangle size={16} strokeWidth={2.2} aria-hidden />
            <span>
              Confirme no aplicativo do Inter que estas ordens não estão mais lá. Se ainda
              estiverem e forem reenviadas, o banco pode criar uma segunda — a proteção é a chave
              idempotente, e ela ainda não foi verificada contra a API real.
            </span>
          </p>

          <ul className="fin-apr-res-lista fin-apr-dev-alvos">
            {escolhidas.map((o) => (
              <li key={o.id}>
                <span className="fin-apr-code">{o.code}</span>
                <span className="fin-apr-res-quem">{o.favorecido}</span>
                <span className="fin-apr-res-valor">{brlPrecise(o.valorCents)}</span>
              </li>
            ))}
          </ul>

          <label className="fin-apr-dev-campo">
            <span>
              O que você viu no aplicativo do Inter{" "}
              <em>— vai para as notas da ordem e para o fin_audit_log, com o seu nome</em>
            </span>
            <textarea
              value={motivo}
              rows={3}
              maxLength={400}
              disabled={emVoo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </label>

          <div className="fin-apr-dev-botoes">
            <button
              type="button"
              className="fin-apr-dev-confirmar"
              disabled={emVoo || nada || motivoCurto}
              onClick={() => void devolver()}
            >
              {emVoo
                ? "Devolvendo…"
                : `Confirmar · ${plural(escolhidas.length, "ordem", "ordens")} · ${brlCents(totalCents)}`}
            </button>
            <button
              type="button"
              className="fin-btn-ghost"
              disabled={emVoo}
              onClick={() => setConfirmando(false)}
            >
              Voltar
            </button>
            {motivoCurto ? (
              <span className="fin-apr-dev-pendencia">
                Escreva o que você viu: a rota recusa motivo com menos de {MOTIVO_MINIMO}{" "}
                caracteres.
              </span>
            ) : nada ? (
              <span className="fin-apr-dev-pendencia">Nenhuma ordem marcada.</span>
            ) : null}
          </div>

          {erro ? <p className="fin-apr-dev-erro">{erro}</p> : null}
        </div>
      ) : (
        /* PASSO 1. Só abre a confirmação — nenhuma requisição sai daqui. */
        <div className="fin-apr-dev">
          <button
            type="button"
            className="fin-apr-dev-abrir"
            disabled={emVoo || nada}
            onClick={() => {
              setErro(null);
              setConfirmando(true);
            }}
          >
            <Undo2 size={15} strokeWidth={2.2} aria-hidden />
            Não saiu no banco — devolver para a fila
            {nada ? "" : ` · ${plural(escolhidas.length, "ordem", "ordens")} · ${brlCents(totalCents)}`}
          </button>
          {/* A frase que impede a leitura errada, colada no dedo: a plataforma
              NÃO consulta o banco — a credencial de pagamento não tem endpoint
              de consulta. O que ela grava é o que você afirma ter visto. */}
          <span className="fin-apr-dev-nota">
            A plataforma não consulta o banco. <strong>Abra o app</strong> e marque o que não
            está mais lá. Devolver não cancela a dívida — a ordem volta para rascunho.
          </span>
          {erro ? <p className="fin-apr-dev-erro">{erro}</p> : null}
        </div>
      )}

      {resultado ? (
        <PainelDevolucao resultado={resultado} onFechar={() => setResultado(null)} />
      ) : null}

      <Tabela
        ordens={filtro.visiveis}
        estado={bloco.estado}
        hoje={hoje}
        selecao={{
          marcadas: selecao.marcadas,
          elegiveis: devolviveis.length,
          todas: selecao.todas,
          parcial: selecao.parcial,
          desabilitado: emVoo,
          aceita: podeVoltarParaFila,
          rotuloTodas: "Selecionar todas as ordens que podem voltar para a fila",
          tituloTodas:
            "marca as que estão no app do Inter sem pagamento registrado — as que já saíram não voltam",
          tituloLinha: (o, aceita) =>
            aceita
              ? "volta para rascunho, com o mesmo código, e a obrigação continua devida"
              : "esta ordem já tem pagamento registrado — devolvê-la apagaria uma saída da conta",
          alternar: selecao.alternar,
          alternarTodas: selecao.alternarTodas
        }}
      />
    </BlocoColapsavel>
  );
}

/**
 * O RESULTADO DA DEVOLUÇÃO, em dois grupos.
 *
 * Reaproveita o CSS do painel de envio (`fin-apr-res-*`): é o mesmo gesto de
 * leitura — "o que aconteceu com cada uma das que marquei". A única classe nova
 * é a do título, em roxo: verde nesta tela significa dinheiro que SAIU da conta,
 * e uma ordem devolvida não é dinheiro nenhum, é caminho do produto.
 *
 * Não some sozinho. Ele sobrevive ao `router.refresh()` porque é estado de um
 * componente que não é remontado, e é a única prova, do lado de cá, de quais
 * ordens voltaram.
 */
function PainelDevolucao({
  resultado,
  onFechar
}: {
  resultado: ResultadoDevolucao;
  onFechar: () => void;
}) {
  const { devolvidas, recusadas } = resultado;
  return (
    <div className="fin-apr-res" role="status">
      <div className="fin-apr-res-topo">
        <p className="fin-apr-res-contagens">
          <b>{devolvidas.length}</b> devolvida{devolvidas.length === 1 ? "" : "s"} para a fila ·{" "}
          <b>{recusadas.length}</b> recusada{recusadas.length === 1 ? "" : "s"}
        </p>
        <button type="button" className="fin-btn-ghost" onClick={onFechar}>
          Fechar
        </button>
      </div>

      {devolvidas.length > 0 ? (
        <div className="fin-apr-res-grupo">
          <h3 className="fin-apr-res-titulo volta">
            <Undo2 size={15} strokeWidth={2.2} aria-hidden />
            {plural(devolvidas.length, "ordem voltou", "ordens voltaram")} para a fila
          </h3>
          <p className="fin-apr-res-nota">
            Estão em <strong>&ldquo;ainda não foi ao banco&rdquo;</strong>, no bloco de cima, com o
            mesmo código — prontas para reenviar pelo botão que já existe lá. Nada foi cancelado: a
            obrigação continua devida.
          </p>
          <ul className="fin-apr-res-lista">
            {devolvidas.map((d) => (
              <li key={d.id}>
                <span className="fin-apr-code">{d.code}</span>
                <span className="fin-apr-res-quem">{d.favorecido}</span>
                <span className="fin-apr-res-valor">{brlPrecise(d.valorCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {recusadas.length > 0 ? (
        <div className="fin-apr-res-grupo">
          <h3 className="fin-apr-res-titulo erro">
            <CircleAlert size={15} strokeWidth={2.2} aria-hidden />
            {plural(recusadas.length, "ordem não voltou", "ordens não voltaram")}
          </h3>
          <p className="fin-apr-res-nota">
            O estado delas mudou entre você olhar o aplicativo e clicar — uma ordem que virou{" "}
            <strong>paga</strong> no intervalo não volta, porque devolvê-la apagaria uma saída da
            conta. O motivo abaixo é o do servidor, inteiro.
          </p>
          <ul className="fin-apr-res-lista">
            {recusadas.map((r) => (
              <li key={r.id}>
                <span className="fin-apr-code">{r.code}</span>
                <span className="fin-apr-res-quem">{r.favorecido}</span>
                <span className="fin-apr-res-valor">{brlPrecise(r.valorCents)}</span>
                <span className="fin-apr-res-motivo">{r.motivo}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Colapsado por padrão: é o único bloco que não pede ação nem prova nada sobre
 * o caixa de hoje. Fica na tela porque uma ordem que sumiu sem explicação é
 * pior que uma linha a mais.
 */
function BlocoEncerrado({ ordens, hoje }: { ordens: OrdemAprovacao[]; hoje: string }) {
  const bloco = BLOCOS[3];
  const cents = ordens.reduce((s, o) => s + o.valorCents, 0);
  return (
    <BlocoColapsavel bloco={bloco} n={ordens.length} cents={cents} abertoPadrao={false}>
      <Tabela ordens={ordens} estado="encerrada" hoje={hoje} />
    </BlocoColapsavel>
  );
}

type Selecao = {
  marcadas: Set<number>;
  /** Quantas linhas a ação do bloco aceita — as outras têm checkbox desligado. */
  elegiveis: number;
  todas: boolean;
  parcial: boolean;
  desabilitado: boolean;
  /**
   * A REGRA DE ELEGIBILIDADE VEM DO BLOCO, não da tabela.
   *
   * Enviar aceita `rascunho` e `aprovada`; devolver aceita
   * `aguardando_autorizacao` sem execução. A tabela é a mesma nos dois — se ela
   * guardasse a regra, o segundo bloco teria de mentir sobre o primeiro.
   */
  aceita: (o: OrdemAprovacao) => boolean;
  rotuloTodas: string;
  tituloTodas: string;
  /** O `title` do checkbox: por que esta linha pode, ou por que não pode. */
  tituloLinha: (o: OrdemAprovacao, aceita: boolean) => string;
  alternar: (id: number) => void;
  alternarTodas: () => void;
};

function Tabela({
  ordens,
  estado,
  selecao,
  hoje
}: {
  ordens: OrdemAprovacao[];
  estado: EstadoCiclo;
  selecao?: Selecao;
  hoje: string;
}) {
  if (ordens.length === 0) {
    return <p className="fin-empty-row">Nenhuma ordem neste estado.</p>;
  }
  return (
    <div className="fin-table-wrap">
      <table className={`fin-table fin-apr-tabela${selecao ? " com-selecao" : ""}`}>
        <thead>
          <tr>
            {selecao ? (
              <th scope="col" className="fin-apr-sel">
                <input
                  type="checkbox"
                  checked={selecao.todas}
                  disabled={selecao.desabilitado || selecao.elegiveis === 0}
                  aria-label={selecao.rotuloTodas}
                  title={selecao.tituloTodas}
                  // `indeterminate` não existe como atributo em HTML, só como
                  // propriedade do elemento. Sem este ref, "parte marcada"
                  // aparece igual a "nada marcado".
                  ref={(el) => {
                    if (el) el.indeterminate = selecao.parcial;
                  }}
                  onChange={selecao.alternarTodas}
                />
              </th>
            ) : null}
            <th scope="col">Ordem</th>
            <th scope="col">Favorecido</th>
            <th scope="col">Descrição</th>
            <th scope="col" className="num">
              Valor
            </th>
            <th scope="col">Programada</th>
            <th scope="col" className="num">
              Neste estado
            </th>
            <th scope="col">Situação</th>
          </tr>
        </thead>
        <tbody>
          {ordens.map((o) => {
            const podeIr = selecao ? selecao.aceita(o) : false;
            const marcada = selecao ? selecao.marcadas.has(o.id) : false;
            const programadaHoje = ordemEhHoje(o.scheduledFor, hoje);
            const programadaAtrasada = Boolean(
              o.scheduledFor && hoje && o.scheduledFor < hoje && estado !== "paga"
            );
            const classes = [
              o.esquecida ? "fin-apr-esquecida" : "",
              marcada ? "fin-apr-marcada" : "",
              programadaHoje ? "fin-apr-hoje" : "",
              programadaAtrasada ? "fin-apr-atrasada" : ""
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <tr key={o.id} className={classes || undefined}>
                {selecao ? (
                  <td className="fin-apr-sel">
                    <input
                      type="checkbox"
                      checked={marcada}
                      disabled={selecao.desabilitado || !podeIr}
                      aria-label={`Selecionar ${o.code} — ${o.favorecido}`}
                      title={selecao.tituloLinha(o, podeIr)}
                      onChange={() => selecao.alternar(o.id)}
                    />
                  </td>
                ) : null}
                <td>
                  <span className="fin-apr-code">{o.code}</span>
                  {o.codigoSolicitacao ? (
                    <span
                      className="fin-apr-cod"
                      title="codigoSolicitacao devolvido pelo Inter. É por ele que o extrato reencontra esta ordem."
                    >
                      {o.codigoSolicitacao}
                    </span>
                  ) : estado === "aguardando" ? (
                    <span
                      className="fin-apr-cod vazio"
                      title="O Inter respondeu sem código de solicitação."
                    >
                      sem código
                    </span>
                  ) : null}
                </td>
                <td className="fin-apr-fav">
                  <span>{o.favorecido}</span>
                  <span className="fin-apr-tipo">{ROTULO_TIPO[o.tipo]}</span>
                  {o.chaveMascarada ? (
                    <span
                      className="fin-apr-chave"
                      title={
                        o.chaveDoSnapshot
                          ? "Chave congelada na ordem (payee_snapshot): é para onde ESTA ordem manda."
                          : "Chave do cadastro atual — esta ordem não tem foto da coordenada."
                      }
                    >
                      {o.chaveMascarada}
                      {o.chaveDoSnapshot ? null : <em> cadastro de hoje</em>}
                    </span>
                  ) : (
                    <span className="fin-apr-chave vazio">sem chave PIX</span>
                  )}
                </td>
                <td className="fin-apr-desc">{o.descricao}</td>
                <td className="num fin-table-money">{brlPrecise(o.valorCents)}</td>
                {/* Duas datas e não uma. `scheduled_for` é para que dia o
                    pagamento foi marcado; `due_date` é quando a obrigação vence,
                    e é NOT NULL na 0075. Colapsar as duas num `??` faria uma
                    ordem sem data marcada parecer marcada para o vencimento. */}
                <td className="fin-apr-datas">
                  <span
                    className={
                      programadaHoje
                        ? "fin-apr-data-hoje"
                        : programadaAtrasada
                          ? "fin-apr-data-atraso"
                          : undefined
                    }
                  >
                    {dateLabel(o.scheduledFor)}
                    {programadaHoje ? <em>hoje</em> : null}
                  </span>
                  <span className="fin-apr-venc">venc. {dateLabel(o.dueDate)}</span>
                </td>
                <td className={o.esquecida ? "num fin-apr-dias alerta" : "num fin-apr-dias"}>
                  {dias(o.diasNoEstado)}
                  {/*
                    QUEM REGISTROU A SELEÇÃO.

                    A ordem pode nascer numa máquina e ser enviada de outra: em
                    produção a escrita bancária é bloqueada por construção, então
                    quem seleciona lá deixa a ordem em rascunho e quem tem a
                    credencial despacha depois. Numa tela onde uma pessoa manda o
                    que outra escolheu, "quem pediu isto" é o que separa conferir
                    de despachar no automático.
                  */}
                  {o.pedidoPor ? (
                    <span className="fin-apr-pedido" title={`registrado por ${o.pedidoPor}${o.pedidoEm ? ` em ${o.pedidoEm}` : ""}`}>
                      por {o.pedidoPor}
                    </span>
                  ) : null}
                </td>
                <td>
                  <span className={`fin-apr-selo ${CLASSE_SELO[o.estado]}`}>
                    {ROTULO_STATUS[o.status] ?? o.status}
                  </span>
                  {o.execucao ? (
                    <span className="fin-apr-exec">
                      saiu em {dateLabel(o.execucao.paidOn)} · {brlPrecise(o.pagoCents)}
                      {o.execucoes > 1 ? ` · ${o.execucoes} execuções` : ""}
                      {o.execucao.endToEndId ? (
                        <em title="end-to-end do PIX">{o.execucao.endToEndId}</em>
                      ) : null}
                      {o.execucao.transactionId ? (
                        <em title="Conciliada com a linha do extrato que provou a saída.">
                          extrato #{o.execucao.transactionId}
                        </em>
                      ) : (
                        <em title="Registrada, mas ainda sem a linha do extrato que prova a saída.">
                          sem prova no extrato
                        </em>
                      )}
                    </span>
                  ) : o.estado === "aguardando" ? (
                    <span className="fin-apr-exec">nenhum pagamento registrado</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
