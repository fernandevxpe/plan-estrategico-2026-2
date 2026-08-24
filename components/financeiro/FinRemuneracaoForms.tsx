"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { brl } from "@/components/financeiro/Certeza";
import type { ComissaoDeclaradaLinha, ProlaboreEsperadoLinha, SalarioBaseLinha } from "@/lib/financeiro/pessoa-perfil";

/**
 * Os dois formulários que fazem "definir salário atual" e "declarar comissão"
 * virar dado — não conversa perdida.
 *
 * SÃO DOIS COMPONENTES, NÃO UM: salário-base é VIGÊNCIA (vale a partir de uma
 * data, até a próxima mudança); comissão é COMPETÊNCIA (um valor por mês,
 * declarado mês a mês). Misturar os dois num formulário só faria a pessoa
 * confundir "quando isto entra em vigor" com "de que mês é isto".
 *
 * MÁSCARA DE DINHEIRO A PARTIR DOS CENTAVOS — mesma disciplina do app do time
 * (`mascaraDinheiro` em TimeApp.tsx): digitar "500000" vira R$ 5.000,00 sem
 * exigir que ninguém lembre da vírgula.
 */

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

export function FinSalarioBaseForm({ personId, atual }: { personId: number; atual: SalarioBaseLinha | null }) {
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
    if (!nota.trim()) return setErro("diga a origem do número — quem afirmou, e quando");

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
    <div className="pp-remuneracao-card">
      <div className="pp-remuneracao-topo">
        <div>
          <span className="pp-remuneracao-rotulo">Salário-base atual</span>
          {atual ? (
            <strong className="pp-remuneracao-valor">
              {brl(atual.valorCents)} <small>desde {atual.vigenteDesde.split("-").reverse().join("/")}</small>
            </strong>
          ) : (
            <strong className="pp-remuneracao-valor pp-remuneracao-vazio">Nenhum definido</strong>
          )}
        </div>
        <button type="button" className="fin-btn-primary" onClick={() => setAberto((v) => !v)}>
          {atual ? "Definir novo valor" : "Definir salário"}
        </button>
      </div>

      {aberto ? (
        <form className="pp-remuneracao-form" onSubmit={salvar}>
          <p className="pp-remuneracao-explicacao">
            Não substitui o valor antigo — cria uma vigência nova. Os meses já fechados continuam calculando com o
            que valia neles.
          </p>
          <div className="pp-remuneracao-campos">
            <label>
              <span>Valor mensal</span>
              <input
                className="fin-input"
                value={valor}
                onChange={(e) => setValor(mascaraDinheiro(e.target.value))}
                inputMode="numeric"
                placeholder="0,00"
              />
            </label>
            <label>
              <span>Vigente desde</span>
              <input className="fin-input" type="date" value={vigenteDesde} onChange={(e) => setVigenteDesde(e.target.value)} />
            </label>
          </div>
          <label className="pp-remuneracao-nota">
            <span>Nota — de onde vem este número</span>
            <input className="fin-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: combinado com o Fernando em 24/08/2026" />
          </label>
          {erro ? <p className="pp-remuneracao-erro">{erro}</p> : null}
          <div className="pp-remuneracao-acoes">
            <button type="submit" className="fin-btn-primary" disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" className="fin-btn-ghost" onClick={() => setAberto(false)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/**
 * PRÓ-LABORE ESPERADO — não é o pró-labore real.
 *
 * O pró-labore de um mês fechado é o resto por construção (0164/0165):
 * sobra depois de reembolso, salário-base e comissão, provada igual ao que
 * caiu na conta. Não dá para "definir" isso para o passado sem inventar
 * dinheiro que não existiu. O que dá para definir é uma EXPECTATIVA, para
 * projetar o mês seguinte — antes de qualquer transação existir.
 */
export function FinProlaboreEsperadoForm({ personId, atual }: { personId: number; atual: ProlaboreEsperadoLinha | null }) {
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
    if (!nota.trim()) return setErro("diga a origem do número — quem afirmou, e quando");

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
    <div className="pp-remuneracao-card">
      <div className="pp-remuneracao-topo">
        <div>
          <span className="pp-remuneracao-rotulo">Pró-labore esperado</span>
          {atual ? (
            <strong className="pp-remuneracao-valor">
              {brl(atual.valorCents)} <small>desde {atual.vigenteDesde.split("-").reverse().join("/")}</small>
            </strong>
          ) : (
            <strong className="pp-remuneracao-valor pp-remuneracao-vazio">Nenhum definido</strong>
          )}
        </div>
        <button type="button" className="fin-btn-primary" onClick={() => setAberto((v) => !v)}>
          {atual ? "Atualizar expectativa" : "Definir expectativa"}
        </button>
      </div>

      <p className="pp-remuneracao-explicacao" style={{ marginTop: atual || aberto ? 10 : 0 }}>
        Só usado para PREVER o mês seguinte — o pró-labore de meses já fechados continua sendo calculado pelo que
        sobrou de verdade, não por este número.
      </p>

      {aberto ? (
        <form className="pp-remuneracao-form" onSubmit={salvar}>
          <div className="pp-remuneracao-campos">
            <label>
              <span>Valor esperado por mês</span>
              <input
                className="fin-input"
                value={valor}
                onChange={(e) => setValor(mascaraDinheiro(e.target.value))}
                inputMode="numeric"
                placeholder="0,00"
              />
            </label>
            <label>
              <span>Vigente desde</span>
              <input className="fin-input" type="date" value={vigenteDesde} onChange={(e) => setVigenteDesde(e.target.value)} />
            </label>
          </div>
          <label className="pp-remuneracao-nota">
            <span>Nota — de onde vem este número</span>
            <input
              className="fin-input"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ex.: mediana dos últimos meses, combinado em 24/08/2026"
            />
          </label>
          {erro ? <p className="pp-remuneracao-erro">{erro}</p> : null}
          <div className="pp-remuneracao-acoes">
            <button type="submit" className="fin-btn-primary" disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" className="fin-btn-ghost" onClick={() => setAberto(false)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function FinComissaoForm({
  personId,
  temSalarioBase
}: {
  personId: number;
  temSalarioBase: boolean;
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
    if (!nota.trim()) return setErro("diga de onde veio o número");

    setSalvando(true);
    const r = await fetch(`/api/financeiro/pessoas/${personId}/comissao`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ valorCents, competencia, nota: nota.trim() })
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
    <div className="pp-remuneracao-card">
      <div className="pp-remuneracao-topo">
        <div>
          <span className="pp-remuneracao-rotulo">Comissão</span>
          <strong className="pp-remuneracao-valor pp-remuneracao-vazio">Declarada mês a mês, veja a tabela abaixo</strong>
        </div>
        <button type="button" className="fin-btn-primary" onClick={() => setAberto((v) => !v)}>
          Declarar comissão
        </button>
      </div>

      {!temSalarioBase ? (
        <p className="pp-remuneracao-aviso">
          Esta pessoa ainda não tem salário-base definido. Sem ele, a comissão declarada não aparece separada —
          o PIX inteiro continua contando como salário. Defina o salário-base primeiro.
        </p>
      ) : null}

      {aberto ? (
        <form className="pp-remuneracao-form" onSubmit={salvar}>
          <div className="pp-remuneracao-campos">
            <label>
              <span>Valor da comissão</span>
              <input
                className="fin-input"
                value={valor}
                onChange={(e) => setValor(mascaraDinheiro(e.target.value))}
                inputMode="numeric"
                placeholder="0,00"
              />
            </label>
            <label>
              <span>Mês</span>
              <input className="fin-input" type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
            </label>
          </div>
          <label className="pp-remuneracao-nota">
            <span>Nota — de onde vem este número</span>
            <input className="fin-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: planilha de comissionamento, linha da Audrey" />
          </label>
          {erro ? <p className="pp-remuneracao-erro">{erro}</p> : null}
          <div className="pp-remuneracao-acoes">
            <button type="submit" className="fin-btn-primary" disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" className="fin-btn-ghost" onClick={() => setAberto(false)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function TabelaSalarioBase({ historico }: { historico: SalarioBaseLinha[] }) {
  if (historico.length === 0) return null;
  return (
    <div className="pp-tabela-caixa">
      <table className="pp-tabela">
        <thead>
          <tr>
            <th scope="col">Vigente desde</th>
            <th scope="col" className="num">Valor</th>
            <th scope="col">Nota</th>
          </tr>
        </thead>
        <tbody>
          {historico.map((h) => (
            <tr key={h.id}>
              <td className="num">{h.vigenteDesde.split("-").reverse().join("/")}</td>
              <td className="num">{brl(h.valorCents)}</td>
              <td className="pp-meta">{h.nota}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TabelaProlaboreEsperado({ historico }: { historico: ProlaboreEsperadoLinha[] }) {
  if (historico.length === 0) return null;
  return (
    <div className="pp-tabela-caixa">
      <table className="pp-tabela">
        <thead>
          <tr>
            <th scope="col">Vigente desde</th>
            <th scope="col" className="num">Valor</th>
            <th scope="col">Nota</th>
          </tr>
        </thead>
        <tbody>
          {historico.map((h) => (
            <tr key={h.id}>
              <td className="num">{h.vigenteDesde.split("-").reverse().join("/")}</td>
              <td className="num">{brl(h.valorCents)}</td>
              <td className="pp-meta">{h.nota}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A CALCULADORA — soma o que já foi definido, para o mês seguinte.
 *
 * DUAS SOMAS, NÃO UMA: "Salário + Pró-labore" é o fixo esperado, o que dá
 * para contar mesmo sem venda nem comissão nenhuma. "+ Comissão" soma em cima
 * a comissão já declarada PARA O MÊS SEGUINTE especificamente — não a mais
 * recente qualquer, senão a calculadora prometeria em agosto um número que
 * era de julho.
 *
 * Cada parcela ausente aparece como "— (não definido)" em vez de contar como
 * zero silenciosamente: a soma de baixo existir não pode esconder que falta
 * uma peça.
 */
export function FinCalculadoraRemuneracao({
  salarioBaseAtual,
  prolaboreEsperadoAtual,
  comissaoDeclarada
}: {
  salarioBaseAtual: SalarioBaseLinha | null;
  prolaboreEsperadoAtual: ProlaboreEsperadoLinha | null;
  comissaoDeclarada: ComissaoDeclaradaLinha[];
}) {
  const hoje = new Date();
  const proximoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
  const competenciaProxima = `${proximoMes.getFullYear()}-${String(proximoMes.getMonth() + 1).padStart(2, "0")}`;
  const comissaoProxima = comissaoDeclarada.find((c) => c.competencia === competenciaProxima) ?? null;

  const salario = salarioBaseAtual?.valorCents ?? null;
  const prolabore = prolaboreEsperadoAtual?.valorCents ?? null;
  const comissao = comissaoProxima?.valorCents ?? null;

  const linha = (v: number | null) => (v === null ? "— (não definido)" : brl(v));
  const somaOuNull = (...vs: (number | null)[]) => (vs.some((v) => v === null) ? null : vs.reduce((a, b) => a! + b!, 0));

  const somaFixa = somaOuNull(salario, prolabore);
  const somaComComissao = somaOuNull(salario, prolabore, comissao ?? 0);

  const mesNome = proximoMes.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="pp-calc">
      <h3>Previsão de {mesNome}</h3>
      <dl className="pp-calc-linhas">
        <div>
          <dt>Salário-base</dt>
          <dd>{linha(salario)}</dd>
        </div>
        <div>
          <dt>+ Pró-labore esperado</dt>
          <dd>{linha(prolabore)}</dd>
        </div>
        <div className="pp-calc-total">
          <dt>= Salário + Pró-labore</dt>
          <dd>{somaFixa === null ? "— falta definir algum dos dois" : brl(somaFixa)}</dd>
        </div>
        <div>
          <dt>+ Comissão de {mesNome}</dt>
          <dd>{comissaoProxima ? brl(comissaoProxima.valorCents) : "— (nenhuma declarada ainda para este mês)"}</dd>
        </div>
        <div className="pp-calc-total pp-calc-total-final">
          <dt>= Salário + Pró-labore + Comissão</dt>
          <dd>{somaComComissao === null ? "— falta definir salário ou pró-labore" : brl(somaComComissao)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function TabelaComissao({ historico }: { historico: ComissaoDeclaradaLinha[] }) {
  if (historico.length === 0) {
    return <p className="pp-vazio">Nenhuma comissão declarada ainda.</p>;
  }
  return (
    <div className="pp-tabela-caixa">
      <table className="pp-tabela">
        <thead>
          <tr>
            <th scope="col">Mês</th>
            <th scope="col" className="num">Valor</th>
            <th scope="col">Nota</th>
          </tr>
        </thead>
        <tbody>
          {historico.map((h) => (
            <tr key={h.id}>
              <td className="num">{h.competencia}</td>
              <td className="num">{brl(h.valorCents)}</td>
              <td className="pp-meta">{h.nota}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
