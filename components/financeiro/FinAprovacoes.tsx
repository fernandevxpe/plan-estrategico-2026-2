"use client";

import { useMemo } from "react";
import { Ban, CheckCircle2, Clock, FileText, ShieldCheck } from "lucide-react";

import type { Aprovacoes, EstadoCiclo, OrdemAprovacao } from "@/lib/financeiro/aprovacoes";
import { brlCents, brlPrecise, dateLabel } from "@/lib/financeiro/format";

import { KpiAnalise } from "./FinKpiAnalise";
import { FinSecaoColapsavel } from "./FinSecaoColapsavel";

/**
 * APROVAÇÕES — o que foi para o Inter e ainda espera um dedo humano.
 *
 * Quatro blocos, na ordem do ciclo: o que ainda não foi ao banco, o que está
 * esperando no aplicativo, o que já saiu e o que morreu no caminho. O bloco do
 * meio é o motivo da tela.
 *
 * O aviso do topo é permanente e não colapsa. Ele não é decoração de
 * onboarding: é a garantia do produto, escrita também no schema da 0075 e no
 * cabeçalho de `pagar-programar.ts`. Uma tela chamada "Aprovações" que não
 * dissesse isso ensinaria exatamente a leitura errada — "a plataforma aprovou,
 * então está pago".
 *
 * ÂMBAR SIGNIFICA UMA COISA SÓ AQUI: ordem parada há dois dias ou mais no
 * aplicativo do banco. O aviso do topo usa o roxo da casa justamente para não
 * gastar o âmbar em algo que não é fila de decisão — se tudo alerta, nada
 * alerta. É a mesma lição que FinContasAPagar já pagou, quando hachurar por
 * `entra_no_total = false` rotulou 31 contas reais de R$ 40.044,75 como
 * duplicata.
 */

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
      "Ordem criada na plataforma. Nada foi entregue ao Inter — ela sai daqui pela aba Contas a pagar.",
    rotuloKpi: "Não foi ao banco",
    icone: FileText
  },
  {
    estado: "aguardando",
    titulo: "Aguardando sua aprovação no app do Inter",
    explicacao:
      "A ordem foi entregue ao banco. Daqui em diante nada muda sozinho: só a sua aprovação no aplicativo do Inter faz o dinheiro sair.",
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
 * ficariam indistinguíveis no primeiro bloco.
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

          {BLOCOS.filter((b) => b.estado !== "encerrada").map((bloco) => (
            <BlocoAberto key={bloco.estado} bloco={bloco} ordens={porEstado.get(bloco.estado) ?? []} />
          ))}

          <BlocoEncerrado ordens={porEstado.get("encerrada") ?? []} />

          <p className="fin-apr-rodape">
            Posição de {dateLabel(dados.hoje)}. A tela lê; ela não move nenhuma ordem.
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

function BlocoAberto({ bloco, ordens }: { bloco: Bloco; ordens: OrdemAprovacao[] }) {
  const Icone = bloco.icone;
  const cents = ordens.reduce((s, o) => s + o.valorCents, 0);
  return (
    <section
      className={`card fin-apr-bloco${bloco.estado === "aguardando" ? " principal" : ""}`}
      aria-label={bloco.titulo}
    >
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
          <span>
            {ordens.length} {ordens.length === 1 ? "ordem" : "ordens"}
          </span>
        </p>
      </header>
      <Tabela ordens={ordens} estado={bloco.estado} />
    </section>
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

function Tabela({ ordens, estado }: { ordens: OrdemAprovacao[]; estado: EstadoCiclo }) {
  if (ordens.length === 0) {
    return <p className="fin-empty-row">Nenhuma ordem neste estado.</p>;
  }
  return (
    <div className="fin-table-wrap">
      <table className="fin-table fin-apr-tabela">
        <thead>
          <tr>
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
          {ordens.map((o) => (
            <tr key={o.id} className={o.esquecida ? "fin-apr-esquecida" : undefined}>
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
                  <span className="fin-apr-cod vazio" title="O Inter respondeu sem código de solicitação.">
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
