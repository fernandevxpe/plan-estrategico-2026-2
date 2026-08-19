"use client";

import { useMemo, useState } from "react";

import { Ressalva } from "@/components/financeiro/Certeza";
import { brlPrecise } from "@/lib/financeiro/format";
import type { LinhaProduto } from "@/lib/financeiro/contratos/categorizacao";

/**
 * Linhas de produto — a segunda pergunta que o dinheiro responde (0124).
 *
 * O plano de contas (aba ao lado) responde "que natureza é isto?" — receita,
 * custo, por tipo de serviço. Esta tabela responde "que produto vendemos?" —
 * uma camada que agrupa categorias, pensada pelo Fernando a partir da
 * planilha de gestão. Nasce vazia de propósito: os nomes e agrupamentos são
 * decisão dele, não um mapeamento que a migration decidiu sozinha.
 *
 * Mesmo padrão de `FinPlanoContas.tsx`: a recusa de desativar (linha com
 * categoria ativa apontando para ela) aparece NA LINHA, com o botão
 * desligado e o motivo no `title` — nunca só descoberta pelo erro.
 */

const ROTA = "/api/financeiro/gerencial/categorizacao/linhas-produto";

type Nova = { nome: string; descricao: string; ordem: string };
const NOVA_VAZIA: Nova = { nome: "", descricao: "", ordem: "" };

type Edicao = { nome: string; descricao: string; ordem: string };

type Props = {
  linhas: LinhaProduto[];
  recarregando: boolean;
  onMudou: () => void;
};

export function FinLinhasProduto({ linhas, recarregando, onMudou }: Props) {
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [criando, setCriando] = useState(false);
  const [nova, setNova] = useState<Nova>(NOVA_VAZIA);
  const [editando, setEditando] = useState<number | null>(null);
  const [edicao, setEdicao] = useState<Edicao>({ nome: "", descricao: "", ordem: "" });
  const [pendente, setPendente] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  const visiveis = useMemo(
    () => linhas.filter((l) => mostrarInativas || l.ativa),
    [linhas, mostrarInativas]
  );
  const inativas = linhas.filter((l) => !l.ativa).length;

  async function enviar(metodo: "POST" | "PATCH", corpo: Record<string, unknown>, chave: string) {
    setPendente(chave);
    setErro(null);
    setRecado(null);
    try {
      const r = await fetch(ROTA, {
        method: metodo,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo)
      });
      const dado = await r.json().catch(() => ({}));
      if (!r.ok) {
        const extra = dado?.recusadoPor ? ` (${dado.recusadoPor})` : "";
        throw new Error(`${dado?.erro ?? `HTTP ${r.status}`}${extra}`);
      }
      return dado;
    } finally {
      setPendente(null);
    }
  }

  async function criar(evento: React.FormEvent) {
    evento.preventDefault();
    try {
      const dado = await enviar(
        "POST",
        { nome: nova.nome, descricao: nova.descricao || null, ordem: nova.ordem ? Number(nova.ordem) : undefined },
        "nova"
      );
      setRecado(`"${dado?.linha?.name ?? nova.nome}" criada.`);
      setNova(NOVA_VAZIA);
      setCriando(false);
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao criar linha de produto");
    }
  }

  async function salvarEdicao(linha: LinhaProduto) {
    try {
      await enviar(
        "PATCH",
        {
          id: linha.id,
          nome: edicao.nome,
          descricao: edicao.descricao || null,
          ordem: edicao.ordem === "" ? undefined : Number(edicao.ordem)
        },
        String(linha.id)
      );
      setRecado(`"${edicao.nome}" atualizada.`);
      setEditando(null);
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao editar linha de produto");
    }
  }

  async function alternarAtiva(linha: LinhaProduto) {
    try {
      await enviar("PATCH", { id: linha.id, ativa: !linha.ativa }, String(linha.id));
      setRecado(`"${linha.nome}" ${linha.ativa ? "desativada" : "reativada"}.`);
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao mudar o estado da linha de produto");
    }
  }

  return (
    <div className="fin-cat-plano">
      <Ressalva>
        Nasce vazia de propósito: os nomes e agrupamentos são decisão sua, a partir da planilha de
        gestão ou de como o negócio realmente se organiza. Para unir duas linhas (ex.: "Monitor BT" e
        "Monitor AT" viram uma só), mova as categorias de uma para a outra na aba{" "}
        <strong>Plano de contas</strong> e desative a que ficou vazia — nunca dê o mesmo nome a duas
        linhas ativas, ou o relatório por dimensão mostra duas fatias idênticas.
      </Ressalva>

      {erro ? (
        <p className="fin-alert" role="alert">
          {erro}
        </p>
      ) : null}
      {recado ? <p className="fin-cat-recado">{recado}</p> : null}

      <div className="fin-cat-plano-topo">
        <label className="fin-check">
          <input type="checkbox" checked={mostrarInativas} onChange={(e) => setMostrarInativas(e.target.checked)} />
          mostrar inativas ({inativas})
        </label>
        <button type="button" className="fin-btn-primary" onClick={() => setCriando((v) => !v)}>
          {criando ? "Fechar cadastro" : "Criar linha de produto"}
        </button>
        {recarregando ? <span className="fin-cat-nota">recarregando…</span> : null}
      </div>

      {criando ? (
        <form className="fin-cat-form" onSubmit={criar}>
          <div className="fin-cat-grade">
            <label className="fin-field fin-field-wide">
              <span>nome</span>
              <input
                className="fin-input"
                value={nova.nome}
                onChange={(e) => setNova((n) => ({ ...n, nome: e.target.value }))}
                placeholder="Monitoramento e Faturamento de Energia"
                required
              />
            </label>
            <label className="fin-field fin-field-wide">
              <span>descrição (opcional)</span>
              <input
                className="fin-input"
                value={nova.descricao}
                onChange={(e) => setNova((n) => ({ ...n, descricao: e.target.value }))}
                placeholder="o que entra aqui, se não for óbvio pelo nome"
              />
            </label>
            <label className="fin-field">
              <span>ordem (opcional)</span>
              <input
                className="fin-input"
                inputMode="numeric"
                value={nova.ordem}
                onChange={(e) => setNova((n) => ({ ...n, ordem: e.target.value }))}
                placeholder="0"
              />
            </label>
          </div>
          <div className="fin-cat-form-acoes">
            <button type="submit" className="fin-btn-primary" disabled={pendente === "nova"}>
              {pendente === "nova" ? "criando…" : "Criar linha"}
            </button>
            <button type="button" className="fin-btn-ghost" onClick={() => setNova(NOVA_VAZIA)}>
              Limpar
            </button>
          </div>
        </form>
      ) : null}

      <div className="fin-cat-wrap">
        <table className="fin-table fin-cat-tabela-plano">
          <thead>
            <tr>
              <th>nome</th>
              <th>categorias</th>
              <th className="num">uso vivo</th>
              <th className="num">valor</th>
              <th>ações</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => {
              const editandoEsta = editando === l.id;
              return (
                <tr key={l.id} data-inativa={l.ativa ? undefined : "sim"}>
                  <td>
                    {editandoEsta ? (
                      <>
                        <input
                          className="fin-input"
                          value={edicao.nome}
                          onChange={(e) => setEdicao((x) => ({ ...x, nome: e.target.value }))}
                          aria-label={`Nome de ${l.nome}`}
                        />
                        <input
                          className="fin-input"
                          value={edicao.descricao}
                          onChange={(e) => setEdicao((x) => ({ ...x, descricao: e.target.value }))}
                          placeholder="descrição (opcional)"
                          style={{ marginTop: 6 }}
                        />
                      </>
                    ) : (
                      <>
                        <span className="fin-desc">{l.nome}</span>
                        {l.descricao ? <span className="fin-desc-sub">{l.descricao}</span> : null}
                        {!l.ativa ? <span className="fin-tag">inativa</span> : null}
                      </>
                    )}
                  </td>

                  <td>
                    {l.categoriasCodes.length ? (
                      <span className="fin-desc-sub">{l.categoriasCodes.join(", ")}</span>
                    ) : (
                      <span className="fin-desc-sub">nenhuma ainda</span>
                    )}
                  </td>

                  <td className="num fin-table-money">{l.usoVivo.toLocaleString("pt-BR")}</td>
                  <td className="num fin-table-money">{brlPrecise(l.valorVivoCents)}</td>

                  <td className="fin-cat-acoes-cel">
                    {editandoEsta ? (
                      <>
                        <button
                          type="button"
                          className="fin-btn-primary fin-btn-mini"
                          disabled={pendente === String(l.id)}
                          onClick={() => void salvarEdicao(l)}
                        >
                          {pendente === String(l.id) ? "salvando…" : "Salvar"}
                        </button>
                        <button type="button" className="fin-btn-ghost fin-btn-mini" onClick={() => setEditando(null)}>
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="fin-btn-ghost fin-btn-mini"
                          onClick={() => {
                            setEditando(l.id);
                            setEdicao({ nome: l.nome, descricao: l.descricao ?? "", ordem: String(l.ordem) });
                          }}
                        >
                          Editar
                        </button>
                        {l.ativa ? (
                          <button
                            type="button"
                            className="fin-btn-ghost fin-btn-mini fin-btn-perigo"
                            disabled={!l.podeDesativar || pendente === String(l.id)}
                            title={l.motivoBloqueio ?? "desativa a linha de produto"}
                            onClick={() => void alternarAtiva(l)}
                          >
                            Desativar
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="fin-btn-ghost fin-btn-mini"
                            disabled={pendente === String(l.id)}
                            onClick={() => void alternarAtiva(l)}
                          >
                            Reativar
                          </button>
                        )}
                        {l.ativa && !l.podeDesativar && l.motivoBloqueio ? (
                          <span className="fin-cat-bloqueio">{l.motivoBloqueio}</span>
                        ) : null}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!visiveis.length ? (
        <p className="fin-empty-row">
          {linhas.length ? "Nenhuma linha ativa — marque \"mostrar inativas\"." : "Nenhuma linha de produto ainda."}
        </p>
      ) : null}
    </div>
  );
}
