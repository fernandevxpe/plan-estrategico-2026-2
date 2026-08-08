"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { ContaLinha, Direcao, PainelContas } from "@/lib/financeiro/contas";
import { brlCents, brlPrecise, dateLabel, monthKeyLabel } from "@/lib/financeiro/format";

type Props = {
  pagar: PainelContas;
  receber: PainelContas;
  direcaoInicial: Direcao;
};

const ROTULO_FLEX: Record<string, string> = {
  fixo: "fixo",
  negociavel: "negociável",
  adiavel: "adiável"
};

const ROTULO_STATUS: Record<string, string> = {
  previsto: "previsto",
  emitido: "emitido",
  confirmado: "confirmado",
  parcial: "parcial",
  liquidado: "liquidado",
  estornado: "estornado",
  cancelado: "cancelado"
};

/** Centavos a partir de "1.350,00" / "1350,00" / "1350.00" / "1350". */
function paraCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(/[R$\s]/g, "");
  if (!limpo) return null;
  // pt-BR: o último separador é o decimal. "1.350,00" → 135000; "1350.00" → 135000.
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const valor = Number(normalizado);
  if (!Number.isFinite(valor)) return null;
  return Math.round(valor * 100);
}

function hojeIso() {
  const agora = new Date();
  return new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * Contas a pagar e a receber.
 *
 * Duas telas com a mesma forma e propósitos opostos. A de RECEBER é leitura: o
 * dado chega do Asaas e mexer nele à mão faria a conciliação divergir da fonte.
 * A de PAGAR é escrita — é a única superfície onde uma saída de caixa passa a
 * existir antes de acontecer.
 *
 * Por isso o estado vazio de "a pagar" não é uma frase cinza dizendo "nenhum
 * registro": é uma chamada para a ação que falta. Zero pagáveis num banco com
 * 3.350 recebíveis não é uma tabela vazia, é metade do fluxo de caixa faltando.
 *
 * Os filtros agem sobre os dados já carregados, e o rodapé de totais é
 * recalculado a partir das MESMAS linhas que a tabela mostra: um total que vem
 * do servidor enquanto a lista é filtrada no cliente é um total que mente.
 */
export function FinPayables({ pagar, receber, direcaoInicial }: Props) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [direcao, setDirecao] = useState<Direcao>(direcaoInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);

  // --- filtros ---
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [nucleo, setNucleo] = useState("");
  const [categoria, setCategoria] = useState("");
  const [favorecido, setFavorecido] = useState("");
  const [texto, setTexto] = useState("");

  const painel = direcao === "pagar" ? pagar : receber;

  const linhasFiltradas = useMemo(() => {
    const termo = texto.trim().toLowerCase();
    const alvo = favorecido.trim().toLowerCase();
    const todas = painel.grupos.flatMap((g) => g.linhas);
    return todas.filter((linha) => {
      if (de && linha.dueDate < de) return false;
      if (ate && linha.dueDate > ate) return false;
      if (nucleo && linha.nucleo !== nucleo) return false;
      if (categoria && linha.categoriaCode !== categoria) return false;
      if (alvo && !(linha.contraparte ?? "").toLowerCase().includes(alvo)) return false;
      if (termo && !`${linha.descricao} ${linha.contraparte ?? ""}`.toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [painel.grupos, de, ate, nucleo, categoria, favorecido, texto]);

  const gruposFiltrados = useMemo(() => {
    const mapa = new Map<string, { mes: string; linhas: ContaLinha[]; totalCents: number; vencidoCents: number }>();
    for (const linha of linhasFiltradas) {
      const mes = `${linha.dueDate.slice(0, 7)}-01`;
      const grupo = mapa.get(mes) ?? { mes, linhas: [], totalCents: 0, vencidoCents: 0 };
      grupo.linhas.push(linha);
      grupo.totalCents += linha.abertoCents;
      if (linha.diasAtraso > 0) grupo.vencidoCents += linha.abertoCents;
      mapa.set(mes, grupo);
    }
    return [...mapa.values()].sort((a, b) => a.mes.localeCompare(b.mes));
  }, [linhasFiltradas]);

  const totais = useMemo(() => {
    const hoje = hojeIso();
    const limite = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    let total = 0;
    let vencido = 0;
    let proximos30 = 0;
    for (const linha of linhasFiltradas) {
      total += linha.abertoCents;
      if (linha.diasAtraso > 0) vencido += linha.abertoCents;
      if (linha.dueDate >= hoje && linha.dueDate <= limite) proximos30 += linha.abertoCents;
    }
    return { n: linhasFiltradas.length, total, vencido, proximos30 };
  }, [linhasFiltradas]);

  function trocarAba(proxima: Direcao) {
    setDirecao(proxima);
    setEditando(null);
    // A aba vive na querystring para o link ser colável — a mesma convenção das
    // visões salvas (0004).
    router.replace(`/financeiro/contas?aba=${proxima}`, { scroll: false });
  }

  async function enviar(url: string, metodo: string, corpo?: unknown) {
    setErro(null);
    const resposta = await fetch(url, {
      method: metodo,
      headers: corpo ? { "Content-Type": "application/json" } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    if (!resposta.ok) {
      const json = await resposta.json().catch(() => ({}));
      setErro(json.error ?? `falha na operação (HTTP ${resposta.status})`);
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  if (!painel.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">Contas indisponíveis</h2>
        <p>
          Sem conexão com o banco do financeiro. O restante da plataforma segue funcionando — só esta tela depende do
          PostgreSQL em tempo de request.
        </p>
      </section>
    );
  }

  const semNenhumPagavel = direcao === "pagar" && pagar.totalPagaveisNoBanco === 0;

  return (
    <>
      <nav className="fin-subtabs" aria-label="Direção do dinheiro">
        <button
          type="button"
          className={direcao === "pagar" ? "fin-subtab active" : "fin-subtab"}
          onClick={() => trocarAba("pagar")}
        >
          A pagar
          <em>{pagar.totais.n ? brlCents(pagar.totais.abertoCents) : "nenhum"}</em>
        </button>
        <button
          type="button"
          className={direcao === "receber" ? "fin-subtab active" : "fin-subtab"}
          onClick={() => trocarAba("receber")}
        >
          A receber
          <em>{brlCents(receber.totais.abertoCents - receber.totais.confirmadoCents)}</em>
          {receber.totais.confirmadoN ? (
            <small className="fin-conta-nota">
              + {brlCents(receber.totais.confirmadoCents)} em {receber.totais.confirmadoN} cobranças já recebidas fora
              das contas rastreadas
            </small>
          ) : null}
        </button>
      </nav>

      {erro ? (
        <div className="fin-alert" role="alert">
          {erro}
        </div>
      ) : null}

      {direcao === "pagar" ? (
        <div className="fin-contas-acoes">
          <button type="button" className="fin-btn-primary" onClick={() => setMostrarForm((v) => !v)}>
            {mostrarForm ? "Fechar" : "Novo pagamento"}
          </button>
          <span className="fin-card-hint">
            Registrar o pagamento antes da saída é o que faz o fluxo de caixa prever em vez de relatar.
          </span>
        </div>
      ) : null}

      {mostrarForm && direcao === "pagar" ? (
        <FormNovoPagamento
          painel={pagar}
          pendente={pendente}
          onCancelar={() => setMostrarForm(false)}
          onEnviar={async (corpo) => {
            const ok = await enviar("/api/financeiro/contas", "POST", corpo);
            if (ok) setMostrarForm(false);
            return ok;
          }}
        />
      ) : null}

      {semNenhumPagavel && !mostrarForm ? (
        <section className="card fin-empty fin-contas-vazio">
          <h2 className="card-title">Nenhuma conta a pagar registrada</h2>
          <p>
            O banco tem {(receber.totais.n - receber.totais.confirmadoN).toLocaleString("pt-BR")} cobranças a receber
            em aberto e{" "}
            <strong>zero</strong> pagamentos a fazer. Isso não significa que a empresa não paga nada — significa que
            toda saída de caixa só aparece depois de acontecer, no extrato. Enquanto for assim, a previsão de fluxo é
            um teto, não uma previsão.
          </p>
          <p className="fin-empty-hint">
            Uma conta a pagar chega aqui de duas maneiras: <strong>criada nesta tela</strong> (pró-labore, aluguel,
            fornecedor, imposto — tudo que se sabe com antecedência) ou <strong>vinda de um extrato importado</strong>,
            quando o pagamento já aconteceu. Só a primeira produz previsão.
          </p>
          <button type="button" className="fin-btn-primary" onClick={() => setMostrarForm(true)}>
            Registrar o primeiro pagamento
          </button>
        </section>
      ) : null}

      {!semNenhumPagavel ? (
        <section className="card">
          <div className="fin-filters">
            <input
              type="search"
              className="fin-input"
              placeholder="Filtrar por descrição ou favorecido…"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              aria-label="Filtrar por texto"
            />
            <input
              type="date"
              className="fin-select"
              value={de}
              onChange={(e) => setDe(e.target.value)}
              aria-label="Vencimento a partir de"
            />
            <input
              type="date"
              className="fin-select"
              value={ate}
              onChange={(e) => setAte(e.target.value)}
              aria-label="Vencimento até"
            />
            <select className="fin-select" value={nucleo} onChange={(e) => setNucleo(e.target.value)} aria-label="Núcleo">
              <option value="">Todos os núcleos</option>
              {painel.opcoes.nucleos.map((n) => (
                <option key={n.slug} value={n.slug}>
                  {n.name}
                </option>
              ))}
            </select>
            <select
              className="fin-select"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              aria-label="Categoria"
            >
              <option value="">Todas as categorias</option>
              {painel.opcoes.categorias.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
            <input
              type="search"
              className="fin-input"
              placeholder={direcao === "pagar" ? "Favorecido…" : "Cliente…"}
              value={favorecido}
              onChange={(e) => setFavorecido(e.target.value)}
              aria-label={direcao === "pagar" ? "Favorecido" : "Cliente"}
            />
          </div>

          <p className="fin-filters-summary">
            {totais.n.toLocaleString("pt-BR")} {totais.n === 1 ? "documento" : "documentos"} ·{" "}
            {brlPrecise(totais.total)} em aberto · {brlPrecise(totais.proximos30)} vencem em 30 dias
            {totais.vencido ? ` · ${brlPrecise(totais.vencido)} vencidos` : ""}
          </p>

          {gruposFiltrados.map((grupo) => (
            <div key={grupo.mes} className="fin-mes-bloco">
              <h3 className="fin-mes-titulo">
                <span>{monthKeyLabel(grupo.mes)}</span>
                <strong>{brlPrecise(grupo.totalCents)}</strong>
                {grupo.vencidoCents ? <em className="fin-badge-atencao">{brlPrecise(grupo.vencidoCents)} vencido</em> : null}
              </h3>
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Vencimento</th>
                    <th>{direcao === "pagar" ? "Favorecido" : "Cliente"}</th>
                    <th>Descrição</th>
                    <th>Categoria</th>
                    <th>Núcleo</th>
                    <th className="num">Valor</th>
                    {direcao === "pagar" ? <th>Flexibilidade</th> : <th>Situação</th>}
                    <th>Status</th>
                    {direcao === "pagar" ? <th aria-label="Ações" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {grupo.linhas.map((linha) =>
                    editando === linha.id ? (
                      <LinhaEdicao
                        key={linha.id}
                        linha={linha}
                        pendente={pendente}
                        onCancelar={() => setEditando(null)}
                        onSalvar={async (corpo) => {
                          const ok = await enviar(`/api/financeiro/contas/${linha.id}`, "PATCH", corpo);
                          if (ok) setEditando(null);
                        }}
                        onExcluir={async () => {
                          const ok = await enviar(`/api/financeiro/contas/${linha.id}`, "DELETE");
                          if (ok) setEditando(null);
                        }}
                      />
                    ) : (
                      <tr key={linha.id}>
                        <td className="fin-nowrap">{dateLabel(linha.dueDate)}</td>
                        <td>{linha.contraparte ?? <span className="fin-zero">sem favorecido</span>}</td>
                        <td>
                          <span className="fin-desc">{linha.descricao}</span>
                          {linha.installmentTotal ? (
                            <span className="fin-desc-sub">
                              parcela {linha.installmentNumber}/{linha.installmentTotal}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {linha.categoriaCode ? (
                            <span className="fin-cat">
                              <span className="fin-code">{linha.categoriaCode}</span>
                              {linha.categoriaNome}
                            </span>
                          ) : (
                            <span className="fin-badge-pendente">sem categoria</span>
                          )}
                        </td>
                        <td className="fin-nowrap">{linha.nucleo ?? "—"}</td>
                        <td className="num fin-table-money">{brlPrecise(linha.amountCents)}</td>
                        {direcao === "pagar" ? (
                          <td>
                            <select
                              className="fin-select fin-select-inline"
                              value={linha.flexibility}
                              disabled={pendente}
                              aria-label={`Flexibilidade de ${linha.descricao.slice(0, 30)}`}
                              onChange={(e) =>
                                void enviar(`/api/financeiro/contas/${linha.id}`, "PATCH", {
                                  flexibility: e.target.value
                                })
                              }
                            >
                              <option value="fixo">fixo</option>
                              <option value="negociavel">negociável</option>
                              <option value="adiavel">adiável</option>
                            </select>
                          </td>
                        ) : (
                          <td className="fin-nowrap">
                            {linha.diasAtraso > 0 ? (
                              <span className="fin-badge-atencao">{linha.diasAtraso} dias em atraso</span>
                            ) : (
                              <span className="fin-badge-ok">em dia</span>
                            )}
                          </td>
                        )}
                        <td className="fin-nowrap">
                          <span className="fin-tag">{ROTULO_STATUS[linha.status] ?? linha.status}</span>
                          {linha.plannedAt ? <span className="fin-tag">planejado</span> : null}
                        </td>
                        {direcao === "pagar" ? (
                          <td className="fin-nowrap">
                            <button type="button" className="fin-btn-ghost fin-btn-mini" onClick={() => setEditando(linha.id)}>
                              editar
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          ))}

          {!gruposFiltrados.length ? (
            <p className="fin-empty-row">Nenhum documento com esses filtros.</p>
          ) : (
            <table className="fin-table fin-total-geral">
              <tfoot>
                <tr>
                  <th>Total {direcao === "pagar" ? "a pagar" : "a receber"} (filtro aplicado)</th>
                  <td className="num fin-table-money">
                    <strong>{brlPrecise(totais.total)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>
      ) : null}

      {direcao === "receber" ? (
        <p className="fin-card-hint">
          Somente leitura: as cobranças a receber vêm do Asaas e são corrigidas lá. Editá-las aqui faria a conciliação
          divergir da fonte sem deixar rastro.
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Formulário de novo pagamento — inline, nunca modal
// ---------------------------------------------------------------------------
/**
 * Inline e não modal de propósito: quem registra um pagamento normalmente está
 * olhando a lista para não duplicar o que já existe, e um modal esconde
 * exatamente a informação de que se precisa nesse momento.
 */
function FormNovoPagamento({
  painel,
  pendente,
  onEnviar,
  onCancelar
}: {
  painel: PainelContas;
  pendente: boolean;
  onEnviar: (corpo: Record<string, unknown>) => Promise<boolean>;
  onCancelar: () => void;
}) {
  const [descricao, setDescricao] = useState("");
  const [favorecido, setFavorecido] = useState("");
  const [categoria, setCategoria] = useState("");
  const [nucleo, setNucleo] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState(hojeIso());
  const [recorrencia, setRecorrencia] = useState("unica");
  const [flexibility, setFlexibility] = useState("negociavel");
  const [observacao, setObservacao] = useState("");
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  const contraparteCasada = useMemo(
    () => painel.opcoes.contrapartes.find((c) => c.name.toLowerCase() === favorecido.trim().toLowerCase()),
    [painel.opcoes.contrapartes, favorecido]
  );

  return (
    <section className="card fin-form-novo">
      <h2 className="card-title">Novo pagamento</h2>
      <p className="fin-card-hint">
        Nasce como <strong>previsto</strong> e com a data de registro carimbada — é esse carimbo que prova que o
        pagamento foi planejado, e ele não pode ser reconstruído depois.
      </p>

      <div className="fin-form-grid">
        <label className="fin-field">
          <span>Descrição</span>
          <input
            className="fin-input"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Pró-labore agosto"
          />
        </label>

        <label className="fin-field">
          <span>Favorecido</span>
          <input
            className="fin-input"
            list="fin-contrapartes"
            value={favorecido}
            onChange={(e) => setFavorecido(e.target.value)}
            placeholder="Nome do fornecedor ou pessoa"
          />
          <datalist id="fin-contrapartes">
            {painel.opcoes.contrapartes.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          <em className="fin-field-hint">
            {contraparteCasada ? "cadastro existente" : favorecido.trim() ? "será cadastrado como fornecedor" : "opcional"}
          </em>
        </label>

        <label className="fin-field">
          <span>Categoria</span>
          <select className="fin-select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Sem categoria (vai para a fila de revisão)</option>
            {painel.opcoes.categorias.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="fin-field">
          <span>Núcleo</span>
          <select className="fin-select" value={nucleo} onChange={(e) => setNucleo(e.target.value)}>
            <option value="">Sem núcleo</option>
            {painel.opcoes.nucleos.map((n) => (
              <option key={n.slug} value={n.slug}>
                {n.name}
              </option>
            ))}
          </select>
        </label>

        <label className="fin-field">
          <span>Valor</span>
          <input
            className="fin-input"
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="1.350,00"
          />
        </label>

        <label className="fin-field">
          <span>Vencimento</span>
          <input className="fin-select" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
        </label>

        <label className="fin-field">
          <span>Recorrência</span>
          <select className="fin-select" value={recorrencia} onChange={(e) => setRecorrencia(e.target.value)}>
            <option value="unica">Única</option>
            <option value="mensal">Mensal (gera 12 meses)</option>
          </select>
        </label>

        <label className="fin-field">
          <span>Flexibilidade</span>
          <select className="fin-select" value={flexibility} onChange={(e) => setFlexibility(e.target.value)}>
            <option value="fixo">Fixo — não dá para adiar</option>
            <option value="negociavel">Negociável</option>
            <option value="adiavel">Adiável</option>
          </select>
        </label>

        <label className="fin-field fin-field-wide">
          <span>Observação</span>
          <input
            className="fin-input"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Combinado com o fornecedor, boleto chega dia 5…"
          />
        </label>
      </div>

      {erroLocal ? (
        <p className="fin-alert" role="alert">
          {erroLocal}
        </p>
      ) : null}

      <div className="fin-form-acoes">
        <button
          type="button"
          className="fin-btn-primary"
          disabled={pendente}
          onClick={async () => {
            setErroLocal(null);
            const centavos = paraCentavos(valor);
            if (!descricao.trim()) return setErroLocal("informe a descrição");
            if (!centavos || centavos <= 0) return setErroLocal("informe um valor maior que zero");
            if (!vencimento) return setErroLocal("informe o vencimento");
            const ok = await onEnviar({
              descricao: descricao.trim(),
              counterpartyId: contraparteCasada?.id ?? null,
              counterpartyNome: contraparteCasada ? null : favorecido.trim() || null,
              categoryCode: categoria || null,
              nucleo: nucleo || null,
              valorCents: centavos,
              dueDate: vencimento,
              recorrencia,
              flexibility,
              observacao: observacao.trim() || null
            });
            if (ok) {
              setDescricao("");
              setFavorecido("");
              setValor("");
              setObservacao("");
            }
          }}
        >
          {recorrencia === "mensal" ? "Criar 12 pagamentos" : "Criar pagamento"}
        </button>
        <button type="button" className="fin-btn-ghost" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Edição inline de uma linha
// ---------------------------------------------------------------------------
function LinhaEdicao({
  linha,
  pendente,
  onSalvar,
  onCancelar,
  onExcluir
}: {
  linha: ContaLinha;
  pendente: boolean;
  onSalvar: (corpo: Record<string, unknown>) => Promise<void>;
  onCancelar: () => void;
  onExcluir: () => Promise<void>;
}) {
  const [valor, setValor] = useState((linha.amountCents / 100).toFixed(2).replace(".", ","));
  const [vencimento, setVencimento] = useState(linha.dueDate);
  const [flexibility, setFlexibility] = useState(linha.flexibility);
  const podeExcluir = linha.status === "previsto" && linha.settledCents === 0;

  return (
    <tr className="fin-linha-edicao">
      <td>
        <input className="fin-input" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
      </td>
      <td>{linha.contraparte ?? "—"}</td>
      <td colSpan={2}>
        <span className="fin-desc">{linha.descricao}</span>
        <span className="fin-desc-sub">
          {ROTULO_FLEX[linha.flexibility]} · {linha.categoriaCode ?? "sem categoria"}
        </span>
      </td>
      <td className="fin-nowrap">{linha.nucleo ?? "—"}</td>
      <td className="num">
        <input
          className="fin-input fin-input-valor"
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          aria-label="Novo valor"
        />
      </td>
      <td>
        <select className="fin-select fin-select-inline" value={flexibility} onChange={(e) => setFlexibility(e.target.value)}>
          <option value="fixo">fixo</option>
          <option value="negociavel">negociável</option>
          <option value="adiavel">adiável</option>
        </select>
      </td>
      <td>
        <span className="fin-tag">{ROTULO_STATUS[linha.status] ?? linha.status}</span>
      </td>
      <td className="fin-nowrap fin-linha-edicao-acoes">
        <button
          type="button"
          className="fin-btn-primary fin-btn-mini"
          disabled={pendente}
          onClick={() => {
            const centavos = paraCentavos(valor);
            void onSalvar({
              valorCents: centavos ?? linha.amountCents,
              dueDate: vencimento,
              flexibility
            });
          }}
        >
          salvar
        </button>
        <button type="button" className="fin-btn-ghost fin-btn-mini" onClick={onCancelar}>
          cancelar
        </button>
        {podeExcluir ? (
          <button type="button" className="fin-btn-ghost fin-btn-mini fin-btn-perigo" disabled={pendente} onClick={() => void onExcluir()}>
            excluir
          </button>
        ) : null}
      </td>
    </tr>
  );
}
