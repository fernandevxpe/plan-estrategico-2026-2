"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import type { LotePreview, ResumoLote } from "@/lib/financeiro/importacao";
import { brlPrecise, dateLabel } from "@/lib/financeiro/format";

type Props = {
  contas: { id: number; slug: string; name: string; import_adapter: string }[];
  lotes: ResumoLote[];
};

/**
 * Importação de extrato.
 *
 * O arquivo NASCE NO CELULAR — é de lá que se exporta o extrato do Nubank. Se
 * conferir exigir uma mesa e dez cliques, a rotina diária fica mais longa que
 * colar na planilha e o módulo morre na segunda semana. Por isso:
 *
 *   · UM passo por padrão. Escolher arquivo → conferir saldo → confirmar. O
 *     passo de resolver duplicatas só aparece quando existe duplicata.
 *   · NADA de escolher formato. O parser é detectado; o usuário só corrige a
 *     conta quando o palpite estiver errado.
 *   · CLASSIFICAR NÃO ACONTECE AQUI. Os lançamentos entram pendentes e vão para
 *     a fila de revisão, no desktop, quando der.
 *   · DESFAZER SEMPRE VISÍVEL. É o que permite confirmar sem medo.
 */
export function FinImportWizard({ contas, lotes }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendente, startTransition] = useTransition();
  const [enviando, setEnviando] = useState(false);
  const [preview, setPreview] = useState<LotePreview | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<{ inseridos: number; batchId: number } | null>(null);
  const [conta, setConta] = useState("");
  const [verDuplicadas, setVerDuplicadas] = useState(false);

  async function enviarArquivo(arquivo: File) {
    setErro(null);
    setSucesso(null);
    setEnviando(true);
    try {
      const form = new FormData();
      form.append("file", arquivo);
      if (conta) form.append("conta", conta);
      const resposta = await fetch("/api/financeiro/importacoes", { method: "POST", body: form });
      const corpo = await resposta.json();
      if (!resposta.ok) {
        setErro(corpo.error ?? `falha no upload (HTTP ${resposta.status})`);
        return;
      }
      setPreview(corpo);
    } finally {
      setEnviando(false);
    }
  }

  async function decidir(rowId: number, acao: "forcar" | "ignorar" | "restaurar") {
    if (!preview) return;
    const resposta = await fetch(`/api/financeiro/importacoes/${preview.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, acao })
    });
    const corpo = await resposta.json();
    if (resposta.ok) setPreview(corpo);
    else setErro(corpo.error ?? "não consegui atualizar a linha");
  }

  async function confirmar(aceitarDivergencia = false) {
    if (!preview) return;
    setErro(null);
    const resposta = await fetch(`/api/financeiro/importacoes/${preview.id}/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aceitarDivergencia })
    });
    const corpo = await resposta.json();
    if (!resposta.ok) {
      setErro(corpo.error ?? "não consegui confirmar");
      return;
    }
    setSucesso(corpo);
    setPreview(null);
    startTransition(() => router.refresh());
  }

  async function reverter(batchId: number) {
    setErro(null);
    const resposta = await fetch(`/api/financeiro/importacoes/${batchId}/reverter`, { method: "POST" });
    const corpo = await resposta.json();
    if (!resposta.ok) setErro(corpo.error ?? "não consegui reverter");
    else startTransition(() => router.refresh());
  }

  async function descartar() {
    if (!preview) return;
    await fetch(`/api/financeiro/importacoes/${preview.id}`, { method: "DELETE" });
    setPreview(null);
    startTransition(() => router.refresh());
  }

  const divergente = preview?.saldo.divergenciaCents !== null && preview?.saldo.divergenciaCents !== 0;
  const novas = preview?.linhas.filter((linha) => linha.status === "novo" || linha.status === "forcado") ?? [];
  const duplicadas = preview?.linhas.filter((linha) => linha.status === "duplicado") ?? [];

  return (
    <>
      {erro ? (
        <div className="fin-alert" role="alert">
          {erro}
        </div>
      ) : null}

      {sucesso ? (
        <section className="card fin-import-sucesso">
          <h2 className="card-title">{sucesso.inseridos} lançamentos importados</h2>
          <p>
            Eles entraram sem categoria e já estão na fila de revisão — classificar acontece lá, não aqui.
          </p>
          <div className="fin-import-acoes">
            <Link className="fin-btn-primary" href="/financeiro/revisao">
              Ir para a revisão
            </Link>
            <button type="button" className="fin-btn-ghost" onClick={() => void reverter(sucesso.batchId)}>
              Desfazer esta importação
            </button>
          </div>
        </section>
      ) : null}

      {!preview ? (
        <section className="card fin-dropzone-card">
          <h2 className="card-title">Enviar extrato</h2>
          <p className="fin-card-hint">
            CSV do Nubank, CSV do Inter ou OFX (Inter e Caixa). O formato é detectado sozinho — não precisa escolher.
          </p>

          <label className="fin-field">
            <span>Conta (opcional — só se o palpite errar)</span>
            <select className="fin-select" value={conta} onChange={(evento) => setConta(evento.target.value)}>
              <option value="">detectar pela estrutura do arquivo</option>
              {contas.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,.ofx,.txt,text/csv,text/plain"
            className="fin-file-input"
            onChange={(evento) => {
              const arquivo = evento.target.files?.[0];
              if (arquivo) void enviarArquivo(arquivo);
            }}
          />
          <button
            type="button"
            className="fin-btn-upload"
            disabled={enviando}
            onClick={() => inputRef.current?.click()}
          >
            {enviando ? "Lendo o arquivo…" : "Escolher extrato"}
          </button>
        </section>
      ) : null}

      {preview ? (
        <section className="card">
          <h2 className="card-title">Conferência — {preview.conta?.nome ?? "conta não identificada"}</h2>
          <p className="fin-card-hint">
            {preview.arquivo} · {preview.adapter} · {dateLabel(preview.periodo.inicio)} a{" "}
            {dateLabel(preview.periodo.fim)}
          </p>

          <div className="fin-import-resumo">
            <div>
              <span className="fin-import-num">{preview.contagens.novos + preview.contagens.forcados}</span>
              <span>novos</span>
            </div>
            <div>
              <span className="fin-import-num">{preview.contagens.duplicados}</span>
              <span>já existiam</span>
            </div>
            <div>
              <span className="fin-import-num">{preview.contagens.total}</span>
              <span>linhas no arquivo</span>
            </div>
          </div>

          {/* A conferência de saldo é o único sinal de completude que existe.
              É ela que pega linha faltando antes de o dado envenenar o ledger. */}
          <div className={divergente ? "fin-import-saldo divergente" : "fin-import-saldo"}>
            <p>
              Saldo declarado pelo arquivo: <strong>{brlPrecise(preview.saldo.declaradoCents ?? 0)}</strong>
              {preview.saldo.declaradoCents === null ? " (o arquivo não informa)" : ""}
            </p>
            <p>
              Saldo que o ledger calcula: <strong>{brlPrecise(preview.saldo.calculadoCents ?? 0)}</strong>
            </p>
            {divergente ? (
              <p className="fin-import-divergencia">
                Diferença de <strong>{brlPrecise(preview.saldo.divergenciaCents ?? 0)}</strong> — pode faltar linha no
                arquivo. Confira antes de confirmar.
              </p>
            ) : (
              <p className="fin-import-ok">Bate exatamente.</p>
            )}
          </div>

          {preview.avisos.length ? (
            <ul className="fin-import-avisos">
              {preview.avisos.map((aviso) => (
                <li key={aviso}>{aviso}</li>
              ))}
            </ul>
          ) : null}

          {duplicadas.length ? (
            <details className="fin-import-dupes" open={verDuplicadas} onToggle={(e) => setVerDuplicadas(e.currentTarget.open)}>
              <summary>
                {duplicadas.length} linhas já existiam e ficam de fora — abrir para importar alguma mesmo assim
              </summary>
              <table className="fin-table">
                <tbody>
                  {duplicadas.map((linha) => (
                    <tr key={linha.id}>
                      <td className="fin-nowrap">{dateLabel(linha.postedOn)}</td>
                      <td>{linha.descricao}</td>
                      <td className="num fin-table-money">{brlPrecise(linha.amountCents ?? 0)}</td>
                      <td>
                        <button type="button" className="fin-btn-ghost" onClick={() => void decidir(linha.id, "forcar")}>
                          importar mesmo assim
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}

          <div className="table-wrap fin-import-preview">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th className="num">Valor</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {novas.slice(0, 60).map((linha) => (
                  <tr key={linha.id}>
                    <td className="fin-nowrap">{dateLabel(linha.postedOn)}</td>
                    <td>
                      {linha.descricao}
                      {linha.status === "forcado" ? <span className="fin-tag">forçada</span> : null}
                    </td>
                    <td
                      className={
                        (linha.amountCents ?? 0) >= 0 ? "num fin-table-money fin-in" : "num fin-table-money fin-out"
                      }
                    >
                      {brlPrecise(linha.amountCents ?? 0)}
                    </td>
                    <td>
                      <button type="button" className="fin-btn-ghost" onClick={() => void decidir(linha.id, "ignorar")}>
                        tirar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {novas.length > 60 ? <p className="fin-card-hint">…e mais {novas.length - 60} linhas.</p> : null}
          </div>

          <div className="fin-import-acoes">
            <button
              type="button"
              className="fin-btn-primary"
              disabled={pendente || !novas.length}
              onClick={() => void confirmar(divergente)}
            >
              {divergente
                ? `Confirmar mesmo com a diferença (${novas.length})`
                : `Confirmar ${novas.length} lançamentos`}
            </button>
            <button type="button" className="fin-btn-ghost" onClick={() => void descartar()}>
              Descartar
            </button>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2 className="card-title">Importações anteriores</h2>
        {lotes.length ? (
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Conta</th>
                  <th>Período</th>
                  <th className="num">Lançamentos</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lotes.map((lote) => (
                  <tr key={lote.id}>
                    <td>{lote.arquivo ?? `lote #${lote.id}`}</td>
                    <td>{lote.contaNome ?? "—"}</td>
                    <td className="fin-nowrap">
                      {dateLabel(lote.periodo.inicio)} – {dateLabel(lote.periodo.fim)}
                    </td>
                    <td className="num">{lote.contagens.inseridos}</td>
                    <td>
                      <span className={lote.status === "confirmado" ? "fin-badge-ok" : "fin-badge-atencao"}>
                        {lote.status}
                      </span>
                    </td>
                    <td>
                      {lote.status === "confirmado" ? (
                        <button type="button" className="fin-btn-ghost" onClick={() => void reverter(lote.id)}>
                          reverter
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="fin-card-hint">
            Nenhum extrato importado ainda. Hoje o ledger tem 100% da receita (pelo Asaas) e nenhuma despesa — é este
            upload que fecha esse buraco.
          </p>
        )}
      </section>
    </>
  );
}
