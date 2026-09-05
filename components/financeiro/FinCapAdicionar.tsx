"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Plus, Search, X } from "lucide-react";

import type { OpcoesContas } from "@/lib/financeiro/contas";
import { brlPrecise, shortDateLabel } from "@/lib/financeiro/format";
import { urlDaOrigem } from "@/lib/url-origem";

/** Centavos a partir de "1.350,00" / "1350,00" / "1350.00" / "1350". */
function paraCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(/[R$\s]/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const valor = Number(normalizado);
  if (!Number.isFinite(valor)) return null;
  return Math.round(valor * 100);
}

function formatarCentavos(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/** Dia do mês na competência aberta (grampa no último dia). */
function diaNaCompetencia(competencia: string, diaDoMes: number, fallback: string): string {
  const [y, m] = competencia.split("-").map(Number);
  if (!y || !m) return fallback;
  const ultimo = new Date(y, m, 0).getDate();
  const d = Math.min(Math.max(1, diaDoMes), ultimo);
  return `${competencia}-${String(d).padStart(2, "0")}`;
}

type HitBusca = {
  descricao: string;
  valorCents: number;
  dia: string;
  diaDoMes: number;
  competencia: string;
  counterpartyId: number | null;
  contraparte: string | null;
  categoryId: number | null;
  categoriaCode: string | null;
  categoriaNome: string | null;
  chaveDedupe: string | null;
  itemId: number | null;
  ocorrencias: number;
};

export function FinCapAdicionarBotao({
  aberto,
  onClick,
  desabilitado
}: {
  aberto: boolean;
  onClick: () => void;
  desabilitado?: boolean;
}) {
  return (
    <button
      type="button"
      className={aberto ? "fin-cap-adicionar-btn aberto" : "fin-cap-adicionar-btn"}
      aria-expanded={aberto}
      disabled={desabilitado}
      onClick={onClick}
    >
      {aberto ? <X size={14} strokeWidth={2.3} aria-hidden /> : <Plus size={14} strokeWidth={2.3} aria-hidden />}
      {aberto ? "Fechar" : "Adicionar"}
    </button>
  );
}

/**
 * Cadastro rápido de custo previsto nesta fila de caixa.
 *
 * Contas a pagar não tinha porta de entrada — o dono ia em /financeiro/custos.
 * O POST é o mesmo (`/api/financeiro/gerencial/custos`); aqui o item já nasce
 * confirmado, com dia na competência aberta, para poder virar ordem no mesmo
 * gesto. Sem favorecido cadastrado o item entra, mas a programação PIX para
 * em "sem chave" até o cadastro — melhor do que sumir da tela.
 */
export function FinCapAdicionarPainel({
  competencia,
  hoje,
  opcoes,
  onCriado,
  onCancelar
}: {
  competencia: string;
  hoje: string;
  opcoes: OpcoesContas;
  onCriado: () => void;
  onCancelar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [hits, setHits] = useState<HitBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [dicaBusca, setDicaBusca] = useState<string | null>(null);
  const [referencia, setReferencia] = useState<HitBusca | null>(null);

  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [dia, setDia] = useState(hoje);
  const [contraparte, setContraparte] = useState("");
  const [categoria, setCategoria] = useState("");
  const [recorrencia, setRecorrencia] = useState<"unica" | "mensal">("unica");

  const [anexo, setAnexo] = useState<File | null>(null);
  const [kindAnexo, setKindAnexo] = useState<"boleto" | "nota_fiscal">("boleto");
  const [vincularChave, setVincularChave] = useState<string | null>(null);
  const [leituraAnexo, setLeituraAnexo] = useState<string | null>(null);

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const timerBusca = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputAnexo = useRef<HTMLInputElement>(null);

  const casada = opcoes.contrapartes.find(
    (c) => c.name.toLowerCase() === contraparte.trim().toLowerCase()
  );
  const categoriasGasto = opcoes.categorias.filter(
    (c) => c.kind !== "receita" && c.kind !== "deducao_receita"
  );

  useEffect(() => {
    if (timerBusca.current) clearTimeout(timerBusca.current);
    const q = busca.trim();
    if (q.length < 2) {
      setHits([]);
      setDicaBusca(null);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    timerBusca.current = setTimeout(() => {
      void (async () => {
        try {
          const r = await fetch(
            urlDaOrigem(`/api/financeiro/contas-a-pagar/buscar?q=${encodeURIComponent(q)}`)
          );
          const j = (await r.json()) as {
            resultados?: HitBusca[];
            ressalva?: string | null;
          };
          setHits(j.resultados ?? []);
          setDicaBusca(j.ressalva ?? null);
        } catch {
          setHits([]);
          setDicaBusca("busca indisponível");
        } finally {
          setBuscando(false);
        }
      })();
    }, 280);
    return () => {
      if (timerBusca.current) clearTimeout(timerBusca.current);
    };
  }, [busca]);

  function aplicarHit(h: HitBusca) {
    setReferencia(h);
    setDescricao(h.descricao);
    setValor(formatarCentavos(h.valorCents));
    setDia(diaNaCompetencia(competencia, h.diaDoMes, hoje));
    if (h.contraparte) setContraparte(h.contraparte);
    if (h.categoriaCode) setCategoria(h.categoriaCode);
    if (h.ocorrencias >= 3) setRecorrencia("mensal");
    // Se o hit é desta competência, oferecer vincular anexo à obrigação existente.
    if (h.competencia === competencia && h.chaveDedupe) {
      setVincularChave(h.chaveDedupe);
    } else {
      setVincularChave(null);
    }
    setBusca("");
    setHits([]);
  }

  async function anexarEm(chaveDedupe: string, file: File) {
    const fd = new FormData();
    fd.set("chaveDedupe", chaveDedupe);
    fd.set("kind", kindAnexo);
    fd.set("arquivo", file);
    const r = await fetch(urlDaOrigem("/api/financeiro/contas-a-pagar/cobranca"), {
      method: "POST",
      body: fd
    });
    const j = (await r.json().catch(() => null)) as {
      error?: string;
      leitura?: {
        vencimentoLido?: string | null;
        valorLidoCents?: number | null;
        aviso?: string | null;
      };
    } | null;
    if (!r.ok) throw new Error(j?.error ?? "não anexou o arquivo");
    const partes: string[] = [];
    if (j?.leitura?.vencimentoLido) {
      partes.push(`vencimento lido ${shortDateLabel(j.leitura.vencimentoLido)}`);
      setDia(j.leitura.vencimentoLido);
    }
    if (j?.leitura?.valorLidoCents != null) {
      partes.push(brlPrecise(j.leitura.valorLidoCents));
      setValor(formatarCentavos(j.leitura.valorLidoCents));
    }
    if (j?.leitura?.aviso) partes.push(j.leitura.aviso);
    setLeituraAnexo(partes.length ? partes.join(" · ") : "arquivo guardado");
  }

  async function salvar() {
    setErro(null);
    setLeituraAnexo(null);

    const cents = paraCentavos(valor);
    if (!descricao.trim()) {
      setErro("informe a descrição");
      return;
    }
    if (cents == null || cents <= 0) {
      setErro("informe um valor maior que zero");
      return;
    }
    if (!dia) {
      setErro("informe o dia do pagamento");
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch(urlDaOrigem("/api/financeiro/gerencial/custos"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competencia,
          descricao: descricao.trim(),
          valorCents: cents,
          diaEsperado: dia,
          confirmar: true,
          recorrencia,
          ...(categoria ? { categoria } : {}),
          ...(casada ? { contraparte: casada.id } : {})
        })
      });
      const j = (await r.json().catch(() => null)) as {
        erro?: string;
        error?: string;
        chaveDedupe?: string;
        id?: number;
        ids?: number[];
      } | null;
      if (!r.ok) {
        setErro(j?.erro ?? j?.error ?? "não criou o item");
        return;
      }

      const chave =
        j?.chaveDedupe ??
        (j?.id != null ? `item|${j.id}` : j?.ids?.[0] != null ? `item|${j.ids[0]}` : null);

      if (anexo && chave) {
        try {
          await anexarEm(chave, anexo);
        } catch (e) {
          setErro(
            e instanceof Error
              ? `item criado, mas o anexo falhou: ${e.message}`
              : "item criado, mas o anexo falhou"
          );
          onCriado();
          return;
        }
      }

      onCriado();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fin-cap-adicionar-painel" role="dialog" aria-label="Adicionar conta a pagar">
      <p className="fin-cap-adicionar-dica">
        Busque um gasto já conhecido na plataforma (último valor vira referência),
        diga se é único ou mensal, e anexe boleto/NF-e/PDF — a data lida preenche
        o vencimento. Ao pagar, some da fila; o mês seguinte já entra se for
        recorrente.
      </p>

      <label className="fin-field fin-cap-adicionar-busca">
        <span>
          <Search size={12} strokeWidth={2.2} aria-hidden /> Buscar na plataforma
        </span>
        <input
          className="fin-input"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Ex.: âncora, luz, MEI, contabilidade…"
          autoComplete="off"
        />
      </label>

      {buscando ? <p className="fin-cap-adicionar-aviso">buscando…</p> : null}
      {dicaBusca && !buscando && busca.trim().length >= 2 ? (
        <p className="fin-cap-adicionar-aviso">{dicaBusca}</p>
      ) : null}
      {hits.length > 0 ? (
        <ul className="fin-cap-adicionar-hits" role="listbox" aria-label="Resultados da busca">
          {hits.map((h) => (
            <li key={`${h.chaveDedupe ?? h.descricao}-${h.competencia}-${h.valorCents}`}>
              <button type="button" className="fin-cap-adicionar-hit" onClick={() => aplicarHit(h)}>
                <span className="fin-cap-adicionar-hit-titulo">
                  {h.contraparte ?? h.descricao}
                  {h.ocorrencias > 1 ? (
                    <em>
                      · {h.ocorrencias}×
                    </em>
                  ) : null}
                </span>
                <span className="fin-cap-adicionar-hit-meta">
                  último {brlPrecise(h.valorCents)} · dia {h.diaDoMes}
                  {h.categoriaCode ? ` · ${h.categoriaCode}` : ""}
                  {h.competencia === competencia && h.chaveDedupe ? " · nesta competência" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {referencia ? (
        <p className="fin-cap-adicionar-ref" role="status">
          Referência: {brlPrecise(referencia.valorCents)} em{" "}
          {shortDateLabel(referencia.dia)}
          {referencia.ocorrencias > 1 ? ` (${referencia.ocorrencias} ocorrências)` : ""}
          {vincularChave ? (
            <>
              {" "}
              — ou só anexe cobrança nesta obrigação{" "}
              <button
                type="button"
                className="fin-cap-limpar"
                onClick={() => {
                  setVincularChave(null);
                  setReferencia(null);
                }}
              >
                criar nova em vez disso
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="fin-cap-adicionar-grade">
        <label className="fin-field fin-cap-adicionar-wide">
          <span>Descrição</span>
          <input
            className="fin-input"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex.: manutenção do ar-condicionado"
            autoFocus
          />
        </label>
        <label className="fin-field">
          <span>Valor{referencia ? " (referência)" : ""}</span>
          <input
            className="fin-input"
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="1.250,00"
          />
        </label>
        <label className="fin-field">
          <span>Dia do pagamento</span>
          <input
            className="fin-select"
            type="date"
            value={dia}
            min={hoje}
            onChange={(e) => setDia(e.target.value)}
          />
        </label>
        <label className="fin-field">
          <span>Favorecido</span>
          <input
            className="fin-input"
            list="fin-cap-adicionar-fav"
            value={contraparte}
            onChange={(e) => setContraparte(e.target.value)}
            placeholder="opcional · só cadastro existente"
          />
          <datalist id="fin-cap-adicionar-fav">
            {opcoes.contrapartes.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </label>
        <label className="fin-field">
          <span>Categoria</span>
          <select className="fin-select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Sem categoria</option>
            {categoriasGasto.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="fin-field fin-cap-adicionar-recorrencia">
          <legend>Tipo</legend>
          <label className="fin-cap-adicionar-radio">
            <input
              type="radio"
              name="fin-cap-recorrencia"
              checked={recorrencia === "unica"}
              onChange={() => setRecorrencia("unica")}
            />
            Único neste mês
          </label>
          <label className="fin-cap-adicionar-radio">
            <input
              type="radio"
              name="fin-cap-recorrencia"
              checked={recorrencia === "mensal"}
              onChange={() => setRecorrencia("mensal")}
            />
            Mensal (12 competências)
          </label>
        </fieldset>
      </div>

      <div className="fin-cap-adicionar-anexo">
        <div className="fin-cap-adicionar-anexo-cab">
          <span>
            <Paperclip size={13} strokeWidth={2.2} aria-hidden /> Cobrança (boleto, NF-e, PDF, foto)
          </span>
          <select
            className="fin-select fin-cap-adicionar-kind"
            value={kindAnexo}
            onChange={(e) => setKindAnexo(e.target.value as "boleto" | "nota_fiscal")}
            aria-label="Tipo do anexo"
          >
            <option value="boleto">Boleto / PIX / cobrança</option>
            <option value="nota_fiscal">NF-e / nota</option>
          </select>
        </div>
        <input
          ref={inputAnexo}
          type="file"
          accept="application/pdf,image/*,.xml,text/xml"
          className="fin-cap-adicionar-file"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setAnexo(f);
            setLeituraAnexo(null);
          }}
        />
        {anexo ? (
          <p className="fin-cap-adicionar-aviso">
            {anexo.name} · {(anexo.size / 1024).toFixed(0)} KB
            {vincularChave ? " · vai vincular à obrigação encontrada" : " · anexa após criar"}
          </p>
        ) : null}
        {leituraAnexo ? <p className="fin-cap-adicionar-ref">{leituraAnexo}</p> : null}
      </div>

      {contraparte.trim() && !casada ? (
        <p className="fin-cap-adicionar-aviso" role="note">
          “{contraparte.trim()}” não está no cadastro — o item nasce sem
          favorecido. Cadastre o PIX depois, ou escolha um nome da lista.
        </p>
      ) : null}
      {erro ? (
        <p className="fin-cap-erro" role="alert">
          {erro}
        </p>
      ) : null}
      <div className="fin-cap-adicionar-acoes">
        <button type="button" className="fin-btn-ghost" disabled={enviando} onClick={onCancelar}>
          Cancelar
        </button>
        {vincularChave && anexo ? (
          <button
            type="button"
            className="fin-btn-ghost"
            disabled={enviando}
            onClick={() => {
              void (async () => {
                setErro(null);
                setEnviando(true);
                try {
                  await anexarEm(vincularChave, anexo);
                  onCriado();
                } catch (e) {
                  setErro(e instanceof Error ? e.message : "não anexou");
                } finally {
                  setEnviando(false);
                }
              })();
            }}
          >
            {enviando ? "anexando…" : "Só anexar nesta obrigação"}
          </button>
        ) : null}
        <button type="button" className="fin-btn-primary" disabled={enviando} onClick={() => void salvar()}>
          {enviando
            ? "salvando…"
            : recorrencia === "mensal"
              ? "Salvar 12 meses"
              : "Salvar e listar"}
        </button>
      </div>
    </div>
  );
}
