"use client";

import { useCallback, useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { brl } from "@/components/financeiro/Certeza";
import type { ComissaoDeclaradaLinha, ProlaboreEsperadoLinha, SalarioBaseLinha } from "@/lib/financeiro/pessoa-perfil";
import { urlDaOrigem } from "@/lib/url-origem";

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

function IconeMais() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
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
  formulario,
  // Salário-base e pró-labore têm UM valor vigente: mexer neles é editar.
  // Comissão não — várias no mesmo mês somam, e o que o botão faz é LANÇAR
  // mais uma. Com o lápis de "Editar" nos três, a ação de acrescentar
  // comissão não tinha nome em lugar nenhum da tela.
  acao = "editar"
}: {
  rotulo: string;
  valor: ReactNode;
  detalhe?: string | null;
  cor?: string;
  historico?: ReactNode;
  editando: boolean;
  onEditar: () => void;
  formulario?: ReactNode;
  acao?: "editar" | "lancar";
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
          <button
            type="button"
            className="pp-btn-icone"
            onClick={onEditar}
            aria-label={acao === "lancar" ? `Lançar ${rotulo.toLowerCase()}` : `Editar ${rotulo.toLowerCase()}`}
            title={acao === "lancar" ? `Lançar ${rotulo.toLowerCase()}` : "Editar"}
          >
            {acao === "lancar" ? <IconeMais /> : <IconeLapis />}
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
  historico = [],
  onSalvo
}: {
  personId: number;
  atual: SalarioBaseLinha | null;
  historico?: SalarioBaseLinha[];
  onSalvo?: () => void;
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
    const r = await fetch(urlDaOrigem(`/api/financeiro/pessoas/${personId}/salario-base`), {
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
    onSalvo?.();
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
  historico = [],
  onSalvo
}: {
  personId: number;
  atual: ProlaboreEsperadoLinha | null;
  historico?: ProlaboreEsperadoLinha[];
  onSalvo?: () => void;
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
    const r = await fetch(urlDaOrigem(`/api/financeiro/pessoas/${personId}/prolabore-esperado`), {
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
    onSalvo?.();
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
  historico = [],
  onSalvo
}: {
  personId: number;
  temSalarioBase: boolean;
  comissaoAtual: ComissaoDeclaradaLinha | null;
  historico?: ComissaoDeclaradaLinha[];
  onSalvo?: () => void;
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
    // Campo VAZIO e campo com "0,00" precisam ser coisas diferentes: zero é a
    // declaração de que não houve comissão no mês, e recusá-lo foi o que fez
    // quatro lançamentos de R$ 0,01 entrarem na base em 29/08/2026.
    const digitos = valor.replace(/\D/g, "");
    if (!digitos) return setErro("informe um valor — use 0,00 para declarar que não houve comissão no mês");
    const valorCents = Number(digitos);
    // A descrição não barra mais: vazia, o servidor grava "Sem comissão no mês"
    // ou "Comissão".

    setSalvando(true);
    const r = await fetch(urlDaOrigem(`/api/financeiro/pessoas/${personId}/comissao`), {
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
    onSalvo?.();
    startTransition(() => router.refresh());
  }

  return (
    <ChipRemuneracao
      rotulo="Comissão"
      cor="var(--nat-comissao)"
      valor={comissaoAtual ? brl(comissaoAtual.valorCents) : "—"}
      detalhe={comissaoAtual ? comissaoAtual.competencia : temSalarioBase ? "mês a mês" : "defina salário-base antes"}
      editando={aberto}
      acao="lancar"
      onEditar={() => setAberto((v) => !v)}
      historico={historico.length > 0 ? <HistoricoComissao historico={historico} /> : null}
      formulario={
        <form className="pp-remuneracao-form" onSubmit={salvar}>
          {!temSalarioBase ? (
            <p className="pp-remuneracao-aviso">Defina o salário-base primeiro — sem ele a comissão não separa do PIX.</p>
          ) : null}
          <p className="pp-remuneracao-aviso">
            Cada lançamento ACRESCENTA — duas comissões no mesmo mês somam. Use <strong>0,00</strong> para declarar que
            não houve comissão (é diferente de deixar o mês em branco). Para parcelar, use{" "}
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
            <input
              className="fin-input"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ex.: comissão obra X (opcional)"
            />
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

// ---------------------------------------------------------------------------
// Confirmar um mês à mão (0171)
// ---------------------------------------------------------------------------

const NATUREZA_ROTULO_MES: Record<string, string> = {
  comissao: "Comissão",
  reembolso: "Reembolso",
  estagio: "Estágio",
  encargo_beneficio: "Encargos",
  extra: "Extra"
};

type ResumoMes = {
  mes: string;
  totalCents: number;
  outrasNaturezas: { natureza: string; valorCents: number }[];
  outrasCents: number;
  salarioSugeridoCents: number;
  prolaboreSugeridoCents: number;
  disponivelParaSalarioProlaboreCents: number;
  ajuste: { salarioCents: number; prolaboreCents: number; nota: string; confirmadoPor: string; atualizadoEm: string } | null;
};

/**
 * A TELA DE CONFERÊNCIA — total real de um lado, edição do outro.
 *
 * Comissão e reembolso aparecem aqui só como LEITURA, com link para onde de
 * fato se editam (`/financeiro/comissoes`, `/financeiro/reembolsos`) — abrir
 * edição livre duplicaria a fonte da verdade dessas duas naturezas, que já têm
 * histórico e parcelamento próprios. Salário e pró-labore são o que fica
 * editável aqui, porque são o que NÃO tem outro lugar para confirmar.
 *
 * A checagem soma ao vivo, no cliente, a cada tecla — mas quem decide de
 * verdade é a rota (mesma conta, feita de novo do lado do servidor): o botão
 * salvar fica desabilitado quando a soma não bate, e a mensagem de erro do
 * servidor é a mesma se alguém tentar burlar o desabilitado.
 */
export function FinAjusteMesForm({ personId, meses }: { personId: number; meses: string[] }) {
  const router = useRouter();
  const [mes, setMes] = useState(meses[0] ?? "");
  const [dados, setDados] = useState<ResumoMes | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [salario, setSalario] = useState("");
  const [prolabore, setProlabore] = useState("");
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [ok, setOk] = useState(false);
  const [, startTransition] = useTransition();

  const carregar = useCallback(async (mesEscolhido: string) => {
    if (!mesEscolhido) return;
    setCarregando(true);
    setErro(null);
    setOk(false);
    const r = await fetch(urlDaOrigem(`/api/financeiro/pessoas/${personId}/mes-ajuste?mes=${mesEscolhido}`), {
      cache: "no-store"
    });
    const j = (await r.json().catch(() => null)) as ResumoMes | null;
    setCarregando(false);
    if (!r.ok || !j) return setErro("não consegui carregar este mês");
    setDados(j);
    setSalario((j.salarioSugeridoCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
    setProlabore((j.prolaboreSugeridoCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
    setNota(j.ajuste?.nota ?? "");
  }, [personId]);

  useEffect(() => {
    void carregar(mes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes]);

  const salarioCents = centavosDoTexto(salario);
  const prolaboreCents = centavosDoTexto(prolabore);
  const somaCents = dados ? salarioCents + prolaboreCents + dados.outrasCents : 0;
  const diffCents = dados ? dados.totalCents - somaCents : 0;
  const bate = dados !== null && diffCents === 0;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!bate) return;
    if (!nota.trim()) return setErro("nota é obrigatória — o que foi conferido para chegar nesse número");

    setSalvando(true);
    setErro(null);
    const r = await fetch(urlDaOrigem(`/api/financeiro/pessoas/${personId}/mes-ajuste`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mes, salarioCents, prolaboreCents, nota: nota.trim() })
    });
    const j = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) return setErro(j.error ?? "não consegui salvar");

    setOk(true);
    startTransition(() => router.refresh());
  }

  return (
    <div className="pp-ajuste-mes">
      <div className="pp-ajuste-mes-topo">
        <h3>Conferir um mês</h3>
        <label className="pp-ajuste-mes-select">
          <span>Mês</span>
          <select className="fin-input" value={mes} onChange={(e) => setMes(e.target.value)}>
            {meses.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      {carregando ? <p className="pp-vazio">Carregando…</p> : null}

      {dados && !carregando ? (
        <form className="pp-remuneracao-form" onSubmit={salvar}>
          <div className="pp-ajuste-total">
            <span>Total real no banco em {dados.mes}</span>
            <strong>{brl(dados.totalCents)}</strong>
          </div>

          {dados.ajuste ? (
            <p className="pp-remuneracao-explicacao">
              Já confirmado por {dados.ajuste.confirmadoPor} em {dados.ajuste.atualizadoEm.split(" ")[0].split("-").reverse().join("/")}
              {dados.ajuste.nota ? `: "${dados.ajuste.nota}"` : ""}
            </p>
          ) : (
            <p className="pp-remuneracao-explicacao">Ainda não confirmado — os campos abaixo mostram o palpite atual da fórmula.</p>
          )}

          <div className="pp-remuneracao-campos">
            <label>
              <span>Salário</span>
              <input className="fin-input" value={salario} onChange={(e) => setSalario(mascaraDinheiro(e.target.value))} inputMode="numeric" />
            </label>
            <label>
              <span>Pró-labore</span>
              <input className="fin-input" value={prolabore} onChange={(e) => setProlabore(mascaraDinheiro(e.target.value))} inputMode="numeric" />
            </label>
          </div>

          {dados.outrasNaturezas.length > 0 ? (
            <ul className="pp-ajuste-outras">
              {dados.outrasNaturezas.map((n) => (
                <li key={n.natureza}>
                  <span>{NATUREZA_ROTULO_MES[n.natureza] ?? n.natureza}</span>
                  <strong>{brl(n.valorCents)}</strong>
                  <a
                    href={n.natureza === "comissao" ? "/financeiro/comissoes" : n.natureza === "reembolso" ? "/financeiro/reembolsos" : "#"}
                    className="pp-ajuste-outras-link"
                  >
                    editar lá
                  </a>
                </li>
              ))}
            </ul>
          ) : null}

          <div className={bate ? "pp-ajuste-check ok" : "pp-ajuste-check erro"}>
            {bate
              ? "Soma bate com o total real."
              : diffCents > 0
                ? `Faltam ${brl(diffCents)} para fechar o total.`
                : `Sobram ${brl(-diffCents)} além do total.`}
          </div>

          <label className="pp-remuneracao-nota">
            <span>Nota — o que foi conferido</span>
            <input
              className="fin-input"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ex.: PIX de 02/08 é o pró-labore fixo; o resto não tem explicação, fica como pró-labore"
            />
          </label>

          {erro ? <p className="pp-remuneracao-erro">{erro}</p> : null}
          {ok ? <p className="conta-pgto-ok">Confirmado.</p> : null}
          <div className="pp-remuneracao-acoes">
            <button type="submit" className="fin-btn-primary fin-btn-sm" disabled={!bate || salvando}>
              {salvando ? "Salvando…" : "Confirmar este mês"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
