"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { CustoPessoas, LinkProposto, Pessoa } from "@/lib/financeiro/pessoas";
import { brlPrecise } from "@/lib/financeiro/format";
import { urlDaOrigem } from "@/lib/url-origem";

import { FinSecaoColapsavel } from "./FinSecaoColapsavel";
import { FinPessoaCadastroApp } from "./FinPessoaCadastroApp";

/**
 * Cadastro de pessoa: área, vínculo, papel, status, saída, tipo de custo — e a
 * decisão sobre as ligações pessoa↔contraparte.
 *
 * Tudo isto já existia. Existia como script, como pergunta por chat, como
 * migration escrita à mão para atribuir área a 28 pessoas de uma vez. O que muda
 * aqui não é a capacidade, é quem a exerce e a que custo: a próxima área nova
 * nasce numa quinta-feira, por quem sabe a resposta, sem deploy.
 *
 * QUATRO DECISÕES DE DESENHO:
 *
 * 1. O CADASTRO É UMA SEÇÃO PRÓPRIA, NÃO SÓ A GAVETA DA TABELA. A tabela de
 *    cima lista quem teve LANÇAMENTO no recorte. Quatro pessoas estão sem área
 *    hoje — Alves, Obras 1, Obras 2, Teco — e três delas não têm contraparte
 *    nenhuma, então nunca apareceriam numa linha. Um editor que só existisse na
 *    gaveta seria incapaz de corrigir exatamente os cadastros mais incompletos.
 *
 * 2. ÁREA É COMBO COM CAMPO LIVRE, NÃO SELECT. O pedido do dono foi "definir e
 *    CRIAR áreas". Um <select> fechado exigiria migration para cada área nova, e
 *    um <input> puro deixaria "Obras", "obras" e "obras " virarem três times na
 *    mesma tabela — `TIME_SQL` compara o texto literalmente. O <datalist> dá as
 *    duas coisas: sugere as seis que existem e aceita a sétima; o servidor
 *    normaliza antes de gravar.
 *
 * 3. O QUE A ESCOLHA CONTRADIZ FICA VISÍVEL AO LADO DELA. Ao escolher o tipo de
 *    custo, o editor mostra em que categoria os lançamentos daquela pessoa estão
 *    HOJE. É como se vê que 281 lançamentos caíram em "Salários" numa empresa sem
 *    um único CLT — e a diferença entre o padrão escolhido e o realizado é o
 *    tamanho do trabalho de reclassificação que ainda falta.
 *
 * 4. CONFIRMAR LIGAÇÃO MOSTRA O DINHEIRO ANTES DO CLIQUE. Confirmar
 *    Felipe↔Marcelo Felipe moveu R$ 20.710,35 de time. A tela põe o valor no
 *    botão, e o servidor devolve quanto moveu de fato — porque uma ligação errada
 *    é permanente até alguém achar o erro, e é mais fácil recusar R$ 20 mil no
 *    lugar errado do que encontrá-los depois.
 */

type Props = { dados: CustoPessoas };

// ---------------------------------------------------------------------------
// A seção: o roster inteiro, com o editor embutido
// ---------------------------------------------------------------------------
export function FinPessoaCadastro({ dados }: Props) {
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<number | null>(null);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const ehPendente = (pessoa: Pessoa) => {
      const app = pessoa.cadastroApp;
      const appPendente = app
        ? app.whatsapp || app.email || app.cpf || app.pix || app.nascimento || app.senha
        : false;
      return (
        !pessoa.area ||
        pessoa.vinculo === "indefinido" ||
        (dados.categoriaPadraoDisponivel && !pessoa.categoriaPadrao) ||
        pessoa.contrapartesPropostas.length > 0 ||
        appPendente
      );
    };
    return dados.pessoas.filter((pessoa) => {
      if (!ehPendente(pessoa)) return false;
      if (!termo) return true;
      return `${pessoa.nome} ${pessoa.nomeLegal ?? ""} ${pessoa.area ?? ""}`.toLowerCase().includes(termo);
    });
  }, [dados.pessoas, busca, dados.categoriaPadraoDisponivel]);

  const semArea = dados.pessoas.filter((p) => !p.area).length;
  const indefinidos = dados.pessoas.filter((p) => p.vinculo === "indefinido").length;
  const propostas = dados.pessoas.reduce((soma, p) => soma + p.contrapartesPropostas.length, 0);

  const semApp = dados.pessoas.filter((p) => {
    const a = p.cadastroApp;
    return a && (a.whatsapp || a.email || a.cpf || a.pix || a.nascimento || a.senha);
  }).length;

  const pendencias =
    (semArea ? `${semArea} sem área` : "") +
    (semArea && (indefinidos || propostas || semApp) ? " · " : "") +
    (indefinidos ? `${indefinidos} vínculo indefinido` : "") +
    (indefinidos && (propostas || semApp) ? " · " : "") +
    (propostas ? `${propostas} ligação${propostas === 1 ? "" : "ões"} a decidir` : "") +
    ((propostas || semArea || indefinidos) && semApp ? " · " : "") +
    (semApp ? `${semApp} cadastro do app incompleto` : "");

  if (!dados.disponivel) return null;
  if (!lista.length && !busca.trim()) {
    return (
      <FinSecaoColapsavel
        className="fin-pessoas-cadastro"
        titulo="Pendências de cadastro"
        meta="nenhuma"
      >
        <p className="fin-card-hint fin-card-hint-curto">
          Área e vínculo editam na tabela Pessoas. Aqui só entra quem ainda tem pendência.
        </p>
      </FinSecaoColapsavel>
    );
  }

  return (
    <FinSecaoColapsavel
      className="fin-pessoas-cadastro"
      titulo="Pendências de cadastro"
      abertoPadrao
      meta={pendencias || `${lista.length} pendências`}
      ariaLabel="Pendências de cadastro"
    >
      <p className="fin-card-hint fin-card-hint-curto">
        Área e vínculo mudam na tabela Pessoas. Aqui: tipo de custo, ligações, contato/PIX/senha do app e quem ainda falta decidir.
      </p>
      <div className="fin-regra-form">
        <label className="fin-field">
          <span>Buscar</span>
          <input
            className="fin-input"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="nome ou área"
          />
        </label>
      </div>

      <div className="table-wrap">
        <table className="fin-table">
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>Área</th>
              <th>Vínculo</th>
              <th>Tipo de custo padrão</th>
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lista.map((pessoa) => (
              <LinhaPessoa
                key={pessoa.id}
                pessoa={pessoa}
                dados={dados}
                aberta={aberta === pessoa.id}
                alternar={() => setAberta(aberta === pessoa.id ? null : pessoa.id)}
              />
            ))}
            {!lista.length ? (
              <tr>
                <td colSpan={6} className="fin-empty-row">
                  Nenhuma pendência neste filtro.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </FinSecaoColapsavel>
  );
}

function LinhaPessoa({
  pessoa,
  dados,
  aberta,
  alternar
}: {
  pessoa: Pessoa;
  dados: CustoPessoas;
  aberta: boolean;
  alternar: () => void;
}) {
  const sugerida = pessoa.categoriaSugerida
    ? dados.categorias.find((c) => c.code === pessoa.categoriaSugerida)
    : null;

  return (
    <>
      <tr>
        <td>
          <span className="fin-desc">{pessoa.nome}</span>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <CelulaArea pessoa={pessoa} areas={dados.areas} />
          {pessoa.time === "sem_time" ? (
            <span className="fin-tag" title="Sem área nem via de pagamento: cai em 'Sem time'">
              sem time
            </span>
          ) : null}
        </td>
        <td className={pessoa.vinculo === "indefinido" || pessoa.vinculo === "irregular" ? "fin-badge-atencao" : undefined}>
          {pessoa.vinculoRotulo}
        </td>
        <td>
          {pessoa.categoriaPadrao ? (
            <span className="fin-code">
              {pessoa.categoriaPadrao} · {pessoa.categoriaPadraoNome}
            </span>
          ) : sugerida ? (
            <span className="fin-zero" title="Sugestão derivada do vínculo — ainda não gravada">
              sugerido {sugerida.code} · {sugerida.nome}
            </span>
          ) : (
            <span className="fin-zero">—</span>
          )}
        </td>
        <td>
          {pessoa.status === "ativo" ? "Ativo" : `Inativo${pessoa.fim ? ` desde ${pessoa.fim}` : ""}`}
          {pessoa.contrapartesPropostas.length ? (
            <span className="fin-badge-pendente">
              {pessoa.contrapartesPropostas.length}{" "}
              {pessoa.contrapartesPropostas.length === 1 ? "ligação a decidir" : "ligações a decidir"}
            </span>
          ) : null}
          {pessoa.cadastroApp &&
          (pessoa.cadastroApp.whatsapp ||
            pessoa.cadastroApp.email ||
            pessoa.cadastroApp.cpf ||
            pessoa.cadastroApp.pix ||
            pessoa.cadastroApp.nascimento ||
            pessoa.cadastroApp.senha) ? (
            <span className="fin-badge-pendente" title="WhatsApp, CPF, PIX, aniversário, e-mail ou senha do app">
              app incompleto
            </span>
          ) : null}
        </td>
        <td>
          <button type="button" className="fin-why" onClick={alternar} aria-expanded={aberta}>
            {aberta ? "fechar" : "editar"}
          </button>
        </td>
      </tr>
      {aberta ? (
        <tr>
          <td colSpan={6}>
            <FinPessoaEditor pessoa={pessoa} dados={dados} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Select na própria célula: mesma API/domínio do editor completo. */
export function CelulaArea({
  pessoa,
  areas
}: {
  pessoa: Pessoa;
  areas: CustoPessoas["areas"];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [emVoo, setEmVoo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function mudar(slug: string) {
    if (!slug || slug === (pessoa.area ?? "")) return;
    setErro(null);
    setEmVoo(true);
    try {
      const resposta = await fetch(urlDaOrigem(`/api/financeiro/pessoas/${pessoa.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area: slug })
      });
      const resultado = await resposta.json();
      if (!resposta.ok) {
        setErro(resultado.error ?? "não salvou");
        return;
      }
      startTransition(() => router.refresh());
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "não salvou");
    } finally {
      setEmVoo(false);
    }
  }

  const opcoes = [...areas];
  if (pessoa.area && !opcoes.some((a) => a.slug === pessoa.area)) {
    opcoes.unshift({
      slug: pessoa.area,
      nome: pessoa.areaRotulo ?? pessoa.area
    });
  }

  return (
    <span className="fin-celula-area">
      <select
        className="fin-select fin-select-inline"
        value={pessoa.area ?? ""}
        disabled={emVoo}
        aria-label={`Área de ${pessoa.nome}`}
        onChange={(evento) => void mudar(evento.target.value)}
      >
        {!pessoa.area ? <option value="">sem área</option> : null}
        {opcoes.map((item) => (
          <option key={item.slug} value={item.slug}>
            {item.nome}
          </option>
        ))}
      </select>
      {erro ? <span className="fin-badge-atencao">{erro}</span> : null}
    </span>
  );
}

/** Vínculo na linha — mesmo PATCH do editor. */
export function CelulaVinculo({
  pessoa,
  vinculos
}: {
  pessoa: Pessoa;
  vinculos: CustoPessoas["vinculosDominio"];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [emVoo, setEmVoo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function mudar(slug: string) {
    if (!slug || slug === pessoa.vinculo) return;
    setErro(null);
    setEmVoo(true);
    try {
      const resposta = await fetch(urlDaOrigem(`/api/financeiro/pessoas/${pessoa.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employmentType: slug })
      });
      const resultado = await resposta.json();
      if (!resposta.ok) {
        setErro(resultado.error ?? "não salvou");
        return;
      }
      startTransition(() => router.refresh());
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "não salvou");
    } finally {
      setEmVoo(false);
    }
  }

  return (
    <span className="fin-celula-area">
      <select
        className="fin-select fin-select-inline"
        value={pessoa.vinculo}
        disabled={emVoo}
        aria-label={`Vínculo de ${pessoa.nome}`}
        onChange={(evento) => void mudar(evento.target.value)}
      >
        {vinculos.map((item) => (
          <option key={item.slug} value={item.slug}>
            {item.nome}
          </option>
        ))}
      </select>
      {erro ? <span className="fin-badge-atencao">{erro}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// O formulário de uma pessoa
// ---------------------------------------------------------------------------
export function FinPessoaEditor({ pessoa, dados }: { pessoa: Pessoa; dados: CustoPessoas }) {
  const router = useRouter();
  const [salvando, startTransition] = useTransition();
  const [emVoo, setEmVoo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [area, setArea] = useState(pessoa.areaRotulo ?? "");
  const [vinculo, setVinculo] = useState(pessoa.vinculo);
  const [papel, setPapel] = useState(pessoa.papel ?? "");
  const [status, setStatus] = useState(pessoa.status);
  const [inicio, setInicio] = useState(pessoa.inicio ?? "");
  const [fim, setFim] = useState(pessoa.fim ?? "");
  const [nucleo, setNucleo] = useState(pessoa.defaultNucleo ?? "");
  const [categoria, setCategoria] = useState(pessoa.categoriaPadrao ?? "");

  // Como o dinheiro JÁ confirmado desta pessoa está classificado hoje.
  const usoAtual = useMemo(
    () => dados.usoCategoria.filter((u) => u.personId === pessoa.id).sort((a, b) => b.cents - a.cents),
    [dados.usoCategoria, pessoa.id]
  );
  const totalRealizado = usoAtual.reduce((soma, u) => soma + u.cents, 0);
  const sugerida = pessoa.categoriaSugerida
    ? dados.categorias.find((c) => c.code === pessoa.categoriaSugerida)
    : null;

  const dataInvertida = Boolean(inicio && fim && fim < inicio);

  async function salvar() {
    setErro(null);
    setAviso(null);

    const corpo: Record<string, unknown> = {};
    // Só o que MUDOU vai no corpo. Mandar o formulário inteiro faria toda edição
    // de área gravar também um "vínculo = o mesmo vínculo", e a trilha encheria
    // de campos que ninguém tocou — tornando ilegível justamente o registro que
    // existe para ser lido meses depois.
    if (area.trim() !== (pessoa.areaRotulo ?? "")) corpo.area = area;
    if (vinculo !== pessoa.vinculo) corpo.employmentType = vinculo;
    if (papel.trim() !== (pessoa.papel ?? "")) corpo.role = papel.trim() || null;
    if (status !== pessoa.status) corpo.status = status;
    if (inicio !== (pessoa.inicio ?? "")) corpo.startDate = inicio || null;
    if (fim !== (pessoa.fim ?? "")) corpo.endDate = fim || null;
    if (nucleo !== (pessoa.defaultNucleo ?? "")) corpo.defaultNucleo = nucleo || null;
    if (dados.categoriaPadraoDisponivel && categoria !== (pessoa.categoriaPadrao ?? "")) {
      corpo.defaultCategoryCode = categoria || null;
    }

    if (!Object.keys(corpo).length) {
      setAviso("Nada mudou — nenhuma alteração enviada.");
      return;
    }

    setEmVoo(true);
    try {
      const resposta = await fetch(urlDaOrigem(`/api/financeiro/pessoas/${pessoa.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo)
      });
      const resultado = await resposta.json();
      if (!resposta.ok) {
        setErro(resultado.error ?? "não consegui salvar");
        return;
      }
      const alterados: string[] = resultado.alterados ?? [];
      setAviso(
        alterados.length
          ? `Salvo: ${alterados.join(", ")}. A alteração vale para todo o histórico, não só de hoje em diante.`
          : "Nada mudou no banco: o valor enviado já era o gravado (área diferente só na acentuação, por exemplo)."
      );
      startTransition(() => router.refresh());
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "não consegui salvar");
    } finally {
      setEmVoo(false);
    }
  }

  return (
    <div className="fin-why-popover" role="group" aria-label={`Cadastro de ${pessoa.nome}`}>
      {erro ? (
        <div className="fin-alert" role="alert">
          {erro}
        </div>
      ) : null}
      {aviso ? (
        <div className="fin-alert" role="status">
          {aviso}
        </div>
      ) : null}

      <div className="fin-regra-form">
        <label className="fin-field">
          <span>Área</span>
          <input
            className="fin-input"
            list={`fin-areas-${pessoa.id}`}
            value={area}
            onChange={(evento) => setArea(evento.target.value)}
            placeholder="consultoria, obras… ou uma nova"
          />
          <em className="fin-field-hint">
            Escolha uma das existentes ou digite uma nova — ela passa a valer para as próximas pessoas. Hardware e
            Software também definem o time desta tela.
          </em>
        </label>

        <label className="fin-field">
          <span>Vínculo</span>
          <select className="fin-select" value={vinculo} onChange={(evento) => setVinculo(evento.target.value)}>
            {dados.vinculosDominio.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.nome}
              </option>
            ))}
          </select>
          <em className="fin-field-hint">
            Decide linha de DRE e encargo. &quot;Irregular&quot; é quem presta serviço, recebe e não tem enquadramento
            nenhum.
          </em>
        </label>

        <label className="fin-field">
          <span>Papel</span>
          <input
            className="fin-input"
            value={papel}
            onChange={(evento) => setPapel(evento.target.value)}
            placeholder="ex.: sócio investidor"
          />
        </label>

        <label className="fin-field">
          <span>Situação</span>
          <select className="fin-select" value={status} onChange={(evento) => setStatus(evento.target.value)}>
            {dados.statusDominio.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="fin-field">
          <span>Entrada</span>
          <input
            className="fin-input"
            type="date"
            value={inicio}
            onChange={(evento) => setInicio(evento.target.value)}
          />
        </label>

        <label className="fin-field">
          <span>Saída</span>
          <input className="fin-input" type="date" value={fim} onChange={(evento) => setFim(evento.target.value)} />
          {dataInvertida ? (
            <em className="fin-field-hint fin-badge-atencao">
              A saída ({fim}) é anterior à entrada ({inicio}) — o servidor vai recusar.
            </em>
          ) : (
            <em className="fin-field-hint">
              Marcar a saída não apaga o histórico: o que a pessoa custou continua somando nos meses em que custou.
            </em>
          )}
        </label>

        <label className="fin-field">
          <span>Via de pagamento (núcleo)</span>
          <select className="fin-select" value={nucleo} onChange={(evento) => setNucleo(evento.target.value)}>
            <option value="">nenhuma</option>
            {dados.nucleos.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.nome}
              </option>
            ))}
          </select>
          <em className="fin-field-hint">
            É por onde o dinheiro passa, não onde a pessoa trabalha: Obras e Consultoria definem o time de quem não tem
            área de Hardware ou Software.
          </em>
        </label>

        <label className="fin-field fin-field-wide">
          <span>Tipo de custo padrão</span>
          <select
            className="fin-select"
            value={categoria}
            disabled={!dados.categoriaPadraoDisponivel}
            onChange={(evento) => setCategoria(evento.target.value)}
          >
            <option value="">
              {sugerida ? `sem padrão gravado (o vínculo sugere ${sugerida.code} · ${sugerida.nome})` : "sem padrão"}
            </option>
            {dados.categorias.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} · {item.nome}
                {item.usos ? ` (${item.usos} usos)` : " (sem uso)"}
              </option>
            ))}
          </select>
          {dados.categoriaPadraoDisponivel ? (
            <em className="fin-field-hint">
              Onde o pagamento a esta pessoa deve cair na DRE: pró-labore para sócio, estágio para estagiário, em vez
              de tudo em Salários. É cadastro, não reclassificação — ele orienta o que vier daqui para frente e serve
              de gabarito para corrigir o que já entrou.
            </em>
          ) : (
            <em className="fin-field-hint fin-badge-atencao">
              A coluna <code>fin_person.default_category_id</code> ainda não existe neste banco. O SQL está no relatório
              de entrega e precisa ser aplicado por quem administra o schema; o campo liga sozinho depois disso.
            </em>
          )}
        </label>
      </div>

      {usoAtual.length ? (
        <>
          <p style={{ marginTop: 12 }}>
            <strong>Como os {brlPrecise(totalRealizado)} desta pessoa estão classificados hoje</strong>
          </p>
          <table className="fin-table">
            <thead>
              <tr>
                <th>Categoria no razão</th>
                <th className="num">Lanç.</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {usoAtual.map((linha) => (
                <tr key={linha.code ?? "sem"}>
                  <td>
                    {linha.code ? (
                      <>
                        <span className="fin-code">{linha.code}</span> {linha.nome}
                      </>
                    ) : (
                      <span className="fin-badge-atencao">sem categoria no extrato</span>
                    )}
                    {categoria && linha.code && linha.code !== categoria ? (
                      <span className="fin-tag" title="Está em categoria diferente do padrão escolhido">
                        difere do padrão
                      </span>
                    ) : null}
                  </td>
                  <td className="num">{linha.n}</td>
                  <td className="num fin-table-money">{brlPrecise(linha.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fin-card-hint">
            Escolher o padrão acima <strong>não</strong> reclassifica estas linhas. Ele diz para onde o custo desta
            pessoa deveria ir; mover o que já entrou é trabalho da fila de revisão, e a diferença entre as duas colunas
            é o tamanho dele.
          </p>
        </>
      ) : null}

      <div className="fin-import-acoes">
        <button
          type="button"
          className="fin-btn-primary"
          disabled={emVoo || salvando || dataInvertida}
          onClick={() => void salvar()}
        >
          {emVoo ? "Salvando…" : "Salvar cadastro"}
        </button>
      </div>

      <FinPessoaCadastroApp personId={pessoa.id} nome={pessoa.nome} />

      {pessoa.contrapartesPropostas.length ? (
        <>
          <p style={{ marginTop: 16 }}>
            <strong>Ligações esperando decisão</strong>
          </p>
          <table className="fin-table">
            <thead>
              <tr>
                <th>Contraparte no extrato</th>
                <th>Como foi proposta</th>
                <th className="num">Lanç.</th>
                <th className="num">Entra no custo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pessoa.contrapartesPropostas.map((cp) => (
                <tr key={cp.linkId}>
                  <td>
                    {cp.nome}
                    {cp.ehBanco ? <span className="fin-badge-pendente">é banco, não pessoa</span> : null}
                    {cp.documento ? <span className="fin-desc-sub">{cp.documento}</span> : null}
                  </td>
                  <td>
                    {cp.metodo} · confiança {cp.confianca.toFixed(2)}
                  </td>
                  <td className="num">{cp.n}</td>
                  <td className="num fin-table-money">{brlPrecise(cp.realizadoCents)}</td>
                  <td>
                    <FinLigacaoAcoes
                      linkId={cp.linkId}
                      personId={pessoa.id}
                      pessoa={pessoa.nome}
                      contraparte={cp.nome}
                      valorCents={cp.realizadoCents}
                      ehBanco={cp.ehBanco}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {pessoa.contrapartes.length ? (
        <p className="fin-card-hint" style={{ marginTop: 10 }}>
          Confirmadas:{" "}
          {pessoa.contrapartes
            .map((cp) => `${cp.nome} (${brlPrecise(cp.realizadoCents)}${cp.decididoPor ? `, por ${cp.decididoPor}` : ""})`)
            .join(" · ")}
          .
        </p>
      ) : null}

      {/* Um datalist por pessoa: a gaveta da tabela e a seção de cadastro podem
          estar abertas ao mesmo tempo, e dois <datalist> com o mesmo id fazem o
          navegador ignorar o segundo. */}
      <datalist id={`fin-areas-${pessoa.id}`}>
        {dados.areas.map((item) => (
          <option key={item.slug} value={item.nome} />
        ))}
      </datalist>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmar / rejeitar uma ligação — o mesmo componente na gaveta e na cobertura
// ---------------------------------------------------------------------------
export function FinLigacaoAcoes({
  linkId,
  personId,
  pessoa,
  contraparte,
  valorCents,
  ehBanco
}: {
  linkId: number;
  personId: number;
  pessoa: string;
  contraparte: string;
  valorCents: number;
  ehBanco: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [emVoo, setEmVoo] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pedirConfirmacaoBanco, setPedirConfirmacaoBanco] = useState(false);

  async function decidir(status: "confirmado" | "rejeitado", aceitarRiscoBanco = false) {
    setErro(null);
    setMensagem(null);
    setEmVoo(true);
    try {
      const resposta = await fetch(urlDaOrigem(`/api/financeiro/pessoas/${personId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ligacoes: [{ id: linkId, status, aceitarRiscoBanco }] })
      });
      const resultado = await resposta.json();
      if (!resposta.ok) {
        setErro(resultado.error ?? "não consegui gravar a decisão");
        if (status === "confirmado" && ehBanco) setPedirConfirmacaoBanco(true);
        return;
      }
      const moveu = Number(resultado.moveuCents ?? 0);
      setMensagem(
        status === "confirmado"
          ? `Confirmado: ${brlPrecise(moveu)} passam a somar em ${pessoa}.`
          : `Rejeitado. ${contraparte} não soma para ninguém, e a recusa fica registrada para o importador não propor de novo.`
      );
      startTransition(() => router.refresh());
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "não consegui gravar a decisão");
    } finally {
      setEmVoo(false);
    }
  }

  if (mensagem) return <span className="fin-desc-sub">{mensagem}</span>;

  return (
    <div className="fin-import-acoes" style={{ marginTop: 0 }}>
      <button
        type="button"
        className="fin-btn-ghost fin-btn-mini"
        disabled={emVoo}
        onClick={() => void decidir("confirmado")}
        title={`Passa a somar ${brlPrecise(valorCents)} no custo de ${pessoa}`}
      >
        Confirmar {brlPrecise(valorCents)}
      </button>
      <button
        type="button"
        className="fin-btn-ghost fin-btn-mini fin-btn-perigo"
        disabled={emVoo}
        onClick={() => void decidir("rejeitado")}
      >
        Rejeitar
      </button>
      {pedirConfirmacaoBanco ? (
        <button
          type="button"
          className="fin-btn-ghost fin-btn-mini fin-btn-perigo"
          disabled={emVoo}
          onClick={() => void decidir("confirmado", true)}
        >
          Sei que é banco — confirmar mesmo assim
        </button>
      ) : null}
      {erro ? <span className="fin-badge-atencao">{erro}</span> : null}
    </div>
  );
}

/** Atalho para a tabela de ligações propostas da seção de cobertura. */
export function FinLigacaoPropostaAcoes({ link }: { link: LinkProposto }) {
  return (
    <FinLigacaoAcoes
      linkId={link.linkId}
      personId={link.personId}
      pessoa={link.pessoa}
      contraparte={link.contraparte}
      valorCents={link.saidaCents}
      ehBanco={link.ehBanco}
    />
  );
}
