"use client";

import { MoreHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { brl } from "@/components/financeiro/Certeza";
import {
  FinCalculadoraRemuneracao,
  FinProlaboreEsperadoForm,
  FinSalarioBaseForm,
  HistoricoComissao
} from "@/components/financeiro/FinRemuneracaoForms";
import type { CadastroPrevisaoPessoa } from "@/lib/financeiro/cadastro-previsao-pessoa";
import { brlPrecise, monthKeyLabel } from "@/lib/financeiro/format";
import { urlDaOrigem } from "@/lib/url-origem";

const ROTULO_NAT: Record<string, string> = {
  salario: "Salário",
  prolabore: "Pró-labore",
  comissao: "Comissão",
  reembolso: "Reembolso",
  estagio: "Estágio",
  extra: "Extra"
};

function mascaraDinheiro(bruto: string): string {
  const digitos = bruto.replace(/\D/g, "").slice(0, 11);
  if (!digitos) return "";
  const n = Number(digitos) / 100;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const centavosDoTexto = (v: string) => Number(v.replace(/\D/g, "") || 0);

function paraCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(/\./g, "").replace(",", ".");
  if (!limpo) return null;
  const n = Number(limpo);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** Botão "…" na célula previsto — abre o popup de cadastro rápido. */
export function BotaoPrevisaoPessoa({
  personId,
  nome,
  mesPrevisto,
  previstoCents
}: {
  personId: number;
  nome: string;
  mesPrevisto: string;
  previstoCents: number;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button
        type="button"
        className="fin-previsao-pop-gatilho"
        onClick={() => setAberto(true)}
        aria-label={`Ver e editar previsão de ${nome}`}
        title="Ver cadastro e editar previsão"
      >
        <MoreHorizontal size={16} strokeWidth={2.2} aria-hidden />
      </button>
      {aberto ? (
        <FinPrevisaoPessoaPop
          personId={personId}
          nome={nome}
          mesPrevisto={mesPrevisto}
          previstoCents={previstoCents}
          onFechar={() => setAberto(false)}
        />
      ) : null}
    </>
  );
}

export function FinPrevisaoPessoaPop({
  personId,
  nome,
  mesPrevisto,
  previstoCents,
  onFechar
}: {
  personId: number;
  nome: string;
  mesPrevisto: string;
  previstoCents: number;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dados, setDados] = useState<CadastroPrevisaoPessoa | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [aba, setAba] = useState<"cadastro" | "comissao" | "reembolso">("cadastro");
  const [mostrarComissao, setMostrarComissao] = useState(false);
  const [mostrarReembolso, setMostrarReembolso] = useState(false);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const mes = mesPrevisto.slice(0, 7);
    const r = await fetch(urlDaOrigem(`/api/financeiro/pessoas/${personId}/cadastro-previsao?mes=${mes}`), {
      cache: "no-store"
    });
    const j = (await r.json().catch(() => null)) as CadastroPrevisaoPessoa | { error?: string } | null;
    setCarregando(false);
    if (!r.ok || !j || "error" in j) {
      setErro((j && "error" in j && j.error) || "não consegui carregar");
      return;
    }
    setDados(j as CadastroPrevisaoPessoa);
    startTransition(() => router.refresh());
  }, [personId, mesPrevisto, router, startTransition]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onFechar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFechar]);

  const comissaoProximaSoma = dados?.comissaoDoMes.reduce((s, c) => s + c.valorCents, 0) ?? 0;

  return (
    <div className="fin-previsao-pop-overlay" role="presentation" onClick={onFechar}>
      <div
        className="fin-previsao-pop"
        role="dialog"
        aria-modal="true"
        aria-label={`Previsão de ${nome}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="fin-previsao-pop-cabecalho">
          <div>
            <h2>{nome}</h2>
            <p className="fin-previsao-pop-meta">
              Previsto {monthKeyLabel(mesPrevisto)}
              {" · "}
              <strong>{dados ? brlPrecise(dados.previsaoTotalCents) : brlPrecise(previstoCents)}</strong>
              {dados?.vinculo ? ` · ${dados.vinculo}` : null}
            </p>
            {dados && Object.keys(dados.previsaoPorNatureza).length ? (
              <ul className="fin-previsao-pop-comp">
                {Object.entries(dados.previsaoPorNatureza).map(([nat, cents]) => (
                  <li key={nat}>
                    {ROTULO_NAT[nat] ?? nat}: {brlPrecise(cents)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <button type="button" className="fin-previsao-pop-fechar" onClick={onFechar} aria-label="Fechar">
            <X size={18} strokeWidth={2.2} />
          </button>
        </header>

        {carregando && !dados ? <p className="fin-previsao-pop-carregando">Carregando cadastro…</p> : null}
        {erro ? <p className="fin-previsao-pop-erro">{erro}</p> : null}

        {dados ? (
          <>
            <nav className="fin-previsao-pop-abas" aria-label="Seções do cadastro">
              <button type="button" className={aba === "cadastro" ? "ativo" : ""} onClick={() => setAba("cadastro")}>
                Fixo
              </button>
              <button type="button" className={aba === "comissao" ? "ativo" : ""} onClick={() => setAba("comissao")}>
                Comissão
                {comissaoProximaSoma ? ` · ${brlPrecise(comissaoProximaSoma)}` : ""}
              </button>
              <button type="button" className={aba === "reembolso" ? "ativo" : ""} onClick={() => setAba("reembolso")}>
                Reembolso
                {dados.reembolsoPrevistoMesCents ? ` · ${brlPrecise(dados.reembolsoPrevistoMesCents)}` : ""}
              </button>
            </nav>

            <div className="fin-previsao-pop-corpo">
              {aba === "cadastro" ? (
                <div className="pp-rem-grid fin-previsao-pop-grid">
                  <FinSalarioBaseForm
                    personId={dados.id}
                    atual={dados.salarioBaseAtual}
                    historico={dados.salarioBaseHistorico}
                    onSalvo={() => void recarregar()}
                  />
                  <FinProlaboreEsperadoForm
                    personId={dados.id}
                    atual={dados.prolaboreEsperadoAtual}
                    historico={dados.prolaboreEsperadoHistorico}
                    onSalvo={() => void recarregar()}
                  />
                  <FinCalculadoraRemuneracao
                    salarioBaseAtual={dados.salarioBaseAtual}
                    prolaboreEsperadoAtual={dados.prolaboreEsperadoAtual}
                    comissaoDeclarada={dados.comissaoHistorico}
                    reembolsoPrevistoProximoMesCents={dados.reembolsoPrevistoMesCents}
                    compacto
                  />
                </div>
              ) : null}

              {aba === "comissao" ? (
                <SecaoComissao
                  dados={dados}
                  mesPrevisto={mesPrevisto}
                  mostrarForm={mostrarComissao}
                  onToggleForm={() => setMostrarComissao((v) => !v)}
                  onSalvo={() => void recarregar()}
                />
              ) : null}

              {aba === "reembolso" ? (
                <SecaoReembolso
                  dados={dados}
                  mesPrevisto={mesPrevisto}
                  mostrarForm={mostrarReembolso}
                  onToggleForm={() => setMostrarReembolso((v) => !v)}
                  onSalvo={() => void recarregar()}
                />
              ) : null}
            </div>
          </>
        ) : null}

        <footer className="fin-previsao-pop-rodape">
          <a href={`/financeiro/pessoas/${personId}`} className="pp-link">
            Perfil completo
          </a>
          <span className="fin-previsao-pop-rodape-sep">·</span>
          <a href="/financeiro/comissoes" className="pp-link">
            Comissões
          </a>
          <span className="fin-previsao-pop-rodape-sep">·</span>
          <a href={`/financeiro/reembolsos?pessoa=${personId}`} className="pp-link">
            Reembolsos
          </a>
        </footer>
      </div>
    </div>
  );
}

function SecaoComissao({
  dados,
  mesPrevisto,
  mostrarForm,
  onToggleForm,
  onSalvo
}: {
  dados: CadastroPrevisaoPessoa;
  mesPrevisto: string;
  mostrarForm: boolean;
  onToggleForm: () => void;
  onSalvo: () => void;
}) {
  const mesChave = mesPrevisto.slice(0, 7);
  const totalMes = dados.comissaoDoMes.reduce((s, c) => s + c.valorCents, 0);

  return (
    <div className="fin-previsao-pop-secao">
      <div className="fin-previsao-pop-secao-topo">
        <div>
          <h3>Comissão — {monthKeyLabel(mesPrevisto)}</h3>
          <p className="fin-previsao-pop-secao-meta">
            {totalMes ? `Total ${brlPrecise(totalMes)}` : "Nada declarado neste mês"}
            {dados.comissaoSeries.length ? ` · ${dados.comissaoSeries.length} série(s) parcelada(s)` : ""}
          </p>
        </div>
        <button type="button" className="fin-btn-ghost fin-btn-sm" onClick={onToggleForm}>
          {mostrarForm ? "Fechar" : "+ Nova"}
        </button>
      </div>

      {dados.comissaoDoMes.length ? (
        <table className="fin-table fin-previsao-pop-tabela">
          <thead>
            <tr>
              <th>Descrição</th>
              <th className="num">Valor</th>
              <th>Parcela</th>
            </tr>
          </thead>
          <tbody>
            {dados.comissaoDoMes.map((c) => (
              <tr key={c.id}>
                <td>{c.descricao || c.nota || "—"}</td>
                <td className="num fin-table-money">{brlPrecise(c.valorCents)}</td>
                <td>
                  {c.competencia.slice(0, 7)}
                  {c.parcela && c.parcelasTotal ? ` · ${c.parcela}/${c.parcelasTotal}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="fin-previsao-pop-vazio">Nenhuma comissão para {monthKeyLabel(mesPrevisto)}.</p>
      )}

      {dados.comissaoSeries.length ? (
        <>
          <h4 className="fin-previsao-pop-subtitulo">Séries parceladas</h4>
          <table className="fin-table fin-previsao-pop-tabela">
            <thead>
              <tr>
                <th>Descrição</th>
                <th className="num">Total</th>
                <th className="num">Parcela</th>
                <th>Progresso</th>
              </tr>
            </thead>
            <tbody>
              {dados.comissaoSeries.map((s) => (
                <tr key={s.id}>
                  <td>{s.descricao}</td>
                  <td className="num fin-table-money">{brlPrecise(s.totalCents)}</td>
                  <td className="num fin-table-money">{brlPrecise(s.valorParcelaCents)}</td>
                  <td>
                    {s.parcelasLancadas}/{s.parcelasTotal}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {mostrarForm ? (
        <FormComissaoRapido personId={dados.id} mesPadrao={mesChave} onSalvo={onSalvo} onCancelar={onToggleForm} />
      ) : null}

      {dados.comissaoHistorico.length > dados.comissaoDoMes.length ? (
        <details className="fin-previsao-pop-detalhes">
          <summary>Histórico recente</summary>
          <HistoricoComissao historico={dados.comissaoHistorico.slice(0, 12)} />
        </details>
      ) : null}
    </div>
  );
}

function FormComissaoRapido({
  personId,
  mesPadrao,
  onSalvo,
  onCancelar
}: {
  personId: number;
  mesPadrao: string;
  onSalvo: () => void;
  onCancelar: () => void;
}) {
  const [modo, setModo] = useState<"avulsa" | "parcelada">("avulsa");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [competencia, setCompetencia] = useState(mesPadrao);
  const [parcelas, setParcelas] = useState("3");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!descricao.trim()) return setErro("descrição obrigatória");
    const valorCents = centavosDoTexto(valor);
    if (valorCents <= 0) return setErro("informe um valor maior que zero");

    const corpo =
      modo === "avulsa"
        ? { modo: "avulsa", personId, competencia, valorCents, descricao: descricao.trim() }
        : {
            modo: "parcelada",
            personId,
            primeiraCompetencia: competencia,
            totalCents: valorCents,
            parcelas: Number(parcelas),
            descricao: descricao.trim()
          };

    if (modo === "parcelada") {
      const n = Number(parcelas);
      if (!Number.isInteger(n) || n < 2) return setErro("mínimo 2 parcelas");
    }

    setSalvando(true);
    const r = await fetch(urlDaOrigem("/api/financeiro/comissoes"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo)
    });
    const j = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) return setErro(j.error ?? "não consegui salvar");
    onSalvo();
    onCancelar();
  }

  return (
    <form className="fin-previsao-pop-form" onSubmit={salvar}>
      <div className="fin-previsao-pop-form-linha">
        <label>
          <span>Modo</span>
          <select className="fin-select" value={modo} onChange={(e) => setModo(e.target.value as "avulsa" | "parcelada")}>
            <option value="avulsa">À vista (este mês)</option>
            <option value="parcelada">Parcelada (N meses iguais)</option>
          </select>
        </label>
        <label>
          <span>{modo === "avulsa" ? "Mês" : "Primeira parcela"}</span>
          <input className="fin-input" type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
        </label>
      </div>
      <label>
        <span>Descrição</span>
        <input className="fin-input" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: comissão obra X" />
      </label>
      <div className="fin-previsao-pop-form-linha">
        <label>
          <span>{modo === "avulsa" ? "Valor" : "Valor total"}</span>
          <input
            className="fin-input"
            value={valor}
            onChange={(e) => setValor(mascaraDinheiro(e.target.value))}
            inputMode="numeric"
            placeholder="0,00"
          />
        </label>
        {modo === "parcelada" ? (
          <label>
            <span>Parcelas</span>
            <input className="fin-input" inputMode="numeric" value={parcelas} onChange={(e) => setParcelas(e.target.value)} />
          </label>
        ) : null}
      </div>
      {modo === "parcelada" && valor && parcelas ? (
        <p className="fin-previsao-pop-form-hint">
          {parcelas}× de {brlPrecise(Math.floor(centavosDoTexto(valor) / Number(parcelas)))} (última absorve centavos)
        </p>
      ) : null}
      {erro ? <p className="fin-previsao-pop-erro">{erro}</p> : null}
      <div className="fin-previsao-pop-form-acoes">
        <button type="submit" className="fin-btn-primary fin-btn-sm" disabled={salvando}>
          {salvando ? "Salvando…" : "Confirmar"}
        </button>
        <button type="button" className="fin-btn-ghost fin-btn-sm" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function SecaoReembolso({
  dados,
  mesPrevisto,
  mostrarForm,
  onToggleForm,
  onSalvo
}: {
  dados: CadastroPrevisaoPessoa;
  mesPrevisto: string;
  mostrarForm: boolean;
  onToggleForm: () => void;
  onSalvo: () => void;
}) {
  const abertas = dados.reembolsoSeries.filter((s) => !s.quitado);

  return (
    <div className="fin-previsao-pop-secao">
      <div className="fin-previsao-pop-secao-topo">
        <div>
          <h3>Reembolsos</h3>
          <p className="fin-previsao-pop-secao-meta">
            Previsto {monthKeyLabel(mesPrevisto)}: {brlPrecise(dados.reembolsoPrevistoMesCents)}
            {" · "}
            Em aberto: {brl(dados.reembolsoAbertoCents)}
          </p>
        </div>
        <button type="button" className="fin-btn-ghost fin-btn-sm" onClick={onToggleForm}>
          {mostrarForm ? "Fechar" : "+ Novo"}
        </button>
      </div>

      {abertas.length ? (
        <table className="fin-table fin-previsao-pop-tabela">
          <thead>
            <tr>
              <th>Descrição</th>
              <th className="num">Parcela</th>
              <th>Progresso</th>
              <th className="num">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {abertas.map((s) => (
              <tr key={s.slug}>
                <td>
                  {s.descricao}
                  {s.categoria ? <span className="fin-desc-sub">{s.categoria}</span> : null}
                </td>
                <td className="num fin-table-money">{brlPrecise(s.valorParcelaCents)}</td>
                <td>
                  {s.parcela}/{s.parcelasTotal}
                  {s.parcelasRestantes > 0 ? ` · faltam ${s.parcelasRestantes}` : ""}
                </td>
                <td className="num fin-table-money">{brlPrecise(s.saldoCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="fin-previsao-pop-vazio">Nenhuma série em aberto — planilha antiga e app do time entram aqui ao cadastrar.</p>
      )}

      {dados.reembolsoSeries.some((s) => s.quitado) ? (
        <details className="fin-previsao-pop-detalhes">
          <summary>Séries quitadas ({dados.reembolsoSeries.filter((s) => s.quitado).length})</summary>
          <ul className="fin-previsao-pop-lista-quitadas">
            {dados.reembolsoSeries
              .filter((s) => s.quitado)
              .slice(0, 8)
              .map((s) => (
                <li key={s.slug}>
                  {s.descricao} · {brlPrecise(s.pagoCents)} pago
                </li>
              ))}
          </ul>
        </details>
      ) : null}

      {mostrarForm ? (
        <FormReembolsoRapido
          personId={dados.id}
          mesPadrao={mesPrevisto.slice(0, 7)}
          tipos={dados.tiposReembolso}
          onSalvo={onSalvo}
          onCancelar={onToggleForm}
        />
      ) : null}
    </div>
  );
}

function FormReembolsoRapido({
  personId,
  mesPadrao,
  tipos,
  onSalvo,
  onCancelar
}: {
  personId: number;
  mesPadrao: string;
  tipos: CadastroPrevisaoPessoa["tiposReembolso"];
  onSalvo: () => void;
  onCancelar: () => void;
}) {
  const [mes, setMes] = useState(mesPadrao);
  const [tipo, setTipo] = useState(tipos[0]?.slug ?? "");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [parcelado, setParcelado] = useState(false);
  const [parcelasTotal, setParcelasTotal] = useState("6");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const tipoAtual = tipos.find((t) => t.slug === tipo);
  const podeParcelar = tipoAtual?.allowsInstallment ?? false;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!descricao.trim()) return setErro("descrição obrigatória");
    const centavos = paraCentavos(valor.replace(/\./g, "").replace(",", ".")) ?? centavosDoTexto(valor);
    if (!centavos || centavos <= 0) return setErro("informe um valor maior que zero");

    setSalvando(true);
    const r = await fetch(urlDaOrigem("/api/financeiro/reembolsos"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        personId,
        referenceMonth: mes,
        tipo: tipo || null,
        descricao: descricao.trim(),
        valorCents: parcelado ? undefined : centavos,
        parcelado,
        parcelasTotal: parcelado ? Number(parcelasTotal) : undefined,
        parcelaCents: parcelado ? centavos : undefined
      })
    });
    const j = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) return setErro(j.error ?? "não consegui salvar");
    onSalvo();
    onCancelar();
  }

  return (
    <form className="fin-previsao-pop-form" onSubmit={salvar}>
      <div className="fin-previsao-pop-form-linha">
        <label>
          <span>Mês de referência</span>
          <input className="fin-input" type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
        </label>
        <label>
          <span>Tipo</span>
          <select className="fin-select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {tipos.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        <span>Descrição</span>
        <input className="fin-input" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: equipamento obra" />
      </label>
      <div className="fin-previsao-pop-form-linha">
        <label>
          <span>{parcelado ? "Valor da parcela" : "Valor"}</span>
          <input className="fin-input" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="284,91" />
        </label>
        {podeParcelar ? (
          <label className="fin-previsao-pop-check">
            <input type="checkbox" checked={parcelado} onChange={(e) => setParcelado(e.target.checked)} />
            <span>
              {parcelasTotal} parcelas iguais
              {parcelado ? (
                <input
                  className="fin-input fin-input-parcelas"
                  inputMode="numeric"
                  value={parcelasTotal}
                  onChange={(e) => setParcelasTotal(e.target.value)}
                  aria-label="Número de parcelas"
                />
              ) : null}
            </span>
          </label>
        ) : null}
      </div>
      {parcelado && valor ? (
        <p className="fin-previsao-pop-form-hint">
          Total {brlPrecise(centavosDoTexto(valor) * (Number(parcelasTotal) || 0))} em {parcelasTotal} meses
        </p>
      ) : null}
      {erro ? <p className="fin-previsao-pop-erro">{erro}</p> : null}
      <div className="fin-previsao-pop-form-acoes">
        <button type="submit" className="fin-btn-primary fin-btn-sm" disabled={salvando}>
          {salvando ? "Salvando…" : parcelado ? `Lançar ${parcelasTotal} parcelas` : "Lançar"}
        </button>
        <button type="button" className="fin-btn-ghost fin-btn-sm" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
