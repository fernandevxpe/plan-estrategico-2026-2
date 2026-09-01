"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleAlert,
  CirclePause,
  Clock,
  FileText,
  Send,
  ShieldCheck,
  Undo2
} from "lucide-react";

import type { Aprovacoes, EstadoCiclo, OrdemAprovacao } from "@/lib/financeiro/aprovacoes";
import { brlCents, brlPrecise, dateLabel } from "@/lib/financeiro/format";
import { urlDaOrigem } from "@/lib/url-origem";

import { KpiAnalise } from "./FinKpiAnalise";
import { FinSecaoColapsavel } from "./FinSecaoColapsavel";

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
 * O aviso do topo é permanente e não colapsa. Ele não é decoração de
 * onboarding: é a garantia do produto, escrita também no schema da 0075 e no
 * cabeçalho de `pagar-programar.ts`. Uma tela chamada "Aprovações" que não
 * dissesse isso ensinaria exatamente a leitura errada — "a plataforma aprovou,
 * então está pago". O botão de envio herda a mesma disciplina: ele se chama
 * "Enviar ao Inter para aprovação", nunca "Pagar", porque o que ele faz é
 * parar em `aguardando_autorizacao` e devolver a decisão para uma pessoa no
 * aplicativo do banco.
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
    titulo: "Ainda não foi ao banco",
    explicacao:
      "O que já foi selecionado para pagar e ainda não foi entregue ao Inter — inclusive por outra pessoa, em outra máquina. A ordem em rascunho É a seleção registrada: ela espera aqui até alguém com a credencial de pagamento enviá-la. Marque e envie abaixo; o envio para na aprovação, não paga.",
    rotuloKpi: "Não foi ao banco",
    icone: FileText
  },
  {
    estado: "aguardando",
    titulo: "Aguardando sua aprovação no app do Inter",
    explicacao:
      "A ordem foi entregue ao banco. Daqui em diante nada muda sozinho: só a sua aprovação no aplicativo do Inter faz o dinheiro sair. Se você abrir o aplicativo e a ordem não estiver mais lá, marque-a e devolva para a fila — a obrigação continua devida, o que morreu foi a ordem.",
    rotuloKpi: "Esperando você",
    icone: Clock
  },
  {
    estado: "paga",
    titulo: "Paga",
    explicacao:
      "Saída registrada em fin_payment_execution — o que já aconteceu na conta, com data que não pode ser futura.",
    rotuloKpi: "Paga",
    icone: CheckCircle2
  },
  {
    estado: "encerrada",
    titulo: "Encerrada sem pagar",
    explicacao: "Rejeitada, cancelada ou devolvida. Fica registrada porque some do caixa previsto.",
    rotuloKpi: "Encerrada sem pagar",
    icone: Ban
  }
];

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

export function FinAprovacoes({ dados }: { dados: Aprovacoes }) {
  const porEstado = useMemo(() => {
    const mapa = new Map<EstadoCiclo, OrdemAprovacao[]>();
    for (const bloco of BLOCOS) mapa.set(bloco.estado, []);
    // `dados.ordens` já vem ordenado do servidor, por bloco e dentro do bloco.
    // Filtrar preserva a ordem, então a regra de ordenação mora num lugar só.
    for (const ordem of dados.ordens) mapa.get(ordem.estado)?.push(ordem);
    return mapa;
  }, [dados.ordens]);

  const esquecidas = useMemo(() => dados.ordens.filter((o) => o.esquecida), [dados.ordens]);

  return (
    <>
      <Aviso esquecidas={esquecidas.length} />

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
          <section className="fin-pessoas-kpis" aria-label="Ordens por estado do ciclo">
            <div className="fin-pessoas-kpi-faixa">
              {BLOCOS.map((bloco) => {
                const lista = porEstado.get(bloco.estado) ?? [];
                const cents = lista.reduce((s, o) => s + o.valorCents, 0);
                return (
                  <KpiAnalise
                    key={bloco.estado}
                    destaque={bloco.estado === "aguardando"}
                    rotulo={bloco.rotuloKpi}
                    valor={brlCents(cents)}
                    delta={
                      <p className="fin-delta neutro">
                        {lista.length} {lista.length === 1 ? "ordem" : "ordens"}
                      </p>
                    }
                    extra={
                      bloco.estado === "aguardando" && esquecidas.length > 0 ? (
                        <p className="fin-pessoas-kpi-extra fin-apr-kpi-alerta">
                          {esquecidas.length} parada{esquecidas.length === 1 ? "" : "s"} há 2 dias ou
                          mais
                        </p>
                      ) : undefined
                    }
                    /* Sem sparkline: o estado do ciclo é uma foto de agora, não
                       uma série. Inventar meses aqui seria enfeite com forma de
                       dado. `SparkArea` já devolve null para menos de 2 pontos. */
                    pontos={[]}
                    crescimento={null}
                    ariaSpark={bloco.rotuloKpi}
                  />
                );
              })}
            </div>
          </section>

          {BLOCOS.filter((b) => b.estado !== "encerrada").map((bloco) =>
            bloco.estado === "nao_enviada" ? (
              <BlocoParaEnviar
                key={bloco.estado}
                bloco={bloco}
                ordens={porEstado.get(bloco.estado) ?? []}
              />
            ) : bloco.estado === "aguardando" ? (
              <BlocoAguardando
                key={bloco.estado}
                bloco={bloco}
                ordens={porEstado.get(bloco.estado) ?? []}
              />
            ) : (
              <BlocoAberto
                key={bloco.estado}
                bloco={bloco}
                ordens={porEstado.get(bloco.estado) ?? []}
              />
            )
          )}

          <BlocoEncerrado ordens={porEstado.get("encerrada") ?? []} />

          <p className="fin-apr-rodape">
            Posição de {dateLabel(dados.hoje)}. Daqui a tela entrega ordens ao Inter — e para nisso.
            Nenhum botão desta página aprova, autoriza ou paga.
          </p>
        </>
      )}
    </>
  );
}

function Aviso({ esquecidas }: { esquecidas: number }) {
  return (
    <section className="card fin-apr-aviso" aria-label="Como funciona a aprovação">
      <span className="fin-apr-aviso-icone" aria-hidden>
        <ShieldCheck size={20} strokeWidth={2.1} />
      </span>
      <div>
        <h2 className="card-title">Nada aqui paga.</h2>
        <p>
          A plataforma cria a ordem e a entrega ao Inter; <strong>quem aprova é você, no aplicativo
          do banco.</strong> Nenhum estado depois de &ldquo;aguardando aprovação&rdquo; muda sozinho.
        </p>
        {esquecidas > 0 ? (
          <p className="fin-apr-aviso-alerta">
            {esquecidas} ordem{esquecidas === 1 ? "" : "s"} espera{esquecidas === 1 ? "" : "m"} há 2
            dias ou mais. Ordem esquecida no aplicativo é dinheiro que não saiu e ninguém percebeu.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * O bloco sem ação. Sobrou só "Paga": os outros dois têm escrita e componente
 * próprio, e o `principal` que este componente aplicava ao bloco "aguardando"
 * mudou de casa junto com ele. Deixá-lo aqui seria um ramo que nunca executa.
 */
function BlocoAberto({ bloco, ordens }: { bloco: Bloco; ordens: OrdemAprovacao[] }) {
  const cents = ordens.reduce((s, o) => s + o.valorCents, 0);
  return (
    <section className="card fin-apr-bloco" aria-label={bloco.titulo}>
      <CabecalhoBloco bloco={bloco} ordens={ordens.length} cents={cents} />
      <Tabela ordens={ordens} estado={bloco.estado} />
    </section>
  );
}

function CabecalhoBloco({
  bloco,
  ordens,
  cents
}: {
  bloco: Bloco;
  ordens: number;
  cents: number;
}) {
  const Icone = bloco.icone;
  return (
    <header className="fin-apr-cab">
      <span className="fin-apr-cab-icone" aria-hidden>
        <Icone size={16} strokeWidth={2.1} />
      </span>
      <div>
        <h2 className="card-title">{bloco.titulo}</h2>
        <p className="fin-apr-explicacao">{bloco.explicacao}</p>
      </div>
      <p className="fin-apr-cab-total">
        <strong>{brlCents(cents)}</strong>
        <span>{plural(ordens, "ordem", "ordens")}</span>
      </p>
    </header>
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
function BlocoParaEnviar({ bloco, ordens }: { bloco: Bloco; ordens: OrdemAprovacao[] }) {
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
  const enviaveis = useMemo(() => ordens.filter((o) => STATUS_QUE_SAEM.has(o.status)), [ordens]);
  const selecao = useSelecao(enviaveis);
  const { escolhidas, totalCents: totalEscolhido, limpar } = selecao;

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

  const restantes = progresso ? progresso.total - progresso.posicao - 1 : 0;
  const feitas = progresso ? progresso.posicao + (progresso.esperando ? 0 : 1) : 0;
  const pct = progresso ? Math.round((feitas / progresso.total) * 100) : 0;

  return (
    <section className="card fin-apr-bloco" aria-label={bloco.titulo}>
      <CabecalhoBloco bloco={bloco} ordens={ordens.length} cents={cents} />

      {enviaveis.length > 0 ? (
        <div className="fin-apr-acoes">
          <button
            type="button"
            className="fin-btn-primary"
            disabled={emVoo || escolhidas.length === 0}
            onClick={() => void enviarFila(escolhidas)}
          >
            <Send size={15} strokeWidth={2.2} aria-hidden />
            Enviar ao Inter para aprovação
            {escolhidas.length > 0
              ? ` · ${plural(escolhidas.length, "ordem", "ordens")} · ${brlCents(totalEscolhido)}`
              : ""}
          </button>
          {/* O aviso do topo repetido onde o dedo está: um aviso que só existe
              no alto da página não está na tela no instante do clique. */}
          <span className="fin-apr-acoes-nota">
            Uma ordem por vez, {ESPERA_ROTULO} entre elas — o Inter limita ~10 chamadas por minuto.
            O envio para em &ldquo;aguardando sua aprovação&rdquo;: <strong>quem paga é você, no
            aplicativo do banco.</strong>
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
          onReenviar={(fila) => void enviarFila(fila)}
          onFechar={() => setResultado(null)}
        />
      ) : null}

      <Tabela
        ordens={ordens}
        estado={bloco.estado}
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
    </section>
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
function BlocoAguardando({ bloco, ordens }: { bloco: Bloco; ordens: OrdemAprovacao[] }) {
  const router = useRouter();
  const cents = ordens.reduce((s, o) => s + o.valorCents, 0);
  const devolviveis = useMemo(() => ordens.filter(podeVoltarParaFila), [ordens]);
  const selecao = useSelecao(devolviveis);
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
    <section className="card fin-apr-bloco principal" aria-label={bloco.titulo}>
      <CabecalhoBloco bloco={bloco} ordens={ordens.length} cents={cents} />

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
            A plataforma não sabe o que houve no banco: a credencial não consulta pagamento.{" "}
            <strong>Quem abre o aplicativo é você</strong> — marque o que não está mais lá.
            Devolver não cancela nada: a obrigação continua devida e a ordem volta para
            &ldquo;ainda não foi ao banco&rdquo;, com o mesmo código.
          </span>
          {erro ? <p className="fin-apr-dev-erro">{erro}</p> : null}
        </div>
      )}

      {resultado ? (
        <PainelDevolucao resultado={resultado} onFechar={() => setResultado(null)} />
      ) : null}

      <Tabela
        ordens={ordens}
        estado={bloco.estado}
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
    </section>
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
function BlocoEncerrado({ ordens }: { ordens: OrdemAprovacao[] }) {
  const bloco = BLOCOS[3];
  const cents = ordens.reduce((s, o) => s + o.valorCents, 0);
  return (
    <FinSecaoColapsavel
      className="fin-apr-encerradas"
      titulo={bloco.titulo}
      icone={bloco.icone}
      meta={`${ordens.length} ${ordens.length === 1 ? "ordem" : "ordens"} · ${brlCents(cents)}`}
    >
      <p className="fin-apr-explicacao">{bloco.explicacao}</p>
      <Tabela ordens={ordens} estado="encerrada" />
    </FinSecaoColapsavel>
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
  selecao
}: {
  ordens: OrdemAprovacao[];
  estado: EstadoCiclo;
  selecao?: Selecao;
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
            const classes = [
              o.esquecida ? "fin-apr-esquecida" : "",
              marcada ? "fin-apr-marcada" : ""
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
                  <span>{dateLabel(o.scheduledFor)}</span>
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
