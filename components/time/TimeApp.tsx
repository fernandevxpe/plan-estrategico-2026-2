"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SeloCamada, brl } from "@/components/financeiro/Certeza";

/**
 * O app do time, inteiro, num componente de cliente só.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM COMPONENTE E NÃO SEIS
 * ---------------------------------------------------------------------------
 * As seis telas compartilham três coisas que precisam estar sempre em acordo: a
 * sessão (quem sou), as opções (tipos e categorias) e a lista de envios (que
 * muda a cada envio). Em seis componentes, cada um buscaria de novo e a lista
 * mostraria o estado de antes do envio que a pessoa acabou de fazer — o bug
 * clássico de "mandei e não apareceu", que faz a pessoa mandar duas vezes.
 *
 * ---------------------------------------------------------------------------
 * AS DUAS COISAS QUE ESTA TELA DIZ EM VOZ ALTA
 * ---------------------------------------------------------------------------
 * 1. **A identidade é declarada.** A credencial da plataforma é uma só para o
 *    time inteiro; ela não sabe quem é quem. A tela não finge que sabe.
 * 2. **Enviar não é aprovar.** Nada aqui vira dinheiro. Todo formulário fecha
 *    dizendo o que vai acontecer depois, porque a expectativa errada ("mandei,
 *    logo vou receber") é o que gera a cobrança na semana seguinte.
 */

type Sessao = {
  personId: number;
  nome: string;
  prova: "declarada" | "pin" | "senha";
  admin: boolean;
  trocarSenha: boolean;
  expiraEm: string;
};
type Porta = "basic" | "sessao";
type Pessoa = { id: number; nome: string; area: string | null; exigePin: boolean };
type Opcoes = {
  tipos: { slug: string; nome: string; exigeNfe: boolean }[];
  categorias: { id: number; rotulo: string }[];
};
type Envio = {
  origem: string;
  origemId: number;
  code: string;
  titulo: string;
  valorCents: number | null;
  dataRef: string | null;
  status: string;
  estado: "rascunho" | "aguardando" | "aprovado" | "devolvido" | "recusado" | "concluido";
  resposta: string | null;
  decididoEm: string | null;
  decididoPor: string | null;
  criadoEm: string;
  itens: number;
  itensComAnexo: number;
};

export type AbaTime = "inicio" | "reembolso" | "custo" | "nota" | "compra" | "envios";

const HOJE = () => new Date().toISOString().slice(0, 10);

/** O vocabulário de estado do time — três palavras, não sete status de banco. */
const ESTADO_ROTULO: Record<Envio["estado"], { texto: string; camada: Parameters<typeof SeloCamada>[0]["camada"] }> = {
  rascunho: { texto: "rascunho", camada: "indeterminado" },
  aguardando: { texto: "aguardando análise", camada: "provavel" },
  aprovado: { texto: "aprovado", camada: "firme" },
  concluido: { texto: "pago", camada: "firme" },
  devolvido: { texto: "voltou para você", camada: "atrasado" },
  recusado: { texto: "recusado", camada: "atrasado" }
};

const ORIGEM_ROTULO: Record<string, string> = {
  reembolso: "Reembolso",
  compra: "Compra",
  custo: "Custo",
  nota_entrada: "Nota"
};

export function TimeApp({ aba, disponivel, motivo }: { aba: AbaTime; disponivel: boolean; motivo: string | null }) {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [porta, setPorta] = useState<Porta>("sessao");
  const [opcoes, setOpcoes] = useState<Opcoes>({ tipos: [], categorias: [] });
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [recado, setRecado] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);

  const carregarSessao = useCallback(async () => {
    const r = await fetch("/api/time/sessao", { cache: "no-store" });
    const j = await r.json();
    setSessao(j.sessao ?? null);
    setPessoas(j.pessoas ?? []);
    setPorta((j.porta as Porta) ?? "sessao");
    return j.sessao as Sessao | null;
  }, []);

  const carregarEnvios = useCallback(async () => {
    const r = await fetch("/api/time/envios", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    setEnvios(j.envios ?? []);
    setOpcoes(j.opcoes ?? { tipos: [], categorias: [] });
  }, []);

  useEffect(() => {
    if (!disponivel) {
      setCarregando(false);
      return;
    }
    (async () => {
      const s = await carregarSessao();
      if (s) await carregarEnvios();
      setCarregando(false);
    })();
  }, [disponivel, carregarSessao, carregarEnvios]);

  const aoEnviar = useCallback(
    async (texto: string) => {
      setRecado({ tom: "ok", texto });
      await carregarEnvios();
    },
    [carregarEnvios]
  );

  if (!disponivel) {
    return (
      <div className="time-aviso">
        <h2>O app do time ainda não está de pé neste ambiente</h2>
        <p>{motivo ?? "a migration 0105 não foi aplicada"}</p>
        <p className="time-sub">
          As telas, as rotas e o schema existem e estão validados. Falta um passo operacional — aplicar a migration —
          que esta entrega deliberadamente não deu: nesta base, migração validada não é migração aplicada.
        </p>
      </div>
    );
  }

  if (carregando) return <div className="time-aviso">carregando…</div>;

  const recarregar = async () => {
    const s = await carregarSessao();
    if (s) await carregarEnvios();
  };

  if (!sessao) return <Identificacao pessoas={pessoas} porta={porta} aoEntrar={recarregar} />;

  // A senha que o admin definiu é de ENTREGA: quem a definiu conhece o valor.
  // Ela não pode sobreviver à primeira sessão, e por isso esta tela vem ANTES
  // de qualquer outra — não é um aviso que dá para adiar.
  if (sessao.trocarSenha) return <TrocarSenha nome={sessao.nome} aoTrocar={recarregar} />;

  return (
    <div className="time-app">
      <CabecalhoPessoa
        sessao={sessao}
        aoSair={async () => {
          await fetch("/api/time/sessao", { method: "DELETE" });
          setSessao(null);
          setEnvios([]);
        }}
      />

      {recado ? (
        <div className={recado.tom === "ok" ? "time-recado ok" : "time-recado erro"} role="status">
          {recado.texto}
        </div>
      ) : null}

      {aba === "inicio" ? <Inicio envios={envios} /> : null}
      {aba === "reembolso" ? <FormReembolso opcoes={opcoes} aoEnviar={aoEnviar} aoFalhar={setRecado} /> : null}
      {aba === "custo" ? <FormEnvio kind="custo" opcoes={opcoes} aoEnviar={aoEnviar} aoFalhar={setRecado} /> : null}
      {aba === "nota" ? <FormEnvio kind="nota_entrada" opcoes={opcoes} aoEnviar={aoEnviar} aoFalhar={setRecado} /> : null}
      {aba === "compra" ? <FormCompra aoEnviar={aoEnviar} aoFalhar={setRecado} /> : null}
      {aba === "envios" ? <ListaEnvios envios={envios} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Identidade
// ---------------------------------------------------------------------------

function Identificacao({
  pessoas,
  porta,
  aoEntrar
}: {
  pessoas: Pessoa[];
  porta: Porta;
  aoEntrar: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // O caminho declarado (clicar no próprio nome) só existe quando a requisição
  // passou pela credencial compartilhada da plataforma. Pela porta do app não
  // há nada por trás, e escolher um nome numa lista viraria "escolha de quem
  // você quer ser". Ver o comentário em app/api/time/sessao/route.ts.
  const podeDeclarar = porta === "basic" && pessoas.length > 0;
  const [declarado, setDeclarado] = useState<number | null>(null);
  const [pin, setPin] = useState("");
  const escolhida = pessoas.find((p) => p.id === declarado);

  async function postar(corpo: Record<string, unknown>) {
    setEnviando(true);
    setErro(null);
    const r = await fetch("/api/time/sessao", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo)
    });
    const j = await r.json().catch(() => ({}));
    setEnviando(false);
    if (!r.ok) return setErro(j.error ?? "não consegui entrar");
    await aoEntrar();
  }

  return (
    <div className="time-identidade">
      <h2>Entrar</h2>
      <p className="time-sub">
        Use o seu e-mail e a sua senha. É essa entrada que faz cada lançamento nascer com o seu nome — e é por ela que
        você vê o seu reembolso, e só o seu.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!email.trim() || !senha) return setErro("informe e-mail e senha");
          void postar({ email: email.trim(), senha });
        }}
      >
        <label className="campo">
          <span>E-mail</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="voce.xpenergy@gmail.com"
          />
        </label>
        <label className="campo">
          <span>Senha</span>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password"
          />
        </label>

        {erro ? <p className="time-erro">{erro}</p> : null}

        <button type="submit" className="time-botao" disabled={enviando || !email.trim() || !senha}>
          {enviando ? "entrando…" : "entrar"}
        </button>
      </form>

      <p className="time-sub">Sem senha ainda? Peça ao Fernando ou ao Igor — eles cadastram e te entregam uma.</p>

      {podeDeclarar ? (
        <details className="time-declarar">
          <summary>Entrar declarando quem sou (só pelo navegador da plataforma)</summary>
          <p className="time-sub">
            A senha da plataforma é a mesma para o time inteiro: ela sabe que você é do time, não sabe qual pessoa. Por
            isso a escolha abaixo fica registrada como <strong>declaração</strong>, não como prova — e esta porta não
            existe no app instalado no celular.
          </p>
          <div className="time-pessoas">
            {pessoas.map((p) => (
              <button
                key={p.id}
                type="button"
                className={declarado === p.id ? "time-pessoa ativa" : "time-pessoa"}
                onClick={() => {
                  setDeclarado(p.id);
                  setErro(null);
                }}
              >
                <span className="time-pessoa-nome">{p.nome}</span>
                {p.area ? <span className="time-pessoa-area">{p.area}</span> : null}
                {p.exigePin ? <span className="time-pessoa-pin">PIN</span> : null}
              </button>
            ))}
          </div>
          {escolhida?.exigePin ? (
            <label className="campo">
              <span>PIN de {escolhida.nome}</span>
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoComplete="off"
              />
            </label>
          ) : null}
          <button
            type="button"
            className="time-botao secundario"
            onClick={() => {
              if (!declarado) return setErro("escolha quem é você");
              void postar({ personId: declarado, pin: pin || null });
            }}
            disabled={enviando || !declarado}
          >
            {enviando ? "entrando…" : "entrar declarando"}
          </button>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Troca obrigatória da senha de entrega.
 *
 * Não há botão de "depois". A senha atual foi definida por outra pessoa, que a
 * conhece — adiar a troca é manter uma credencial compartilhada com quem não
 * deveria mais tê-la.
 */
function TrocarSenha({ nome, aoTrocar }: { nome: string; aoTrocar: () => Promise<void> }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [repetida, setRepetida] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const curta = nova.length > 0 && nova.length < 8;
  const diferem = repetida.length > 0 && nova !== repetida;

  async function trocar(e: React.FormEvent) {
    e.preventDefault();
    if (nova !== repetida) return setErro("as duas senhas novas não são iguais");
    setEnviando(true);
    setErro(null);
    const r = await fetch("/api/time/senha", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ atual, nova })
    });
    const j = await r.json().catch(() => ({}));
    setEnviando(false);
    if (!r.ok) return setErro(j.error ?? "não consegui trocar a senha");
    await aoTrocar();
  }

  return (
    <div className="time-identidade">
      <h2>Escolha uma senha sua, {nome.split(" ")[0]}</h2>
      <p className="time-sub">
        A senha que você recebeu foi criada por outra pessoa, e ela conhece o valor. Antes de qualquer outra coisa,
        troque por uma que só você saiba. As outras sessões abertas com a senha antiga vão cair.
      </p>
      <form onSubmit={trocar}>
        <label className="campo">
          <span>Senha que você recebeu</span>
          <input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="campo">
          <span>Nova senha (mínimo 8 caracteres)</span>
          <input type="password" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" />
          {curta ? <span className="time-erro">faltam {8 - nova.length} caractere(s)</span> : null}
        </label>
        <label className="campo">
          <span>Repita a nova senha</span>
          <input type="password" value={repetida} onChange={(e) => setRepetida(e.target.value)} autoComplete="new-password" />
          {diferem ? <span className="time-erro">as duas não são iguais</span> : null}
        </label>
        {erro ? <p className="time-erro">{erro}</p> : null}
        <button type="submit" className="time-botao" disabled={enviando || !atual || nova.length < 8 || nova !== repetida}>
          {enviando ? "trocando…" : "trocar e continuar"}
        </button>
      </form>
    </div>
  );
}

function CabecalhoPessoa({ sessao, aoSair }: { sessao: Sessao; aoSair: () => Promise<void> }) {
  return (
    <div className="time-quem">
      <div>
        <strong>{sessao.nome}</strong>
        <span className="time-prova" title={
          sessao.prova === "declarada"
            ? "a credencial é compartilhada pelo time: você declarou quem é, e ninguém provou. Tudo que você enviar fica marcado assim."
            : "identidade conferida por PIN"
        }>
          {sessao.prova === "declarada" ? "identidade declarada" : "identidade conferida"}
        </span>
      </div>
      <button type="button" className="time-link" onClick={aoSair}>
        não sou eu
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------

function Inicio({ envios }: { envios: Envio[] }) {
  const aguardando = envios.filter((e) => e.estado === "aguardando");
  const voltaram = envios.filter((e) => e.estado === "devolvido" || e.estado === "recusado");

  return (
    <>
      <div className="time-atalhos">
        <Atalho href="/time/reembolso" titulo="Pedir reembolso" texto="Gastei do meu bolso e quero de volta" icone="↩" />
        <Atalho href="/time/custo" titulo="Lançar um custo" texto="A empresa pagou ou vai pagar" icone="↓" />
        <Atalho href="/time/nota" titulo="Enviar uma nota" texto="Nota fiscal que chegou para nós" icone="▤" />
        <Atalho href="/time/compra" titulo="Pedir uma compra" texto="Com o link do que precisa ser comprado" icone="＋" />
      </div>

      {voltaram.length > 0 ? (
        <section className="time-secao">
          <h2>Voltou para você</h2>
          <ListaEnvios envios={voltaram} compacta />
        </section>
      ) : null}

      <section className="time-secao">
        <h2>Esperando resposta {aguardando.length > 0 ? <span className="time-contador">{aguardando.length}</span> : null}</h2>
        {aguardando.length === 0 ? (
          <p className="time-sub">Nada pendente. O que você mandou já foi respondido.</p>
        ) : (
          <ListaEnvios envios={aguardando} compacta />
        )}
      </section>

      <p className="time-sub time-rodape">
        <Link href="/time/envios">Ver tudo que eu já enviei →</Link>
      </p>
    </>
  );
}

function Atalho({ href, titulo, texto, icone }: { href: string; titulo: string; texto: string; icone: string }) {
  return (
    <Link href={href} className="time-atalho">
      <span className="time-atalho-icone" aria-hidden>
        {icone}
      </span>
      <span>
        <strong>{titulo}</strong>
        <span>{texto}</span>
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Formulários
// ---------------------------------------------------------------------------

type AoEnviar = (texto: string) => Promise<void>;
type AoFalhar = (r: { tom: "ok" | "erro"; texto: string }) => void;

/**
 * Envia o formulário como multipart quando há arquivo, JSON quando não há.
 *
 * Devolve a mensagem de erro do servidor em vez de "erro ao enviar": a
 * mensagem daqui é escrita para a pessoa ("este tipo exige a chave da NF-e"),
 * e trocá-la por um genérico desperdiça a única explicação que existe.
 */
/**
 * Encolhe a foto ANTES de sair do telefone.
 *
 * POR QUE ISTO É O ITEM MAIS IMPORTANTE DESTE ARQUIVO
 * O comprovante é gravado como `bytea` no Postgres, e o backup diário serializa
 * a tabela inteira com `row_to_json` — que emite bytea em hex e DOBRA o
 * tamanho. Com 14 dias de retenção, cada MB de anexo vira ~14 MB guardados.
 * Foto de celular tem 3–5 MB e é JPEG, então nenhum gzip depois disso recupera
 * nada: 193 comprovantes levariam o backup de 32 MB para ~8 GB.
 *
 * Reduzir para 1600px no lado maior e requantizar em JPEG 0.8 leva a mesma foto
 * para ~250 KB — legível para conferir uma nota, e 12× menor. É o único ganho
 * de uma ordem de grandeza disponível, e ele custa doze linhas.
 *
 * PDF e XML passam intactos: não são imagem, e um PDF de nota já é pequeno.
 * Se qualquer passo falhar (navegador antigo, HEIC que o canvas não decodifica),
 * devolve o arquivo original — anexo grande é melhor que anexo nenhum.
 */
const LADO_MAXIMO = 1600;
const QUALIDADE = 0.8;

async function encolherImagem(arquivo: File): Promise<File> {
  if (!arquivo.type.startsWith("image/")) return arquivo;
  // Abaixo de 400 KB não vale o reencode: o ganho é pequeno e a requantização
  // sempre perde alguma nitidez do texto da nota.
  if (arquivo.size <= 400 * 1024) return arquivo;

  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
    const largura = Math.round(bitmap.width * escala);
    const altura = Math.round(bitmap.height * escala);

    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) return arquivo;
    ctx.drawImage(bitmap, 0, 0, largura, altura);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALIDADE));
    if (!blob || blob.size >= arquivo.size) return arquivo;

    const nome = arquivo.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], nome, { type: "image/jpeg", lastModified: arquivo.lastModified });
  } catch {
    return arquivo;
  }
}

async function postar(url: string, dados: Record<string, unknown>, arquivo: File | null) {
  let resposta: Response;
  if (arquivo) {
    const form = new FormData();
    for (const [k, v] of Object.entries(dados)) {
      if (v === null || v === undefined || v === "") continue;
      form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    form.append("arquivo", await encolherImagem(arquivo));
    resposta = await fetch(url, { method: "POST", body: form });
  } else {
    resposta = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(dados)
    });
  }
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.error ?? "não consegui enviar");
  return corpo;
}

function FormReembolso({ opcoes, aoEnviar, aoFalhar }: { opcoes: Opcoes; aoEnviar: AoEnviar; aoFalhar: AoFalhar }) {
  const [tipo, setTipo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [data, setData] = useState(HOJE());
  const [valor, setValor] = useState("");
  const [nfe, setNfe] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const tipoEscolhido = opcoes.tipos.find((t) => t.slug === tipo);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await postar("/api/time/reembolso", { tipo, descricao, expenseDate: data, valor, nfeKey: nfe }, arquivo);
      await aoEnviar(`Reembolso de ${descricao} enviado. Ele entra na competência de ${data.slice(5, 7)}/${data.slice(0, 4)}.`);
      setDescricao("");
      setValor("");
      setNfe("");
      setArquivo(null);
      if (arquivoRef.current) arquivoRef.current.value = "";
    } catch (erro) {
      aoFalhar({ tom: "erro", texto: (erro as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="time-form" onSubmit={enviar}>
      <h2>Pedir reembolso</h2>
      <p className="time-sub">
        O que você pagou do seu bolso e a empresa devolve. O reembolso é pago junto com o fixo do mês seguinte.
      </p>

      <label className="campo">
        <span>Tipo</span>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">— escolha —</option>
          {opcoes.tipos.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.nome}
              {t.exigeNfe ? " (exige NF-e)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="campo">
        <span>O que foi</span>
        <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="almoço com o cliente X" required />
      </label>

      <div className="campo-par">
        <label className="campo">
          <span>Quando</span>
          <input type="date" value={data} max={HOJE()} onChange={(e) => setData(e.target.value)} required />
        </label>
        <label className="campo">
          <span>Quanto</span>
          <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" required />
        </label>
      </div>

      {tipoEscolhido?.exigeNfe ? (
        <label className="campo">
          <span>Chave da NF-e (44 dígitos)</span>
          <input value={nfe} onChange={(e) => setNfe(e.target.value)} inputMode="numeric" />
        </label>
      ) : null}

      <label className="campo">
        <span>Comprovante</span>
        <input
          ref={arquivoRef}
          type="file"
          accept="image/*,application/pdf,.xml"
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
        />
        <small>
          Foto da nota ou do cupom. Hoje <strong>nenhum</strong> dos 193 itens de reembolso desta base tem comprovante
          anexado — quem aprova está confiando no número digitado. Sem ele o pedido entra do mesmo jeito, e a fila
          mostra que falta.
        </small>
      </label>

      <button className="time-botao" disabled={enviando}>
        {enviando ? "enviando…" : "enviar reembolso"}
      </button>
      <p className="time-nota">Enviar não é aprovar. Isto vira um pedido na fila de quem decide.</p>
    </form>
  );
}

function FormEnvio({
  kind,
  opcoes,
  aoEnviar,
  aoFalhar
}: {
  kind: "custo" | "nota_entrada";
  opcoes: Opcoes;
  aoEnviar: AoEnviar;
  aoFalhar: AoFalhar;
}) {
  const nota = kind === "nota_entrada";
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(HOJE());
  const [vencimento, setVencimento] = useState("");
  const [pagamento, setPagamento] = useState(nota ? "boleto" : "a_definir");
  const [fornecedor, setFornecedor] = useState("");
  const [nfeKey, setNfeKey] = useState("");
  const [nfeNumero, setNfeNumero] = useState("");
  const [categoria, setCategoria] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await postar(
        "/api/time/envio",
        {
          kind,
          titulo,
          descricao,
          valor,
          data,
          vencimento,
          pagamento,
          fornecedor,
          nfeKey,
          nfeNumero,
          categoriaSugerida: categoria
        },
        arquivo
      );
      await aoEnviar(`${nota ? "Nota" : "Custo"} ${r.code} enviado para análise.`);
      setTitulo("");
      setValor("");
      setDescricao("");
      setNfeKey("");
      setNfeNumero("");
      setArquivo(null);
      if (arquivoRef.current) arquivoRef.current.value = "";
    } catch (erro) {
      aoFalhar({ tom: "erro", texto: (erro as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="time-form" onSubmit={enviar}>
      <h2>{nota ? "Enviar uma nota" : "Lançar um custo"}</h2>
      <p className="time-sub">
        {nota ? (
          <>
            Nota fiscal que <strong>chegou para a empresa</strong>. Hoje a base só conhece nota de saída — as 3.521
            NFS-e que emitimos. A de entrada não tem por onde chegar, e é por aqui que ela passa a existir.
          </>
        ) : (
          <>
            Uma despesa que a <strong>empresa</strong> pagou ou vai pagar. Se você pagou do seu bolso, o caminho é o
            reembolso — é ele que te devolve o dinheiro.
          </>
        )}
      </p>

      <label className="campo">
        <span>{nota ? "Do que é a nota" : "O que foi"}</span>
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
      </label>

      <div className="campo-par">
        <label className="campo">
          <span>{nota ? "Emissão" : "Data"}</span>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} required />
        </label>
        <label className="campo">
          <span>Valor</span>
          <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" required />
        </label>
      </div>

      <div className="campo-par">
        <label className="campo">
          <span>Vencimento (se houver)</span>
          <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
        </label>
        <label className="campo">
          <span>Como é pago</span>
          <select value={pagamento} onChange={(e) => setPagamento(e.target.value)}>
            <option value="a_definir">ainda não sei</option>
            <option value="boleto">boleto</option>
            <option value="pix_da_empresa">PIX da empresa</option>
            <option value="cartao_da_empresa">cartão da empresa</option>
            <option value="debito_automatico">débito automático</option>
          </select>
        </label>
      </div>

      <label className="campo">
        <span>Quem cobrou / emitiu</span>
        <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="nome do fornecedor" />
      </label>

      {nota ? (
        <div className="campo-par">
          <label className="campo">
            <span>Chave da NF-e</span>
            <input value={nfeKey} onChange={(e) => setNfeKey(e.target.value)} inputMode="numeric" placeholder="44 dígitos" />
          </label>
          <label className="campo">
            <span>Número</span>
            <input value={nfeNumero} onChange={(e) => setNfeNumero(e.target.value)} />
          </label>
        </div>
      ) : null}

      <label className="campo">
        <span>Onde isso entra (se você souber)</span>
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="">— deixo para o financeiro decidir —</option>
          {opcoes.categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.rotulo}
            </option>
          ))}
        </select>
        <small>É uma sugestão. Quem decide a categoria é o financeiro — ela muda a DRE.</small>
      </label>

      <label className="campo">
        <span>{nota ? "Arquivo da nota (PDF ou XML)" : "Comprovante"}</span>
        <input
          ref={arquivoRef}
          type="file"
          accept="image/*,application/pdf,.xml"
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
        />
      </label>

      <button className="time-botao" disabled={enviando}>
        {enviando ? "enviando…" : nota ? "enviar nota" : "enviar custo"}
      </button>
      <p className="time-nota">
        Isto não vira lançamento nem mexe em saldo. Vira um pedido aguardando decisão de quem cuida do financeiro.
      </p>
    </form>
  );
}

function FormCompra({ aoEnviar, aoFalhar }: { aoEnviar: AoEnviar; aoFalhar: AoFalhar }) {
  const [titulo, setTitulo] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [unidade, setUnidade] = useState("un");
  const [valor, setValor] = useState("");
  const [urgencia, setUrgencia] = useState("normal");
  const [precisaAte, setPrecisaAte] = useState("");
  const [links, setLinks] = useState<{ url: string; loja: string; preco: string }[]>([{ url: "", loja: "", preco: "" }]);
  const [enviando, setEnviando] = useState(false);

  const somaLinks = useMemo(
    () => links.filter((l) => l.preco).reduce((a, l) => a + Number(l.preco.replace(/\./g, "").replace(",", ".")) || a, 0),
    [links]
  );

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await postar(
        "/api/time/compra",
        {
          titulo,
          justificativa,
          quantidade,
          unidade,
          valor,
          urgencia,
          precisaAte,
          links: links.filter((l) => l.url.trim()).map((l) => ({ url: l.url.trim(), loja: l.loja, preco: l.preco }))
        },
        null
      );
      await aoEnviar(`Pedido ${r.code} enviado com ${r.links} link(s).`);
      setTitulo("");
      setJustificativa("");
      setValor("");
      setLinks([{ url: "", loja: "", preco: "" }]);
    } catch (erro) {
      aoFalhar({ tom: "erro", texto: (erro as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="time-form" onSubmit={enviar}>
      <h2>Pedir uma compra</h2>
      <p className="time-sub">
        O que você precisa que a empresa compre — com o link de onde comprar. Vários links, se você achou em mais de um
        lugar: é o que transforma o pedido numa cotação.
      </p>

      <label className="campo">
        <span>O que precisa comprar</span>
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="cadeira de escritório" required />
      </label>

      <label className="campo">
        <span>Para que serve</span>
        <textarea
          value={justificativa}
          onChange={(e) => setJustificativa(e.target.value)}
          rows={2}
          placeholder="a atual quebrou o encosto"
          required
        />
        <small>Quem decide lê isto ao lado do valor. Sem justificativa, aprovar vira carimbo.</small>
      </label>

      <div className="campo-trio">
        <label className="campo">
          <span>Quantidade</span>
          <input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} inputMode="decimal" />
        </label>
        <label className="campo">
          <span>Unidade</span>
          <input value={unidade} onChange={(e) => setUnidade(e.target.value)} />
        </label>
        <label className="campo">
          <span>Valor estimado</span>
          <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" required />
        </label>
      </div>

      <div className="campo-par">
        <label className="campo">
          <span>Urgência</span>
          <select value={urgencia} onChange={(e) => setUrgencia(e.target.value)}>
            <option value="baixa">baixa</option>
            <option value="normal">normal</option>
            <option value="alta">alta</option>
            <option value="critica">crítica — está parando o trabalho</option>
          </select>
        </label>
        <label className="campo">
          <span>Preciso até</span>
          <input type="date" value={precisaAte} onChange={(e) => setPrecisaAte(e.target.value)} />
        </label>
      </div>

      <fieldset className="time-links">
        <legend>Links do que comprar</legend>
        {links.map((l, i) => (
          <div className="time-link-linha" key={i}>
            <input
              value={l.url}
              onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
              placeholder="https://…"
              inputMode="url"
            />
            <input
              value={l.loja}
              onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, loja: e.target.value } : x)))}
              placeholder="loja"
            />
            <input
              value={l.preco}
              onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, preco: e.target.value } : x)))}
              placeholder="preço"
              inputMode="decimal"
            />
            {links.length > 1 ? (
              <button type="button" className="time-link" onClick={() => setLinks(links.filter((_, j) => j !== i))}>
                remover
              </button>
            ) : null}
          </div>
        ))}
        <button type="button" className="time-link" onClick={() => setLinks([...links, { url: "", loja: "", preco: "" }])}>
          + outro link
        </button>
        {somaLinks > 0 ? (
          <p className="time-sub">
            Com preço informado em {links.filter((l) => l.preco).length} link(s), o pedido vai marcado como{" "}
            <strong>cotação</strong>, não estimativa.
          </p>
        ) : (
          <p className="time-sub">
            Sem preço no link, o pedido vai como <strong>estimativa</strong> — e cada link fica registrado dizendo que
            quem enviou não informou o preço.
          </p>
        )}
      </fieldset>

      <button className="time-botao" disabled={enviando}>
        {enviando ? "enviando…" : "enviar pedido"}
      </button>
      <p className="time-nota">
        Pedido aprovado ainda não é compra feita nem dinheiro reservado: ele vira solicitação de pagamento num segundo
        passo, com aprovação de quem tem alçada.
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Acompanhamento
// ---------------------------------------------------------------------------

function ListaEnvios({ envios, compacta = false }: { envios: Envio[]; compacta?: boolean }) {
  if (envios.length === 0) {
    return <p className="time-sub">Você ainda não enviou nada.</p>;
  }

  return (
    <>
      {!compacta ? <h2>Tudo que eu enviei</h2> : null}
      <ul className="time-lista">
        {envios.map((e) => {
          const estado = ESTADO_ROTULO[e.estado] ?? ESTADO_ROTULO.aguardando;
          return (
            <li key={`${e.origem}-${e.origemId}`} className="time-item" data-estado={e.estado}>
              <div className="time-item-topo">
                <span className="time-item-origem">{ORIGEM_ROTULO[e.origem] ?? e.origem}</span>
                <span className="time-item-code">{e.code}</span>
                <SeloCamada camada={estado.camada} texto={estado.texto} />
              </div>
              <div className="time-item-titulo">{e.titulo}</div>
              <div className="time-item-baixo">
                <span className="time-item-valor">{e.valorCents === null ? "—" : brl(e.valorCents)}</span>
                {e.dataRef ? <span>{e.dataRef.split("-").reverse().join("/")}</span> : null}
                {e.origem === "reembolso" && e.itens > 0 ? (
                  <span
                    className={e.itensComAnexo < e.itens ? "time-falta" : undefined}
                    title="itens com comprovante anexado"
                  >
                    {e.itensComAnexo}/{e.itens} com comprovante
                  </span>
                ) : null}
                {e.origem === "compra" && e.itens > 0 ? <span>{e.itens} link(s)</span> : null}
              </div>
              {/* A resposta aparece SEMPRE que existir, inclusive na aprovação.
                  Mostrar só na recusa ensinaria que texto do financeiro é
                  sinônimo de má notícia. */}
              {e.resposta ? (
                <div className="time-item-resposta">
                  <strong>{e.decididoPor ?? "financeiro"}:</strong> {e.resposta}
                </div>
              ) : e.estado === "devolvido" || e.estado === "recusado" ? (
                <div className="time-item-resposta">Sem motivo registrado — cobre quem decidiu.</div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
