"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  CatalogoCustoFixo,
  CategoriaCatalogo,
  LinhaCatalogo,
  Vencimento
} from "@/lib/financeiro/contratos/custo-fixo";

import { brl, Medida, Ressalva, SeloCamada, type Camada } from "./Certeza";

/**
 * O catálogo do que a empresa paga todo mês.
 *
 * ---------------------------------------------------------------------------
 * A REGRA QUE ESTA TELA EXISTE PARA NÃO DEIXAR NINGUÉM ERRAR
 * ---------------------------------------------------------------------------
 * Há DOIS totais e eles respondem perguntas diferentes:
 *
 *   "quanto a empresa DECIDIU que paga"  →  total ligado. É previsão, entra no
 *                                           saldo, e hoje é R$ 0,00 porque
 *                                           ninguém ligou nada ainda.
 *   "quanto a empresa DE FATO paga"      →  total detectado. É medida dos 12
 *                                           meses fechados, não entra em saldo.
 *
 * O primeiro sozinho faz a empresa parecer não ter custo. O segundo sozinho faz
 * parecer que a previsão está pronta. A soma dos dois conta o mesmo dinheiro
 * duas vezes. Por isso os dois aparecem lado a lado, com a frase que os separa
 * ANTES deles — não num rodapé, que chega depois de a pessoa já ter formado
 * opinião.
 *
 * ---------------------------------------------------------------------------
 * POR QUE A MAIOR PARTE DO CATÁLOGO NÃO PODE SER LIGADA
 * ---------------------------------------------------------------------------
 * Dos R$ 140.917,86/mês detectados, R$ 87.800,39 são folha e R$ 12.930,85 são
 * DAS — dinheiro que as camadas `pagar_folha` e `pagar_tributo_das` JÁ
 * projetam. Ligá-los aqui somaria por cima. O banco recusa (CHECK
 * `fin_recurring_conflito_nao_ativa`), e a tela mostra a linha desabilitada com
 * o motivo, em vez de escondê-la: esconder faria o total de terceiros parecer
 * o custo inteiro da empresa.
 *
 * ---------------------------------------------------------------------------
 * INDETERMINADO É HACHURA ROXA, NUNCA CINZA NEM R$ 0,00
 * ---------------------------------------------------------------------------
 * Cinco grupos ficaram sem valor sugerido porque o backtest da família deles
 * errou acima de 47% em todos os critérios. `Medida` com `valorCents: null`
 * hachura e obriga o motivo — o tipo não deixa passar valor nulo sem ele.
 */

// ---------------------------------------------------------------------------
// Vocabulário
// ---------------------------------------------------------------------------

/** A confiança do detector, no vocabulário de certeza que a base já ensina. */
const CERTEZA: Record<string, Camada> = {
  firme: "firme",
  provavel: "provavel",
  observado: "observado"
};

const CRITERIO: Record<string, string> = {
  moda_observada: "moda",
  ultimo_observado: "último comparável",
  mediana_3m: "mediana de 3 meses",
  media_janela: "média da janela",
  declarado: "declarado",
  contrato: "contrato"
};

const NATUREZA: Record<string, string> = {
  fixo: "fixo",
  variavel_volume: "varia com volume",
  parcelado: "parcelado",
  estimado: "estimado",
  indeterminado: "indeterminado"
};

const CAMADA_CONFLITO: Record<string, string> = {
  folha_declarada: "folha",
  tributo_das: "DAS",
  fatura_cartao: "fatura de cartão",
  documento_a_pagar: "documento a pagar",
  cobranca: "cobrança",
  contrato_assinatura: "contrato",
  previsao_contrato: "contrato",
  pagamento_recorrente_erp: "ERP de obras"
};

const URGENCIA: Record<Vencimento["urgencia"], { rotulo: string; camada: Camada }> = {
  vencido: { rotulo: "venceu", camada: "atrasado" },
  vence_hoje: { rotulo: "vence hoje", camada: "atrasado" },
  vence_em_3_dias: { rotulo: "vence em 3 dias", camada: "provavel" },
  vence_em_7_dias: { rotulo: "vence em 7 dias", camada: "observado" }
};

const pct = (n: number | null) => (n === null ? "—" : `${n.toString().replace(".", ",")}%`);
const mes = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const competencia = (iso: string | null) => (iso ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

// ---------------------------------------------------------------------------

type Envelope = {
  disponivel: boolean;
  dado: CatalogoCustoFixo;
  ressalvas: string[];
};

export function FinCustoFixo() {
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [soTerceiros, setSoTerceiros] = useState(true);
  const [ocupado, setOcupado] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch("/api/financeiro/gerencial/custo-fixo", { cache: "no-store" });
      const corpo = (await r.json()) as Envelope & { erro?: string };
      if (!r.ok && !corpo?.dado) throw new Error(corpo?.erro ?? `HTTP ${r.status}`);
      setEnvelope(corpo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /**
   * Toda escrita recarrega o catálogo inteiro em vez de remendar o estado local.
   *
   * Ligar um item muda o total, o subtotal da categoria, o contador de revisão e
   * possivelmente um alerta de sobreposição de outra linha. Recalcular isso no
   * cliente seria uma segunda cópia da regra do servidor, e ela divergiria na
   * primeira correção feita só de um lado.
   */
  const escrever = useCallback(
    async (id: number, corpo: Record<string, unknown>) => {
      setOcupado(id);
      setErro(null);
      try {
        const r = await fetch(`/api/financeiro/gerencial/custo-fixo/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo)
        });
        const resposta = (await r.json()) as { erro?: string };
        if (!r.ok) throw new Error(resposta?.erro ?? `HTTP ${r.status}`);
        await carregar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        setOcupado(null);
      }
    },
    [carregar]
  );

  const d = envelope?.dado;
  const r = d?.resumo;

  const porCategoria = useMemo(() => {
    if (!d) return [];
    const grupos = new Map<string, { categoria: CategoriaCatalogo | null; linhas: LinhaCatalogo[] }>();
    for (const l of d.linhas) {
      if (soTerceiros && l.conflitoCamada) continue;
      const chave = l.categoriaCode ?? "—";
      if (!grupos.has(chave)) {
        grupos.set(chave, {
          categoria: d.porCategoria.find((k) => (k.code ?? "—") === chave) ?? null,
          linhas: []
        });
      }
      grupos.get(chave)!.linhas.push(l);
    }
    return [...grupos.entries()].sort((a, b) => {
      const va = a[1].linhas.reduce((s, l) => s + (l.valorVigenteCents ?? l.valorSugeridoCents ?? 0), 0);
      const vb = b[1].linhas.reduce((s, l) => s + (l.valorVigenteCents ?? l.valorSugeridoCents ?? 0), 0);
      return vb - va;
    });
  }, [d, soTerceiros]);

  if (carregando && !envelope) return <p className="cf-vazio">Medindo o catálogo…</p>;
  if (!d || !r) {
    return (
      <Ressalva>
        O catálogo não pôde ser medido{erro ? `: ${erro}` : ""}. Nenhum número é melhor que um número inventado.
      </Ressalva>
    );
  }

  const escondidas = soTerceiros ? d.linhas.filter((l) => l.conflitoCamada).length : 0;

  return (
    <div className="cf-raiz">
      {erro ? <Ressalva>{erro}</Ressalva> : null}

      {/* A ressalva vem ANTES do número, não depois: quem lê o total primeiro
          já formou opinião quando chega a explicação. */}
      <Ressalva>
        <strong>Dois totais, duas perguntas.</strong> O que a empresa <em>decidiu</em> que paga todo mês é{" "}
        {brl(r.totalLigadoCents)} — {r.itensLigados} item(ns) ligado(s).
        {r.totalLigadoMotivo ? ` ${r.totalLigadoMotivo}.` : ""} O que ela <em>de fato</em> paga de recorrente, medido em
        12 meses fechados, é <strong>{brl(r.totalDetectadoCents)}/mês</strong> — e{" "}
        {brl(r.detectadoFolhaCents + r.detectadoDasCents)} disso já é projetado pela folha e pelo DAS. Somar os dois
        conta o mesmo dinheiro duas vezes.
      </Ressalva>

      <section className="cf-medidas">
        <Medida
          rotulo="Ligado no catálogo"
          valorCents={r.totalLigadoCents}
          detalhe={`${r.itensLigados} de ${r.gruposDetectados} · entra no saldo`}
        />
        <Medida
          rotulo="Detectado no ledger"
          valorCents={r.totalDetectadoCents}
          detalhe={`${r.gruposDetectados} grupos · 12 meses fechados · medida, não previsão`}
        />
        <Medida
          rotulo="De terceiros"
          valorCents={r.detectadoTerceirosCents}
          detalhe="o que não é folha, DAS nem cartão — é aqui que a decisão existe"
        />
        <Medida
          rotulo="Já na folha"
          valorCents={r.detectadoFolhaCents}
          detalhe="projetado por pagar_folha · não pode ser ligado aqui"
        />
        {r.detectadoSemValor > 0 ? (
          <Medida
            rotulo="Sem valor"
            valorCents={null}
            motivo={`${r.detectadoSemValor} grupo(s): o backtest da família errou acima de 47% em todos os critérios`}
          />
        ) : null}
        <Medida
          rotulo="Parcelado (acaba)"
          valorCents={r.parceladoMesCorrenteCents}
          detalhe={
            r.parceladoTerminaEm
              ? `${r.parcelamentosAbertos} plano(s) · último termina em ${competencia(r.parceladoTerminaEm)}`
              : `${r.parcelamentosAbertos} plano(s)`
          }
        />
      </section>

      {/* ── "assim não vamos esquecer de pagar" ──────────────────────────── */}
      <VencimentosPainel vencimentos={d.vencimentos} />

      <div className="cf-filtros">
        <label className="cf-check">
          <input type="checkbox" checked={soTerceiros} onChange={(e) => setSoTerceiros(e.target.checked)} />
          Só o que pode ser ligado (esconde folha, DAS e cartão)
        </label>
        {escondidas > 0 ? (
          <span className="cf-nota">
            {escondidas} linha(s) escondida(s) — elas existem e já são projetadas por outra camada
          </span>
        ) : null}
        <button type="button" className="cf-btn-ghost" onClick={() => void carregar()} disabled={carregando}>
          {carregando ? "medindo…" : "remedir"}
        </button>
      </div>

      {porCategoria.map(([code, grupo]) => {
        const k = grupo.categoria;
        const subtotalLigado = grupo.linhas
          .filter((l) => l.entraNoTotal)
          .reduce((s, l) => s + (l.valorVigenteCents ?? 0), 0);
        const subtotalSugerido = grupo.linhas.reduce(
          (s, l) => s + (l.valorVigenteCents ?? l.valorSugeridoCents ?? 0),
          0
        );
        return (
          <section key={code} className="cf-grupo">
            <header className="cf-grupo-cab">
              <h3>
                <span className="cf-grupo-code">{code}</span> {k?.nome ?? "sem categoria"}
              </h3>
              <div className="cf-grupo-num">
                <span title="soma dos itens LIGADOS desta categoria">ligado {brl(subtotalLigado)}</span>
                <span className="cf-sep">·</span>
                <span title="soma do valor vigente ou sugerido de todas as linhas visíveis">
                  catálogo {brl(subtotalSugerido)}
                </span>
                <span className="cf-sep">·</span>
                <span>{grupo.linhas.length} item(ns)</span>
              </div>
            </header>

            <table className="cf-tabela">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Evidência</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                  <th>Critério</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {grupo.linhas.map((l) => (
                  <LinhaItem
                    key={l.chaveDedupe}
                    linha={l}
                    aberta={aberta === l.chaveDedupe}
                    ocupado={ocupado === l.recurringId}
                    onAbrir={() => setAberta(aberta === l.chaveDedupe ? null : l.chaveDedupe)}
                    onEscrever={escrever}
                  />
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      <ParceladoPainel parcelados={d.parcelados} />

      {envelope?.ressalvas?.length ? (
        <section className="cf-ressalvas">
          <h3>Como ler estes números</h3>
          <ul>
            {envelope.ressalvas.map((frase) => (
              <li key={frase}>{frase}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A linha, com a evidência à vista e a ação ao lado
// ---------------------------------------------------------------------------

function LinhaItem({
  linha,
  aberta,
  ocupado,
  onAbrir,
  onEscrever
}: {
  linha: LinhaCatalogo;
  aberta: boolean;
  ocupado: boolean;
  onAbrir: () => void;
  onEscrever: (id: number, corpo: Record<string, unknown>) => Promise<void>;
}) {
  const l = linha;
  const valor = l.valorVigenteCents ?? l.valorSugeridoCents;
  const podeLigar = l.recurringId !== null && !l.conflitoCamada && valor !== null && l.categoriaId !== null;
  const ligado = l.status === "ativo";

  return (
    <>
      <tr className={l.conflitoCamada ? "cf-conflito" : undefined} data-status={l.status}>
        <td>
          <button type="button" className="cf-link" onClick={onAbrir}>
            {l.descricao}
          </button>
          {l.contraparte && l.contraparte !== l.descricao ? (
            <span className="cf-sub">{l.contraparte}</span>
          ) : null}
        </td>

        <td className="cf-evidencia">
          {l.confianca ? <SeloCamada camada={CERTEZA[l.confianca] ?? "observado"} /> : null}
          {l.ocorrencias !== null ? (
            <span
              className="cf-nota"
              title={`densidade ${l.densidade ?? "—"} · dispersão ${l.dispersao ?? "—"} · ${
                l.lancamentosPorMes ?? "—"
              } pagamento(s)/mês`}
            >
              {l.ocorrencias}× · dia {l.diaDoMes ?? "?"} · desde {competencia(l.primeiraCompetencia)}
            </span>
          ) : null}
          {l.situacao && l.situacao !== "vigente" ? (
            <span className="cf-alerta" title={l.situacaoMotivo ?? undefined}>
              {l.situacao === "parou" ? "parou" : "falhou meses"}
            </span>
          ) : null}
        </td>

        <td style={{ textAlign: "right" }}>
          {valor === null ? (
            // Hachura roxa, nunca R$ 0,00. Zero é afirmação sobre o dinheiro;
            // ausência é afirmação sobre o dado.
            <span className="cert-hachura cf-indeterminado" title={l.valorIndeterminadoMotivo ?? undefined}>
              indeterminado
            </span>
          ) : (
            <>
              <span className="cf-valor">{brl(valor)}</span>
              {l.divergenciaSugeridoCents !== null && l.divergenciaSugeridoCents !== 0 ? (
                <span
                  className="cf-delta"
                  title={`o ledger sugere ${brl(l.valorSugeridoCents ?? 0)} — reajuste não aplicado`}
                >
                  {l.divergenciaSugeridoCents > 0 ? "▲" : "▼"} {brl(Math.abs(l.divergenciaSugeridoCents))}
                </span>
              ) : null}
            </>
          )}
        </td>

        <td>
          {l.criterio ? (
            <span className="cf-nota" title={l.criterioMotivo ?? undefined}>
              {CRITERIO[l.criterio] ?? l.criterio}
              {l.criterioErroPct !== null ? ` · erro ${pct(l.criterioErroPct)}` : ""}
            </span>
          ) : (
            <span className="cf-nota">—</span>
          )}
          {l.naturezaCusto ? <span className="cf-sub">{NATUREZA[l.naturezaCusto] ?? l.naturezaCusto}</span> : null}
        </td>

        <td>
          <EstadoBadge linha={l} />
        </td>

        <td style={{ textAlign: "right" }}>
          {l.recurringId === null ? (
            <span className="cf-nota">{l.procedencia === "folha" ? "informativo" : "candidato"}</span>
          ) : ligado ? (
            <button
              type="button"
              className="cf-btn-ghost"
              disabled={ocupado}
              onClick={() => {
                const motivo = window.prompt("Por que desligar? (o motivo fica registrado)");
                if (motivo) void onEscrever(l.recurringId!, { status: "suspenso", motivo });
              }}
            >
              desligar
            </button>
          ) : (
            <button
              type="button"
              className="cf-btn"
              disabled={ocupado || !podeLigar}
              title={
                l.conflitoCamada
                  ? l.conflitoMotivo ?? "colide com outra camada"
                  : valor === null
                    ? "sem valor: declare o número antes de ligar"
                    : undefined
              }
              onClick={() => void onEscrever(l.recurringId!, { status: "ativo" })}
            >
              ligar
            </button>
          )}
        </td>
      </tr>

      {aberta ? <DetalheLinha linha={l} ocupado={ocupado} onEscrever={onEscrever} /> : null}
    </>
  );
}

function EstadoBadge({ linha }: { linha: LinhaCatalogo }) {
  const l = linha;
  if (l.conflitoCamada) {
    return (
      <span className="cf-badge cf-badge-bloqueado" title={l.conflitoMotivo ?? undefined}>
        já em {CAMADA_CONFLITO[l.conflitoCamada] ?? l.conflitoCamada}
      </span>
    );
  }
  if (l.status === "ativo") return <span className="cf-badge cf-badge-ok">ligado</span>;
  if (l.status === "candidato") return <span className="cf-badge">candidato</span>;
  if (l.status === "proposto") return <span className="cf-badge">proposto</span>;
  return (
    <span className="cf-badge cf-badge-off" title={l.statusMotivo ?? undefined}>
      {l.status}
    </span>
  );
}

/**
 * O detalhe: a evidência inteira, os candidatos que o critério descartou, o
 * histórico do reajuste — e o ajuste de valor.
 *
 * Os cinco candidatos ficam à vista porque quem discorda do critério precisa
 * poder ver o que ele descartou. Escondê-los transformaria um número medido
 * numa opinião do sistema.
 */
function DetalheLinha({
  linha,
  ocupado,
  onEscrever
}: {
  linha: LinhaCatalogo;
  ocupado: boolean;
  onEscrever: (id: number, corpo: Record<string, unknown>) => Promise<void>;
}) {
  const l = linha;
  const [valor, setValor] = useState(() =>
    l.valorVigenteCents !== null ? (l.valorVigenteCents / 100).toFixed(2) : ""
  );
  const [motivo, setMotivo] = useState("");

  return (
    <tr className="cf-detalhe">
      <td colSpan={6}>
        <div className="cf-detalhe-grade">
          <div>
            <h4>Por que este valor</h4>
            <p>{l.criterioMotivo ?? l.valorIndeterminadoMotivo ?? "sem critério declarado"}</p>
            <dl className="cf-candidatos">
              <div>
                <dt>moda</dt>
                <dd>{l.modaCents === null ? "—" : brl(l.modaCents)}</dd>
              </div>
              <div>
                <dt>último comparável</dt>
                <dd>{l.ultimoComparavelCents === null ? "—" : brl(l.ultimoComparavelCents)}</dd>
              </div>
              <div>
                <dt>último mês</dt>
                <dd>{l.ultimoCents === null ? "—" : brl(l.ultimoCents)}</dd>
              </div>
              <div>
                <dt>mediana de 3</dt>
                <dd>{l.mediana3mCents === null ? "—" : brl(l.mediana3mCents)}</dd>
              </div>
              <div>
                <dt>mediana</dt>
                <dd>{l.medianaCents === null ? "—" : brl(l.medianaCents)}</dd>
              </div>
              <div>
                <dt>média</dt>
                <dd>{l.mediaCents === null ? "—" : brl(l.mediaCents)}</dd>
              </div>
            </dl>
          </div>

          <div>
            <h4>Evidência</h4>
            <ul className="cf-lista">
              <li>
                {l.ocorrencias ?? "—"} ocorrência(s) em {l.spanMeses ?? "—"} mês(es) · densidade {l.densidade ?? "—"}
              </li>
              <li>dispersão {l.dispersao ?? "—"} (MAD ÷ mediana)</li>
              <li>{l.lancamentosPorMes ?? "—"} pagamento(s) por mês</li>
              <li>
                de {competencia(l.primeiraCompetencia)} a {competencia(l.ultimaCompetencia)}
              </li>
              {l.situacaoMotivo ? <li className="cf-alerta">{l.situacaoMotivo}</li> : null}
            </ul>
            {l.alertaSobreposicao ? <Ressalva>{l.alertaSobreposicao}</Ressalva> : null}
          </div>

          <div>
            <h4>Histórico</h4>
            {l.ajustes > 0 ? (
              <ul className="cf-lista">
                <li>
                  {l.ajustes} mudança(s) registrada(s)
                  {l.ultimoAjusteVigenteDe ? ` · última vale desde ${competencia(l.ultimoAjusteVigenteDe)}` : ""}
                </li>
                {l.ultimoAjusteAntesCents !== null ? (
                  <li>
                    era {brl(l.ultimoAjusteAntesCents)} → {brl(l.valorVigenteCents ?? 0)}
                  </li>
                ) : null}
                {l.ultimoAjusteMotivo ? (
                  <li>
                    “{l.ultimoAjusteMotivo}” — {l.ultimoAjusteAutor ?? "sem autor"}
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="cf-nota">nenhuma mudança registrada ainda</p>
            )}
            <p className="cf-nota">
              {l.revisadoEm
                ? `revisado por ${l.revisadoPor ?? "alguém"} em ${l.revisadoEm.slice(0, 10)}`
                : "nunca revisado"}
            </p>
            {l.statusMotivo ? <p className="cf-nota">estado: {l.statusMotivo}</p> : null}
          </div>

          {l.recurringId !== null ? (
            <div>
              <h4>Ajustar</h4>
              <p className="cf-nota">
                O novo valor vale do mês corrente em diante. O anterior não se perde — ele fica no histórico.
              </p>
              <div className="cf-form">
                <input
                  type="text"
                  inputMode="decimal"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="0,00"
                  aria-label="novo valor"
                />
                <input
                  type="text"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="por que mudou (obrigatório)"
                  aria-label="motivo do reajuste"
                />
                <button
                  type="button"
                  className="cf-btn"
                  disabled={ocupado || !motivo.trim() || !valor.trim()}
                  onClick={() => {
                    const cents = Math.round(Number(valor.replace(/\./g, "").replace(",", ".")) * 100);
                    if (!Number.isSafeInteger(cents) || cents <= 0) return;
                    void onEscrever(l.recurringId!, { valorCents: cents, motivo: motivo.trim() });
                  }}
                >
                  registrar reajuste
                </button>
                <button
                  type="button"
                  className="cf-btn-ghost"
                  disabled={ocupado}
                  onClick={() => void onEscrever(l.recurringId!, { revisado: true })}
                >
                  revisei, está certo
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// "assim não vamos esquecer de pagar"
// ---------------------------------------------------------------------------

/**
 * O objetivo declarado do dono, e por isso um painel próprio no topo.
 *
 * "Pago" aqui é `estado = 'realizado'`, o único estado que exige lançamento em
 * `fin_transaction`. Confirmado NÃO é pago, e cada linha diz isso — um lembrete
 * que some quando alguém apenas prometeu pagar é um lembrete que falha
 * exatamente no dia em que importa.
 */
function VencimentosPainel({ vencimentos }: { vencimentos: Vencimento[] }) {
  const urgentes = vencimentos.filter((v) => v.urgencia !== "vence_em_7_dias");
  if (!vencimentos.length) {
    return (
      <section className="cf-vencimentos">
        <h3>Não deixar esquecer de pagar</h3>
        <p className="cf-nota">
          Nada vence nos próximos 7 dias e nada venceu nos últimos 30 sem ser pago. Vazio aqui é uma afirmação sobre o
          que a previsão enxerga — o que não tem dia esperado não aparece.
        </p>
      </section>
    );
  }
  return (
    <section className="cf-vencimentos">
      <h3>
        Não deixar esquecer de pagar
        <span className="cf-nota"> · {urgentes.length} em cima da hora, {vencimentos.length} na janela</span>
      </h3>
      <table className="cf-tabela">
        <thead>
          <tr>
            <th>Dia</th>
            <th>O quê</th>
            <th style={{ textAlign: "right" }}>Valor</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {vencimentos.map((v) => (
            <tr key={v.chaveDedupe}>
              <td>
                {mes(v.diaEsperado)} <SeloCamada camada={URGENCIA[v.urgencia].camada} texto={URGENCIA[v.urgencia].rotulo} />
              </td>
              <td>
                {v.descricao}
                {v.diaRegra ? <span className="cf-sub">{v.diaRegra}</span> : null}
              </td>
              <td style={{ textAlign: "right" }}>
                {v.valorCents === null ? (
                  <span className="cert-hachura cf-indeterminado">indeterminado</span>
                ) : (
                  brl(v.valorCents)
                )}
              </td>
              <td>
                <span className="cf-nota">{v.oQueFalta}</span>
                {v.alertaSobreposicao ? <span className="cf-alerta">{v.alertaSobreposicao}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// O que se repete E acaba
// ---------------------------------------------------------------------------

/**
 * Parcelamento fica FORA do custo fixo, num bloco próprio, com a data de
 * término em cada linha.
 *
 * Recorrente e parcelado têm a mesma assinatura estatística — densidade 1,00,
 * dispersão 0,00 — e são coisas diferentes, porque parcelamento acaba. Do lado
 * da receita, confundi-los custou 37% de superestimativa nesta base. A data de
 * término não é inferida: vem declarada por `fin_card_installment_plan`.
 */
function ParceladoPainel({ parcelados }: { parcelados: CatalogoCustoFixo["parcelados"] }) {
  if (!parcelados.length) return null;
  const porMes = parcelados.reduce((s, p) => s + p.parcelaCents, 0);
  return (
    <section className="cf-parcelado">
      <h3>
        O que se repete e <em>acaba</em>
        <span className="cf-nota">
          {" "}
          · {brl(porMes)}/mês em {parcelados.length} parcelamento(s), fora do custo fixo
        </span>
      </h3>
      <table className="cf-tabela">
        <thead>
          <tr>
            <th>Compra</th>
            <th>Parcelas</th>
            <th style={{ textAlign: "right" }}>Por mês</th>
            <th style={{ textAlign: "right" }}>Em aberto</th>
            <th>Termina</th>
          </tr>
        </thead>
        <tbody>
          {parcelados.map((p) => (
            <tr key={p.planoId}>
              <td title={p.ressalva}>{p.descricao}</td>
              <td>
                {p.parcelasAbertas} de {p.parcelasTotal} restante(s)
              </td>
              <td style={{ textAlign: "right" }}>{brl(p.parcelaCents)}</td>
              <td style={{ textAlign: "right" }}>{brl(p.abertoCents)}</td>
              <td>
                <SeloCamada camada="firme" texto={competencia(p.terminaEm)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
