"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { brl } from "@/components/financeiro/Certeza";
import type { ComissaoDeclaradaLinha, ProlaboreEsperadoLinha, SalarioBaseLinha } from "@/lib/financeiro/pessoa-perfil";

function mascaraDinheiro(bruto: string): string {
  const digitos = bruto.replace(/\D/g, "").slice(0, 11);
  if (!digitos) return "";
  const n = Number(digitos) / 100;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const centavosDoTexto = (v: string) => Number(v.replace(/\D/g, "") || 0);

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function mesAtualISO(): string {
  return new Date().toISOString().slice(0, 7);
}

function dataCurta(iso: string) {
  return iso.split("-").reverse().join("/");
}

function IconeLapis() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function ChipRemuneracao({
  rotulo,
  valor,
  detalhe,
  cor,
  historico,
  editando,
  onEditar,
  formulario
}: {
  rotulo: string;
  valor: ReactNode;
  detalhe?: string | null;
  cor?: string;
  historico?: ReactNode;
  editando: boolean;
  onEditar: () => void;
  formulario?: ReactNode;
}) {
  const [histAberto, setHistAberto] = useState(false);
  const temHistorico = Boolean(historico);

  return (
    <article className="pp-chip" style={cor ? { ["--pp-chip-cor" as string]: cor } : undefined}>
      <div className="pp-chip-topo">
        <div className="pp-chip-corpo">
          <span className="pp-chip-rotulo">{rotulo}</span>
          <strong className="pp-chip-valor">{valor}</strong>
          {detalhe ? <span className="pp-chip-detalhe">{detalhe}</span> : null}
        </div>
        <div className="pp-chip-acoes">
          <button type="button" className="pp-btn-icone" onClick={onEditar} aria-label={`Editar ${rotulo.toLowerCase()}`} title="Editar">
            <IconeLapis />
          </button>
          {temHistorico ? (
            <button
              type="button"
              className="pp-btn-icone"
              onClick={() => setHistAberto((v) => !v)}
              aria-expanded={histAberto}
              aria-label={histAberto ? "Ocultar histórico" : "Ver histórico"}
              title="Histórico"
            >
              {histAberto ? "▴" : "▾"}
            </button>
          ) : null}
        </div>
      </div>
      {editando && formulario ? <div className="pp-chip-form">{formulario}</div> : null}
      {histAberto && historico ? <div className="pp-chip-hist">{historico}</div> : null}
    </article>
  );
}

function FormSalvar({
  campos,
  erro,
  salvando,
  onCancelar
}: {
  campos: ReactNode;
  erro: string | null;
  salvando: boolean;
  onCancelar: () => void;
}) {
  return (
    <>
      {campos}
      {erro ? <p className="pp-remuneracao-erro">{erro}</p> : null}
      <div className="pp-remuneracao-acoes">
        <button type="submit" className="fin-btn-primary fin-btn-sm" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        <button type="button" className="fin-btn-ghost fin-btn-sm" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </>
  );
}

export function FinSalarioBaseForm({
  personId,
  atual,
  historico = []
}: {
  personId: number;
  atual: SalarioBaseLinha | null;
  historico?: SalarioBaseLinha[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState("");
  const [vigenteDesde, setVigenteDesde] = useState(hojeISO());
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [, startTransition] = useTransition();

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const valorCents = centavosDoTexto(valor);
    if (valorCents <= 0) return setErro("informe um valor maior que zero");
    if (!nota.trim()) return setErro("diga a origem do número");

    setSalvando(true);
    const r = await fetch(`/api/financeiro/pessoas/${personId}/salario-base`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ valorCents, vigenteDesde, nota: nota.trim() })
    });
    const j = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) return setErro(j.error ?? "não consegui salvar");

    setAberto(false);
    setValor("");
    setNota("");
    startTransition(() => router.refresh());
  }

  return (
    <ChipRemuneracao
      rotulo="Salário-base"
      cor="var(--nat-salario)"
      valor={atual ? brl(atual.valorCents) : "—"}
      detalhe={atual ? `desde ${dataCurta(atual.vigenteDesde)}` : "não definido"}
      editando={aberto}
      onEditar={() => setAberto((v) => !v)}
      historico={historico.length > 1 ? <HistoricoSalarioBase historico={historico} /> : null}
      formulario={
        <form className="pp-remuneracao-form" onSubmit={salvar}>
          <div className="pp-remuneracao-campos">
            <label>
              <span>Valor mensal</span>
              <input className="fin-input" value={valor} onChange={(e) => setValor(mascaraDinheiro(e.target.value))} inputMode="numeric" placeholder="0,00" />
            </label>
            <label>
              <span>Vigente desde</span>
              <input className="fin-input" type="date" value={vigenteDesde} onChange={(e) => setVigenteDesde(e.target.value)} />
            </label>
          </div>
          <label className="pp-remuneracao-nota">
            <span>Nota</span>
            <input className="fin-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: combinado em 24/08/2026" />
          </label>
          <FormSalvar campos={null} erro={erro} salvando={salvando} onCancelar={() => setAberto(false)} />
        </form>
      }
    />
  );
}

export function FinProlaboreEsperadoForm({
  personId,
  atual,
  historico = []
}: {
  personId: number;
  atual: ProlaboreEsperadoLinha | null;
  historico?: ProlaboreEsperadoLinha[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState("");
  const [vigenteDesde, setVigenteDesde] = useState(hojeISO());
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [, startTransition] = useTransition();

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const valorCents = centavosDoTexto(valor);
    if (valorCents <= 0) return setErro("informe um valor maior que zero");
    if (!nota.trim()) return setErro("diga a origem do número");

    setSalvando(true);
    const r = await fetch(`/api/financeiro/pessoas/${personId}/prolabore-esperado`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ valorCents, vigenteDesde, nota: nota.trim() })
    });
    const j = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) return setErro(j.error ?? "não consegui salvar");

    setAberto(false);
    setValor("");
    setNota("");
    startTransition(() => router.refresh());
  }

  return (
    <ChipRemuneracao
      rotulo="Pró-labore esperado"
      cor="var(--nat-recorrente)"
      valor={atual ? brl(atual.valorCents) : "—"}
      detalhe={atual ? `desde ${dataCurta(atual.vigenteDesde)}` : "só previsão"}
      editando={aberto}
      onEditar={() => setAberto((v) => !v)}
      historico={historico.length > 1 ? <HistoricoProlaboreEsperado historico={historico} /> : null}
      formulario={
        <form className="pp-remuneracao-form" onSubmit={salvar}>
          <div className="pp-remuneracao-campos">
            <label>
              <span>Valor esperado</span>
              <input className="fin-input" value={valor} onChange={(e) => setValor(mascaraDinheiro(e.target.value))} inputMode="numeric" placeholder="0,00" />
            </label>
            <label>
              <span>Vigente desde</span>
              <input className="fin-input" type="date" value={vigenteDesde} onChange={(e) => setVigenteDesde(e.target.value)} />
            </label>
          </div>
          <label className="pp-remuneracao-nota">
            <span>Nota</span>
            <input className="fin-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: mediana dos últimos meses" />
          </label>
          <FormSalvar campos={null} erro={erro} salvando={salvando} onCancelar={() => setAberto(false)} />
        </form>
      }
    />
  );
}

export function FinComissaoForm({
  personId,
  temSalarioBase,
  comissaoAtual,
  historico = []
}: {
  personId: number;
  temSalarioBase: boolean;
  comissaoAtual: ComissaoDeclaradaLinha | null;
  historico?: ComissaoDeclaradaLinha[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState("");
  const [competencia, setCompetencia] = useState(mesAtualISO());
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [, startTransition] = useTransition();

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const valorCents = centavosDoTexto(valor);
    if (valorCents <= 0) return setErro("informe um valor maior que zero");
    if (!nota.trim()) return setErro("descrição obrigatória — a que se refere?");

    setSalvando(true);
    const r = await fetch(`/api/financeiro/pessoas/${personId}/comissao`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ valorCents, competencia, descricao: nota.trim(), nota: nota.trim() })
    });
    const j = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) return setErro(j.error ?? "não consegui salvar");

    setAberto(false);
    setValor("");
    setNota("");
    startTransition(() => router.refresh());
  }

  return (
    <ChipRemuneracao
      rotulo="Comissão"
      cor="var(--nat-comissao)"
      valor={comissaoAtual ? brl(comissaoAtual.valorCents) : "—"}
      detalhe={comissaoAtual ? comissaoAtual.competencia : temSalarioBase ? "mês a mês" : "defina salário-base antes"}
      editando={aberto}
      onEditar={() => setAberto((v) => !v)}
      historico={historico.length > 0 ? <HistoricoComissao historico={historico} /> : null}
      formulario={
        <form className="pp-remuneracao-form" onSubmit={salvar}>
          {!temSalarioBase ? (
            <p className="pp-remuneracao-aviso">Defina o salário-base primeiro — sem ele a comissão não separa do PIX.</p>
          ) : null}
          <p className="pp-remuneracao-aviso">
            Para várias no mês ou parcelar, use{" "}
            <a href="/financeiro/comissoes">Comissões</a>.
          </p>
          <div className="pp-remuneracao-campos">
            <label>
              <span>Valor</span>
              <input className="fin-input" value={valor} onChange={(e) => setValor(mascaraDinheiro(e.target.value))} inputMode="numeric" placeholder="0,00" />
            </label>
            <label>
              <span>Mês</span>
              <input className="fin-input" type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
            </label>
          </div>
          <label className="pp-remuneracao-nota">
            <span>Descrição</span>
            <input className="fin-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: comissão obra X" />
          </label>
          <FormSalvar campos={null} erro={erro} salvando={salvando} onCancelar={() => setAberto(false)} />
        </form>
      }
    />
  );
}

function TabelaHistoricoCompacta({
  colunas,
  linhas
}: {
  colunas: string[];
  linhas: { id: number; cells: ReactNode[] }[];
}) {
  if (linhas.length === 0) return null;
  return (
    <table className="pp-tabela pp-tabela-compacta">
      <thead>
        <tr>
          {colunas.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => (
          <tr key={l.id}>
            {l.cells.map((cell, i) => (
              <td key={i} className={i > 0 && i < l.cells.length - 1 ? "num" : undefined}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HistoricoSalarioBase({ historico }: { historico: SalarioBaseLinha[] }) {
  return (
    <TabelaHistoricoCompacta
      colunas={["Desde", "Valor", "Nota"]}
      linhas={historico.map((h) => ({
        id: h.id,
        cells: [dataCurta(h.vigenteDesde), brl(h.valorCents), h.nota ?? "—"]
      }))}
    />
  );
}

export function HistoricoProlaboreEsperado({ historico }: { historico: ProlaboreEsperadoLinha[] }) {
  return (
    <TabelaHistoricoCompacta
      colunas={["Desde", "Valor", "Nota"]}
      linhas={historico.map((h) => ({
        id: h.id,
        cells: [dataCurta(h.vigenteDesde), brl(h.valorCents), h.nota ?? "—"]
      }))}
    />
  );
}

export function HistoricoComissao({ historico }: { historico: ComissaoDeclaradaLinha[] }) {
  if (historico.length === 0) return <p className="pp-vazio">Nenhuma comissão declarada.</p>;
  return (
    <TabelaHistoricoCompacta
      colunas={["Mês", "Valor", "Descrição"]}
      linhas={historico.map((h) => ({
        id: h.id,
        cells: [h.competencia, brl(h.valorCents), h.descricao || h.nota || "—"]
      }))}
    />
  );
}

export function FinCalculadoraRemuneracao({
  salarioBaseAtual,
  prolaboreEsperadoAtual,
  comissaoDeclarada,
  reembolsoPrevistoProximoMesCents,
  compacto = false
}: {
  salarioBaseAtual: SalarioBaseLinha | null;
  prolaboreEsperadoAtual: ProlaboreEsperadoLinha | null;
  comissaoDeclarada: ComissaoDeclaradaLinha[];
  reembolsoPrevistoProximoMesCents: number;
  compacto?: boolean;
}) {
  const hoje = new Date();
  const proximoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
  const competenciaProxima = `${proximoMes.getFullYear()}-${String(proximoMes.getMonth() + 1).padStart(2, "0")}`;
  const comissaoProximaSoma = comissaoDeclarada
    .filter((c) => c.competencia === competenciaProxima)
    .reduce((s, c) => s + c.valorCents, 0);

  const salario = salarioBaseAtual?.valorCents ?? null;
  const prolabore = prolaboreEsperadoAtual?.valorCents ?? null;
  const comissao = comissaoProximaSoma > 0 ? comissaoProximaSoma : null;
  const reembolsoPrevisto = reembolsoPrevistoProximoMesCents;

  const somaOuNull = (...vs: (number | null)[]) => (vs.some((v) => v === null) ? null : vs.reduce((a, b) => a! + b!, 0));
  const somaFixa = somaOuNull(salario, prolabore);
  const somaComComissao = somaOuNull(salario, prolabore, comissao ?? 0);
  const somaComReembolso = somaComComissao === null ? null : somaComComissao + reembolsoPrevisto;

  const mesNome = proximoMes.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });

  if (compacto) {
    return (
      <article className="pp-chip pp-chip-calc">
        <span className="pp-chip-rotulo">Previsão {mesNome}</span>
        <strong className="pp-chip-valor">{somaComReembolso === null ? "—" : brl(somaComReembolso)}</strong>
        <span className="pp-chip-detalhe">
          {somaFixa === null ? "falta salário ou pró-labore" : `${brl(somaFixa)} fixo`}
          {comissao ? ` + ${brl(comissao)} comissão` : ""}
          {reembolsoPrevisto > 0 ? ` + ${brl(reembolsoPrevisto)} reembolso` : ""}
        </span>
      </article>
    );
  }

  return (
    <div className="pp-calc">
      <h3>Previsão de {proximoMes.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</h3>
      <dl className="pp-calc-linhas">
        <div>
          <dt>Salário-base</dt>
          <dd>{salario === null ? "—" : brl(salario)}</dd>
        </div>
        <div>
          <dt>+ Pró-labore esperado</dt>
          <dd>{prolabore === null ? "—" : brl(prolabore)}</dd>
        </div>
        <div className="pp-calc-total">
          <dt>= Fixo</dt>
          <dd>{somaFixa === null ? "—" : brl(somaFixa)}</dd>
        </div>
        <div>
          <dt>+ Comissão</dt>
          <dd>{comissao === null ? "—" : brl(comissao)}</dd>
        </div>
        <div>
          <dt>+ Reembolso previsto</dt>
          <dd>{reembolsoPrevisto > 0 ? brl(reembolsoPrevisto) : "—"}</dd>
        </div>
        <div className="pp-calc-total pp-calc-total-final">
          <dt>= Total previsto</dt>
          <dd>{somaComReembolso === null ? "—" : brl(somaComReembolso)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** @deprecated use HistoricoSalarioBase — mantido para imports antigos */
export function TabelaSalarioBase({ historico }: { historico: SalarioBaseLinha[] }) {
  return <HistoricoSalarioBase historico={historico} />;
}
export function TabelaProlaboreEsperado({ historico }: { historico: ProlaboreEsperadoLinha[] }) {
  return <HistoricoProlaboreEsperado historico={historico} />;
}
export function TabelaComissao({ historico }: { historico: ComissaoDeclaradaLinha[] }) {
  return <HistoricoComissao historico={historico} />;
}
