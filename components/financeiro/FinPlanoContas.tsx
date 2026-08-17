"use client";

import { useMemo, useState } from "react";

import { Ressalva, SeloCamada } from "@/components/financeiro/Certeza";
import { brlPrecise } from "@/lib/financeiro/format";
import type { CategoriaPlano } from "@/lib/financeiro/contratos/categorizacao";

/**
 * O plano de contas — cadastrar, editar, desativar.
 *
 * ---------------------------------------------------------------------------
 * A TELA EXPLICA A RECUSA ANTES DELA ACONTECER
 * ---------------------------------------------------------------------------
 * O banco (gatilhos da 0101) recusa três coisas: mexer em 3.99/5.99, desativar
 * categoria com linha viva, e apagar categoria que já classificou algo. A
 * tentação é deixar o usuário descobrir isso pelo erro — mas um botão que
 * parece disponível e devolve 409 ensina que o sistema é imprevisível. Aqui o
 * motivo que `fin_categoria_uso_v` já calcula (`pode_desativar` +
 * `motivo_bloqueio`) aparece NA LINHA, com o botão desligado.
 *
 * `kind` não é editável — decisão do backend, não desta tela. Ele decide o
 * sinal exigido e a linha da DRE; trocá-lo numa categoria com uso vivo
 * reclassificaria dinheiro sem passar por `fin_classification_event`. O
 * formulário diz isso em vez de mandar o PATCH e receber 400.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O SINAL É DERIVADO AQUI TAMBÉM
 * ---------------------------------------------------------------------------
 * `sinalEsperadoDe` mora em `contratos/categorizacao.ts`, que é `server-only`.
 * Importar a FUNÇÃO daqui arrastaria o módulo inteiro para o bundle do
 * cliente e quebraria o build. A tabela abaixo é a mesma régua, escrita à mão,
 * e o único jeito de ela divergir é alguém mudar um lado sem o outro — por
 * isso ela está imediatamente ao lado do seletor que a usa, e não num utils.
 */

type GrupoFluxo = { slug: string; nome: string; direcao: string };

type Props = {
  categorias: CategoriaPlano[];
  gruposFluxo: GrupoFluxo[];
  nucleos: { slug: string; nome: string }[];
  ressalvas: string[];
  recarregando: boolean;
  onMudou: () => void;
};

/** Espelho de `sinalEsperadoDe`. Ver o cabeçalho: server-only não cruza para cá. */
const KINDS = [
  { valor: "receita", rotulo: "Receita", sinal: "entrada" as const },
  { valor: "deducao_receita", rotulo: "Dedução de receita", sinal: "ambos" as const },
  { valor: "custo_variavel_direto", rotulo: "Custo variável direto", sinal: "saida" as const },
  { valor: "despesa_operacional", rotulo: "Despesa operacional", sinal: "saida" as const },
  { valor: "pessoal", rotulo: "Pessoal", sinal: "saida" as const },
  { valor: "imposto", rotulo: "Imposto", sinal: "saida" as const },
  { valor: "investimento", rotulo: "Investimento", sinal: "saida" as const },
  { valor: "movimentacao_financeira", rotulo: "Movimentação financeira", sinal: "ambos" as const }
];

const LINHAS_DRE = [
  { valor: "receita_bruta", rotulo: "Receita bruta" },
  { valor: "deducoes", rotulo: "Deduções" },
  { valor: "custos_servicos", rotulo: "Custos dos serviços" },
  { valor: "despesas_comerciais", rotulo: "Despesas comerciais" },
  { valor: "despesas_administrativas", rotulo: "Despesas administrativas" },
  { valor: "despesas_pessoal", rotulo: "Despesas com pessoal" },
  { valor: "resultado_financeiro", rotulo: "Resultado financeiro" },
  { valor: "impostos", rotulo: "Impostos" },
  { valor: "investimentos", rotulo: "Investimentos" },
  { valor: "nao_operacional", rotulo: "Não operacional" }
];

const SINAL_ROTULO = {
  entrada: "exige ENTRADA (o gatilho anula a categoria numa saída)",
  saida: "exige SAÍDA (o gatilho anula a categoria numa entrada)",
  ambos: "aceita entrada e saída"
} as const;

const ROTA = "/api/financeiro/gerencial/categorizacao/categorias";

type Nova = {
  code: string;
  nome: string;
  kind: string;
  grupoFluxo: string;
  linhaDre: string;
  nucleoPadrao: string;
  categoriaPai: string;
};

const NOVA_VAZIA: Nova = {
  code: "",
  nome: "",
  kind: "",
  grupoFluxo: "",
  linhaDre: "",
  nucleoPadrao: "",
  categoriaPai: ""
};

/**
 * O caso real que estava esperando uma casa.
 *
 * 133 itens de cartão carregam o motivo declarado: *"IOF: o QUE é veio da
 * fonte e está certo; ONDE vai não existe no plano de contas. 7.01 é DAS, 7.02
 * é ISS, 7.03 é retenção, 4.05 é tarifa e 9.11 é juro — IOF não é nenhum."*
 *
 * O prefill deixa o CÓDIGO em branco de propósito: escolher o número é
 * escolher onde a linha entra no plano, e isso é decisão do Fernando (dúvida
 * 20), não do botão.
 */
const CASO_IOF: Partial<Nova> = {
  nome: "IOF",
  kind: "imposto",
  grupoFluxo: "impostos",
  linhaDre: "impostos"
};

type Edicao = { nome: string; grupoFluxo: string; linhaDre: string; nucleoPadrao: string };

export function FinPlanoContas({ categorias, gruposFluxo, nucleos, ressalvas, recarregando, onMudou }: Props) {
  const [busca, setBusca] = useState("");
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [criando, setCriando] = useState(false);
  const [nova, setNova] = useState<Nova>(NOVA_VAZIA);
  const [editando, setEditando] = useState<string | null>(null);
  const [edicao, setEdicao] = useState<Edicao>({ nome: "", grupoFluxo: "", linhaDre: "", nucleoPadrao: "" });
  const [pendente, setPendente] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return categorias.filter((c) => {
      if (!mostrarInativas && !c.ativa) return false;
      if (!termo) return true;
      return `${c.code} ${c.nome} ${c.kind} ${c.grupo ?? ""}`.toLowerCase().includes(termo);
    });
  }, [categorias, busca, mostrarInativas]);

  const inativas = categorias.filter((c) => !c.ativa).length;
  const sinalDoKind = KINDS.find((k) => k.valor === nova.kind)?.sinal;

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
        // 409 é recusa do gatilho, 422 é recusa da camada de escrita. As duas
        // são regra de negócio escrita de propósito — mostrar "erro interno"
        // aqui faria a pessoa tentar de novo achando que foi falha de rede.
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
        {
          code: nova.code,
          nome: nova.nome,
          kind: nova.kind,
          grupoFluxo: nova.grupoFluxo,
          linhaDre: nova.linhaDre,
          nucleoPadrao: nova.nucleoPadrao || null,
          categoriaPai: nova.categoriaPai || null
        },
        "nova"
      );
      setRecado(
        `${dado?.categoria?.code ?? nova.code} ${dado?.categoria?.name ?? nova.nome} criada · ` +
          `sinal esperado: ${dado?.categoria?.sinalEsperado ?? sinalDoKind ?? "—"}`
      );
      setNova(NOVA_VAZIA);
      setCriando(false);
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao criar categoria");
    }
  }

  async function salvarEdicao(code: string) {
    try {
      await enviar(
        "PATCH",
        {
          code,
          nome: edicao.nome,
          grupoFluxo: edicao.grupoFluxo,
          linhaDre: edicao.linhaDre,
          // `null` aqui é instrução de limpar; `undefined` seria "não mexa".
          nucleoPadrao: edicao.nucleoPadrao || null
        },
        code
      );
      setRecado(`${code} atualizada.`);
      setEditando(null);
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao editar categoria");
    }
  }

  async function alternarAtiva(categoria: CategoriaPlano) {
    try {
      await enviar("PATCH", { code: categoria.code, ativa: !categoria.ativa }, categoria.code);
      setRecado(`${categoria.code} ${categoria.ativa ? "desativada" : "reativada"}.`);
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao mudar o estado da categoria");
    }
  }

  return (
    <div className="fin-cat-plano">
      <Ressalva>
        <strong>3.99 e 5.99 são intocáveis, e não por capricho.</strong> Elas não são linhas do plano de contas —
        são o vocabulário da indecisão. O código delas é lido por três gatilhos, três invariantes (H1, H2, H3) e
        quatro views. Desativá-las tiraria 237 itens (R$ 112.492,54) da fila sem classificar nenhum. O banco
        recusa renomear, reagrupar ou desativar as duas; esta tela nem oferece o botão.
      </Ressalva>

      {ressalvas.map((r) => (
        <p key={r} className="fin-cat-nota">
          {r}
        </p>
      ))}

      {erro ? (
        <p className="fin-alert" role="alert">
          {erro}
        </p>
      ) : null}
      {recado ? <p className="fin-cat-recado">{recado}</p> : null}

      <div className="fin-cat-plano-topo">
        <input
          type="search"
          className="fin-input"
          placeholder="Filtrar o plano por código, nome ou natureza…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Filtrar o plano de contas"
        />
        <label className="fin-check">
          <input
            type="checkbox"
            checked={mostrarInativas}
            onChange={(e) => setMostrarInativas(e.target.checked)}
          />
          mostrar inativas ({inativas})
        </label>
        <button type="button" className="fin-btn-primary" onClick={() => setCriando((v) => !v)}>
          {criando ? "Fechar cadastro" : "Cadastrar categoria"}
        </button>
        {recarregando ? <span className="fin-cat-nota">recarregando o plano…</span> : null}
      </div>

      {criando ? (
        <form className="fin-cat-form" onSubmit={criar}>
          <div className="fin-cat-caso">
            <strong>Um caso real está esperando: o IOF não tem casa.</strong>
            <span>
              133 itens de cartão trazem o motivo declarado — <em>o QUE é veio da fonte e está certo; ONDE vai
              não existe no plano</em>. 7.01 é DAS, 7.02 é ISS, 7.03 é retenção, 4.05 é tarifa e 9.11 é juro; IOF
              não é nenhum deles. O botão preenche nome, natureza, grupo e linha da DRE — e deixa o{" "}
              <strong>código em branco de propósito</strong>: escolher o número é escolher onde a linha entra no
              plano, e isso é decisão sua (dúvida 20).
            </span>
            <button
              type="button"
              className="fin-btn-ghost"
              onClick={() => setNova((n) => ({ ...n, ...CASO_IOF }))}
            >
              Preencher com o caso do IOF
            </button>
          </div>

          <div className="fin-cat-grade">
            <label className="fin-field">
              <span>código</span>
              <input
                className="fin-input"
                value={nova.code}
                onChange={(e) => setNova((n) => ({ ...n, code: e.target.value }))}
                placeholder="7.04"
                required
              />
              <span className="fin-field-hint">formato N.NN, como o resto do plano</span>
            </label>

            <label className="fin-field fin-field-wide">
              <span>nome</span>
              <input
                className="fin-input"
                value={nova.nome}
                onChange={(e) => setNova((n) => ({ ...n, nome: e.target.value }))}
                placeholder="IOF"
                required
              />
            </label>

            <label className="fin-field">
              <span>natureza (kind)</span>
              <select
                className="fin-select"
                value={nova.kind}
                onChange={(e) => setNova((n) => ({ ...n, kind: e.target.value }))}
                required
              >
                <option value="">escolha…</option>
                {KINDS.map((k) => (
                  <option key={k.valor} value={k.valor}>
                    {k.rotulo}
                  </option>
                ))}
              </select>
              <span className="fin-field-hint">
                {sinalDoKind
                  ? `sinal esperado: ${SINAL_ROTULO[sinalDoKind]}`
                  : "a natureza decide o sinal exigido e não pode ser editada depois"}
              </span>
            </label>

            <label className="fin-field">
              <span>grupo de fluxo de caixa</span>
              <select
                className="fin-select"
                value={nova.grupoFluxo}
                onChange={(e) => setNova((n) => ({ ...n, grupoFluxo: e.target.value }))}
                required
              >
                <option value="">escolha…</option>
                {gruposFluxo.map((g) => (
                  <option key={g.slug} value={g.slug}>
                    {g.nome} ({g.direcao})
                  </option>
                ))}
              </select>
            </label>

            <label className="fin-field">
              <span>linha da DRE</span>
              <select
                className="fin-select"
                value={nova.linhaDre}
                onChange={(e) => setNova((n) => ({ ...n, linhaDre: e.target.value }))}
                required
              >
                <option value="">escolha…</option>
                {LINHAS_DRE.map((l) => (
                  <option key={l.valor} value={l.valor}>
                    {l.rotulo}
                  </option>
                ))}
              </select>
            </label>

            <label className="fin-field">
              <span>núcleo padrão (opcional)</span>
              <select
                className="fin-select"
                value={nova.nucleoPadrao}
                onChange={(e) => setNova((n) => ({ ...n, nucleoPadrao: e.target.value }))}
              >
                <option value="">nenhum</option>
                {nucleos.map((n) => (
                  <option key={n.slug} value={n.slug}>
                    {n.nome}
                  </option>
                ))}
              </select>
            </label>

            <label className="fin-field">
              <span>categoria pai (opcional)</span>
              <select
                className="fin-select"
                value={nova.categoriaPai}
                onChange={(e) => setNova((n) => ({ ...n, categoriaPai: e.target.value }))}
              >
                <option value="">nenhuma</option>
                {categorias
                  .filter((c) => c.ativa && !c.marcadorDeIndecisao)
                  .map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.nome}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <div className="fin-cat-form-acoes">
            <button type="submit" className="fin-btn-primary" disabled={pendente === "nova"}>
              {pendente === "nova" ? "criando…" : "Criar categoria"}
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
              <th>código</th>
              <th>nome</th>
              <th>natureza · sinal</th>
              <th>grupo · DRE</th>
              <th className="num">uso vivo</th>
              <th className="num">valor</th>
              <th>ações</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((c) => {
              const editandoEsta = editando === c.code;
              const marcador = c.marcadorDeIndecisao;
              return (
                <tr key={c.code} data-inativa={c.ativa ? undefined : "sim"}>
                  <td className="fin-cat-code">
                    {c.code}
                    {marcador ? <span className="fin-tag">marcador</span> : null}
                    {!c.ativa ? <span className="fin-tag">inativa</span> : null}
                  </td>

                  <td>
                    {editandoEsta ? (
                      <input
                        className="fin-input"
                        value={edicao.nome}
                        onChange={(e) => setEdicao((x) => ({ ...x, nome: e.target.value }))}
                        aria-label={`Nome de ${c.code}`}
                      />
                    ) : (
                      <>
                        <span className="fin-desc">{c.nome}</span>
                        {c.nucleoPadrao ? (
                          <span className="fin-desc-sub">núcleo padrão: {c.nucleoPadrao}</span>
                        ) : null}
                      </>
                    )}
                  </td>

                  <td>
                    <span className="fin-desc">{KINDS.find((k) => k.valor === c.kind)?.rotulo ?? c.kind}</span>
                    <span className="fin-desc-sub">{SINAL_ROTULO[c.sinalEsperado]}</span>
                  </td>

                  <td>
                    {editandoEsta ? (
                      <div className="fin-cat-edit-par">
                        <select
                          className="fin-select"
                          value={edicao.grupoFluxo}
                          onChange={(e) => setEdicao((x) => ({ ...x, grupoFluxo: e.target.value }))}
                          aria-label={`Grupo de fluxo de ${c.code}`}
                        >
                          {gruposFluxo.map((g) => (
                            <option key={g.slug} value={g.slug}>
                              {g.nome}
                            </option>
                          ))}
                        </select>
                        <select
                          className="fin-select"
                          value={edicao.linhaDre}
                          onChange={(e) => setEdicao((x) => ({ ...x, linhaDre: e.target.value }))}
                          aria-label={`Linha da DRE de ${c.code}`}
                        >
                          {LINHAS_DRE.map((l) => (
                            <option key={l.valor} value={l.valor}>
                              {l.rotulo}
                            </option>
                          ))}
                        </select>
                        <select
                          className="fin-select"
                          value={edicao.nucleoPadrao}
                          onChange={(e) => setEdicao((x) => ({ ...x, nucleoPadrao: e.target.value }))}
                          aria-label={`Núcleo padrão de ${c.code}`}
                        >
                          <option value="">sem núcleo padrão</option>
                          {nucleos.map((n) => (
                            <option key={n.slug} value={n.slug}>
                              {n.nome}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <>
                        <span className="fin-desc">{c.grupo ?? "—"}</span>
                        <span className="fin-desc-sub">{c.dreLine ?? "—"}</span>
                      </>
                    )}
                  </td>

                  <td className="num fin-table-money">
                    {c.usoVivo.toLocaleString("pt-BR")}
                    <span className="fin-desc-sub">
                      {c.usoLancamento} lç · {c.usoDocumento} doc · {c.usoItemCartao} cartão
                    </span>
                  </td>

                  <td className="num fin-table-money">{brlPrecise(c.valorVivoCents)}</td>

                  <td className="fin-cat-acoes-cel">
                    {marcador ? (
                      <span className="fin-cat-bloqueio">
                        <SeloCamada camada="indeterminado" texto="não se edita" />
                        marcador de indecisão: não é linha do plano de contas, e o H3 depende do código.
                      </span>
                    ) : editandoEsta ? (
                      <>
                        <button
                          type="button"
                          className="fin-btn-primary fin-btn-mini"
                          disabled={pendente === c.code}
                          onClick={() => void salvarEdicao(c.code)}
                        >
                          {pendente === c.code ? "salvando…" : "Salvar"}
                        </button>
                        <button
                          type="button"
                          className="fin-btn-ghost fin-btn-mini"
                          onClick={() => setEditando(null)}
                        >
                          Cancelar
                        </button>
                        <span className="fin-desc-sub">
                          a natureza ({c.kind}) não é editável: ela decide o sinal exigido e a linha da DRE.
                          Natureza errada se resolve criando a categoria certa e movendo os itens em lote.
                        </span>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="fin-btn-ghost fin-btn-mini"
                          onClick={() => {
                            setEditando(c.code);
                            setEdicao({
                              nome: c.nome,
                              grupoFluxo: c.grupo ?? "",
                              linhaDre: c.dreLine ?? "",
                              nucleoPadrao: c.nucleoPadrao ?? ""
                            });
                          }}
                        >
                          Editar
                        </button>
                        {c.ativa ? (
                          <button
                            type="button"
                            className="fin-btn-ghost fin-btn-mini fin-btn-perigo"
                            disabled={!c.podeDesativar || pendente === c.code}
                            title={c.motivoBloqueio ?? "desativa a categoria"}
                            onClick={() => void alternarAtiva(c)}
                          >
                            Desativar
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="fin-btn-ghost fin-btn-mini"
                            disabled={pendente === c.code}
                            onClick={() => void alternarAtiva(c)}
                          >
                            Reativar
                          </button>
                        )}
                        {c.ativa && !c.podeDesativar && c.motivoBloqueio ? (
                          <span className="fin-cat-bloqueio">{c.motivoBloqueio}</span>
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

      {!visiveis.length ? <p className="fin-empty-row">Nenhuma categoria com esse filtro.</p> : null}

      <p className="fin-cat-nota">
        Não existe apagar. Categoria que já classificou alguma coisa nunca é removida — o verbo não existe na
        rota, em vez de existir e ser negado. Desativar tira da lista de escolha e não move um centavo: o que
        estava nela continua somando na DRE.
      </p>
    </div>
  );
}
