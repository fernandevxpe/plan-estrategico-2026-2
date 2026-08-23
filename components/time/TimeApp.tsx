"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AnexarFlutuante, type OrigemAnexo } from "@/components/time/AnexarFlutuante";
import { Recebiveis } from "@/components/time/Recebiveis";
import {
  CLASSE as CLASSE_REC,
  ROTULO as ROTULO_REC,
  mesCurto as mesCurtoRec,
  nomeMes as nomeMesRec,
  type Recebiveis as DadoRecebiveis,
  carregarRecebiveis,
  invalidarRecebiveis,
  useRecebiveis
} from "@/components/time/recebiveis-dado";
import { RecebiveisGrafico } from "@/components/time/RecebiveisGrafico";
import { PixQr } from "@/components/time/PixQr";
import { BotaoTema } from "@/components/layout/ThemeToggle";
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
  tipos: { slug: string; nome: string; exigeNfe: boolean; permiteParcelas: boolean; categoriaId: number | null }[];
  categorias: { id: number; rotulo: string }[];
  centros: { id: number; nome: string; ehProjeto: boolean; nucleo: string | null; recentes: number }[];
  linhas: { id: number; slug: string; nome: string }[];
  bancos: {
    id: number;
    nome: string;
    plasticos: { id: number; nome: string; final: string | null; bandeira: string | null; cor: string | null }[];
  }[];
};
type StatusExtrato = "registrado" | "aguardando" | "pago" | "nao_pago";

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
  parcelasTotal: number | null;
  parcelaAtual: number | null;
  statusExtrato: StatusExtrato;
  grupoChave: string;
  itensPreview: { titulo: string; temComprovante: boolean }[];
};

type DetalheEnvio = {
  origem: string;
  origemId: number;
  code: string;
  titulo: string;
  valorCents: number | null;
  statusExtrato: StatusExtrato;
  parcelasTotal: number | null;
  partes: {
    id: number;
    fonte: "app" | "planilha";
    titulo: string;
    slug: string | null;
    valorCents: number;
    parcela: number | null;
    parcelasTotal: number | null;
    mesRef: string | null;
    temComprovante: boolean;
    statusParte: StatusExtrato;
    categoriaRotulo: string | null;
  }[];
  cronograma: { mes: string; parcela: number; valorCents: number; situacao: StatusExtrato | "previsto" }[];
  relacionados: {
    origem: string;
    origemId: number;
    code: string;
    titulo: string;
    valorCents: number | null;
    statusExtrato: StatusExtrato;
  }[];
};

export type AbaTime =
  | "inicio" | "reembolso" | "custo" | "nota" | "compra"
  | "envios" | "meu-reembolso" | "comprar" | "item" | "recebiveis" | "recebiveis-grafico";

const HOJE = () => new Date().toISOString().slice(0, 10);

/**
 * Máscara de dinheiro que preenche a partir dos CENTAVOS.
 *
 * Digitar 1 9 3 8 3 vira R$ 193,83 — é como a maquininha, o caixa eletrônico e
 * todo app de banco funcionam, e é o único jeito que não exige a pessoa
 * lembrar de digitar a vírgula. Um `<input type="number">` no celular abre o
 * teclado errado, aceita ponto e vírgula misturados, e deixa "193.8" virar
 * R$ 193,80 sem ninguém perceber.
 *
 * `inputMode="numeric"` garante o teclado de números; o valor exibido é sempre
 * formatado, e o que vai para o servidor é o total em reais com vírgula.
 */
function mascaraDinheiro(bruto: string): string {
  const digitos = bruto.replace(/\D/g, "").slice(0, 11);
  if (!digitos) return "";
  const n = Number(digitos) / 100;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const centavosDoTexto = (v: string) => Number(v.replace(/\D/g, "") || 0);

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

export function TimeApp({
  aba,
  disponivel,
  motivo,
  itemFonte,
  itemId
}: {
  aba: AbaTime;
  disponivel: boolean;
  motivo: string | null;
  itemFonte?: "planilha" | "app";
  itemId?: number;
}) {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [porta, setPorta] = useState<Porta>("sessao");
  const [opcoes, setOpcoes] = useState<Opcoes>({ tipos: [], categorias: [], centros: [], linhas: [], bancos: [] });
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [recado, definirRecado] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);

  /*
   * POR QUE O RECADO TEM CONTADOR E FOCO
   *
   * Ele vive no topo de `.time-app`, e o botão de enviar fica no fim de um
   * formulário longo. Medido com a página rolada até o botão: o recado
   * renderizava 415px ACIMA da viewport. A pessoa tocava em "enviar custo",
   * nada visível acontecia, e o custo não tinha entrado — o app parecia
   * quebrado quando na verdade estava explicando o erro fora da tela.
   *
   * O contador existe porque `role="alert"` não reanuncia texto idêntico: quem
   * errasse o mesmo campo duas vezes ouviria o problema uma vez só. Trocar a
   * `key` recria o nó e força o segundo anúncio.
   */
  const [selo, setSelo] = useState(0);
  const recadoRef = useRef<HTMLDivElement | null>(null);

  const setRecado = useCallback((r: { tom: "ok" | "erro"; texto: string } | null) => {
    definirRecado(r);
    setSelo((n) => n + 1);
  }, []);

  useEffect(() => {
    const no = recadoRef.current;
    if (!no || !recado) return;
    /*
     * SÓ O ERRO ARRASTA A TELA. O sucesso avisa onde a pessoa está.
     *
     * Eu tinha rolado até o recado nos DOIS tons, e isso virou um defeito na
     * tela de PIX: medido, a pessoa tocava em "copiar", o recado "PIX copiado."
     * puxava a página de scrollY 999 para 0, e o QR que estava em y=240 ia
     * para y=1291 — fora de uma tela de 852px. Confirmação que faz o conteúdo
     * confirmado desaparecer, no exato momento de pagar.
     *
     * Erro é diferente: ali a mensagem É o que precisa ser lido, e sem rolar
     * ela ficava 415px acima da viewport, invisível.
     */
    if (recado.tom === "erro") {
      no.scrollIntoView({ block: "center", behavior: "smooth" });
      no.focus({ preventScroll: true });
    }
  }, [recado, selo]);

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
    setEnvios((j.envios ?? []).map((e: Partial<Envio> & Pick<Envio, "origem" | "origemId">) => normalizarEnvio(e)));
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
      <div className="time-porta">
        <div className="time-aviso">
          <h2>O app do time ainda não está de pé neste ambiente</h2>
          <p>{motivo ?? "a migration 0105 não foi aplicada"}</p>
          <p className="time-sub">
            As telas, as rotas e o schema existem e estão validados. Falta um passo operacional — aplicar a migration —
            que esta entrega deliberadamente não deu: nesta base, migração validada não é migração aplicada.
          </p>
        </div>
      </div>
    );
  }

  if (carregando) {
    return (
      <div className="time-porta">
        <p className="time-porta-espera">carregando…</p>
      </div>
    );
  }

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
        aoAtualizarNome={(nome) => setSessao((s) => (s ? { ...s, nome } : s))}
        aoSair={async () => {
          await fetch("/api/time/sessao", { method: "DELETE" });
          setSessao(null);
          setEnvios([]);
        }}
      />

      {recado ? (
        <div
          key={selo}
          ref={recadoRef}
          tabIndex={-1}
          className={recado.tom === "ok" ? "time-recado ok" : "time-recado erro"}
          role={recado.tom === "erro" ? "alert" : "status"}
        >
          {recado.texto}
        </div>
      ) : null}

      {aba === "inicio" ? <Inicio envios={envios} /> : null}
      {aba === "reembolso" ? (
        <FormEnvio
          kind="custo"
          somenteReembolso
          opcoes={opcoes}
          pessoas={pessoas}
          aoAtualizarOpcoes={setOpcoes}
          aoEnviar={aoEnviar}
          aoFalhar={setRecado}
        />
      ) : null}
      {aba === "custo" ? (
        <FormEnvio
          kind="custo"
          opcoes={opcoes}
          pessoas={pessoas}
          aoAtualizarOpcoes={setOpcoes}
          aoEnviar={aoEnviar}
          aoFalhar={setRecado}
        />
      ) : null}
      {aba === "nota" ? (
        <FormEnvio
          kind="nota_entrada"
          opcoes={opcoes}
          pessoas={pessoas}
          aoAtualizarOpcoes={setOpcoes}
          aoEnviar={aoEnviar}
          aoFalhar={setRecado}
        />
      ) : null}
      {aba === "compra" ? <FormCompra aoEnviar={aoEnviar} aoFalhar={setRecado} /> : null}
      {aba === "envios" ? <Historico envios={envios} /> : null}
      {aba === "meu-reembolso" ? <MeuReembolso /> : null}
      {/*
        Recebíveis vive em arquivo próprio: ela busca o próprio dado e não usa
        `sessao`, `opcoes` nem `envios` — os três que justificam este arquivo
        ser grande. Passa por aqui só para herdar o portão de sessão e o
        cabeçalho; o corte para uma moldura compartilhada é o passo seguinte.
      */}
      {aba === "recebiveis" ? <Recebiveis /> : null}
      {aba === "recebiveis-grafico" ? <RecebiveisGrafico /> : null}
      {aba === "comprar" ? (
        <Comprar opcoes={opcoes} pessoas={pessoas} aoAtualizarOpcoes={setOpcoes} aoEnviar={aoEnviar} aoFalhar={setRecado} />
      ) : null}
      {aba === "item" && itemFonte && itemId ? (
        <TelaItemGasto fonte={itemFonte} itemId={itemId} aoFalhar={setRecado} />
      ) : null}
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
    <div className="time-porta">
      <div className="time-identidade">
        <header className="time-porta-marca">
          <div className="time-porta-icone" aria-hidden>
            <img src="/icone-192.png" alt="" width={52} height={52} />
          </div>
          <p className="time-porta-nome">XPE</p>
          <p className="time-porta-lema">Custos e reembolsos do time</p>
        </header>

        <form
          className="time-porta-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim() || !senha) return setErro("informe e-mail e senha");
            void postar({ email: email.trim(), senha });
          }}
        >
          <label className="time-porta-campo">
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
              placeholder="seu@email.com"
            />
          </label>
          <label className="time-porta-campo">
            <span>Senha</span>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </label>

          {erro ? <p className="time-porta-erro" role="alert">{erro}</p> : null}

          <button type="submit" className="time-porta-entrar" disabled={enviando || !email.trim() || !senha}>
            {enviando ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="time-porta-ajuda">Sem senha? Peça ao Fernando ou ao Igor.</p>

        {podeDeclarar ? (
          <details className="time-porta-declarar">
            <summary>Entrar declarando quem sou</summary>
            <p className="time-porta-ajuda">
              Só no navegador da plataforma. A credencial é do time; você declara qual pessoa é.
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
              <label className="time-porta-campo">
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
              className="time-porta-entrar secundario"
              onClick={() => {
                if (!declarado) return setErro("escolha quem é você");
                void postar({ personId: declarado, pin: pin || null });
              }}
              disabled={enviando || !declarado}
            >
              {enviando ? "Entrando…" : "Continuar"}
            </button>
          </details>
        ) : null}
      </div>
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
    <div className="time-porta">
      <div className="time-identidade">
        <header className="time-porta-marca">
          <div className="time-porta-icone" aria-hidden>
            <img src="/icone-192.png" alt="" width={52} height={52} />
          </div>
          <p className="time-porta-nome">Nova senha</p>
          <p className="time-porta-lema">Olá, {nome.split(" ")[0]}</p>
        </header>

        <p className="time-porta-ajuda">
          Troque a senha de entrega por uma que só você saiba.
        </p>

        <form className="time-porta-form" onSubmit={trocar}>
          <label className="time-porta-campo">
            <span>Senha que você recebeu</span>
            <input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" />
          </label>
          <label className="time-porta-campo">
            <span>Nova senha</span>
            <input type="password" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" placeholder="mínimo 8 caracteres" />
            {curta ? <span className="time-porta-erro">faltam {8 - nova.length} caractere(s)</span> : null}
          </label>
          <label className="time-porta-campo">
            <span>Repita a nova senha</span>
            <input type="password" value={repetida} onChange={(e) => setRepetida(e.target.value)} autoComplete="new-password" />
            {diferem ? <span className="time-porta-erro">as duas não são iguais</span> : null}
          </label>
          {erro ? <p className="time-porta-erro" role="alert">{erro}</p> : null}
          <button type="submit" className="time-porta-entrar" disabled={enviando || !atual || nova.length < 8 || nova !== repetida}>
            {enviando ? "Salvando…" : "Continuar"}
          </button>
        </form>
      </div>
    </div>
  );
}

type Reembolso = {
  historico: { fonte: string; meses: { mes: string; totalCents: number; status: string; itens: number }[] };
  aReceber: {
    fonte: string;
    totalCents: number;
    itens: { descricao: string; parcela: number; parcelasTotal: number; parcelaCents: number; parcelasRestantes: number; saldoCents: number }[];
    proximosMeses: { mes: string; cents: number }[];
  };
  ressalva: string | null;
};

const MES_CURTO = (iso: string) => {
  const [ano, mes] = iso.split("-");
  return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(mes) - 1]}/${ano.slice(2)}`;
};

/**
 * O dinheiro que a empresa deve a esta pessoa.
 *
 * Três perguntas, nesta ordem, porque é a ordem em que elas doem: quanto falta,
 * quando cai, e o que já foi pago. A pessoa abre isto para saber se o dinheiro
 * dela está vindo — não para auditar o histórico.
 *
 * O gráfico é SVG puro e sem biblioteca: são no máximo doze barras de um valor
 * só, e trazer Recharts para o bundle do app de celular por causa disso seria
 * pagar caro por pouco.
 */
function MeuReembolso() {
  const [dados, setDados] = useState<Reembolso | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/time/meu-reembolso", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErro(j.error ?? "não consegui carregar");
      setDados(j.reembolso as Reembolso);
    })();
  }, []);

  if (erro)
    return (
      <div className="time-aviso">
        <p className="time-erro">{erro}</p>
        <Link href="/time/envios" className="time-botao secundario">
          Ver o histórico
        </Link>
      </div>
    );
  if (!dados) return <div className="time-aviso">carregando…</div>;

  const { aReceber, historico } = dados;
  const pico = Math.max(1, ...aReceber.proximosMeses.map((m) => m.cents));
  const proximo = aReceber.proximosMeses[0];

  return (
    <div className="reemb time-tela-padrao">
      <header className="time-form-cabeca">
        <h1>Meu reembolso</h1>
        <p>Quanto a empresa ainda te deve, quando cai, e o que já foi pago.</p>
      </header>

      <Link href="/time/reembolso" className="time-botao time-botao-secundario">
        Pedir reembolso
      </Link>

      <div className="reemb-destaques">
        <article className="kpi-card">
          <span className="kpi-rotulo">Ainda a receber</span>
          <strong className="kpi-valor">{brl(aReceber.totalCents)}</strong>
          <span className="kpi-detalhe">
            {aReceber.itens.length === 0
              ? "nada em aberto"
              : `${aReceber.itens.length} ${aReceber.itens.length === 1 ? "item" : "itens"} em aberto`}
          </span>
        </article>
        <article className="kpi-card">
          <span className="kpi-rotulo">Mês que vem</span>
          <strong className="kpi-valor">{brl(proximo?.cents ?? 0)}</strong>
          <span className="kpi-detalhe">{proximo ? MES_CURTO(proximo.mes) : "sem parcela prevista"}</span>
        </article>
      </div>

      {aReceber.proximosMeses.length > 0 ? (
        <section className="reemb-bloco">
          <h3>Como isso cai nos próximos meses</h3>
          <svg
            className="reemb-grafico"
            viewBox={`0 0 ${aReceber.proximosMeses.length * 34} 120`}
            role="img"
            aria-label={`Parcelas previstas: ${aReceber.proximosMeses
              .map((m) => `${MES_CURTO(m.mes)} ${brl(m.cents)}`)
              .join(", ")}`}
          >
            {aReceber.proximosMeses.map((m, i) => {
              const altura = Math.round((m.cents / pico) * 88);
              return (
                <g key={m.mes}>
                  <rect x={i * 34 + 5} y={96 - altura} width={22} height={altura} rx={3} className="reemb-barra" />
                  <text x={i * 34 + 16} y={112} className="reemb-rotulo">
                    {MES_CURTO(m.mes).slice(0, 3)}
                  </text>
                </g>
              );
            })}
          </svg>
          <p className="time-sub">
            É aritmética do que já está contratado: cada item em aberto contribui com uma parcela por mês até acabar.
            Não é estimativa.
          </p>
        </section>
      ) : null}

      {aReceber.itens.length > 0 ? (
        <section className="reemb-bloco">
          <h3>O que está em aberto</h3>
          <ul className="reemb-itens">
            {aReceber.itens.map((i) => (
              <li key={i.descricao}>
                <div>
                  <strong>{i.descricao}</strong>
                  <span className="time-sub">
                    parcela {i.parcela} de {i.parcelasTotal} · faltam {i.parcelasRestantes} ×{" "}
                    {brl(i.parcelaCents)}
                  </span>
                </div>
                <span className="reemb-saldo">{brl(i.saldoCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="reemb-bloco">
        <h3>O que já passou</h3>
        {historico.meses.length === 0 ? (
          <p className="time-sub">Você ainda não tem reembolso lançado.</p>
        ) : (
          <ul className="reemb-meses">
            {[...historico.meses].reverse().map((m) => (
              <li key={`${m.mes}-${m.status}`}>
                <span>{MES_CURTO(m.mes)}</span>
                <span className="time-sub">
                  {m.itens} {m.itens === 1 ? "item" : "itens"} · {m.status}
                </span>
                <strong>{brl(m.totalCents)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dados.ressalva ? (
        <p className="reemb-ressalva">
          {dados.ressalva}
          <br />
          <span className="time-sub">
            histórico: {historico.fonte} · saldo: {aReceber.fonte}
          </span>
        </p>
      ) : null}
    </div>
  );
}

type CompraAprovada = {
  id: number; code: string; titulo: string; pedidoCents: number;
  precisaAte: string | null; aprovadaEm: string | null; links: number;
};

/**
 * As compras aprovadas que ainda não foram feitas — e o registro do que foi.
 *
 * O ciclo fecha aqui: pediu, aprovaram, comprou, registra o que GASTOU. O valor
 * pedido continua guardado do lado da solicitação; os dois juntos são a única
 * medida de quanto a estimativa da casa erra.
 *
 * Reusa o mesmo formulário de custo, com a compra pré-selecionada. Um segundo
 * formulário "parecido com o de custo" divergiria dele na primeira mudança —
 * foi assim que a barra do financeiro divergiu entre telas antes do FinShell.
 */
function Comprar({
  opcoes,
  pessoas,
  aoAtualizarOpcoes,
  aoEnviar,
  aoFalhar
}: {
  opcoes: Opcoes;
  pessoas: Pessoa[];
  aoAtualizarOpcoes: (o: Opcoes) => void;
  aoEnviar: AoEnviar;
  aoFalhar: AoFalhar;
}) {
  const [compras, setCompras] = useState<CompraAprovada[] | null>(null);
  const [escolhida, setEscolhida] = useState<CompraAprovada | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/time/compra/realizar", { cache: "no-store" });
    if (!r.ok) return setCompras([]);
    const j = await r.json();
    setCompras(j.compras ?? []);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (compras === null) return <div className="time-aviso">carregando…</div>;

  if (escolhida) {
    return (
      <div className="comprar time-tela-padrao">
        <button type="button" className="comprar-voltar" onClick={() => setEscolhida(null)}>
          ← outras compras
        </button>
        <div className="comprar-alvo">
          <strong>{escolhida.titulo}</strong>
          <span className="time-sub">
            {escolhida.code} · pedido de {brl(escolhida.pedidoCents)}
          </span>
        </div>
        <FormEnvio
          kind="custo"
          opcoes={opcoes}
          pessoas={pessoas}
          compra={escolhida}
          aoAtualizarOpcoes={aoAtualizarOpcoes}
          aoEnviar={async (t) => {
            setEscolhida(null);
            await carregar();
            await aoEnviar(t);
          }}
          aoFalhar={aoFalhar}
        />
      </div>
    );
  }

  if (compras.length === 0) {
    return (
      <div className="comprar time-tela-padrao">
        <header className="time-form-cabeca">
          <h1>Comprar</h1>
          <p>Pedidos aprovados que ainda não viraram gasto registrado.</p>
        </header>
        <p className="time-sub">
          Quando um pedido seu for aprovado, ele aparece aqui esperando você comprar. Depois é só registrar
          quanto gastou de verdade.
        </p>
      </div>
    );
  }

  const hoje = HOJE();
  return (
    <div className="comprar time-tela-padrao">
      <header className="time-form-cabeca">
        <h1>Comprar</h1>
        <p>Aprovadas e esperando você comprar — depois registre o valor real.</p>
      </header>
      <ul className="comprar-lista">
        {compras.map((c) => {
          const atrasada = c.precisaAte !== null && c.precisaAte < hoje;
          return (
            <li key={c.id}>
              <button type="button" onClick={() => setEscolhida(c)}>
                <div>
                  <strong>{c.titulo}</strong>
                  <span className="time-sub">
                    {c.code} · pedido de {brl(c.pedidoCents)}
                    {c.links > 0 ? ` · ${c.links} ${c.links === 1 ? "link" : "links"}` : ""}
                  </span>
                </div>
                {c.precisaAte ? (
                  <span className={atrasada ? "comprar-prazo atrasado" : "comprar-prazo"}>
                    {atrasada ? "atrasada" : `até ${c.precisaAte.slice(8, 10)}/${c.precisaAte.slice(5, 7)}`}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="time-nota">
        Registrar a compra não mexe em saldo. Ela vira um custo aguardando o financeiro, e o valor pedido fica
        guardado do lado — é assim que a casa aprende quanto a estimativa erra.
      </p>
    </div>
  );
}

/**
 * Busca do destino do custo: obra, projeto ou área.
 *
 * Era um `<select>` com 28 itens. Num celular isso abre uma folha nativa que
 * cobre a tela e obriga a rolar até achar — e quem não acha rápido escolhe
 * "não é de uma obra específica", que é o valor que deixa o indicador em 0%.
 *
 * Aqui a pessoa escreve. "leparc" acha "Edf. Le Parc"; "comer" acha
 * "Comercial". A busca ignora acento e maiúscula, porque quem digita no
 * celular não coloca acento.
 *
 * DUAS FAMÍLIAS, e a separação importa: obra é um cliente específico e o custo
 * vira margem daquele contrato; área é a estrutura da casa. Misturadas numa
 * lista só, "Comercial" aparecia entre dois condomínios e ninguém entendia a
 * diferença.
 */
const semAcento = (v: string) =>
  v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function IconeRotuloBusca({
  tipo
}: {
  tipo: "categoria" | "destino" | "compra" | "descricao" | "valor" | "data" | "tipo" | "pagamento" | "urgencia" | "link";
}) {
  const comum = {
    className: "campo-rotulo-icone",
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };
  if (tipo === "compra") {
    return (
      <svg {...comum}>
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
        <path d="M3 6h18" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    );
  }
  if (tipo === "descricao") {
    return (
      <svg {...comum}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  }
  if (tipo === "valor") {
    return (
      <svg {...comum}>
        <circle cx="12" cy="12" r="10" />
        <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 0 1 0 4H8" />
        <path d="M12 6v2" />
        <path d="M12 16v2" />
      </svg>
    );
  }
  if (tipo === "data") {
    return (
      <svg {...comum}>
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <rect width="18" height="18" x="3" y="4" rx="2" />
        <path d="M3 10h18" />
      </svg>
    );
  }
  if (tipo === "tipo") {
    return (
      <svg {...comum}>
        <path d="M4 7h7v7H4z" />
        <path d="M13 7h7v4h-7z" />
        <path d="M13 14h7v3h-7z" />
      </svg>
    );
  }
  if (tipo === "pagamento") {
    return (
      <svg {...comum}>
        <rect width="20" height="14" x="2" y="5" rx="2" />
        <path d="M2 10h20" />
      </svg>
    );
  }
  if (tipo === "urgencia") {
    return (
      <svg {...comum}>
        <path d="M12 2v4" />
        <path d="m4.93 4.93 2.83 2.83" />
        <path d="M2 12h4" />
        <path d="m4.93 19.07 2.83-2.83" />
        <circle cx="12" cy="13" r="7" />
        <path d="M12 10v4l2 2" />
      </svg>
    );
  }
  if (tipo === "link") {
    return (
      <svg {...comum}>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    );
  }
  if (tipo === "categoria") {
    return (
      <svg {...comum}>
        <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
        <circle cx="7.5" cy="7.5" r="1.5" />
      </svg>
    );
  }
  return (
    <svg {...comum}>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="M10 18h4" />
    </svg>
  );
}

function BuscaDestino({
  centros,
  valor,
  aoEscolher,
  destaque = false
}: {
  centros: Opcoes["centros"];
  valor: string;
  aoEscolher: (id: string) => void;
  destaque?: boolean;
}) {
  const [termo, setTermo] = useState("");
  const [aberto, setAberto] = useState(false);
  const escolhido = centros.find((c) => String(c.id) === valor);

  const achados = useMemo(() => {
    const t = semAcento(termo.trim());
    const base = t ? centros.filter((c) => semAcento(c.nome).includes(t)) : centros;
    return {
      obras: base.filter((c) => c.ehProjeto),
      areas: base.filter((c) => !c.ehProjeto)
    };
  }, [centros, termo]);

  const rotuloCls = destaque ? "campo-rotulo campo-rotulo-destaque" : "campo-rotulo";

  if (escolhido) {
    return (
      <div className="campo">
        <span className={rotuloCls}>
          {destaque ? <IconeRotuloBusca tipo="destino" /> : null}
          Para qual obra ou projeto
          {destaque ? <span className="campo-opcional">opcional</span> : null}
        </span>
        <div className="destino-escolhido">
          <div>
            <strong>{escolhido.nome}</strong>
            <span className="time-sub">{escolhido.ehProjeto ? "obra ou projeto" : "área da empresa"}</span>
          </div>
          <button type="button" onClick={() => { aoEscolher(""); setTermo(""); setAberto(true); }}>
            trocar
          </button>
        </div>
      </div>
    );
  }

  const total = achados.obras.length + achados.areas.length;

  return (
    <div className={`campo destino${destaque ? " destino-destaque" : ""}`}>
      <label className={rotuloCls} htmlFor="busca-destino">
        {destaque ? <IconeRotuloBusca tipo="destino" /> : null}
        Para qual obra ou projeto
        {destaque ? <span className="campo-opcional">opcional</span> : null}
      </label>
      <div className="campo-busca">
        <svg className="campo-busca-icone" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          id="busca-destino"
          value={termo}
          onChange={(e) => { setTermo(e.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
          placeholder="cliente, obra ou área"
          autoComplete="off"
        />
      </div>

      {aberto ? (
        <div className="destino-lista">
          {achados.obras.length > 0 ? (
            <>
              <p className="destino-grupo">Obras e projetos</p>
              {achados.obras.slice(0, 8).map((c) => (
                <button key={c.id} type="button" onClick={() => { aoEscolher(String(c.id)); setAberto(false); }}>
                  {c.nome}
                </button>
              ))}
            </>
          ) : null}
          {achados.areas.length > 0 ? (
            <>
              <p className="destino-grupo">Áreas da empresa</p>
              {achados.areas.slice(0, 8).map((c) => (
                <button key={c.id} type="button" onClick={() => { aoEscolher(String(c.id)); setAberto(false); }}>
                  {c.nome}
                </button>
              ))}
            </>
          ) : null}
          {total === 0 ? <p className="destino-vazio">Nada com “{termo}”.</p> : null}
          <button type="button" className="destino-nenhum" onClick={() => { aoEscolher(""); setAberto(false); }}>
            Não é de uma obra específica
          </button>
        </div>
      ) : (
        <small>{destaque ? "Busque pelo cliente, obra ou área." : "Opcional — ajuda a direcionar para o cliente ou obra certa."}</small>
      )}
    </div>
  );
}

function BuscaCategoria({
  categorias,
  valor,
  proposta,
  aoEscolher,
  aoPropor,
  destaque = false
}: {
  categorias: Opcoes["categorias"];
  valor: string;
  proposta: string;
  aoEscolher: (id: string) => void;
  aoPropor: (texto: string) => void;
  destaque?: boolean;
}) {
  const [termo, setTermo] = useState("");
  const [aberto, setAberto] = useState(false);
  const escolhida = categorias.find((c) => String(c.id) === valor);

  const achados = useMemo(() => {
    const t = semAcento(termo.trim());
    const base = t ? categorias.filter((c) => semAcento(c.rotulo).includes(t)) : categorias;
    return base.slice(0, 10);
  }, [categorias, termo]);

  const rotuloCls = destaque ? "campo-rotulo campo-rotulo-destaque" : "campo-rotulo";

  if (escolhida) {
    return (
      <div className="campo">
        <span className={rotuloCls}>
          {destaque ? <IconeRotuloBusca tipo="categoria" /> : null}
          Categoria
        </span>
        <div className="destino-escolhido">
          <div>
            <strong>{escolhida.rotulo}</strong>
            <span className="time-sub">sugestão sua — o financeiro confere</span>
          </div>
          <button
            type="button"
            onClick={() => {
              aoEscolher("");
              setTermo("");
              setAberto(true);
            }}
          >
            trocar
          </button>
        </div>
      </div>
    );
  }

  if (proposta) {
    return (
      <div className="campo">
        <span className={rotuloCls}>
          {destaque ? <IconeRotuloBusca tipo="categoria" /> : null}
          Categoria
        </span>
        <div className="destino-escolhido">
          <div>
            <strong>{proposta}</strong>
            <span className="time-sub">nova — o financeiro valida antes de entrar na DRE</span>
          </div>
          <button
            type="button"
            onClick={() => {
              aoPropor("");
              setTermo("");
              setAberto(true);
            }}
          >
            trocar
          </button>
        </div>
      </div>
    );
  }

  const podeSugerir =
    termo.trim().length >= 3 &&
    !achados.some((c) => semAcento(c.rotulo) === semAcento(termo.trim()));

  return (
    <div className={`campo destino${destaque ? " destino-destaque" : ""}`}>
      <label className={rotuloCls} htmlFor="busca-categoria">
        {destaque ? <IconeRotuloBusca tipo="categoria" /> : null}
        Categoria
      </label>
      <div className="campo-busca">
        <svg className="campo-busca-icone" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          id="busca-categoria"
          value={termo}
          onChange={(e) => { setTermo(e.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
          placeholder="buscar na lista ou sugerir nova"
          autoComplete="off"
        />
      </div>

      {aberto ? (
        <div className="destino-lista">
          {achados.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                aoEscolher(String(c.id));
                aoPropor("");
                setAberto(false);
              }}
            >
              {c.rotulo}
            </button>
          ))}
          {podeSugerir ? (
            <button
              type="button"
              className="destino-criar"
              onClick={() => {
                aoPropor(termo.trim());
                aoEscolher("");
                setAberto(false);
              }}
            >
              Sugerir «{termo.trim()}»
            </button>
          ) : null}
          {achados.length === 0 && !podeSugerir ? (
            <p className="destino-vazio">Nada com “{termo}”. Escreva mais para sugerir uma nova.</p>
          ) : null}
          <button
            type="button"
            className="destino-nenhum"
            onClick={() => {
              aoEscolher("");
              aoPropor("");
              setAberto(false);
            }}
          >
            Deixo para o financeiro decidir
          </button>
        </div>
      ) : (
        <small>{destaque ? "Busque na lista ou sugira uma categoria nova." : "Opcional — busque na lista ou proponha uma categoria nova."}</small>
      )}
    </div>
  );
}

/**
 * Tipo de reembolso + categorias de custo numa busca só.
 *
 * Os onze tipos de `fin_reimbursement_type` cobrem o dia a dia, mas a DRE tem
 * 38 rubricas — esconder o resto atrás de chip obriga a rolar 275px de altura.
 * Aqui os cinco primeiros (sort_order) aparecem como atalho; o resto vem com
 * filtro, e categorias que não têm tipo dedicado entram na segunda seção.
 */
function BuscaClassificacaoGasto({
  tipos,
  categorias,
  tipoSlug,
  categoriaId,
  aoEscolherTipo,
  aoEscolherCategoria
}: {
  tipos: Opcoes["tipos"];
  categorias: Opcoes["categorias"];
  tipoSlug: string;
  categoriaId: string;
  aoEscolherTipo: (slug: string) => void;
  aoEscolherCategoria: (id: string) => void;
}) {
  const [termo, setTermo] = useState("");
  const [aberto, setAberto] = useState(false);

  const tipoEscolhido = tipos.find((t) => t.slug === tipoSlug);
  const categoriaEscolhida =
    !tipoSlug && categoriaId ? categorias.find((c) => String(c.id) === categoriaId) : null;

  const idsDosTipos = useMemo(() => new Set(tipos.map((t) => t.categoriaId).filter((id): id is number => id != null)), [tipos]);

  const filtro = semAcento(termo.trim());

  const tiposVisiveis = useMemo(() => {
    const base = filtro
      ? tipos.filter((t) => semAcento(t.nome).includes(filtro) || semAcento(t.slug).includes(filtro))
      : tipos;
    return base;
  }, [tipos, filtro]);

  const categoriasExtras = useMemo(() => {
    const base = categorias.filter((c) => !idsDosTipos.has(c.id));
    if (!filtro) return base;
    return base.filter((c) => semAcento(c.rotulo).includes(filtro));
  }, [categorias, idsDosTipos, filtro]);

  const frequentes = tipos.slice(0, 5);
  const rotuloCls = "campo-rotulo campo-rotulo-destaque";

  if (tipoEscolhido) {
    return (
      <div className="campo">
        <span className={rotuloCls}>
          <IconeRotuloBusca tipo="tipo" />
          Tipo de gasto
        </span>
        <div className="destino-escolhido">
          <div>
            <strong>{tipoEscolhido.nome}</strong>
            <span className="time-sub">
              {tipoEscolhido.exigeNfe ? "exige NF-e" : "tipo de reembolso"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              aoEscolherTipo("");
              setTermo("");
              setAberto(true);
            }}
          >
            trocar
          </button>
        </div>
      </div>
    );
  }

  if (categoriaEscolhida) {
    return (
      <div className="campo">
        <span className={rotuloCls}>
          <IconeRotuloBusca tipo="categoria" />
          Categoria de custo
        </span>
        <div className="destino-escolhido">
          <div>
            <strong>{categoriaEscolhida.rotulo}</strong>
            <span className="time-sub">categoria da DRE — sem tipo dedicado de reembolso</span>
          </div>
          <button
            type="button"
            onClick={() => {
              aoEscolherCategoria("");
              setTermo("");
              setAberto(true);
            }}
          >
            trocar
          </button>
        </div>
      </div>
    );
  }

  const mostrarFrequentes = !filtro && !aberto;

  return (
    <div className="campo destino destino-destaque">
      <label className={rotuloCls} htmlFor="busca-classificacao-gasto">
        <IconeRotuloBusca tipo="tipo" />
        Tipo ou categoria
      </label>

      {mostrarFrequentes ? (
        <div className="classif-atalhos">
          {/*
            O rótulo precisa NOMEAR o grupo, não só ficar acima dele. Os outros
            oito grupos de chips do app já fazem isso; este entrou depois e
            saiu sem — os botões chegavam avulsos na árvore de acessibilidade,
            sem dizer de que pergunta eram resposta.

            Aqui NÃO vai `aria-pressed`: estes chips são atalho de ação (tocar
            escolhe e segue), não alternância. Marcar como "pressionado" algo
            que não fica pressionado seria mentir sobre o estado.
          */}
          <p className="destino-grupo" id="grupo-mais-usados">
            Mais usados
          </p>
          <div className="chips chips-compactos" role="group" aria-labelledby="grupo-mais-usados">
            {frequentes.map((t) => (
              <button
                key={t.slug}
                type="button"
                className="chip"
                onClick={() => {
                  aoEscolherTipo(t.slug);
                  aoEscolherCategoria("");
                  setAberto(false);
                }}
              >
                {t.nome}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="campo-busca">
        <svg className="campo-busca-icone" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          id="busca-classificacao-gasto"
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
          placeholder="buscar tipo ou categoria"
          autoComplete="off"
        />
      </div>

      {aberto || filtro ? (
        <div className="destino-lista">
          {tiposVisiveis.length > 0 ? (
            <>
              <p className="destino-grupo">Tipos de reembolso</p>
              {tiposVisiveis.slice(0, 12).map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => {
                    aoEscolherTipo(t.slug);
                    aoEscolherCategoria("");
                    setAberto(false);
                  }}
                >
                  {t.nome}
                  {t.exigeNfe ? " · exige NF-e" : ""}
                </button>
              ))}
            </>
          ) : null}
          {categoriasExtras.length > 0 ? (
            <>
              <p className="destino-grupo">Outras categorias de custo</p>
              {categoriasExtras.slice(0, 10).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    aoEscolherCategoria(String(c.id));
                    aoEscolherTipo("");
                    setAberto(false);
                  }}
                >
                  {c.rotulo}
                </button>
              ))}
            </>
          ) : null}
          {tiposVisiveis.length === 0 && categoriasExtras.length === 0 ? (
            <p className="destino-vazio">Nada com “{termo}”.</p>
          ) : null}
        </div>
      ) : (
        <small>Escolha um atalho ou busque na lista completa.</small>
      )}
    </div>
  );
}

/**
 * A miniatura do cartão.
 *
 * Um `<select>` com "final 7626" é um dado; um retângulo com o gradiente do
 * emissor, a bandeira e os quatro dígitos é o objeto que está na carteira. A
 * pessoa reconhece pela COR antes de ler o número — é assim que ela acha o
 * cartão certo na mão, e é assim que ela deve achar na tela.
 *
 * As cores são as das marcas dos emissores, e NÃO as de `XpeChart.conta` —
 * aquelas são de gráfico, validadas para daltonismo e para não repetir entre
 * séries. Aqui a cor é identidade, não dado: usar âmbar para o Nubank (como o
 * gráfico faz, de propósito, para não colidir com o roxo da XPE) tornaria a
 * miniatura irreconhecível.
 */
const CORES_EMISSOR: Record<string, string> = {
  nubank: "linear-gradient(135deg, #820ad1, #5f0a99)",
  inter: "linear-gradient(135deg, #ff7a00, #e05e00)",
  asaas: "linear-gradient(135deg, #1e40af, #1e3a8a)"
};

/*
 * A COR DO PLÁSTICO GANHA DA COR DO BANCO.
 *
 * `CORES_EMISSOR` pinta pelo emissor, então os nove Nubank saem nove retângulos
 * roxos idênticos — e quem procura o próprio cartão tem de comparar número a
 * número. Quando a foto disse a cor, ela vale: "o dourado" é como a pessoa
 * reconhece o cartão dela, muito antes de ler quatro dígitos.
 */
const CORES_PLASTICO: Record<string, string> = {
  preto: "linear-gradient(135deg, #2b2b31, #131317)",
  branco: "linear-gradient(135deg, #f4f4f6, #d9d9e0)",
  cinza: "linear-gradient(135deg, #6b6b76, #45454e)",
  prata: "linear-gradient(135deg, #c9ccd4, #8e939e)",
  dourado: "linear-gradient(135deg, #d4af37, #9c7c1c)",
  roxo: "linear-gradient(135deg, #820ad1, #5f0a99)",
  azul: "linear-gradient(135deg, #1e5fd4, #133b87)",
  verde: "linear-gradient(135deg, #12805c, #0a4f38)",
  vermelho: "linear-gradient(135deg, #c2283c, #841a29)",
  laranja: "linear-gradient(135deg, #ff7a00, #e05e00)",
  rosa: "linear-gradient(135deg, #d6449b, #9c2c70)",
  transparente: "linear-gradient(135deg, #7d8592, #4d5561)"
};
/* Cartão claro precisa de letra escura, ou o texto some no plástico. */
const CORES_CLARAS = new Set(["branco", "prata", "dourado"]);

const BANDEIRA_ROTULO: Record<string, string> = {
  visa: "VISA",
  mastercard: "Mastercard",
  elo: "elo",
  amex: "AMEX",
  hipercard: "Hipercard",
  outra: ""
};

function Miniatura({
  emissor,
  nome,
  final,
  bandeira,
  cor,
  ativo,
  aoTocar
}: {
  emissor: string;
  nome: string;
  final: string | null;
  bandeira: string | null;
  /** A cor lida da foto do plástico. Quando existe, ganha da cor do emissor. */
  cor?: string | null;
  ativo: boolean;
  aoTocar: () => void;
}) {
  const chave = Object.keys(CORES_EMISSOR).find((k) => emissor.toLowerCase().includes(k));
  const fundo = (cor && CORES_PLASTICO[cor]) || (chave ? CORES_EMISSOR[chave] : null) ||
    "linear-gradient(135deg, #3f3d56, #2a2839)";
  return (
    <button
      type="button"
      className={`${ativo ? "cartao ativo" : "cartao"}${cor && CORES_CLARAS.has(cor) ? " claro" : ""}`}
      style={{ background: fundo }}
      onClick={aoTocar}
      aria-pressed={ativo}
    >
      <span className="cartao-emissor">{emissor}</span>
      <span className="cartao-apelido">{nome}</span>
      <span className="cartao-rodape">
        <em>•••• {final ?? "????"}</em>
        {bandeira && BANDEIRA_ROTULO[bandeira] ? <i>{BANDEIRA_ROTULO[bandeira]}</i> : null}
      </span>
    </button>
  );
}

/**
 * Cadastrar um cartão sem sair do lançamento.
 *
 * O momento em que a pessoa descobre que o cartão não está cadastrado é o
 * momento em que ela está no caixa com ele na mão — é o único instante em que
 * ela sabe o final, a bandeira e se é físico ou virtual. Mandá-la "falar com o
 * admin" é garantir que o cartão nunca seja cadastrado.
 */
function CadastrarCartao({
  bancos,
  pessoas,
  inicial,
  aoCadastrar,
  aoFechar
}: {
  bancos: Opcoes["bancos"];
  pessoas: Pessoa[];
  /** O que a foto já revelou: banco escolhido, final lido, bandeira lida. */
  inicial?: { banco?: string; final?: string; bandeira?: string };
  /** Devolve também DE QUEM é: é isso que decide custo × reembolso. */
  aoCadastrar: (opcoes: Opcoes, cartaoId: number, dono: { natureza: "empresa" | "pessoal"; titular: string }) => void;
  aoFechar: () => void;
}) {
  const [natureza, setNatureza] = useState<"empresa" | "pessoal">("empresa");
  /** Vazio é "meu". Preenchido é o colega cujo plástico apareceu na foto. */
  const [titular, setTitular] = useState("");
  /*
   * O BANCO NÃO VEM PRÉ-ESCOLHIDO, e isso custou um cartão errado em produção.
   *
   * Era `inicial?.banco || bancos[0]`: sem banco herdado da foto — e a foto
   * NUNCA diz o banco —, o primeiro da lista vinha marcado sozinho. Quem não
   * tocasse nos chips salvava no Nubank sem ter escolhido nada.
   *
   * Aconteceu: o Fernando cadastrou o final 5585 e escreveu "Inter xpe igor"
   * no apelido. O cartão foi para o Nubank. O apelido dizia Inter, o banco
   * dizia Nubank, e um plástico no banco errado nunca casa com a fatura —
   * que é a única coisa que ele existe para fazer.
   *
   * Vazio obriga a escolher. Um passo a mais, e é o passo que decide se o
   * cadastro serve para alguma coisa.
   */
  const [banco, setBanco] = useState(inicial?.banco ?? "");
  const [final, setFinal] = useState(inicial?.final ?? "");
  const [apelido, setApelido] = useState("");
  const [bandeira, setBandeira] = useState(inicial?.bandeira ?? "");
  const [tipo, setTipo] = useState("fisico");
  const [cor, setCor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [lendoCartao, setLendoCartao] = useState(false);
  const [leituraCartao, setLeituraCartao] = useState<string | null>(null);
  const fotoRef = useRef<HTMLInputElement>(null);

  /**
   * A FOTO DO CARTÃO PREENCHE O CADASTRO — e não é guardada.
   *
   * Dos quatro últimos dígitos não dá para saber banco, bandeira nem cor: o que
   * identifica isso é o BIN, os PRIMEIROS seis a oito dígitos, e a casa não
   * guarda o número completo de propósito — número em banco é PAN.
   *
   * Olhar o cartão resolve, e a pessoa o tem na mão exatamente agora. A imagem
   * vai para `/api/time/cartao/ler`, é lida em memória e descartada na mesma
   * requisição: ela contém o número inteiro, e guardá-la seria trocar
   * conveniência por hospedar dado de cartão.
   */
  async function fotografar(f: File) {
    setLendoCartao(true);
    setLeituraCartao(null);
    setErro(null);
    try {
      const form = new FormData();
      form.append("arquivo", await encolherImagem(f));
      const r = await fetch("/api/time/cartao/ler", { method: "POST", body: form });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLeituraCartao(j.error ?? "não consegui ler o cartão");
        return;
      }
      const l = j.lido as {
        banco: string | null; bandeira: string; cor: string; final: string | null;
        tipo: string; titular: string | null; legibilidade: string;
      };
      const veio: string[] = [];
      if (l.final && !final) { setFinal(l.final); veio.push(`final ${l.final}`); }
      if (l.bandeira !== "indeterminado" && !bandeira) { setBandeira(l.bandeira); veio.push(l.bandeira); }
      if (l.cor !== "indeterminado" && !cor) { setCor(l.cor); veio.push(l.cor); }
      if (l.tipo !== "indeterminado") setTipo(l.tipo);
      // O banco casa por NOME contra as contas que existem. Sem casar, fica
      // vazio: escolher o parecido é como o 5585 foi parar no Nubank.
      if (l.banco && !banco) {
        const achado = bancos.find((b) => b.nome.toLowerCase().includes(l.banco!.toLowerCase().split(/\s+/)[0]));
        if (achado) { setBanco(String(achado.id)); veio.push(achado.nome); }
      }
      setLeituraCartao(
        veio.length
          ? `Li ${veio.join(", ")}. Confira antes de salvar.`
          : "Não consegui ler nada novo — preencha à mão."
      );
    } catch {
      setLeituraCartao("não consegui ler o cartão");
    } finally {
      setLendoCartao(false);
    }
  }

  async function salvar() {
    if (final.length !== 4) return setErro("preciso dos 4 últimos dígitos");
    setSalvando(true);
    setErro(null);
    const r = await fetch("/api/time/cartao", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ natureza, banco, final, apelido, bandeira, tipo, titular, cor })
    });
    const j = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) return setErro(j.error ?? "não consegui cadastrar");
    aoCadastrar(j.opcoes as Opcoes, j.cartao.id as number, {
      natureza,
      titular: titular ? (pessoas.find((p) => String(p.id) === titular)?.nome ?? "outra pessoa") : "você"
    });
  }

  return (
    <div className="cartao-novo">
      <div className="cartao-novo-topo">
        <strong>Cadastrar cartão</strong>
        <button type="button" onClick={aoFechar}>
          cancelar
        </button>
      </div>

      {/* A prévia muda enquanto se digita: a pessoa confere o cartão olhando
          para ele, não relendo campos. */}
      <div className="cartao-previa">
        <Miniatura
          emissor={
            natureza === "pessoal"
              ? titular
                ? (pessoas.find((p) => String(p.id) === titular)?.nome ?? "Pessoal")
                : "Meu cartão"
              : (bancos.find((b) => String(b.id) === banco)?.nome ?? "qual banco?")
          }
          nome={apelido || "sem apelido"}
          final={final.padEnd(4, "•")}
          bandeira={bandeira || null}
          cor={cor || null}
          ativo
          aoTocar={() => {}}
        />
      </div>

      {/*
        FOTOGRAFAR O CARTÃO — o atalho que responde três campos de uma vez.
        Fica logo abaixo da prévia porque é o que faz a prévia deixar de ser um
        retângulo genérico e virar o cartão que a pessoa está segurando.
      */}
      <div className="foto-cartao">
        <button type="button" onClick={() => fotoRef.current?.click()} disabled={lendoCartao}>
          {lendoCartao ? "lendo o cartão…" : "fotografar o cartão"}
        </button>
        <small>
          {leituraCartao ??
            "Eu leio banco, bandeira, cor e os 4 últimos. A foto NÃO é guardada — ela tem o número inteiro."}
        </small>
        <input
          ref={fotoRef}
          type="file"
          className="anexar-input"
          accept="image/*"
          capture="environment"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void fotografar(f);
          }}
        />
      </div>

      <div className="campo">
        <span className="campo-rotulo" id="grupo-de-quem-e">De quem é</span>
        <div className="chips" role="group" aria-labelledby="grupo-de-quem-e">
          <button type="button" aria-pressed={natureza === "empresa"} className={natureza === "empresa" ? "chip ativo" : "chip"} onClick={() => setNatureza("empresa")}>
            Da empresa
          </button>
          <button type="button" aria-pressed={natureza === "pessoal" && !titular} className={natureza === "pessoal" && !titular ? "chip ativo" : "chip"} onClick={() => { setNatureza("pessoal"); setTitular(""); }}>
            Meu, pessoal
          </button>
          {pessoas.length > 0 ? (
            <button
              type="button"
              aria-pressed={natureza === "pessoal" && Boolean(titular)}
              className={natureza === "pessoal" && titular ? "chip ativo" : "chip"}
              onClick={() => {
                setNatureza("pessoal");
                // Já entra com alguém selecionado: um chip que abre um select
                // vazio faz a pessoa tocar duas vezes para dizer uma coisa só.
                if (!titular) setTitular(String(pessoas[0].id));
              }}
            >
              De outra pessoa
            </button>
          ) : null}
        </div>
        <small>
          {natureza === "empresa"
            ? "O gasto entra na fatura da empresa — é uma compra, não um reembolso."
            : titular
              ? "O gasto saiu do bolso de outra pessoa. O reembolso é pedido por quem gastou."
              : "O gasto vira reembolso — é dinheiro do seu bolso que a empresa te devolve."}
        </small>
      </div>

      {natureza === "pessoal" && titular ? (
        <label className="campo">
          <span>De quem é o cartão</span>
          <select value={titular} onChange={(e) => setTitular(e.target.value)}>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          <small>Cadastrar o plástico já ajuda: da próxima vez o app reconhece o final sozinho.</small>
        </label>
      ) : null}

      {natureza === "empresa" ? (
        <div className="campo">
          <span className="campo-rotulo" id="grupo-banco">Banco</span>
          <div className="chips" role="group" aria-labelledby="grupo-banco">
            {bancos.map((b) => (
              <button key={b.id} type="button" aria-pressed={banco === String(b.id)} className={banco === String(b.id) ? "chip ativo" : "chip"} onClick={() => setBanco(String(b.id))}>
                {b.nome}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="campo-par">
        <label className="campo">
          <span>4 últimos dígitos</span>
          <input
            value={final}
            onChange={(e) => setFinal(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            maxLength={4}
            placeholder="0000"
            className="campo-final"
          />
        </label>
        <label className="campo">
          <span>Apelido (opcional)</span>
          <input value={apelido} onChange={(e) => setApelido(e.target.value)} placeholder="ex.: cartão da obra" />
        </label>
      </div>

      <div className="campo">
        <span className="campo-rotulo" id="grupo-bandeira">Bandeira</span>
        <div className="chips" role="group" aria-labelledby="grupo-bandeira">
          {[["visa", "Visa"], ["mastercard", "Mastercard"], ["elo", "Elo"], ["amex", "Amex"], ["", "não sei"]].map(([v, r]) => (
            <button key={v || "na"} type="button" aria-pressed={bandeira === v} className={bandeira === v ? "chip ativo" : "chip"} onClick={() => setBandeira(v)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="campo">
        <span className="campo-rotulo" id="grupo-fisico-ou-virtual">Físico ou virtual</span>
        <div className="chips" role="group" aria-labelledby="grupo-fisico-ou-virtual">
          {[["fisico", "Físico"], ["virtual", "Virtual"], ["adicional", "Adicional"]].map(([v, r]) => (
            <button key={v} type="button" aria-pressed={tipo === v} className={tipo === v ? "chip ativo" : "chip"} onClick={() => setTipo(v)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {erro ? <p className="time-erro">{erro}</p> : null}

      <button
        type="button"
        className="time-botao"
        onClick={salvar}
        disabled={salvando || final.length !== 4 || (natureza === "empresa" && !banco)}
      >
        {salvando
          ? "salvando…"
          : natureza === "empresa" && !banco
            ? "escolha o banco"
            : "salvar cartão"}
      </button>
    </div>
  );
}

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "?";
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function CabecalhoPessoa({
  sessao,
  aoAtualizarNome,
  aoSair
}: {
  sessao: Sessao;
  aoAtualizarNome: (nome: string) => void;
  aoSair: () => Promise<void>;
}) {
  const [perfil, setPerfil] = useState<{ nome: string; email: string | null; temFoto: boolean } | null>(null);
  const [folha, setFolha] = useState(false);
  /*
   * Toque fora já fechava; Esc, não — e o foco nunca entrava, então a
   * primeira tabulação saía para o conteúdo atrás da folha. Mesma disciplina
   * do diálogo de cancelar.
   */
  /*
   * PARA ONDE VAI O MEU DINHEIRO.
   *
   * A casa paga R$ 42.320 de reembolso por ano com a chave vindo de conversa.
   * Isto é o cadastro que fecha essa lacuna — e é insumo de lote de pagamento,
   * não campo de exibição: por isso a validação é por tipo de chave, e mudar a
   * chave derruba a conferência do financeiro (quem confirmou o destino antigo
   * não confirmou o novo).
   */
  const [conta, setConta] = useState<{
    metodo: string; pixTipo: string | null; pixChave: string | null;
    bancoNome: string | null; agencia: string | null; conta: string | null;
    titularEhAPessoa: boolean; titularNome: string | null; titularDocumento: string | null;
    recebeSalario: boolean; recebeReembolso: boolean; observacao: string | null;
    conferidoEm: string | null;
  } | null>(null);
  const [contaMetodo, setContaMetodo] = useState("pix");
  const [pixTipo, setPixTipo] = useState("cpf");
  const [pixChave, setPixChave] = useState("");
  const [bancoNome, setBancoNome] = useState("");
  const [agencia, setAgencia] = useState("");
  const [contaNum, setContaNum] = useState("");
  const [titularEhEu, setTitularEhEu] = useState(true);
  const [titularNome, setTitularNome] = useState("");
  const [titularDoc, setTitularDoc] = useState("");
  /**
   * SALÁRIO ATUAL E REEMBOLSO PREVISTO, no perfil.
   *
   * São os mesmos dois números do cabeçalho de Recebíveis, e essa repetição é
   * deliberada: aqui eles respondem "o que a empresa me paga hoje", que é a
   * pergunta que a pessoa faz olhando o próprio cadastro. Mesma fonte, mesmo
   * componente — não é o caso de duas telas discordando, é o caso de um número
   * aparecer onde ele é procurado.
   */
  const [resumoRec, setResumoRec] = useState<{ mediana: number; aberto: number; desde: string | null } | null>(null);
  const [salvandoConta, setSalvandoConta] = useState(false);
  const [erroConta, setErroConta] = useState<string | null>(null);
  const [contaOk, setContaOk] = useState(false);

  useEffect(() => {
    if (!folha) return;
    void (async () => {
      const r = await fetch("/api/time/perfil/conta", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      // Aproveita a abertura da folha para trazer os dois números também.
      void carregarRecebiveis().then(({ dado }) => {
        if (dado) {
          setResumoRec({
            mediana: dado.medianaRecorrenteCents ?? 0,
            aberto: dado.emAbertoCents ?? 0,
            desde: dado.desde ?? null
          });
        }
      });
      const c = j.conta as typeof conta;
      if (!c) return;
      setConta(c);
      setContaMetodo(c.metodo);
      setPixTipo(c.pixTipo ?? "cpf");
      setPixChave(c.pixChave ?? "");
      setBancoNome(c.bancoNome ?? "");
      setAgencia(c.agencia ?? "");
      setContaNum(c.conta ?? "");
      setTitularEhEu(c.titularEhAPessoa);
      setTitularNome(c.titularNome ?? "");
      setTitularDoc(c.titularDocumento ?? "");
    })();
  }, [folha]);

  async function salvarConta(e: React.FormEvent) {
    e.preventDefault();
    setSalvandoConta(true);
    setErroConta(null);
    setContaOk(false);
    try {
      const r = await fetch("/api/time/perfil/conta", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          metodo: contaMetodo, pixTipo, pixChave,
          bancoNome, agencia, conta: contaNum,
          titularEhAPessoa: titularEhEu, titularNome, titularDocumento: titularDoc,
          recebeSalario: true, recebeReembolso: true
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErroConta((j.error as string) ?? "não consegui salvar");
        return;
      }
      setConta(j.conta);
      setContaOk(true);
    } finally {
      setSalvandoConta(false);
    }
  }

  const folhaRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!folha) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFolha(false);
    };
    document.addEventListener("keydown", aoTeclar);
    folhaRef.current?.focus();
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [folha]);

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [fotoVersao, setFotoVersao] = useState(0);
  const fotoRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/time/perfil", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    setPerfil(j.perfil);
    setNome(j.perfil.nome);
    setEmail(j.perfil.email ?? "");
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvarPerfil(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    const r = await fetch("/api/time/perfil", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nome: nome.trim(), email: email.trim() || null })
    });
    const j = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) return setErro(j.error ?? "não consegui salvar");
    setPerfil(j.perfil);
    aoAtualizarNome(j.perfil.nome);
    setFolha(false);
  }

  async function enviarFoto(arquivo: File) {
    const redimensionada = await encolherImagem(arquivo);
    const fd = new FormData();
    fd.append("arquivo", redimensionada);
    setSalvando(true);
    setErro(null);
    const r = await fetch("/api/time/perfil/foto", { method: "POST", body: fd });
    setSalvando(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErro(j.error ?? "não consegui salvar a foto");
      return;
    }
    setPerfil((p) => (p ? { ...p, temFoto: true } : p));
    setFotoVersao((n) => n + 1);
  }

  const fotoSrc = perfil?.temFoto ? `/api/time/perfil/foto?v=${fotoVersao}` : null;

  return (
    <>
      <header className="time-topo">
        <button type="button" className="time-topo-perfil" onClick={() => setFolha(true)}>
          <span className="time-topo-foto">
            {fotoSrc ? (
              <img src={fotoSrc} alt="" />
            ) : (
              <span className="time-topo-iniciais">{iniciais(sessao.nome)}</span>
            )}
          </span>
          <span className="time-topo-texto">
            <strong>{sessao.nome}</strong>
            <span>Meu perfil</span>
          </span>
        </button>
        {/*
          UM CONTROLE SÓ NESTE CANTO, e os dois que saíram tinham razão para sair.
          
          "Sair" aqui era a SEGUNDA porta para a mesma coisa: a folha de perfil
          já tem "Sair da conta", rotulado e muito menos sujeito a toque errado.
          Um ícone de deslogar a 8px de uma ação é como se perde o raciocínio no
          meio de um lançamento.
          
          O tema é escolha de UMA VEZ na vida ocupando 40px do imóvel mais
          disputado do app, em toda rota, para sempre. Desceu para o perfil, que
          é onde ajuste de aparência pertence.
          
          No lugar entra "Solicitar": ação RARA (zero pedidos em 7 meses), e
          canto superior é exatamente onde ação rara deve ficar. Como pílula
          rotulada, não ícone mudo — um "+" sozinho ali não diz o que faz.
        */}
        <div className="time-topo-acoes">
          <Link href="/time/compra" className="time-topo-solicitar">
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            <span>Solicitar</span>
          </Link>
        </div>
      </header>

      {folha ? (
        <div className="time-perfil-casca" role="presentation" onClick={() => setFolha(false)}>
          <div
            className="time-perfil-folha"
            ref={folhaRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Meu perfil"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="time-perfil-folha-cabeca">
              <h2>Meu perfil</h2>
              <button type="button" className="time-perfil-fechar" onClick={() => setFolha(false)} aria-label="Fechar">
                ×
              </button>
            </div>

            <div className="time-perfil-foto-linha">
              {/*
                Sem `aria-label` o botão fica MUDO exatamente para quem usou o
                recurso: sem foto ele contém as iniciais e ganha nome pelo
                texto; com foto, contém só um `<img alt="">` e o leitor de tela
                anuncia "botão".
              */}
              <button
                type="button"
                className="time-topo-foto time-topo-foto-grande"
                aria-label={fotoSrc ? "Trocar a foto do perfil" : "Adicionar uma foto de perfil"}
                onClick={() => fotoRef.current?.click()}
              >
                {fotoSrc ? (
                  <img src={fotoSrc} alt="" />
                ) : (
                  <span className="time-topo-iniciais">{iniciais(nome || sessao.nome)}</span>
                )}
              </button>
              <div>
                <button type="button" className="time-perfil-foto-btn" onClick={() => fotoRef.current?.click()} disabled={salvando}>
                  {salvando ? "Salvando…" : "Trocar foto"}
                </button>
                <p className="time-sub">Câmera ou galeria</p>
              </div>
              <input
                ref={fotoRef}
                type="file"
                accept="image/*"
                capture="user"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void enviarFoto(f);
                }}
              />
            </div>

            <form className="time-porta-form" onSubmit={salvarPerfil}>
              <label className="time-porta-campo">
                <span>Nome</span>
                <input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
              </label>
              <label className="time-porta-campo">
                <span>E-mail</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  inputMode="email"
                />
              </label>
              {erro ? <p className="time-porta-erro" role="alert">{erro}</p> : null}
              <button type="submit" className="time-porta-entrar" disabled={salvando || nome.trim().length < 2}>
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </form>

            {/*
              A CONTA QUE RECEBE. Vem depois do nome e do e-mail porque é o
              cadastro mais raro de mexer — e antes de "Sair" porque é o que a
              pessoa vem preencher quando abre esta folha pela primeira vez.
            */}
            {resumoRec ? (
              <div className="perfil-numeros">
                <div>
                  <span>Recebo de hábito</span>
                  <strong>{brl(resumoRec.mediana)}</strong>
                  {/* "mediana" escrito: não é o contrato, é o que costuma cair.
                      A média seria puxada pelos extremos — nos oito meses do
                      Fernando os valores vão de R$ 2.386 a R$ 7.644. */}
                  <small>mediana por mês</small>
                </div>
                <div>
                  <span>Reembolso previsto</span>
                  <strong>{brl(resumoRec.aberto)}</strong>
                  <small>{resumoRec.aberto > 0 ? "aprovado, ainda não pago" : "nada em aberto"}</small>
                </div>
              </div>
            ) : null}

            <form className="time-porta-form conta-pgto" onSubmit={salvarConta}>
              <div className="conta-pgto-topo">
                <strong>Onde eu recebo</strong>
                {conta ? (
                  <span className={conta.conferidoEm ? "pp-selo ok" : "pp-selo aviso"}>
                    {conta.conferidoEm ? "conferido" : "aguardando conferência"}
                  </span>
                ) : null}
              </div>
              <p className="time-sub">
                É para cá que vai o seu reembolso e o seu pagamento. Confira caractere por caractere: chave errada
                não dá erro, o dinheiro vai para outra pessoa.
              </p>

              <div className="campo">
                <span className="campo-rotulo" id="grupo-metodo">Como você recebe</span>
                <div className="chips" role="group" aria-labelledby="grupo-metodo">
                  {[["pix", "PIX"], ["ted", "TED / transferência"]].map(([v, r]) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={contaMetodo === v}
                      className={contaMetodo === v ? "chip ativo" : "chip"}
                      onClick={() => setContaMetodo(v)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {contaMetodo === "pix" ? (
                <>
                  <div className="campo">
                    <span className="campo-rotulo" id="grupo-tipo-chave">Tipo da chave</span>
                    <div className="chips" role="group" aria-labelledby="grupo-tipo-chave">
                      {[["cpf", "CPF"], ["cnpj", "CNPJ"], ["telefone", "Telefone"], ["email", "E-mail"], ["aleatoria", "Aleatória"]].map(
                        ([v, r]) => (
                          <button
                            key={v}
                            type="button"
                            aria-pressed={pixTipo === v}
                            className={pixTipo === v ? "chip ativo" : "chip"}
                            onClick={() => setPixTipo(v)}
                          >
                            {r}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                  <label className="time-porta-campo">
                    <span>Chave PIX</span>
                    <input
                      value={pixChave}
                      onChange={(e) => setPixChave(e.target.value)}
                      inputMode={pixTipo === "cpf" || pixTipo === "cnpj" || pixTipo === "telefone" ? "numeric" : "text"}
                      placeholder={
                        pixTipo === "cpf" ? "000.000.000-00"
                        : pixTipo === "cnpj" ? "00.000.000/0000-00"
                        : pixTipo === "telefone" ? "(81) 99999-9999"
                        : pixTipo === "email" ? "voce@exemplo.com"
                        : "a chave que o banco gerou"
                      }
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="time-porta-campo">
                    <span>Banco</span>
                    <input value={bancoNome} onChange={(e) => setBancoNome(e.target.value)} placeholder="Inter, Nubank…" />
                  </label>
                  <div className="campo-par">
                    <label className="time-porta-campo">
                      <span>Agência</span>
                      <input value={agencia} onChange={(e) => setAgencia(e.target.value)} inputMode="numeric" />
                    </label>
                    <label className="time-porta-campo">
                      <span>Conta</span>
                      <input value={contaNum} onChange={(e) => setContaNum(e.target.value)} inputMode="numeric" />
                    </label>
                  </div>
                </>
              )}

              <div className="campo">
                <span className="campo-rotulo" id="grupo-titular">De quem é a conta</span>
                <div className="chips" role="group" aria-labelledby="grupo-titular">
                  <button type="button" aria-pressed={titularEhEu} className={titularEhEu ? "chip ativo" : "chip"} onClick={() => setTitularEhEu(true)}>
                    Minha
                  </button>
                  <button type="button" aria-pressed={!titularEhEu} className={!titularEhEu ? "chip ativo" : "chip"} onClick={() => setTitularEhEu(false)}>
                    Do meu CNPJ / de outra pessoa
                  </button>
                </div>
                <small>
                  {titularEhEu
                    ? "O comprovante vai sair no seu nome."
                    : "Comum aqui: o time é MEI e recebe no CNPJ. Diga o titular para o comprovante fazer sentido depois."}
                </small>
              </div>

              {!titularEhEu ? (
                <div className="campo-par">
                  <label className="time-porta-campo">
                    <span>Nome do titular</span>
                    <input value={titularNome} onChange={(e) => setTitularNome(e.target.value)} />
                  </label>
                  <label className="time-porta-campo">
                    <span>CPF ou CNPJ dele</span>
                    <input value={titularDoc} onChange={(e) => setTitularDoc(e.target.value)} inputMode="numeric" />
                  </label>
                </div>
              ) : null}

              {erroConta ? <p className="time-porta-erro" role="alert">{erroConta}</p> : null}
              {contaOk ? <p className="conta-pgto-ok" role="status">Conta salva. O financeiro vai conferir antes do próximo pagamento.</p> : null}
              <button type="submit" className="time-porta-entrar" disabled={salvandoConta}>
                {salvandoConta ? "Salvando…" : conta ? "Atualizar conta" : "Salvar conta"}
              </button>
            </form>

            <div className="time-perfil-rodape">
              <div className="time-perfil-tema">
                <span>Aparência</span>
                <BotaoTema className="time-topo-tema" />
              </div>
              <button type="button" className="time-perfil-sair" onClick={() => void aoSair()}>
                Sair da conta
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------

function Inicio({ envios }: { envios: Envio[] }) {
  /*
   * O INÍCIO PASSA A ABRIR PELO DINHEIRO QUE ENTROU, e a razão é medida.
   *
   * Os três KPIs antigos davam R$ 0,00 para 28 de 28 pessoas: "Reembolso no
   * mês" e "Compras no mês" leem `fin_time_envio`, que tem UMA linha na base
   * inteira. E o gráfico `pedido × pago` desenhava seis tocos de 2px, porque a
   * série "pedido" é estruturalmente zero — não existe pedido de reembolso pelo
   * app ainda. 176px para dizer nada, e só renderizava para 14 de 28.
   *
   * `fin_time_recebivel_v` tem 449 pagamentos para 28 de 28, em 8 meses. É o
   * único dado com conteúdo para todo mundo no dia 1.
   *
   * As duas ações urgentes — Registrar e Reembolso — já têm assento permanente
   * na barra inferior, ao alcance do polegar em toda rota. O que NÃO tem outro
   * lugar é a resposta a "a casa me pagou o que devia?", e é ela que a tela
   * principal passa a responder.
   */
  const { dado: rec } = useRecebiveis();
  const [mesFoco, setMesFoco] = useState<string | null>(null);

  const aguardando = envios.filter((e) => e.estado === "aguardando");
  const voltaram = envios.filter((e) => e.estado === "devolvido" || e.estado === "recusado");
  const [resumo, setResumo] = useState<{
    reembolsoMesCents: number;
    comprasMesCents: number;
    aReceberCents: number;
    historico: { mes: string; solicitadoCents: number; recebidoCents: number }[];
    comprasRecentes: { code: string; titulo: string; valorCents: number | null; dataRef: string | null; estado: string }[];
  } | null>(null);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/time/inicio", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setResumo(j.resumo);
    })();
  }, []);

  const pico =
    resumo && resumo.historico.length > 0
      ? Math.max(1, ...resumo.historico.flatMap((h) => [h.solicitadoCents, h.recebidoCents]))
      : 1;


  return (
    <div className="time-tela-padrao">
      <header className="time-form-cabeca">
        <h1>Início</h1>
        <p>O que a XPE te pagou, e o que falta enviar.</p>
      </header>

      {resumo ? (
        <>
          {/*
            DE QUEM É O DINHEIRO — a distinção que os rótulos sozinhos não faziam.

            Os três números já estavam certos: "Reembolso" conta `kind =
            reembolso`, "Compras" conta `kind = custo`, e "A receber" vem do
            saldo de reembolso, que não enxerga custo nenhum. Conferido no
            banco: o custo de R$ 193,83 no cartão da empresa não aparece em
            nenhum dos dois primeiros.

            Só que a tela não DIZIA isso, e a pergunta apareceu: "compra no
            cartão da empresa não é reembolso para a pessoa, isso está
            correto?". Um número certo que precisa ser perguntado está
            incompleto — a legenda é parte do dado.
          */}
          {/*
            Os três números formam uma frase: caiu X · o normal é Y · faltam Z.
            E o terceiro TROCA DE PERGUNTA quando não há saldo, para nenhum
            azulejo nascer zerado — que era o defeito dos anteriores.
          */}
          <div className="time-faixa">
            <Link href="/time/recebiveis" className="time-faixa-item time-faixa-destaque">
              <span className="time-faixa-rotulo">
                Caiu em {rec && rec.porMes.length ? mesCurtoRec(rec.porMes[rec.porMes.length - 1].mes) : "—"}
              </span>
              <strong className="time-faixa-valor">
                {brl(rec && rec.porMes.length ? rec.porMes[rec.porMes.length - 1].totalCents : 0)}
              </strong>
              <small className="time-faixa-nota">
                {rec && rec.porMes.length
                  ? `${rec.linhas.filter((l) => l.mes === rec.porMes[rec.porMes.length - 1].mes).length} pagamentos`
                  : "nada ainda"}
              </small>
            </Link>
            <article className="time-faixa-item">
              <span className="time-faixa-rotulo">De hábito</span>
              <strong className="time-faixa-valor">{brl(rec?.medianaRecorrenteCents ?? 0)}</strong>
              <small className="time-faixa-nota">mediana, {rec?.porMes.length ?? 0} meses</small>
            </article>
            {rec && rec.emAbertoCents > 0 ? (
              <Link href="/time/recebiveis#aberto" className="time-faixa-item">
                <span className="time-faixa-rotulo">Ainda a receber</span>
                <strong className="time-faixa-valor">{brl(rec.emAbertoCents)}</strong>
                <small className="time-faixa-nota">reembolso parcelado</small>
              </Link>
            ) : (
              <article className="time-faixa-item">
                <span className="time-faixa-rotulo">Em 2026</span>
                <strong className="time-faixa-valor">{brl(rec?.totalCents ?? 0)}</strong>
                <small className="time-faixa-nota">nada em aberto</small>
              </article>
            )}
          </div>

          {rec && rec.porMes.length > 0 ? (
            <GraficoRecebido rec={rec} mesFoco={mesFoco} aoFocar={setMesFoco} />
          ) : null}
        </>
      ) : null}

      <section className="time-secao">
        <h2>Enviar ao financeiro</h2>
        <nav className="time-menu-atalhos" aria-label="Enviar ao financeiro">
          <Atalho href="/time/reembolso" titulo="Reembolso" texto="Solicitar e registrar" tipo="reembolso" />
          <Atalho
            href="/time/custo"
            titulo="Registrar compra"
            texto="Foto, nota fiscal ou os dois"
            tipo="custo"
          />
          {/* "Solicitar compra" saiu da grade: virou pílula no cabeçalho,
              presente em TODA rota. Aqui era a terceira porta para a mesma
              tela, gastando 63px numa grade de uma coluna. */}
          {/*
            O PASSO QUE TINHA FICADO SEM PORTA.
            `/time/comprar` fecha a solicitação aprovada com a compra que foi
            realmente feita. Quando a barra passou de "4 + menu Mais" para 5
            destinos fixos, o link dela saiu junto com o menu — a tela
            continuou de pé, respondendo 200, e sem nenhum caminho no app
            inteiro. O ciclo pedir → aprovar → comprar → registrar ficava
            aberto no terceiro passo.
          */}
          <Atalho
            href="/time/comprar"
            titulo="Comprar o que foi aprovado"
            texto="Fechar um pedido já aprovado"
            tipo="compra"
          />
        </nav>

        {resumo && resumo.comprasRecentes.length > 0 ? (
          <details className="time-compras-dobrada">
            <summary>
              <span>Minhas compras</span>
              <span className="time-compras-contagem">{resumo.comprasRecentes.length}</span>
            </summary>
            <ul className="time-compras-lista">
              {resumo.comprasRecentes.map((c) => (
                <li key={c.code}>
                  <div>
                    <strong>{c.titulo}</strong>
                    <span className="time-sub">
                      {c.code} · {ESTADO_ROTULO[c.estado as Envio["estado"]]?.texto ?? c.estado}
                    </span>
                  </div>
                  <span className="time-compras-valor">{c.valorCents !== null ? brl(c.valorCents) : "—"}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

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
    </div>
  );
}

function IconeAtalho({ tipo }: { tipo: "reembolso" | "custo" | "nota" | "compra" }) {
  const comum = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };
  if (tipo === "reembolso")
    return (
      <svg {...comum}>
        <path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 6 6v2" />
      </svg>
    );
  if (tipo === "custo")
    return (
      <svg {...comum}>
        <path d="M12 4v13M6.5 11.5 12 17l5.5-5.5M5 20h14" />
      </svg>
    );
  if (tipo === "nota")
    return (
      <svg {...comum}>
        <path d="M8 6h12M8 12h12M8 18h8M4 6h.01M4 12h.01M4 18h.01" />
      </svg>
    );
  return (
    <svg {...comum}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}


/**
 * O gráfico empilhado do Início — o mesmo de Recebíveis, em versão compacta.
 *
 * UM componente, não dois: duas implementações do mesmo gráfico divergem na
 * primeira mudança de paleta, e este app já viveu isso esta semana (o
 * componente emitia `.nat-recorrente` e o CSS definia `.nat-prolabore`, e uma
 * banda de R$ 72.022 renderizou invisível).
 *
 * TOCAR NO MÊS não navega: a nota vira o resumo daquele mês e a legenda passa
 * a somar só ele. É de propósito que a legenda ENCOLHE em vez de crescer — as
 * naturezas de um mês são subconjunto das da janela, então o botão de baixo
 * nunca desce quando alguém toca numa coluna.
 */
function GraficoRecebido({
  rec,
  mesFoco,
  aoFocar
}: {
  rec: DadoRecebiveis;
  mesFoco: string | null;
  aoFocar: (m: string | null) => void;
}) {
  const meses = rec.porMes.slice(-6);
  const teto = Math.max(...meses.map((m) => m.totalCents), 1);
  const foco = mesFoco ? meses.find((m) => m.mes === mesFoco) : null;

  // A legenda soma exatamente o que está desenhado: a janela, ou o mês em foco.
  const base = foco ? [foco] : meses;
  const soma = new Map<string, number>();
  for (const m of base) {
    for (const [nat, v] of Object.entries(m.porNatureza)) soma.set(nat, (soma.get(nat) ?? 0) + v);
  }
  const legenda = [...soma.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <section className="rec-plot rec-plot-mini" aria-labelledby="tit-rec-inicio">
      <div className="rec-plot-cabeca">
        <h2 id="tit-rec-inicio">O que eu recebo</h2>
      </div>
      <div className="rec-plot-trilho">
        <div
          className="rec-grade"
          role="img"
          aria-label={`O que a XPE me pagou, mês a mês. ${meses
            .map((m) => `${mesCurtoRec(m.mes)}: ${brl(m.totalCents)}`)
            .join("; ")}`}
        >
          {meses.map((m) => (
            <button
              key={m.mes}
              type="button"
              className={mesFoco === m.mes ? "rec-col ativa" : "rec-col"}
              aria-pressed={mesFoco === m.mes}
              aria-label={`${nomeMesRec(m.mes)}: ${brl(m.totalCents)}`}
              onClick={() => aoFocar(mesFoco === m.mes ? null : m.mes)}
            >
              <span className="rec-col-area">
                <span className="rec-pilha" style={{ height: `${(m.totalCents / teto) * 100}%` }}>
                  {Object.entries(m.porNatureza)
                    .sort((a, b) => b[1] - a[1])
                    .map(([nat, v]) => (
                      <i
                        key={nat}
                        className={CLASSE_REC[nat] ?? "nat-encargo"}
                        style={{ height: `${(v / m.totalCents) * 100}%` }}
                      />
                    ))}
                </span>
              </span>
              <span className="rec-col-mes">{mesCurtoRec(m.mes)}</span>
            </button>
          ))}
        </div>
      </div>
      {/* Fora do `role="img"`: um leitor de tela não anuncia mudança dentro de
          uma imagem, e esta linha muda quando a pessoa toca num mês. */}
      <p className="rec-plot-nota" role="status">
        {foco
          ? `${nomeMesRec(foco.mes)} · ${brl(foco.totalCents)} em ${rec.linhas.filter((l) => l.mes === foco.mes).length} pagamentos. Toque de novo para fechar.`
          : `Últimos ${meses.length} meses. Toque num mês para ver só ele.`}
      </p>
      <ul className="rec-legenda">
        {legenda.map(([nat, v]) => (
          <li key={nat}>
            <i className={`rec-ponto ${CLASSE_REC[nat] ?? "nat-encargo"}`} />
            <span>{ROTULO_REC[nat] ?? nat}</span>
            <b>{brl(v)}</b>
          </li>
        ))}
      </ul>
      <Link href="/time/recebiveis" className="time-botao secundario time-botao-largo">
        Ver cada pagamento
      </Link>
    </section>
  );
}

function Atalho({
  href,
  titulo,
  texto,
  tipo,
  compacto = false
}: {
  href: string;
  titulo: string;
  texto: string;
  tipo: "reembolso" | "custo" | "nota" | "compra";
  compacto?: boolean;
}) {
  return (
    <Link href={href} className={compacto ? "time-atalho time-atalho-compacto" : "time-atalho"}>
      <span className="time-atalho-icone" aria-hidden>
        <IconeAtalho tipo={tipo} />
      </span>
      <span className="time-atalho-texto">
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

/** O que o modelo aceita direto. HEIC e HEIF do iPhone não estão aqui. */
const MIMES_QUE_O_MODELO_LE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

async function encolherImagem(arquivo: File): Promise<File> {
  if (!arquivo.type.startsWith("image/")) return arquivo;

  // HEIC SEMPRE PASSA PELO CANVAS, mesmo pequeno.
  //
  // O iPhone grava foto em HEIC e o modelo não lê o formato. O atalho do
  // "abaixo de 400 KB devolve como está" mandava o HEIC cru para a API, que
  // respondia 400 — e a tela dizia "não consegui ler o comprovante", como se o
  // problema fosse a foto. O canvas do Safari decodifica HEIC e devolve JPEG,
  // então converter resolve na origem; quando o navegador não consegue, o
  // servidor recusa dizendo o nome do formato.
  const precisaConverter = !MIMES_QUE_O_MODELO_LE.has(arquivo.type);

  // Abaixo de 400 KB não vale o reencode: o ganho é pequeno e a requantização
  // sempre perde alguma nitidez do texto da nota.
  if (!precisaConverter && arquivo.size <= 400 * 1024) return arquivo;

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
    // Quando o objetivo era CONVERTER, um JPEG maior que o HEIC original ainda
    // é o resultado certo: HEIC comprime melhor, e devolver o original por ele
    // ser menor traria de volta o 400 que esta conversão existe para evitar.
    if (!blob || (blob.size >= arquivo.size && !precisaConverter)) return arquivo;

    const nome = arquivo.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], nome, { type: "image/jpeg", lastModified: arquivo.lastModified });
  } catch {
    return arquivo;
  }
}

async function postar(
  url: string,
  dados: Record<string, unknown>,
  arquivo: File | null,
  // A nota entra num campo PRÓPRIO, não numa lista: o servidor precisa saber
  // qual dos dois é o documento fiscal para gravar o `kind` certo, e ordem de
  // upload não é informação — é acidente.
  arquivoNota: File | null = null
) {
  let resposta: Response;
  if (arquivo || arquivoNota) {
    const form = new FormData();
    for (const [k, v] of Object.entries(dados)) {
      if (v === null || v === undefined || v === "") continue;
      form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    if (arquivo) form.append("arquivo", await encolherImagem(arquivo));
    // A nota NÃO passa pelo encolhedor: um XML não é imagem, e um PDF
    // reencodado como JPEG deixaria de ser o documento fiscal.
    if (arquivoNota) form.append("arquivoNota", arquivoNota);
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

const ROTULO = "campo-rotulo campo-rotulo-destaque";


function FormEnvio({
  kind,
  opcoes,
  pessoas,
  compra,
  somenteReembolso = false,
  aoAtualizarOpcoes,
  aoEnviar,
  aoFalhar
}: {
  kind: "custo" | "nota_entrada";
  opcoes: Opcoes;
  /** O time, para dizer de quem é um cartão pessoal que não é o seu. */
  pessoas: Pessoa[];
  /** Quando vem preenchido, este custo FECHA a solicitação de compra. */
  compra?: CompraAprovada;
  /** Tela dedicada de reembolso: mesmo formulário, destino fixo no bolso. */
  somenteReembolso?: boolean;
  /** Chamado quando um cartão novo é cadastrado sem sair da tela. */
  aoAtualizarOpcoes: (opcoes: Opcoes) => void;
  aoEnviar: AoEnviar;
  aoFalhar: AoFalhar;
}) {
  const nota = kind === "nota_entrada";
  const unificado = kind === "custo";
  /**
   * Para onde este lançamento vai, depois que o cartão respondeu.
   * Declarado antes de `modoReembolso`: usar `destino` acima da linha do
   * useState gerava ReferenceError e derrubava custo/reembolso no cliente.
   */
  const [destino, setDestino] = useState<"custo" | "reembolso">(somenteReembolso ? "reembolso" : "custo");
  const [decisaoPendente, setDecisaoPendente] = useState<{ titular: string } | null>(null);
  const [tipoReembolso, setTipoReembolso] = useState("");
  const modoReembolso = somenteReembolso || destino === "reembolso";
  // O título vem da solicitação quando é uma compra: reescrever o que já foi
  // aprovado desliga o pedido do gasto na hora de conferir os dois.
  const [titulo, setTitulo] = useState(compra?.titulo ?? "");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(HOJE());
  const [pagamento, setPagamento] = useState(nota ? "boleto" : "");
  const [parcelas, setParcelas] = useState("");
  const [final, setFinal] = useState("");
  // Só a tela de NOTA ainda precisa de quem emitiu: numa nota fiscal o emitente
  // é o fato central. Num custo, ele já vem da foto quando existe, e pedir de
  // novo é um campo a mais entre a pessoa e o botão de enviar.
  const [fornecedor, setFornecedor] = useState("");
  const [nfeKey, setNfeKey] = useState("");
  const [nfeNumero, setNfeNumero] = useState("");
  const [categoria, setCategoria] = useState("");
  const [categoriaProposta, setCategoriaProposta] = useState("");
  const [centro, setCentro] = useState("");
  const [linha, setLinha] = useState("");
  const [banco, setBanco] = useState("");
  const [cartao, setCartao] = useState("");
  // A bandeira que a foto revelou, para o cadastro do cartão já nascer preenchido.
  const [bandeiraLida, setBandeiraLida] = useState("");
  const [sugestao, setSugestao] = useState<{
    categoriaId: number; rotulo: string; contraparte: string; vezes: number; forte: boolean;
  } | null>(null);

  /**
   * O arquivo que chegou pela folha de compartilhamento do sistema.
   *
   * `/api/time/compartilhado` guarda o arquivo e redireciona para cá com
   * `?anexo=<chave>&nome=<nome>`. Até agora NINGUÉM lia esses parâmetros: o
   * arquivo era gravado, ficava órfão para sempre, e a pessoa caía num
   * formulário vazio sem entender por quê — que é exatamente o atrito que o
   * compartilhamento existe para eliminar.
   */
  const params = useSearchParams();
  const anexoCompartilhado = params.get("anexo");
  const nomeCompartilhado = params.get("nome");
  useEffect(() => {
    if (!somenteReembolso) return;
    const d = params.get("descricao");
    const v = params.get("valor");
    if (d) setDescricao(d);
    if (v) setValor(mascaraDinheiro(v));
  }, [somenteReembolso, params]);
  const [cadastrando, setCadastrando] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [leitura, setLeitura] = useState<{ tom: "ok" | "aviso" | "erro"; texto: string } | null>(null);

  /**
   * O que a IA achou que isto é — categoria, área, e em que ela se baseou.
   *
   * Guardado separado do valor dos campos de propósito: enquanto está aqui, é
   * palpite exibido com a justificativa ao lado; só vira conteúdo do formulário
   * quando a pessoa toca em "usar". A `porQue` é o que permite discordar sem
   * abrir a foto de novo.
   */
  const [palpite, setPalpite] = useState<{
    categoriaId: string | null;
    categoriaRotulo: string | null;
    centroId: string | null;
    centroNome: string | null;
    porQue: string;
  } | null>(null);

  /** A NF-e, quando vem junto do print. */
  const [arquivoNota, setArquivoNota] = useState<File | null>(null);

  /**
   * O CARTÃO QUE A FOTO REVELOU — e se o sistema o conhece.
   *
   * A leitura já extraía "Mastercard **** 5585" e guardava o final num estado
   * que ninguém mostrava: o campo do final só renderizava depois de escolher o
   * banco, e a foto não diz o banco. O dado mais chato de digitar chegava e
   * desaparecia.
   *
   * Agora a resposta chega junto com a leitura, e ela decide o caminho:
   * cartão da EMPRESA é compra da empresa; cartão PESSOAL é dinheiro do bolso
   * de alguém, e isso é reembolso — não custo.
   */
  const [cartaoLido, setCartaoLido] = useState<{
    final: string;
    conhecido: boolean;
    natureza?: "empresa" | "pessoal";
    banco?: string | null;
    apelido?: string | null;
  } | null>(null);

  const tentativaRef = useRef<string | null>(null);

  /**
   * Lê o comprovante e PREENCHE — nunca envia.
   *
   * Roda sozinha quando a pessoa escolhe o arquivo: pedir para ela tocar num
   * segundo botão depois de já ter escolhido a foto é pedir duas vezes a mesma
   * coisa, e metade não toca.
   *
   * Campo que já tem conteúdo digitado NÃO é sobrescrito. Quem digitou sabe
   * mais que a foto, e ver o próprio texto ser trocado por um automático é o
   * jeito mais rápido de perder a confiança na ferramenta.
   */
  const lerArquivo = useCallback(
    async (f: File) => {
      if (!f.type.startsWith("image/") && f.type !== "application/pdf") return;
      setLendo(true);
      setLeitura(null);
      try {
        const form = new FormData();
        form.append("arquivo", await encolherImagem(f));
        const r = await fetch("/api/time/ler-comprovante", { method: "POST", body: form });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          setLeitura({ tom: "erro", texto: j.error ?? "não consegui ler o comprovante" });
          return;
        }
        const l = j.lido as {
          valorTotal: number | null; data: string | null; estabelecimento: string | null;
          documento: string | null; chaveNfe: string | null; resumo: string;
          cartaoFinal: string | null; cartaoBandeira: string; parcelas: number | null;
          legibilidade: "boa" | "parcial" | "ruim";
          // Do XML vem `emitente` no lugar de `estabelecimento`: o layout da
          // NF-e chama assim, e renomear no servidor esconderia de onde veio.
          emitente?: string | null;
          itens?: { descricao: string; quantidade: number | null; valorUnitario: number | null }[];
          numeroPedido?: string | null;
          categoriaCode?: string | null;
          areaNome?: string | null;
          porQue?: string;
        };
        const doXml = j.fonte === "xml";

        const preenchidos: string[] = [];
        const por = (atual: string, valor: string | null | undefined, set: (v: string) => void, rotulo: string) => {
          if (atual.trim() || !valor) return;
          set(valor);
          preenchidos.push(rotulo);
        };
        por(titulo, l.resumo, setTitulo, "descrição");
        por(valor, l.valorTotal != null ? l.valorTotal.toFixed(2).replace(".", ",") : null, setValor, "valor");
        por(data === HOJE() ? "" : data, l.data, setData, "data");
        por(fornecedor, l.estabelecimento ?? l.emitente, setFornecedor, "fornecedor");
        por(nfeKey, l.chaveNfe, setNfeKey, "chave da NF-e");

        // O CARTÃO SAI DA FOTO. "Mastercard **** 5585" é o dado mais chato de
        // digitar e o mais fácil de ler — e é ele que casa com a fatura depois.
        if (l.cartaoFinal && !final) {
          setFinal(l.cartaoFinal);
          preenchidos.push("cartão");
          setBandeiraLida(l.cartaoBandeira !== "indeterminado" ? l.cartaoBandeira : "");

          if (somenteReembolso) {
            setPagamento("cartao_pessoal");
            setCartaoLido({ final: l.cartaoFinal, conhecido: true, natureza: "pessoal" });
          } else {
          setPagamento("cartao_da_empresa");

          // E PERGUNTA NA HORA se este final é conhecido. Antes o final ficava
          // guardado sem ninguém ver, porque o campo dependia de um banco que
          // a foto não informa. Aqui a resposta vem sem depender de nada.
          try {
            const cr = await fetch(`/api/time/cartao?final=${encodeURIComponent(l.cartaoFinal)}`);
            const cj = await cr.json().catch(() => ({}));
            if (cj.conhecido && cj.cartao) {
              setCartaoLido({
                final: l.cartaoFinal,
                conhecido: true,
                natureza: cj.cartao.natureza,
                banco: cj.cartao.banco,
                apelido: cj.cartao.apelido
              });
              // Cartão da empresa reconhecido: o banco se preenche sozinho, que
              // era o passo manual que ninguém tinha como adivinhar da foto.
              if (cj.cartao.natureza === "empresa" && cj.cartao.bancoId) {
                setBanco(String(cj.cartao.bancoId));
                setCartao(String(cj.cartao.id));
              } else {
                // Pessoal e já cadastrado: o caminho é reembolso, e a pergunta
                // fica na tela em vez de o envio falhar lá no fim.
                setDecisaoPendente({ titular: "você" });
              }
            } else {
              setCartaoLido({ final: l.cartaoFinal, conhecido: false });
            }
          } catch {
            // Consulta é conveniência: se ela falhar, o final continua digitado
            // e o fluxo antigo segue. Não é motivo para perder a leitura toda.
          }
          }
        }
        if (l.parcelas && !parcelas) {
          setParcelas(String(l.parcelas));
          preenchidos.push("parcelas");
        }

        // OS ITENS VÃO PARA A DESCRIÇÃO LONGA, não para o título.
        //
        // "Cabo HDMI 4K 2 Metros — 3 un. × R$ 64,61" é o que responde "o que
        // você comprou?" seis meses depois, quando ninguém lembra e a foto
        // virou um blob no banco. O título fica curto porque é ele que aparece
        // na lista; o detalhe fica aqui porque é aqui que se procura.
        const itens = l.itens ?? [];
        if (itens.length && !descricao.trim()) {
          const linhas = itens.map((i) => {
            const q = i.quantidade ? `${i.quantidade % 1 === 0 ? i.quantidade : i.quantidade.toFixed(3)} un.` : null;
            const vu = i.valorUnitario != null ? `R$ ${i.valorUnitario.toFixed(2).replace(".", ",")}` : null;
            const cauda = [q, vu].filter(Boolean).join(" × ");
            return cauda ? `${i.descricao} — ${cauda}` : i.descricao;
          });
          if (l.numeroPedido) linhas.push(`Pedido ${l.numeroPedido}`);
          setDescricao(linhas.join("\n"));
          preenchidos.push(itens.length === 1 ? "o item" : `os ${itens.length} itens`);
        }

        // A CLASSIFICAÇÃO DA IA NÃO PREENCHE NADA SOZINHA.
        //
        // Ela vira um cartão com a frase que a justifica, e a pessoa toca em
        // "usar" — ou ignora. É a mesma disciplina da sugestão por contraparte,
        // pelo mesmo motivo: campo preenchido em silêncio é campo que ninguém
        // confere, e aqui o palpite vem de uma foto, não de histórico contado.
        const codigo = l.categoriaCode ?? null;
        const alvo = codigo ? opcoes.categorias.find((c) => c.rotulo.startsWith(`${codigo} `)) : null;
        const area = l.areaNome
          ? opcoes.centros.find((c) => !c.ehProjeto && c.nome === l.areaNome)
          : null;
        if ((alvo && !categoria) || (area && !centro)) {
          setPalpite({
            categoriaId: alvo && !categoria ? String(alvo.id) : null,
            categoriaRotulo: alvo && !categoria ? alvo.rotulo : null,
            centroId: area && !centro ? String(area.id) : null,
            centroNome: area && !centro ? area.nome : null,
            porQue: l.porQue ?? ""
          });
        }

        // O CNPJ da foto vira sugestão de categoria — ele era extraído e
        // descartado. Medido: quando a contraparte já apareceu antes, o
        // histórico acerta 76,4% contra 26,7% do chute cego.
        //
        // O HISTÓRICO GANHA DO PALPITE quando os dois existem: "você já
        // classificou este CNPJ assim 7 de 8 vezes" é um fato contado, e o
        // palpite da imagem é uma impressão. Mostrar os dois cartões brigando
        // faria a pessoa escolher entre duas telas em vez de conferir uma.
        if (l.documento && !categoria) {
          const sr = await fetch(`/api/time/sugerir-categoria?documento=${encodeURIComponent(l.documento)}`);
          const sj = await sr.json().catch(() => ({}));
          if (sj.sugestao) {
            setSugestao(sj.sugestao);
            setPalpite((p) => (p && p.centroId ? { ...p, categoriaId: null, categoriaRotulo: null } : null));
          }
        }

        if (l.legibilidade === "ruim") {
          setLeitura({
            tom: "aviso",
            texto:
              preenchidos.length > 0
                ? `Li com dificuldade — preenchi ${preenchidos.join(", ")}. Confira tudo antes de enviar.`
                : "A imagem está difícil de ler. Preencha à mão, ou tire outra foto com mais luz."
          });
        } else if (preenchidos.length === 0) {
          setLeitura({ tom: "aviso", texto: "Não achei nada novo para preencher — o que você digitou foi mantido." });
        } else if (doXml) {
          // Do XML os números são EXATOS, e dizer isso muda o que se pede da
          // pessoa: conferir uma leitura de foto é obrigação, conferir um campo
          // que veio do arquivo fiscal é cortesia.
          setLeitura({ tom: "ok", texto: `Li a nota e preenchi ${preenchidos.join(", ")} — valores exatos, do XML.` });
        } else {
          setLeitura({ tom: "ok", texto: `Preenchi ${preenchidos.join(", ")}. Confira antes de enviar.` });
        }
      } catch {
        setLeitura({ tom: "erro", texto: "não consegui ler o comprovante" });
      } finally {
        setLendo(false);
      }
    },
    [titulo, valor, data, fornecedor, nfeKey, final, parcelas, descricao, categoria, centro, opcoes, somenteReembolso]
  );

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);

    const kindEnvio = ((): "custo" | "nota_entrada" => {
      if (nota) return "nota_entrada";
      const temComprovante = Boolean(arquivo || anexoCompartilhado);
      const temFiscal = Boolean(arquivoNota || nfeKey.trim() || nfeNumero.trim() || fornecedor.trim());
      if (!temComprovante && temFiscal) return "nota_entrada";
      return "custo";
    })();

    // A CHAVE DA TENTATIVA (0145).
    //
    // Gerada uma vez e guardada num ref, ela sobrevive à retentativa: se a
    // resposta se perder na volta — 4G que cai, aba que dorme —, a pessoa toca
    // de novo e o servidor devolve o envio que JÁ existe em vez de criar um
    // segundo custo idêntico. Só zera depois do sucesso, porque aí a próxima
    // compra é mesmo outra compra.
    //
    // Isto é diferente do `disabled` do botão, que só protege contra o dedo. É
    // um app usado na rua, com sinal ruim: a resposta perdida não é o caso
    // raro.
    if (!tentativaRef.current) tentativaRef.current = crypto.randomUUID();

    try {
      if (!nota && !pagamento && !modoReembolso) throw new Error("escolha a forma de pagamento");

      /*
       * O DESTINO DECIDE O ENDPOINT, e é o cartão que decide o destino.
       *
       * Antes, um gasto do bolso da pessoa só descobria que estava na tela
       * errada no fim: o servidor recusava com "use a tela de reembolso" e ela
       * refazia tudo — foto, valor, itens. Agora a pergunta acontece no
       * instante em que o cartão pessoal aparece, e o mesmo formulário sabe
       * para onde mandar.
       *
       * O reembolso continua amarrado à SESSÃO: `criarReembolsoDoTime` não
       * aceita pessoa como parâmetro, de propósito. Por isso o botão "é
       * reembolso" fica desabilitado quando o cartão é de outra pessoa — quem
       * recebe o dinheiro é quem pede.
       */
      if (destino === "reembolso") {
        if (!tipoReembolso && !categoria) throw new Error("escolha o tipo ou a categoria do gasto");
        const tipoEscolhido = opcoes.tipos.find((t) => t.slug === tipoReembolso);
        if (tipoEscolhido?.exigeNfe && !nfeKey.trim()) throw new Error("este tipo exige a chave da NF-e");
        if (!pagamento) throw new Error("escolha como foi pago");
        const rr = await postar(
          "/api/time/reembolso",
          {
            tipo: tipoReembolso || undefined,
            categoriaId: !tipoReembolso && categoria ? categoria : undefined,
            descricao: [titulo, descricao].filter(Boolean).join(" — "),
            expenseDate: data,
            valor,
            nfeKey: nfeKey,
            nfeNumero,
            parcelas,
            pagamento,
            fornecedor,
            centroCusto: centro,
            linhaServico: centro ? "" : linha,
            finalCartao: final,
            idempotencyKey: tentativaRef.current
          },
          arquivo,
          arquivoNota
        );
        tentativaRef.current = null;
        await aoEnviar(`Reembolso ${rr.code ?? ""} enviado — a empresa te devolve este valor.`.replace("  ", " "));
        setTitulo("");
        setValor("");
        setDescricao("");
        setNfeKey("");
        setArquivo(null);
        setArquivoNota(null);
        setCartaoLido(null);
        setDestino(somenteReembolso ? "reembolso" : "custo");
        setTipoReembolso("");
        setCategoria("");
        setPalpite(null);
        setLeitura(null);
        return;
      }

      const r = await postar(
        compra ? "/api/time/compra/realizar" : "/api/time/envio",
        {
          kind: kindEnvio,
          idempotencyKey: tentativaRef.current,
          compraId: compra?.id,
          titulo,
          descricao: [categoriaProposta ? `Categoria sugerida: ${categoriaProposta}` : "", descricao]
            .filter(Boolean)
            .join(" — "),
          valor,
          data,
          parcelas,
          final,
          pagamento,
          fornecedor,
          nfeKey,
          nfeNumero,
          categoriaSugerida: categoria,
          centroCusto: centro,
          linhaServico: centro ? "" : linha,
          banco,
          cartao,
          anexoChave: anexoCompartilhado ?? undefined
        },
        arquivo,
        arquivoNota
      );
      await aoEnviar(
        compra
          ? `Compra ${compra.code} registrada — o custo ${r.code} foi para análise.`
          : `${kindEnvio === "nota_entrada" ? "Nota" : "Custo"} ${r.code} enviado para análise.`
      );
      tentativaRef.current = null;
      setTitulo("");
      setArquivoNota(null);
      setPalpite(null);
      setLeitura(null);
      setCartaoLido(null);
      setDecisaoPendente(null);
      setValor("");
      setDescricao("");
      setNfeKey("");
      setNfeNumero("");
      setParcelas("");
      setFinal("");
      setCentro("");
      setLinha("");
      setBanco("");
      setCartao("");
      setArquivo(null);
      setArquivo(null);
    } catch (erro) {
      aoFalhar({ tom: "erro", texto: (erro as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  const aoAnexar = (f: File, origem: OrigemAnexo) => {
    if (lendo) return;
    setLeitura(null);
    if (origem === "nota") setArquivoNota(f);
    else setArquivo(f);
    void lerArquivo(f);
  };

  const rotulo = unificado ? "campo-rotulo campo-rotulo-destaque" : undefined;

  return (
    <form className={unificado ? "time-form time-form-registro time-tela-padrao" : "time-form"} onSubmit={enviar}>
      {unificado ? (
        <header className="time-form-cabeca">
          <h1>
            {somenteReembolso ? "Pedir reembolso" : compra ? `Registrar ${compra.code}` : "Registrar compra"}
          </h1>
          <p>
            {somenteReembolso
              ? "Gasto do seu bolso — mesmo registro de uma compra, mas a empresa te devolve."
              : "Processo para registro das compras e custos da empresa."}
          </p>
        </header>
      ) : (
        <p className="time-sub">
          {nota ? (
            <>
              Nota fiscal que <strong>chegou para a empresa</strong>. Hoje a base só conhece nota de saída — as 3.521
              NFS-e que emitimos. A de entrada não tem por onde chegar, e é por aqui que ela passa a existir.
            </>
          ) : (
            <>
              Se você pagou do <strong>seu bolso</strong>, o caminho é o reembolso — é ele que te devolve o dinheiro.
            </>
          )}
        </p>
      )}

      <label className="campo">
        <span className={rotulo}>
          {unificado ? <IconeRotuloBusca tipo="compra" /> : null}
          {nota ? "Do que é a nota" : unificado ? "O que comprou" : "O que foi comprado"}
        </span>
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder={unificado ? "ex.: toner, almoço com cliente, passagem" : undefined}
          required
        />
      </label>

      <label className={`campo valor-campo${unificado ? " valor-campo-centro" : ""}`}>
        <span className={rotulo}>Valor{unificado ? "" : " total"}</span>
        <div className="valor-caixa">
          <em>R$</em>
          <input
            value={valor}
            onChange={(e) => setValor(mascaraDinheiro(e.target.value))}
            inputMode="numeric"
            placeholder="0,00"
            required
          />
        </div>
      </label>

      {(unificado && (arquivo || arquivoNota)) || (unificado && leitura) ? (
        <div className="anexos-resumo">
          <div className="anexos-lista" role="group" aria-label="Anexos do envio">
            {arquivo ? (
              <div className="anexo-ficha">
                <strong>{arquivo.name}</strong>
                <small>foto ou print · {(arquivo.size / 1024).toFixed(0)} KB</small>
                <button type="button" onClick={() => { setArquivo(null); setLeitura(null); }} aria-label="tirar a foto do envio">
                  tirar
                </button>
              </div>
            ) : null}
            {arquivoNota ? (
              <div className="anexo-ficha fiscal">
                <strong>{arquivoNota.name}</strong>
                <small>nota fiscal · {(arquivoNota.size / 1024).toFixed(0)} KB</small>
                <button type="button" onClick={() => setArquivoNota(null)} aria-label="tirar a nota do envio">
                  tirar
                </button>
              </div>
            ) : null}
          </div>
          {leitura ? <p className={`reemb-leitura ${leitura.tom}`}>{leitura.texto}</p> : null}
        </div>
      ) : null}

      {anexoCompartilhado && !arquivo ? (
        <div className="compartilhado">
          <strong>Comprovante recebido</strong>
          <span className="time-sub">
            {nomeCompartilhado || "arquivo"} chegou pelo compartilhamento e vai junto com este lançamento.
          </span>
        </div>
      ) : null}

      {/* Parcelamento: chips, não um campo numérico. */}
      {!nota ? (
        <div className="campo">
          <span className={rotulo ?? "campo-rotulo"} id="grupo-parcelado">{unificado ? "Parcelas" : "Parcelado?"}</span>
          <div className="chips" role="group" aria-labelledby="grupo-parcelado">
            {["", "2", "3", "4", "6", "10", "12", "18", "21", "24"].map((n) => (
              <button
                key={n || "avista"}
                type="button"
                aria-pressed={parcelas === n} className={parcelas === n ? "chip ativo" : "chip"}
                onClick={() => setParcelas(n)}
              >
                {n === "" ? "à vista" : `${n}×`}
              </button>
            ))}
          </div>
          {parcelas && centavosDoTexto(valor) > 0 ? (
            <small className="parcela-conta">
              {parcelas}× de <strong>{brl(Math.round(centavosDoTexto(valor) / Number(parcelas)))}</strong> — o total
              lançado é {brl(centavosDoTexto(valor))}
            </small>
          ) : null}
        </div>
      ) : null}

      <label className="campo">
        <span className={rotulo}>{nota ? "Emissão" : unificado ? "Data" : "Data da compra"}</span>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} required />
      </label>

      {/* Forma de pagamento em chips: opções curtas, sem folha nativa de select. */}
      <div className="campo">
        <span className={rotulo ?? "campo-rotulo"} id="grupo-como-foi-pago">{unificado ? "Pagamento" : "Como foi pago"}</span>
        <div className="chips" role="group" aria-labelledby="grupo-como-foi-pago">
          {(modoReembolso
            ? [
                ["cartao_pessoal", "Cartão"],
                ["pix_pessoal", "PIX"],
                ["dinheiro", "Dinheiro"],
                ["debito_pessoal", "Débito"]
              ]
            : [
                ["cartao_da_empresa", "Cartão"],
                ["pix_da_empresa", "PIX"],
                ["dinheiro", "Dinheiro"],
                ["boleto", "Boleto"],
                ["debito_automatico", "Débito"]
              ]
          ).map(([v, r]) => (
            <button
              key={v}
              type="button"
              aria-pressed={pagamento === v} className={pagamento === v ? "chip ativo" : "chip"}
              onClick={() => {
                setPagamento(v);
                if (v !== "cartao_da_empresa" && v !== "cartao_pessoal") {
                  setBanco("");
                  setCartao("");
                  setFinal("");
                }
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {modoReembolso && pagamento === "cartao_pessoal" ? (
        <label className="campo">
          <span className={rotulo}>Final do seu cartão</span>
          <input
            value={final}
            onChange={(e) => setFinal(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            maxLength={4}
            placeholder="4 últimos dígitos"
            className="campo-final"
          />
        </label>
      ) : null}

      {pagamento === "cartao_da_empresa" && !modoReembolso && opcoes.bancos.length > 0
        ? (() => {
            const escolhido = opcoes.bancos.find((b) => String(b.id) === banco);
            const casa = escolhido?.plasticos.find((p) => p.nome.endsWith(final)) && final.length === 4;
            return (
              <>
                <div className="campo">
                  <span className={rotulo ?? "campo-rotulo"} id="grupo-qual-banco">Banco</span>
                  <div className="chips" role="group" aria-labelledby="grupo-qual-banco">
                    {opcoes.bancos.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={banco === String(b.id)} className={banco === String(b.id) ? "chip ativo" : "chip"}
                        onClick={() => {
                          setBanco(String(b.id));
                          setCartao("");
                        }}
                      >
                        {b.nome}
                      </button>
                    ))}
                  </div>
                </div>

                {banco && !cadastrando ? (
                  <label className="campo">
                    <span className={rotulo}>Final do cartão</span>
                    <input
                      value={final}
                      onChange={(e) => setFinal(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="4 últimos dígitos"
                      className="campo-final"
                    />
                    {casa ? (
                      <small className="reemb-leitura ok">
                        Reconheci este cartão — vai casar sozinho com a fatura.
                      </small>
                    ) : final.length === 4 ? (
                      <span className="final-novo">
                        <small className="reemb-leitura aviso">Este cartão ainda não está cadastrado.</small>
                        <button type="button" onClick={() => setCadastrando(true)}>
                          cadastrar agora
                        </button>
                      </span>
                    ) : escolhido && escolhido.plasticos.length > 0 ? (
                      <small>
                        Cadastrados: {escolhido.plasticos.map((p) => p.nome.replace("final ", "")).join(" · ")}
                      </small>
                    ) : (
                      <small>Se não lembrar, pode deixar em branco.</small>
                    )}
                  </label>
                ) : null}
              </>
            );
          })()
        : null}

      {unificado ? (
        <section className="time-form-classificar">
          {modoReembolso ? (
            <BuscaClassificacaoGasto
              tipos={opcoes.tipos}
              categorias={opcoes.categorias}
              tipoSlug={tipoReembolso}
              categoriaId={categoria}
              aoEscolherTipo={(slug) => {
                setTipoReembolso(slug);
                if (slug) setCategoria("");
              }}
              aoEscolherCategoria={(id) => {
                setCategoria(id);
                if (id) setTipoReembolso("");
              }}
            />
          ) : (
            <BuscaCategoria
              destaque
              categorias={opcoes.categorias}
              valor={categoria}
              proposta={categoriaProposta}
              aoEscolher={(id) => {
                setCategoria(id);
                if (id) setCategoriaProposta("");
              }}
              aoPropor={setCategoriaProposta}
            />
          )}

          <BuscaDestino
            destaque
            centros={opcoes.centros}
            valor={centro}
            aoEscolher={(id) => {
              setCentro(id);
              if (id) setLinha("");
            }}
          />

          {!centro ? (
            <details className="campo-extra">
              <summary>Foi para um serviço específico?</summary>
              <label className="campo">
                <span>Qual serviço</span>
                <select value={linha} onChange={(e) => setLinha(e.target.value)}>
                  <option value="">— não é de um serviço —</option>
                  {opcoes.linhas.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </select>
              </label>
            </details>
          ) : null}

          <details className="time-form-extra time-form-extra-compacto">
            <summary>Quem emitiu, chave e número da NF</summary>
            <div className="time-form-extra-corpo">
              <p className="time-sub">
                Vem da foto ou do XML. Só abra se quiser digitar na mão.
              </p>
              <label className="campo">
                <span>Quem emitiu</span>
                <input
                  value={fornecedor}
                  onChange={(e) => setFornecedor(e.target.value)}
                  placeholder="nome do fornecedor"
                />
              </label>
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
            </div>
          </details>
        </section>
      ) : null}

      {/*
        O CADASTRO DO CARTÃO, no nível do formulário.
        Ele morava DENTRO do bloco que só renderiza depois de escolher o banco
        — e a foto não diz o banco. Ou seja: o único caminho para cadastrar o
        cartão que a leitura acabou de revelar exigia adivinhar antes de qual
        banco ele era. Aqui ele é alcançável de onde a pergunta nasce.
      */}
      {cadastrando ? (
        <CadastrarCartao
          bancos={opcoes.bancos}
          pessoas={pessoas}
          inicial={{ banco, final, bandeira: bandeiraLida }}
          aoCadastrar={(novasOpcoes, id, dono) => {
            aoAtualizarOpcoes(novasOpcoes);
            setCartao(String(id));
            setCadastrando(false);
            setCartaoLido({ final, conhecido: true, natureza: dono.natureza, apelido: null, banco: null });
            // AQUI FECHA O CICLO que o Fernando descreveu: dito de quem é o
            // cartão, sobra uma pergunta só — compra da empresa ou reembolso.
            if (dono.natureza === "pessoal") setDecisaoPendente({ titular: dono.titular });
          }}
          aoFechar={() => setCadastrando(false)}
        />
      ) : null}

      {/*
        O CARTÃO QUE A FOTO REVELOU.
        Fica ANTES de tudo que depende dele, porque a resposta muda o destino do
        lançamento inteiro: cartão da empresa é compra; cartão pessoal é
        dinheiro do bolso de alguém, e isso é reembolso.
      */}
      {cartaoLido && !cadastrando ? (
        somenteReembolso ? (
          <div className="cartao-lido pessoal">
            <strong>Cartão final {cartaoLido.final}</strong>
            <span className="time-sub">Li da foto — confira o final e a forma de pagamento.</span>
          </div>
        ) : cartaoLido.conhecido ? (
          <div className={cartaoLido.natureza === "empresa" ? "cartao-lido ok" : "cartao-lido pessoal"}>
            <strong>
              Cartão final {cartaoLido.final} — {cartaoLido.natureza === "empresa" ? "da empresa" : "pessoal"}
            </strong>
            <span className="time-sub">
              {cartaoLido.natureza === "empresa"
                ? `${cartaoLido.banco ?? "banco reconhecido"}${cartaoLido.apelido ? ` · ${cartaoLido.apelido}` : ""} — vai casar sozinho com a fatura.`
                : "Você pagou do seu bolso, então o caminho é o reembolso — é ele que te devolve o dinheiro."}
            </span>
          </div>
        ) : (
          <div className="cartao-lido novo">
            <strong>Não conheço o cartão final {cartaoLido.final}</strong>
            <span className="time-sub">
              Li os quatro dígitos da foto, mas ele não está cadastrado. Diga de quem é — é isso que decide
              se esta compra entra como gasto da empresa ou como reembolso para alguém.
            </span>
            <button type="button" onClick={() => setCadastrando(true)}>
              dizer de quem é
            </button>
          </div>
        )
      ) : null}

      {/*
        A CONFIRMAÇÃO que o cartão pessoal exige.
        Cartão pessoal quase sempre significa reembolso, mas "quase sempre" não
        é sempre — e gravar o caminho errado aqui manda a pessoa refazer tudo.
        Por isso pergunta, com os dois botões do mesmo tamanho.
      */}
      {decisaoPendente && !somenteReembolso ? (
        <div className="decisao">
          <strong>Cartão pessoal {decisaoPendente.titular === "você" ? "seu" : `de ${decisaoPendente.titular}`}</strong>
          <span className="time-sub">
            O dinheiro saiu do bolso de uma pessoa. Isto normalmente é um reembolso — a empresa devolve.
            Mas se a empresa já pagou por outro caminho, é uma compra.
          </span>
          <div className="decisao-acoes">
            <button
              type="button"
              onClick={() => {
                setDestino("reembolso");
                setDecisaoPendente(null);
              }}
              disabled={decisaoPendente.titular !== "você"}
            >
              é reembolso
            </button>
            <button
              type="button"
              className="decisao-alt"
              onClick={() => {
                setDestino("custo");
                setDecisaoPendente(null);
              }}
            >
              foi compra da empresa
            </button>
          </div>
          {decisaoPendente.titular !== "você" ? (
            <small className="reemb-leitura aviso">
              O reembolso é pedido por quem gastou — peça para {decisaoPendente.titular} lançar, ou registre
              como compra da empresa se é a empresa que vai pagar.
            </small>
          ) : null}
        </div>
      ) : null}

      {/* O tipo do reembolso, que só existe neste caminho. */}
      {destino === "reembolso" && !unificado ? (
        <div className="decisao escolhido">
          <strong>Isto vai como REEMBOLSO</strong>
          <span className="time-sub">A empresa te devolve este valor. Escolha o tipo para o financeiro conferir.</span>
          <label className="campo">
            <span>Tipo do reembolso</span>
            <select value={tipoReembolso} onChange={(e) => setTipoReembolso(e.target.value)}>
              <option value="">— escolha —</option>
              {opcoes.tipos.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.nome}
                  {t.exigeNfe ? " (exige NF-e)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="decisao-alt" onClick={() => setDestino("custo")}>
            não, voltar para custo da empresa
          </button>
        </div>
      ) : null}

      {/*
        O PALPITE DA IMAGEM, com a razão à vista.
        Ele mostra o que sugere E em que se baseou, na mesma altura. Sem a
        razão, "Comercial" é um chute que a pessoa aceita por preguiça; com
        ela, é uma afirmação que dá para discordar em dois segundos.
      */}
      {palpite && (palpite.categoriaId || palpite.centroId) ? (
        <div className="sugestao palpite">
          <div>
            <strong>
              {[palpite.categoriaRotulo, palpite.centroNome].filter(Boolean).join(" · ")}
            </strong>
            <span className="time-sub">
              {palpite.porQue ? `Li da imagem: ${palpite.porQue}` : "Palpite a partir da imagem."} Confira — é chute, não histórico.
            </span>
          </div>
          <div className="sugestao-acoes">
            <button
              type="button"
              onClick={() => {
                if (palpite.categoriaId) setCategoria(palpite.categoriaId);
                if (palpite.centroId) {
                  setCentro(palpite.centroId);
                  setLinha("");
                }
                setPalpite(null);
              }}
            >
              usar
            </button>
            <button type="button" className="sugestao-nao" onClick={() => setPalpite(null)}>
              não
            </button>
          </div>
        </div>
      ) : null}

      {sugestao && !categoria ? (
        <div className="sugestao">
          <div>
            <strong>{sugestao.rotulo}</strong>
            <span className="time-sub">
              Você já classificou {sugestao.contraparte} assim {sugestao.vezes}{" "}
              {sugestao.vezes === 1 ? "vez" : "vezes"}
              {sugestao.forte ? "" : " — mas nem sempre"}.
            </span>
          </div>
          <button type="button" onClick={() => { setCategoria(String(sugestao.categoriaId)); setSugestao(null); }}>
            usar
          </button>
        </div>
      ) : null}

      {!unificado ? (
        <>
          {nota ? (
            <label className="campo">
              <span>Quem emitiu</span>
              <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="nome do fornecedor" />
            </label>
          ) : null}

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

          <BuscaDestino
            centros={opcoes.centros}
            valor={centro}
            aoEscolher={(id) => {
              setCentro(id);
              if (id) setLinha("");
            }}
          />

          {!centro ? (
            <details className="campo-extra">
              <summary>Foi para um serviço específico?</summary>
              <label className="campo">
                <span>Qual serviço</span>
                <select value={linha} onChange={(e) => setLinha(e.target.value)}>
                  <option value="">— não é de um serviço —</option>
                  {opcoes.linhas.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </select>
                <small>Ex.: combustível para rodar um laudo que ainda não virou contrato.</small>
              </label>
            </details>
          ) : null}

          <BuscaCategoria
            categorias={opcoes.categorias}
            valor={categoria}
            proposta={categoriaProposta}
            aoEscolher={(id) => {
              setCategoria(id);
              if (id) setCategoriaProposta("");
            }}
            aoPropor={setCategoriaProposta}
          />
        </>
      ) : null}

      {!unificado ? (
        <div className="anexos">
          <span className="campo-rotulo" id="grupo-anexos">
            {nota ? "Arquivo da nota" : "Comprovante e nota"}
          </span>
          <div className="anexos-lista" role="group" aria-labelledby="grupo-anexos">
            {arquivo ? (
              <div className="anexo-ficha">
                <strong>{arquivo.name}</strong>
                <small>foto ou print · {(arquivo.size / 1024).toFixed(0)} KB</small>
                <button type="button" onClick={() => { setArquivo(null); setLeitura(null); }} aria-label="tirar a foto do envio">
                  tirar
                </button>
              </div>
            ) : null}
            {arquivoNota ? (
              <div className="anexo-ficha fiscal">
                <strong>{arquivoNota.name}</strong>
                <small>nota fiscal · {(arquivoNota.size / 1024).toFixed(0)} KB</small>
                <button type="button" onClick={() => setArquivoNota(null)} aria-label="tirar a nota do envio">
                  tirar
                </button>
              </div>
            ) : null}
            {!arquivo && !arquivoNota ? (
              <p className="anexos-vazio">
                Nada anexado ainda. Toque em <strong>foto da compra</strong>, ali embaixo.
              </p>
            ) : null}
          </div>
          {lendo ? <small className="reemb-lendo">lendo o comprovante…</small> : null}
          {leitura ? <small className={`reemb-leitura ${leitura.tom}`}>{leitura.texto}</small> : null}
        </div>
      ) : null}

      <div className="time-form-rodape">
        <button className="time-botao" disabled={enviando}>
          {enviando
            ? "enviando…"
            : modoReembolso
              ? "pedir reembolso"
              : nota
                ? "enviar nota"
                : "registrar compra"}
        </button>
        <p className="time-nota">
          {modoReembolso
            ? "Isto entra no SEU reembolso do mês. Não vira lançamento nem mexe em saldo até o financeiro conferir."
            : nota
              ? "A nota entra na fila do financeiro. Não vira documento nem mexe em saldo até alguém conferir."
              : compra
                ? "Registrar não mexe em saldo. O custo fica aguardando o financeiro conferir a compra aprovada."
                : "Enviar não é aprovar. O custo entra na fila do financeiro — sem mexer em saldo até conferir."}
        </p>
      </div>

      {!unificado ? (
        <AnexarFlutuante lendo={lendo} jaTem={Boolean(arquivo || arquivoNota)} aoEscolher={aoAnexar} />
      ) : (
        <AnexarFlutuante
          centralizado
          rotulo="Registro automático"
          rotuloAnexado="Trocar arquivo"
          lendo={lendo}
          jaTem={Boolean(arquivo || arquivoNota)}
          aoEscolher={aoAnexar}
        />
      )}
    </form>
  );
}

function FormCompra({ aoEnviar, aoFalhar }: { aoEnviar: AoEnviar; aoFalhar: AoFalhar }) {
  const [titulo, setTitulo] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [valor, setValor] = useState("");
  const [urgencia, setUrgencia] = useState("normal");
  const [precisaAte, setPrecisaAte] = useState("");
  const [links, setLinks] = useState<{ url: string; loja: string }[]>([{ url: "", loja: "" }]);
  const [enviando, setEnviando] = useState(false);

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
          valor,
          urgencia,
          precisaAte,
          links: links.filter((l) => l.url.trim()).map((l) => ({ url: l.url.trim(), loja: l.loja }))
        },
        null
      );
      await aoEnviar(`Pedido ${r.code} enviado com ${r.links} link(s).`);
      setTitulo("");
      setJustificativa("");
      setValor("");
      setLinks([{ url: "", loja: "" }]);
    } catch (erro) {
      aoFalhar({ tom: "erro", texto: (erro as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="time-form time-form-registro time-tela-padrao" onSubmit={enviar}>
      <header className="time-form-cabeca">
        <h1>Solicitar compra</h1>
        <p>Processo para pedir o que a empresa precisa comprar — links, valores e justificativa viram cotação e aprovação.</p>
      </header>

      <label className="campo">
        <span className={ROTULO}>
          <IconeRotuloBusca tipo="compra" />
          O que precisa
        </span>
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="cadeira de escritório" required />
      </label>

      <label className="campo">
        <span className={ROTULO}>
          <IconeRotuloBusca tipo="descricao" />
          Para que serve
        </span>
        <textarea
          value={justificativa}
          onChange={(e) => setJustificativa(e.target.value)}
          rows={2}
          placeholder="a atual quebrou o encosto"
          required
        />
        <small>Quem decide lê isto ao lado do valor. Sem justificativa, aprovar vira carimbo.</small>
      </label>

      <div className="campo campo-qty">
        <span className={ROTULO}>Quantidade</span>
        <div className="qty-stepper">
          <button
            type="button"
            aria-label="diminuir quantidade"
            onClick={() => {
              const n = Math.max(1, Math.round(Number(String(quantidade).replace(",", ".")) || 1) - 1);
              setQuantidade(String(n));
            }}
          >
            −
          </button>
          <input
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value.replace(/[^\d.,]/g, ""))}
            inputMode="decimal"
            aria-label="quantidade"
          />
          <button
            type="button"
            aria-label="aumentar quantidade"
            onClick={() => {
              const n = Math.max(1, Math.round(Number(String(quantidade).replace(",", ".")) || 1) + 1);
              setQuantidade(String(n));
            }}
          >
            +
          </button>
        </div>
      </div>

      <label className="campo valor-campo valor-campo-centro">
        <span className={ROTULO}>
          <IconeRotuloBusca tipo="valor" />
          Valor estimado
        </span>
        <div className="valor-caixa">
          <em>R$</em>
          <input
            value={valor}
            onChange={(e) => setValor(mascaraDinheiro(e.target.value))}
            inputMode="numeric"
            placeholder="0,00"
            required
          />
        </div>
      </label>

      <div className="campo">
        <span className={ROTULO} id="grupo-urgencia">
          <IconeRotuloBusca tipo="urgencia" />
          Urgência
        </span>
        <div className="chips" role="group" aria-labelledby="grupo-urgencia">
          {[
            ["baixa", "Baixa"],
            ["normal", "Normal"],
            ["alta", "Alta"],
            ["critica", "Crítica"]
          ].map(([v, r]) => (
            <button
              key={v}
              type="button"
              aria-pressed={urgencia === v}
              className={urgencia === v ? "chip ativo" : "chip"}
              onClick={() => setUrgencia(v)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <label className="campo">
        <span className={ROTULO}>
          <IconeRotuloBusca tipo="data" />
          Preciso até
          <span className="campo-opcional">opcional</span>
        </span>
        <input type="date" value={precisaAte} onChange={(e) => setPrecisaAte(e.target.value)} />
      </label>

      <fieldset className="time-links time-links-padrao">
        <legend className={ROTULO}>
          <IconeRotuloBusca tipo="link" />
          Links do que comprar
        </legend>
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
            {links.length > 1 ? (
              <button type="button" className="time-link" onClick={() => setLinks(links.filter((_, j) => j !== i))}>
                remover
              </button>
            ) : null}
          </div>
        ))}
        <button type="button" className="time-link" onClick={() => setLinks([...links, { url: "", loja: "" }])}>
          + outro link
        </button>
        <p className="time-sub">URL e loja de onde achou. O valor vai só no campo acima.</p>
      </fieldset>

      <div className="time-form-rodape">
        <button className="time-botao" disabled={enviando}>
          {enviando ? "enviando…" : "enviar pedido"}
        </button>
        <p className="time-nota">
          Pedido aprovado ainda não é compra feita nem dinheiro reservado: ele vira solicitação de pagamento num segundo
          passo, com aprovação de quem tem alçada.
        </p>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Acompanhamento
// ---------------------------------------------------------------------------

const ORDEM_ENVIO_ROTULO: Record<string, string> = {
  recente: "Mais recentes",
  antigo: "Mais antigos",
  valor_desc: "Maior valor",
  valor_asc: "Menor valor",
  titulo: "Nome A–Z"
};

const FILTRO_TIPO_OPCOES: [string, string][] = [
  ["", "Todos"],
  ["custo", "Custo"],
  ["reembolso", "Reembolso"],
  ["compra", "Compra"],
  ["nota_entrada", "Nota"]
];

const FILTRO_STATUS_OPCOES: [string, string][] = [
  ["", "Todos"],
  ["registrado", "Registrado"],
  ["aguardando", "Aguardando"],
  ["pago", "Pago"],
  ["nao_pago", "Não pago"]
];

const STATUS_EXTRATO_ROTULO: Record<StatusExtrato, string> = {
  registrado: "Registrado",
  aguardando: "Aguardando",
  pago: "Pago",
  nao_pago: "Não pago"
};

const SITUACAO_CRONO_ROTULO: Record<StatusExtrato | "previsto", string> = {
  registrado: "Registrado",
  aguardando: "Aguardando",
  pago: "Pago",
  nao_pago: "Não pago",
  previsto: "Previsto"
};

function normalizarEnvio(bruto: Partial<Envio> & Pick<Envio, "origem" | "origemId">): Envio {
  const estado = (bruto.estado ?? "aguardando") as Envio["estado"];
  const statusExtrato: StatusExtrato =
    bruto.statusExtrato ??
    (estado === "concluido"
      ? "pago"
      : estado === "recusado" || estado === "devolvido"
        ? "nao_pago"
        : estado === "rascunho"
          ? "registrado"
          : "aguardando");
  return {
    origem: bruto.origem,
    origemId: bruto.origemId,
    code: bruto.code ?? "",
    titulo: bruto.titulo ?? "",
    valorCents: bruto.valorCents ?? null,
    dataRef: bruto.dataRef ?? null,
    status: bruto.status ?? "",
    estado,
    resposta: bruto.resposta ?? null,
    decididoEm: bruto.decididoEm ?? null,
    decididoPor: bruto.decididoPor ?? null,
    criadoEm: bruto.criadoEm ?? new Date().toISOString(),
    itens: bruto.itens ?? 0,
    itensComAnexo: bruto.itensComAnexo ?? 0,
    parcelasTotal: bruto.parcelasTotal ?? null,
    parcelaAtual: bruto.parcelaAtual ?? null,
    statusExtrato,
    grupoChave: bruto.grupoChave ?? `${bruto.origem}:${bruto.origemId}`,
    itensPreview: bruto.itensPreview ?? []
  };
}

function chaveEnvio(e: Pick<Envio, "origem" | "origemId">) {
  return `${e.origem}-${e.origemId}`;
}

function metaEnvio(e: Envio) {
  const partes: string[] = [e.code];
  if (e.origem === "reembolso" && e.itens > 0) {
    const faltam = e.itens - e.itensComAnexo;
    if (faltam > 0) partes.push(`${faltam} sem comprovante`);
    else partes.push("comprovantes ok");
  }
  if (e.origem === "compra" && e.itens > 0) partes.push(`${e.itens} link${e.itens === 1 ? "" : "s"}`);
  if (e.parcelasTotal && e.parcelasTotal >= 2) {
    const parcela = e.parcelaAtual ?? 1;
    partes.push(`${parcela}/${e.parcelasTotal}`);
  }
  return partes.join(" · ");
}

function formatMesRef(mes: string) {
  const [a, m] = mes.split("-");
  return `${m}/${a.slice(2)}`;
}

function IconeExpandir({ aberto }: { aberto: boolean }) {
  return (
    <svg
      className="envios-produto-expandir-icone"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {aberto ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
    </svg>
  );
}

const FILTRO_PERIODO_OPCOES: [string, string][] = [
  ["tudo", "Tudo"],
  ["7d", "7 dias"],
  ["30d", "30 dias"],
  ["90d", "90 dias"]
];

function rotuloFiltroTipo(v: string) {
  return FILTRO_TIPO_OPCOES.find(([id]) => id === v)?.[1] ?? v;
}

function rotuloFiltroStatus(v: string) {
  return FILTRO_STATUS_OPCOES.find(([id]) => id === v)?.[1] ?? v;
}

function rotuloFiltroPeriodo(v: string) {
  return FILTRO_PERIODO_OPCOES.find(([id]) => id === v)?.[1] ?? v;
}

/**
 * A data que a linha MOSTRA — e, por isso, a data por que ela ordena e filtra.
 *
 * ---------------------------------------------------------------------------
 * ELAS ESTAVAM SEPARADAS, E A LISTA SAÍA EMBARALHADA
 * ---------------------------------------------------------------------------
 * O cartão exibia `dataRef ?? criadoEm` (a data do gasto), e a ordenação usava
 * `criadoEm` cru (a data em que a linha entrou na base). Nas duas pessoas
 * conferidas, `dataRef` difere de `criadoEm` em 8 de 8 e 7 de 7 envios — a
 * planilha foi importada de uma vez, então TODA linha tem as duas datas
 * distantes.
 *
 * O resultado em "Mais recentes", medido no Fernando:
 *   12/08 · 01/03 · 01/04 · 01/05 · 01/02 · 01/07 · 01/01 · 01/06
 * Quatro quebras em sete pares. A pessoa lia uma lista que se dizia ordenada e
 * não estava, sem nada na tela explicando por quê.
 *
 * O filtro de período tinha a MESMA raiz e era pior: "últimos 30 dias" comparava
 * `criadoEm`, então devolvia gastos de janeiro — importados em agosto — como se
 * fossem do mês. Filtro que responde a outra pergunta é pior que filtro
 * ausente, porque a resposta parece boa.
 *
 * Empate cai em `criadoEm`: duas compras no mesmo dia mantêm a ordem em que
 * foram enviadas, em vez de trocarem de lugar a cada render.
 */
function dataDoEnvio(e: Envio) {
  return e.dataRef ?? e.criadoEm.slice(0, 10);
}

function formatDataEnvio(e: Envio) {
  const [a, m, dia] = dataDoEnvio(e).split("-");
  return `${dia}/${m}/${a.slice(2)}`;
}

function TelaItemGasto({
  fonte,
  itemId,
  aoFalhar
}: {
  fonte: "planilha" | "app";
  itemId: number;
  aoFalhar: (r: { tom: "ok" | "erro"; texto: string }) => void;
}) {
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");
  const [tipoReembolso, setTipoReembolso] = useState("");
  const [categoriaLivre, setCategoriaLivre] = useState("");
  const [nota, setNota] = useState("");
  const [valorCents, setValorCents] = useState(0);
  const [parcela, setParcela] = useState<number | null>(null);
  const [parcelasTotal, setParcelasTotal] = useState<number | null>(null);
  const [data, setData] = useState<string | null>(null);
  const [statusParte, setStatusParte] = useState<StatusExtrato>("aguardando");
  const [temComprovante, setTemComprovante] = useState(false);
  const [envio, setEnvio] = useState<{ origem: string; origemId: number; code: string } | null>(null);
  const [opcoes, setOpcoes] = useState<Opcoes>({ tipos: [], categorias: [], centros: [], linhas: [], bancos: [] });
  const [historico, setHistorico] = useState<{
    parcelaAtual: number;
    parcelasTotal: number;
    pagoCents: number;
    saldoCents: number;
    inicioMes: string | null;
    parcelas: { id: number; mes: string; parcela: number; parcelasTotal: number; valorCents: number; situacao: StatusExtrato | "previsto" }[];
  } | null>(null);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);

  /*
   * O QUE A PESSOA VAI DEVOLVER — pela mesma regra que o servidor cobra.
   *
   * O diálogo dizia `historico.pagoCents`, que é a soma do SLUG inteiro. O
   * servidor foi corrigido para cobrar o item; se a tela não acompanhar, ela
   * anuncia R$ 5.409,26 e o PIX sai R$ 429,97 — e a pessoa confirma uma coisa
   * e recebe outra, que é pior que qualquer um dos dois valores isolados.
   *
   * A regra tem um discriminador só, igual à do `estorno-reembolso.ts`:
   * compra parcelada de verdade devolve as parcelas dela; linha avulsa
   * devolve a própria linha.
   */
  const pagasDoItem = (historico?.parcelas ?? []).filter((p) => p.situacao === "pago");
  const devolverCents =
    (historico?.parcelasTotal ?? 1) > 1
      ? pagasDoItem.reduce((soma, p) => soma + p.valorCents, 0)
      : (pagasDoItem.find((p) => p.id === itemId)?.valorCents ?? 0);
  const parcelasQueVoltam = (historico?.parcelasTotal ?? 1) > 1 ? pagasDoItem.length : devolverCents > 0 ? 1 : 0;
  /** Os arquivos presos a este item — para poder abrir e baixar. */
  const [anexos, setAnexos] = useState<
    { chave: string; nome: string; tipo: string; kind: string; bytes: number; em: string }[]
  >([]);

  /** Confirmação da cópia junto do botão, e o payload à mão se ela falhar. */
  const [pixCopiado, setPixCopiado] = useState<"copiado" | "falhou" | null>(null);

  const [mostrarBrcode, setMostrarBrcode] = useState(false);

  const [estorno, setEstorno] = useState<{
    id: number;
    valorCents: number;
    parcelasPagas: number;
    parcelasDetalhe: { parcela: number; mes: string; valorCents: number }[];
    status: string;
    motivo: string;
    pixChave: string;
    pixNomeRecebedor: string;
    brcode: string | null;
    quitadoEm: string | null;
  } | null>(null);
  const [cancelPasso, setCancelPasso] = useState<null | "motivo" | "confirmar">(null);
  const [motivoCategoria, setMotivoCategoria] = useState("devolucao");
  const [motivoTexto, setMotivoTexto] = useState("");
  const [cancelando, setCancelando] = useState(false);

  /*
   * O DIÁLOGO DE CANCELAR PRECISA TER SAÍDA.
   *
   * Medido antes: `Escape` não fechava, toque no véu não fechava, o foco nunca
   * entrava (ficava no `<body>`), e a 7ª tabulação já estava na barra inferior
   * ATRÁS do véu. A única saída era acertar "Voltar", 39x23px — o menor alvo
   * do app, num diálogo que pergunta se pode cancelar uma compra.
   *
   * A disciplina é a mesma que o menu "Mais" tinha antes de sair: Esc fecha,
   * toque no véu fecha, o foco entra ao abrir e volta para o botão que abriu.
   */
  const painelCancelarRef = useRef<HTMLDivElement | null>(null);
  const abriuCancelarDe = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!cancelPasso) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !cancelando) setCancelPasso(null);
    };
    document.addEventListener("keydown", aoTeclar);
    // Rolagem travada: um diálogo que cobre a tela e deixa o fundo rolar faz a
    // pessoa perder a referência do que estava vendo.
    const rolagemAntes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    painelCancelarRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = rolagemAntes;
      abriuCancelarDe.current?.focus();
    };
  }, [cancelPasso, cancelando]);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const MOTIVOS_CANCELAR = [
    { slug: "devolucao", rotulo: "Devolução da compra" },
    { slug: "erro_compra", rotulo: "Erro na compra" },
    { slug: "desistencia", rotulo: "Desisti da compra" },
    { slug: "outro", rotulo: "Outro" }
  ] as const;

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/time/reembolso-item/${fonte}/${itemId}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        /*
         * 404 aqui quase sempre é URL trocada, não falha de sistema — e a
         * mensagem genérica não ajudava ninguém a sair.
         *
         * O caso concreto: `/time/item/app/391`. O 391 existe, mas é um
         * `fin_time_envio` (uma compra registrada), e a fonte `app` procura em
         * `fin_reimbursement_item`. São duas sequências de id independentes, e
         * o mesmo número aponta para coisas diferentes em cada uma. A tela
         * dizia só "não foi possível carregar" e deixava a pessoa parada.
         */
        /*
         * 404 AQUI QUASE SEMPRE É O ID DE OUTRA COISA — E DÁ PARA RESOLVER.
         *
         * `/time/item/app/391` não achava nada porque o 391 é um
         * `fin_time_envio` (uma compra registrada), e a fonte `app` procura em
         * `fin_reimbursement_item`. São duas sequências de id independentes: o
         * mesmo número aponta para registros diferentes em cada uma.
         *
         * Em vez de mandar a pessoa procurar, procuro por ela: se o id for um
         * envio dela, levo direto para o detalhe. `/time/envios` já sabe abrir
         * um item pelo hash `#envio-origem-id`. Uma requisição a mais, e só no
         * caminho de erro.
         */
        if (r.status === 404) {
          const le = await fetch("/api/time/envios", { cache: "no-store" });
          const lj = await le.json().catch(() => ({}));
          const meu = (lj.envios as { origem: string; origemId: number }[] | undefined)?.find(
            (e) => e.origemId === itemId
          );
          if (meu) {
            window.location.replace(`/time/envios#envio-${meu.origem}-${meu.origemId}`);
            return;
          }
        }
        setErro(
          r.status === 404
            ? `Não achei o item ${itemId} em ${fonte === "app" ? "reembolsos do app" : "reembolsos da planilha"}. ` +
              "Veja a lista completa em Histórico."
            : ((j.erro as string) ?? "Não foi possível carregar o item.")
        );
        return;
      }
      const item = j.item as {
        nome: string;
        valorCents: number;
        parcela: number | null;
        parcelasTotal: number | null;
        data: string | null;
        categoriaId: number | null;
        tipoReembolso: string | null;
        categoriaLivre: string | null;
        nota: string | null;
        temComprovante: boolean;
        statusParte: StatusExtrato;
        envio: { origem: string; origemId: number; code: string } | null;
      };
      setNome(item.nome);
      setValorCents(item.valorCents);
      setParcela(item.parcela);
      setParcelasTotal(item.parcelasTotal);
      setData(item.data);
      setCategoria(item.categoriaId ? String(item.categoriaId) : "");
      setTipoReembolso(item.tipoReembolso ?? "");
      setCategoriaLivre(item.categoriaLivre ?? "");
      setNota(item.nota ?? "");
      setTemComprovante(item.temComprovante);
      setStatusParte(item.statusParte);
      setEnvio(item.envio);
      setOpcoes(j.opcoes ?? { tipos: [], categorias: [], centros: [], linhas: [], bancos: [] });
      if (j.historico) {
        setHistorico({
          parcelaAtual: j.historico.parcelaAtual,
          parcelasTotal: j.historico.parcelasTotal,
          pagoCents: j.historico.pagoCents,
          saldoCents: j.historico.saldoCents,
          inicioMes: j.historico.inicioMes,
          parcelas: j.historico.parcelas
        });
      }
      if (j.estorno) {
        setEstorno(j.estorno as typeof estorno);
      } else {
        setEstorno(null);
      }
      setAnexos(Array.isArray(j.anexos) ? j.anexos : []);
    } finally {
      setCarregando(false);
    }
  }, [fonte, itemId]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const r = await fetch(`/api/time/reembolso-item/${fonte}/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nome: nome.trim(),
          categoriaId: categoria ? Number(categoria) : null,
          tipoReembolso: tipoReembolso || null,
          categoriaLivre: categoriaLivre.trim() || null,
          nota: nota.trim() || null
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        aoFalhar({ tom: "erro", texto: (j.erro as string) ?? "Não foi possível salvar." });
        return;
      }
      if (j.titulo) setNome(j.titulo);
      aoFalhar({ tom: "ok", texto: "Item atualizado." });
      void recarregar();
    } finally {
      setSalvando(false);
    }
  };

  const enviarComprovante = async (arquivo: File) => {
    if (fonte !== "app") return;
    setEnviandoAnexo(true);
    try {
      const form = new FormData();
      form.append("arquivo", arquivo);
      const r = await fetch(`/api/time/reembolso-item/app/${itemId}/comprovante`, { method: "POST", body: form });
      if (r.ok) {
        setTemComprovante(true);
        aoFalhar({ tom: "ok", texto: "Comprovante anexado." });
      } else {
        const j = await r.json().catch(() => ({}));
        aoFalhar({ tom: "erro", texto: (j.erro as string) ?? "Não foi possível anexar." });
      }
    } finally {
      setEnviandoAnexo(false);
    }
  };

  const cancelarCompra = async () => {
    setCancelando(true);
    try {
      const r = await fetch(`/api/time/reembolso-item/${fonte}/${itemId}/cancelar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          motivoCategoria,
          motivo: motivoTexto.trim(),
          confirmar: true
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        aoFalhar({ tom: "erro", texto: (j.erro as string) ?? "Não foi possível cancelar." });
        return;
      }
      setCancelPasso(null);
      aoFalhar({ tom: "ok", texto: "Compra cancelada. Veja abaixo como devolver o valor." });
      // Cancelar move o saldo em aberto: "Ainda a receber" no Início e o
      // aberto de Recebíveis passam a mentir se o cache sobreviver ao POST.
      invalidarRecebiveis();
      void recarregar();
    } finally {
      setCancelando(false);
    }
  };

  const formatarCnpj = (cnpj: string) => {
    const d = cnpj.replace(/\D/g, "");
    if (d.length !== 14) return cnpj;
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  };

  /*
   * A CONFIRMAÇÃO FICA JUNTO DO BOTÃO, não no recado do topo da tela.
   *
   * O recado global é ótimo para "custo enviado" e péssimo aqui: ele mora no
   * alto de `.time-app`, e confirmar a cópia levava a pessoa para longe do QR
   * que ela acabou de copiar.
   *
   * E se a área de transferência falhar — permissão negada, contexto sem
   * HTTPS, navegador antigo —, o código precisa continuar alcançável. Antes o
   * BR Code não existia em lugar nenhum da página como texto: sem a cópia, não
   * havia como pagar por copia-e-cola. `mostrarBrcode` põe o payload numa
   * caixa selecionável, que é o pior caso aceitável.
   */
  const copiarPix = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setPixCopiado("copiado");
      window.setTimeout(() => setPixCopiado(null), 2500);
    } catch {
      setPixCopiado("falhou");
      setMostrarBrcode(true);
    }
  };

  if (carregando) return <div className="time-aviso">carregando…</div>;
  if (erro) return <p className="time-erro">{erro}</p>;

  const voltar =
    envio ? `/time/envios#envio-${envio.origem}-${envio.origemId}` : "/time/envios";

  return (
    <form className="time-form time-form-registro time-tela-padrao item-gasto" onSubmit={(e) => void salvar(e)}>
      <header className="time-form-cabeca item-gasto-cabeca">
        <Link href={voltar} className="time-link item-gasto-voltar">
          ← Histórico
        </Link>
        <div className="item-gasto-titulo">
          <h1>Item de reembolso</h1>
          {estorno ? (
            <span className={`envios-status envios-status-${estorno.status === "quitado" ? "pago" : "aguardando"}`}>
              {estorno.status === "quitado" ? "Devolvido" : "Cancelado · a devolver"}
            </span>
          ) : (
            <span className={`envios-status envios-status-${statusParte}`}>{STATUS_EXTRATO_ROTULO[statusParte]}</span>
          )}
        </div>
        <p>Detalhes sobre o reembolso</p>
      </header>

      <div className="item-gasto-resumo">
        <strong className="item-gasto-valor">{brl(valorCents)}</strong>
        <div className="item-gasto-meta">
          {[
            parcelasTotal && parcelasTotal >= 2 ? `parcela ${parcela ?? "?"}/${parcelasTotal}` : null,
            data ? data.split("-").reverse().join("/") : null,
            envio?.code ?? null,
            fonte === "planilha" ? "planilha" : null
          ]
            .filter(Boolean)
            .map((texto, i, arr) => (
              <span key={`${texto}-${i}`}>
                {texto}
                {i < arr.length - 1 ? <span className="item-gasto-meta-sep" aria-hidden> · </span> : null}
              </span>
            ))}
        </div>
      </div>

      <label className="campo">
        <span className="campo-rotulo campo-rotulo-destaque">O que é</span>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex.: ar-condicionado sala reunião"
          required
          disabled={Boolean(estorno)}
        />
      </label>

      {/*
        COM ESTORNO ABERTO, A TELA É DE LEITURA.
        Antes só o campo "O que é" ficava desabilitado: os chips, a busca de
        categoria e o anexo continuavam ativos, e o rodapé com o botão de
        salvar sumia inteiro. A pessoa reclassificava um item cancelado, nada
        persistia, e nada avisava. `fieldset disabled` desliga tudo que está
        dentro de uma vez — inclusive o que alguém acrescentar aqui amanhã.
      */}
      <fieldset className="item-gasto-campos" disabled={Boolean(estorno)}>
        {estorno ? (
          <p className="item-gasto-travado" role="status">
            Este item foi cancelado e está aguardando o estorno. A classificação não pode mais ser alterada.
          </p>
        ) : null}
      <section className="time-form-classificar">
        {fonte === "app" ? (
          <BuscaClassificacaoGasto
            tipos={opcoes.tipos}
            categorias={opcoes.categorias}
            tipoSlug={tipoReembolso}
            categoriaId={categoria}
            aoEscolherTipo={(slug) => {
              setTipoReembolso(slug);
              if (slug) setCategoria("");
            }}
            aoEscolherCategoria={(id) => {
              setCategoria(id);
              if (id) setTipoReembolso("");
            }}
          />
        ) : (
          <label className="campo">
            <span className="campo-rotulo campo-rotulo-destaque">Categoria</span>
            <input
              value={categoriaLivre}
              onChange={(e) => setCategoriaLivre(e.target.value)}
              placeholder="Transporte, Alimentação, Curso…"
              list="item-categorias-planilha"
            />
            <datalist id="item-categorias-planilha">
              {opcoes.categorias.map((c) => (
                <option key={c.id} value={c.rotulo.replace(/^\d+\s+/, "")} />
              ))}
            </datalist>
          </label>
        )}
      </section>

      {fonte === "planilha" ? (
        <label className="campo">
          <span className="campo-rotulo">Observação</span>
          <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} placeholder="Detalhe que ajude o financeiro" />
        </label>
      ) : null}

      <div className="campo item-gasto-comprovante">
        <span className="campo-rotulo">Comprovante</span>
        {/*
          OS ARQUIVOS, ABRÍVEIS.
          Antes esta caixa dizia só "Comprovante anexado" — o arquivo existia
          em `fin_anexo_blob`, a rota que o serve existia, e nenhuma tela dava
          um link. A pessoa fotografa a nota para poder consultá-la depois; sem
          o link, o upload tinha o custo do armazenamento e nenhum benefício.
        */}
        {anexos.length > 0 ? (
          <ul className="anexo-lista">
            {anexos.map((a) => (
              <li key={a.chave}>
                <span className="anexo-lista-nome">
                  <strong>{a.nome}</strong>
                  <small>
                    {a.kind === "nota_fiscal" ? "nota fiscal" : "comprovante"}
                    {a.bytes ? ` · ${(a.bytes / 1024).toFixed(0)} KB` : ""}
                    {` · ${new Date(a.em).toLocaleDateString("pt-BR")}`}
                  </small>
                </span>
                {/* `target=_blank` para PDF e imagem abrirem sem sair da tela,
                    e `download` no mesmo href para quem quiser guardar. A rota
                    já manda `nosniff` e confere o dono. */}
                <a className="anexo-lista-abrir" href={`/api/time/anexo/${a.chave}`} target="_blank" rel="noopener">
                  abrir
                </a>
                <a className="anexo-lista-baixar" href={`/api/time/anexo/${a.chave}?download=1`} download={a.nome}>
                  baixar
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {temComprovante ? (
          <div className="anexo-ficha fiscal item-gasto-anexo-ok">
            <strong>{anexos.length > 0 ? "Comprovante anexado" : "Comprovante registrado"}</strong>
            <small>Arquivo ligado a este item</small>
            {fonte === "app" ? (
              <>
                <input
                  ref={arquivoRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void enviarComprovante(f);
                    e.target.value = "";
                  }}
                />
                <button type="button" disabled={enviandoAnexo} onClick={() => arquivoRef.current?.click()}>
                  {enviandoAnexo ? "enviando…" : "Trocar"}
                </button>
              </>
            ) : (
              <span className="item-gasto-anexo-selo" aria-hidden>
                ✓
              </span>
            )}
          </div>
        ) : fonte === "app" ? (
          <>
            <input
              ref={arquivoRef}
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void enviarComprovante(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="item-gasto-anexo-zona"
              disabled={enviandoAnexo}
              onClick={() => arquivoRef.current?.click()}
            >
              <span className="item-gasto-anexo-icone" aria-hidden>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 16V7" strokeLinecap="round" />
                  <path d="m8.5 10.5 3.5-3.5 3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M5 17.5v1a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1" strokeLinecap="round" />
                </svg>
              </span>
              <strong>{enviandoAnexo ? "Enviando…" : "Anexar comprovante"}</strong>
              <small>Foto da nota ou PDF</small>
            </button>
          </>
        ) : (
          <div className="item-gasto-anexo-zona item-gasto-anexo-zona-texto">
            <strong>Sem arquivo neste item</strong>
            <small>Itens da planilha ainda não guardam anexo aqui.</small>
            <Link
              href={`/time/reembolso?descricao=${encodeURIComponent(nome)}&valor=${encodeURIComponent(mascaraDinheiro(String(valorCents)))}`}
              className="item-gasto-anexo-link"
            >
              Registrar com comprovante
            </Link>
          </div>
        )}
      </div>

      {historico && historico.parcelas.length > 0 ? (
        <section className="envios-detalhe-secao item-gasto-parcelas">
          <p className="envios-detalhe-contagem">Parcelas</p>
          <div className="envios-item-resumo envios-item-resumo-estatico">
            <span className="envios-item-resumo-pago">
              <strong>{brl(historico.pagoCents)}</strong>
              <span>
                {" "}
                de {brl(historico.pagoCents + historico.saldoCents)}
              </span>
            </span>
            <span className="envios-item-resumo-fracao">
              {historico.parcelaAtual}/{historico.parcelasTotal}
            </span>
            <span className="envios-item-resumo-periodo">
              {historico.inicioMes ? formatMesRef(historico.inicioMes) : "—"}
              {" → "}
              {historico.parcelas.length
                ? formatMesRef(historico.parcelas[historico.parcelas.length - 1].mes)
                : "—"}
            </span>
          </div>

          <ul className="envios-detalhe-cronograma envios-item-parcelas">
            {historico.parcelas.map((parc) => (
              <li key={`${parc.id}-${parc.mes}-${parc.parcela}`}>
                <span>{formatMesRef(parc.mes)}</span>
                <span>
                  {parc.parcela}/{parc.parcelasTotal}
                </span>
                <span>{brl(parc.valorCents)}</span>
                <span
                  className={`envios-status envios-status-${parc.situacao === "previsto" ? "aguardando" : parc.situacao}`}
                >
                  {SITUACAO_CRONO_ROTULO[parc.situacao]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* O fieldset fecha AQUI, antes da seção do estorno: dentro dele o botão
          "Copiar PIX" ficaria desabilitado — justamente na tela em que ele é a
          única coisa que a pessoa precisa tocar. */}
      </fieldset>

      {estorno ? (
        <section className="item-estorno-painel">
          <h2 className="item-estorno-titulo">Devolução à empresa</h2>
          <p className="time-sub">
            {estorno.status === "quitado"
              ? "O financeiro confirmou o recebimento do PIX."
              : "A compra foi cancelada. Devolva o valor que a empresa já reembolsou — não é faturamento, é recuperação de caixa."}
          </p>
          <div className="item-estorno-valor">
            <strong>{brl(estorno.valorCents)}</strong>
            <span>{estorno.parcelasPagas} parcela{estorno.parcelasPagas === 1 ? "" : "s"} pagas</span>
          </div>
          {estorno.parcelasDetalhe.length > 0 ? (
            <ul className="item-estorno-parcelas">
              {estorno.parcelasDetalhe.map((p) => (
                <li key={`${p.mes}-${p.parcela}`}>
                  <span>{formatMesRef(p.mes)}</span>
                  {/*
                    O denominador é o número de parcelas DESTE estorno. Vinha de
                    `historico.parcelasTotal`, outro objeto, e a tela chegou a
                    renderizar "2/1" — parcela dois de uma. O ramo "?" era
                    inalcançável: a condição estava dentro do próprio `.map`
                    sobre o array que ela testava.
                  */}
                  <span>
                    {p.parcela}/{estorno.parcelasDetalhe.length}
                  </span>
                  <span>{brl(p.valorCents)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {estorno.valorCents > 0 && estorno.status !== "quitado" ? (
            <div className="item-estorno-pix">
              <p className="campo-rotulo">PIX da empresa (Inter)</p>
              <p className="item-estorno-recebedor">{estorno.pixNomeRecebedor}</p>
              <p className="item-estorno-chave">CNPJ {formatarCnpj(estorno.pixChave)}</p>
              {estorno.brcode ? (
                <>
                  <PixQr payload={estorno.brcode} />
                  <button
                    type="button"
                    className="time-botao secundario time-botao-largo"
                    onClick={() => void copiarPix(estorno.brcode!)}
                  >
                    {pixCopiado === "copiado" ? "copiado ✓" : "Copiar PIX copia-e-cola"}
                  </button>
                  {/* `role="status"` e não `alert`: é confirmação, e fica AQUI,
                      ao lado do que foi copiado — não no topo da tela. */}
                  <p className="item-estorno-copia" role="status">
                    {pixCopiado === "copiado"
                      ? "Código copiado. Cole no app do seu banco."
                      : pixCopiado === "falhou"
                        ? "Seu navegador não deixou copiar — o código está aqui embaixo, selecione e copie."
                        : ""}
                  </p>
                  {mostrarBrcode ? (
                    <textarea
                      className="item-estorno-brcode"
                      readOnly
                      rows={4}
                      value={estorno.brcode}
                      aria-label="Código PIX copia-e-cola"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  ) : (
                    <button type="button" className="time-link" onClick={() => setMostrarBrcode(true)}>
                      ver o código em texto
                    </button>
                  )}
                </>
              ) : null}
            </div>
          ) : estorno.valorCents === 0 ? (
            <p className="time-sub">Nenhum valor foi pago ainda — não há devolução financeira.</p>
          ) : null}
          <p className="time-sub item-estorno-motivo">
            <strong>Motivo:</strong> {estorno.motivo}
          </p>
        </section>
      ) : null}

      <div className="item-gasto-rodape">
        {!estorno ? (
          <>
            <button type="submit" className="time-botao time-botao-largo" disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
            {cancelPasso === null ? (
              <button
                type="button"
                className="time-botao time-botao-largo perigo"
                // Guarda quem abriu, para o foco voltar exatamente para cá
                // quando o diálogo fechar — em vez de cair no <body>.
                onClick={(e) => {
                  abriuCancelarDe.current = e.currentTarget;
                  setCancelPasso("motivo");
                }}
              >
                Cancelar compra
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {cancelPasso && !estorno ? (
        <div
          className="item-cancelar-folha"
          // Fechar no véu, nunca num clique dentro do painel: `currentTarget`
          // garante que só o fundo dispara.
          onClick={(e) => {
            if (e.target === e.currentTarget && !cancelando) setCancelPasso(null);
          }}
        >
          <div
            className="item-cancelar-painel"
            ref={painelCancelarRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="item-cancelar-titulo"
          >
            {cancelPasso === "motivo" ? (
              <>
                <h2 id="item-cancelar-titulo">Cancelar compra</h2>
                <p className="time-sub">As parcelas futuras param. Se a empresa já pagou algo, você devolve a soma.</p>
                <div className="item-cancelar-motivos">
                  {MOTIVOS_CANCELAR.map((m) => (
                    <button
                      key={m.slug}
                      type="button"
                      className={motivoCategoria === m.slug ? "envios-opcao ativo" : "envios-opcao"}
                      onClick={() => setMotivoCategoria(m.slug)}
                    >
                      {m.rotulo}
                    </button>
                  ))}
                </div>
                <label className="campo">
                  <span className="campo-rotulo">Detalhe o motivo</span>
                  <textarea
                    value={motivoTexto}
                    onChange={(e) => setMotivoTexto(e.target.value)}
                    rows={3}
                    placeholder="Ex.: devolvi o produto na loja"
                    required
                  />
                </label>
                <div className="item-cancelar-acoes">
                  <button type="button" className="time-botao secundario" onClick={() => setCancelPasso(null)}>
                    Voltar
                  </button>
                  <button
                    type="button"
                    className="time-botao"
                    disabled={motivoTexto.trim().length < 3}
                    onClick={() => setCancelPasso("confirmar")}
                  >
                    Continuar
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 id="item-cancelar-titulo">Confirmar cancelamento</h2>
                <p className="item-cancelar-resumo">
                  {devolverCents > 0 ? (
                    <>
                      Você vai devolver <strong>{brl(devolverCents)}</strong>
                      {parcelasQueVoltam > 1 ? ` (${parcelasQueVoltam} parcelas)` : ""} via PIX para o CNPJ da XPE no
                      Inter. As parcelas futuras serão canceladas.
                    </>
                  ) : (
                    <>As parcelas futuras serão canceladas. Não há valor a devolver porque nada foi pago ainda.</>
                  )}
                </p>
                <p className="time-sub">Esta ação não pode ser desfeita no app.</p>
                <div className="item-cancelar-acoes">
                  <button type="button" className="time-botao secundario" onClick={() => setCancelPasso("motivo")}>
                    Voltar
                  </button>
                  <button type="button" className="time-botao perigo" disabled={cancelando} onClick={() => void cancelarCompra()}>
                    {cancelando ? "Cancelando…" : "Confirmar cancelamento"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </form>
  );
}

function ItemParteReembolso({ p }: { p: DetalheEnvio["partes"][number] }) {
  const tituloBase = p.titulo.replace(/\s+\d+\/\d+.*$/, "").trim() || p.titulo;
  const hrefItem = `/time/item/${p.fonte}/${p.id}`;
  const [listaAberta, setListaAberta] = useState(false);
  const [historico, setHistorico] = useState<{
    titulo: string;
    parcelasTotal: number;
    parcelaAtual: number;
    valorParcelaCents: number;
    totalContratadoCents: number;
    pagoCents: number;
    saldoCents: number;
    parcelasRestantes: number;
    inicioMes: string | null;
    ultimoMes: string | null;
    parcelas: { id: number; mes: string; parcela: number; parcelasTotal: number; valorCents: number; descricao: string; situacao: StatusExtrato | "previsto" }[];
  } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const temParcelas = Boolean(p.parcelasTotal && p.parcelasTotal >= 2);

  const mesHoje = new Date().toISOString().slice(0, 7);
  const proximaPendente = historico?.parcelas.find((x) => x.situacao === "previsto" || x.situacao === "registrado");
  const quitado =
    p.statusParte === "pago" && (!temParcelas || (historico ? historico.parcelasRestantes === 0 : (p.parcela ?? 0) >= (p.parcelasTotal ?? 1)));
  const emAtraso = Boolean(!quitado && proximaPendente && proximaPendente.mes < mesHoje);
  const situacaoParcela = quitado ? "pago" : emAtraso ? "atrasado" : temParcelas ? "em_dia" : p.statusParte;
  const situacaoRotulo =
    situacaoParcela === "pago"
      ? "Pago"
      : situacaoParcela === "atrasado"
        ? "Atrasado"
        : situacaoParcela === "em_dia"
          ? "Em dia"
          : STATUS_EXTRATO_ROTULO[p.statusParte];

  useEffect(() => {
    if (!temParcelas) return;
    let cancelado = false;
    (async () => {
      setCarregando(true);
      try {
        const r = await fetch(`/api/time/reembolso-item/${p.fonte}/${p.id}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!cancelado) {
          if (r.ok && j.historico) setHistorico(j.historico);
          else setErro((j.erro as string) ?? "Não foi possível carregar parcelas.");
        }
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [temParcelas, p.fonte, p.id]);

  return (
    <li className={`envios-produto${listaAberta ? " envios-produto-aberto" : ""}${emAtraso ? " envios-produto-atraso" : ""}`}>
      <Link href={hrefItem} className="envios-produto-linha" title="Abrir item">
        <span className="envios-produto-nome">{tituloBase}</span>
        <span className={`envios-produto-cat${p.categoriaRotulo ? "" : " envios-produto-cat-falta"}`}>
          {p.categoriaRotulo ?? "Sem cat."}
        </span>
        <span className="envios-produto-valor">{brl(p.valorCents)}</span>
        <span className={`envios-produto-situacao envios-produto-situacao-${situacaoParcela}`}>
          {situacaoRotulo}
        </span>
      </Link>

      {temParcelas ? (
        <button
          type="button"
          className={`envios-produto-parcelas${listaAberta ? " envios-produto-parcelas-aberta" : ""}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setListaAberta((v) => !v);
          }}
          aria-expanded={listaAberta}
        >
          {carregando && !historico ? (
            <span className="envios-produto-parcelas-loading">Carregando parcelas…</span>
          ) : historico ? (
            <div className="envios-produto-parcelas-topo">
              <span className="envios-produto-fracao">
                {historico.parcelaAtual}
                <span>/{historico.parcelasTotal}</span>
              </span>
              <span className="envios-produto-pago-total">
                <strong>{brl(historico.pagoCents)}</strong>
                <span> / {brl(historico.totalContratadoCents)}</span>
              </span>
              <span className="envios-produto-expandir" aria-hidden>
                <IconeExpandir aberto={listaAberta} />
              </span>
            </div>
          ) : (
            <span className="envios-produto-parcelas-loading">
              {p.parcela ?? "?"}/{p.parcelasTotal} parcelas
              {erro ? ` — ${erro}` : ""}
            </span>
          )}
        </button>
      ) : null}

      {listaAberta && historico ? (
        <ul className="envios-detalhe-cronograma envios-item-parcelas">
          {historico.parcelas.map((parc) => (
            <li key={`${parc.id}-${parc.mes}-${parc.parcela}`}>
              <span>{formatMesRef(parc.mes)}</span>
              <span>
                {parc.parcela}/{parc.parcelasTotal}
              </span>
              <span>{brl(parc.valorCents)}</span>
              <span
                className={`envios-status envios-status-${parc.situacao === "previsto" ? "aguardando" : parc.situacao}`}
              >
                {SITUACAO_CRONO_ROTULO[parc.situacao]}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function DetalheEnvioPainel({
  detalhe,
  carregando,
  erro,
  aoAbrirRelacionado,
  aoVerGrupo
}: {
  detalhe: DetalheEnvio | null;
  carregando: boolean;
  erro: string | null;
  aoAbrirRelacionado: (origem: string, origemId: number) => void;
  aoVerGrupo: () => void;
}) {
  if (carregando) return <div className="envios-detalhe envios-detalhe-carregando">Carregando detalhes…</div>;
  if (erro) return <div className="envios-detalhe envios-detalhe-erro">{erro}</div>;
  if (!detalhe) return null;

  return (
    <div className="envios-detalhe">
      {detalhe.partes.length > 0 ? (
        <section className="envios-detalhe-secao" aria-label={`${detalhe.partes.length} itens`}>
          <ul className="envios-detalhe-lista">
            {detalhe.partes.map((p) => (
              <ItemParteReembolso key={`${p.fonte}-${p.id}`} p={p} />
            ))}
          </ul>
        </section>
      ) : null}

      {detalhe.cronograma.length > 0 ? (
        <section className="envios-detalhe-secao">
          <p className="envios-detalhe-contagem">Parcelas previstas</p>
          <ul className="envios-detalhe-cronograma">
            {detalhe.cronograma.map((c) => (
              <li key={`${c.mes}-${c.parcela}`}>
                <span>{formatMesRef(c.mes)}</span>
                <span>
                  {c.parcela}/{detalhe.parcelasTotal ?? detalhe.cronograma.length}
                </span>
                <span>{brl(c.valorCents)}</span>
                <span className={`envios-status envios-status-${c.situacao === "previsto" ? "aguardando" : c.situacao}`}>
                  {SITUACAO_CRONO_ROTULO[c.situacao]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detalhe.relacionados.length > 0 ? (
        <section className="envios-detalhe-secao">
          <div className="envios-detalhe-secao-topo">
            <p className="envios-detalhe-contagem">Relacionados ({detalhe.relacionados.length})</p>
            <button type="button" className="time-link" onClick={aoVerGrupo}>
              Ver grupo
            </button>
          </div>
          <ul className="envios-detalhe-lista">
            {detalhe.relacionados.map((r) => (
              <li key={`${r.origem}-${r.origemId}`} className="envios-detalhe-item envios-detalhe-item-plano">
                <button type="button" className="envios-detalhe-link" onClick={() => aoAbrirRelacionado(r.origem, r.origemId)}>
                  <strong>{r.titulo}</strong>
                  <span>
                    {r.code} · {r.valorCents !== null ? brl(r.valorCents) : "—"} ·{" "}
                    {STATUS_EXTRATO_ROTULO[r.statusExtrato]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function LinhaExtrato({
  e,
  compacta,
  aberto,
  onToggle
}: {
  e: Envio;
  compacta: boolean;
  aberto?: boolean;
  onToggle?: () => void;
}) {
  const tipo = ORIGEM_ROTULO[e.origem] ?? e.origem;
  const meta = metaEnvio(e);
  const faltaComprovante = e.origem === "reembolso" && e.itens > 0 && e.itensComAnexo < e.itens;
  const qtdItens = Math.max(e.itens, e.itensPreview.length);
  const chips = e.itensPreview.slice(0, 4);
  const resto = Math.max(0, qtdItens - chips.length);
  const temMini = qtdItens > 0 && !compacta;

  const corpo = (
    <>
      <div className="envios-cel envios-cel-data-linha">
        <span className="envios-cel-data" data-label="Data">
          {formatDataEnvio(e)}
        </span>
        {temMini ? (
          <span className="envios-mini-acao">
            <span className="envios-mini-qtd">
              {qtdItens} {qtdItens === 1 ? "item" : "itens"}
            </span>
            <IconeExpandir aberto={Boolean(aberto)} />
          </span>
        ) : null}
      </div>
      <span className="envios-cel envios-cel-tipo" data-label="Tipo">
        {tipo}
      </span>
      <div className="envios-cel envios-cel-item" data-label="Item">
        <strong className="envios-titulo">{e.titulo}</strong>
        <span className={`envios-meta${faltaComprovante ? " time-falta" : ""}`}>{meta}</span>
      </div>
      <span className="envios-cel envios-cel-valor" data-label="Valor">
        {e.valorCents === null ? "—" : brl(e.valorCents)}
      </span>
      <span className="envios-cel envios-cel-status" data-label="Status">
        <span className={`envios-status envios-status-${e.statusExtrato}`}>{STATUS_EXTRATO_ROTULO[e.statusExtrato]}</span>
      </span>
      {temMini && !aberto && chips.length > 0 ? (
        <div className="envios-mini-chips">
          {chips.map((m, i) => (
            <span
              key={`${m.titulo}-${i}`}
              className={`envios-mini-chip${m.temComprovante ? " envios-mini-ok" : ""}`}
              title={m.titulo}
            >
              {m.titulo.replace(/\s+\d+\/\d+.*$/, "").trim().slice(0, 14) || m.titulo.slice(0, 14)}
            </span>
          ))}
          {resto > 0 ? <span className="envios-mini-mais">+{resto}</span> : null}
        </div>
      ) : null}
      {e.resposta ? (
        <div className="envios-resposta">
          <strong>{e.decididoPor ?? "financeiro"}:</strong> {e.resposta}
        </div>
      ) : e.estado === "devolvido" || e.estado === "recusado" ? (
        <div className="envios-resposta envios-resposta-vazio">Sem motivo registrado — cobre quem decidiu.</div>
      ) : null}
    </>
  );

  if (compacta) {
    return <article className="envios-linha envios-linha-compacta">{corpo}</article>;
  }

  return (
    <article className={`envios-linha${aberto ? " envios-linha-aberta" : ""}${temMini ? " envios-linha-com-mini" : ""}`}>
      <button type="button" className="envios-linha-botao" onClick={onToggle} aria-expanded={aberto}>
        {corpo}
        {!temMini ? (
          <span className="envios-linha-chevron" aria-hidden>
            <IconeExpandir aberto={Boolean(aberto)} />
          </span>
        ) : null}
      </button>
    </article>
  );
}


/**
 * O Histórico: as duas direções do meu dinheiro com a casa.
 *
 * ---------------------------------------------------------------------------
 * POR QUE DUAS ABAS E NÃO UM EXTRATO SÓ
 * ---------------------------------------------------------------------------
 * A tentação era misturar num fluxo cronológico, como extrato de banco. Não
 * serve aqui, e o motivo é a coluna Valor: em "Enviei", R$ 429,97 quer dizer
 * "pedi isso e ainda não sei se sai"; em "Recebi", R$ 7.624,11 quer dizer
 * "caiu na conta". Somar os dois não responde nada, e é exatamente o que uma
 * lista única convida a fazer.
 *
 * As colunas também divergem: envio tem Status (aguardando, aprovado,
 * devolvido) e recebimento não tem — ele já aconteceu. Uma tabela com Status
 * vazio em metade das linhas é pior que duas tabelas.
 *
 * ---------------------------------------------------------------------------
 * A CONTAGEM NO BOTÃO É O QUE FAZ A ABA EXISTIR
 * ---------------------------------------------------------------------------
 * "Recebi" nasce escondida atrás de um toque. Sem número, ninguém descobre que
 * tem conteúdo — e ela é a metade mais cheia: no Fernando são 8 envios contra
 * 27 recebimentos; no Gabriel, 7 contra 48. Quem chega ao Histórico para achar
 * um pagamento veria a metade pobre e concluiria que o app não tem o dado.
 */
function Historico({ envios }: { envios: Envio[] }) {
  const [lado, setLado] = useState<"enviei" | "recebi">("enviei");
  const { dado: rec } = useRecebiveis();
  const nRecebi = rec?.linhas.length ?? null;

  return (
    <div className="time-tela-padrao envios-extrato">
      <header className="time-form-cabeca">
        <h1>Histórico</h1>
        <p>O que eu mandei para o financeiro, e o que a casa me pagou.</p>
      </header>

      <div className="hist-segmento" role="tablist" aria-label="Direção do histórico">
        <button
          type="button"
          role="tab"
          aria-selected={lado === "enviei"}
          className={lado === "enviei" ? "hist-segmento-item ativo" : "hist-segmento-item"}
          onClick={() => setLado("enviei")}
        >
          Enviei
          <b>{envios.length}</b>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={lado === "recebi"}
          className={lado === "recebi" ? "hist-segmento-item ativo" : "hist-segmento-item"}
          onClick={() => setLado("recebi")}
        >
          Recebi
          {/* Enquanto não carregou, nada — um "0" que vira "27" depois é pior
              que a ausência: quem lê o zero vai embora. */}
          {nRecebi === null ? null : <b>{nRecebi}</b>}
        </button>
      </div>

      {lado === "enviei" ? <ListaEnvios envios={envios} /> : <ListaRecebidos />}
    </div>
  );
}

const HIST_ORDEM_REC: Record<string, string> = {
  recente: "Mais recentes",
  antigo: "Mais antigos",
  valor_desc: "Maior valor",
  valor_asc: "Menor valor"
};

/**
 * "Recebi": cada pagamento que caiu, com as naturezas ligáveis uma a uma.
 *
 * O filtro de natureza é MÚLTIPLO, e não uma lista de "só um por vez", porque
 * a pergunta real tem essa forma: "quanto recebi de comissão E extra este
 * ano?". Com escolha única a pessoa somaria de cabeça.
 *
 * E o total acompanha o filtro. Aqui somar faz sentido — é tudo dinheiro que
 * entrou, na mesma direção — o que não vale do lado "Enviei", onde a soma
 * misturaria pedido com compra no cartão da empresa.
 */
function ListaRecebidos() {
  const { dado, erro, carregando } = useRecebiveis();
  const [busca, setBusca] = useState("");
  const [naturezas, setNaturezas] = useState<Set<string>>(new Set());
  const [periodo, setPeriodo] = useState("tudo");
  const [valorMin, setValorMin] = useState("");
  const [valorMax, setValorMax] = useState("");
  const [ordem, setOrdem] = useState<"recente" | "antigo" | "valor_desc" | "valor_asc">("recente");
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  const linhas = useMemo(() => dado?.linhas ?? [], [dado]);

  const filtradas = useMemo(() => {
    const t = semAcento(busca.trim());
    const min = valorMin ? centavosDoTexto(valorMin) : null;
    const max = valorMax ? centavosDoTexto(valorMax) : null;
    // Mesma razão de `dataDoEnvio`: string ISO, nunca `Date`, para o item da
    // borda não entrar ou sair do filtro conforme o fuso do aparelho.
    const limite =
      periodo === "7d" || periodo === "30d" || periodo === "90d"
        ? (() => {
            const d = new Date();
            d.setDate(d.getDate() - Number(periodo.replace("d", "")));
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          })()
        : null;

    const lista = linhas.filter((l) => {
      if (naturezas.size > 0 && !naturezas.has(l.natureza)) return false;
      if (limite && l.data < limite) return false;
      if (min !== null && l.valorCents < min) return false;
      if (max !== null && l.valorCents > max) return false;
      if (!t) return true;
      return (
        semAcento(ROTULO_REC[l.natureza] ?? l.natureza).includes(t) ||
        semAcento(l.conta).includes(t) ||
        semAcento(l.descricao ?? "").includes(t) ||
        semAcento(l.categoria ?? "").includes(t)
      );
    });

    return [...lista].sort((a, b) => {
      if (ordem === "valor_desc") return b.valorCents - a.valorCents;
      if (ordem === "valor_asc") return a.valorCents - b.valorCents;
      if (ordem === "antigo") return a.data.localeCompare(b.data);
      return b.data.localeCompare(a.data);
    });
  }, [linhas, busca, naturezas, periodo, valorMin, valorMax, ordem]);

  const totalFiltrado = filtradas.reduce((s, l) => s + l.valorCents, 0);

  const porData = ordem === "recente" || ordem === "antigo";
  const grupos = useMemo(() => {
    if (!porData) return [];
    const m = new Map<string, { mes: string; cents: number; linhas: typeof filtradas }>();
    for (const l of filtradas) {
      const g = m.get(l.mes) ?? { mes: l.mes, cents: 0, linhas: [] };
      g.cents += l.valorCents;
      g.linhas.push(l);
      m.set(l.mes, g);
    }
    // A ordem dos meses já vem certa: `filtradas` está ordenada por data e o
    // Map preserva a ordem de inserção. Reordenar aqui seria a chance de os
    // dois discordarem.
    return [...m.values()];
  }, [filtradas, porData]);

  const limpar = () => {
    setBusca("");
    setNaturezas(new Set());
    setPeriodo("tudo");
    setValorMin("");
    setValorMax("");
    setOrdem("recente");
  };

  const qtdFiltros =
    (busca ? 1 : 0) + (naturezas.size > 0 ? 1 : 0) + (periodo !== "tudo" ? 1 : 0) + (valorMin || valorMax ? 1 : 0);

  const alternarNatureza = (n: string) =>
    setNaturezas((antes) => {
      const novo = new Set(antes);
      if (novo.has(n)) novo.delete(n);
      else novo.add(n);
      return novo;
    });

  if (carregando) return <div className="time-aviso">carregando…</div>;
  if (erro) return <p className="time-erro">{erro}</p>;
  if (!dado || linhas.length === 0) {
    return <p className="time-sub envios-vazio">A casa ainda não te pagou nada em 2026 — ou o pagamento ainda não foi categorizado.</p>;
  }

  return (
    <>
      <div className="envios-toolbar">
        <div className="campo-busca envios-busca">
          <svg className="campo-busca-icone" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Natureza, conta ou descrição"
            autoComplete="off"
          />
          {busca ? (
            <button type="button" className="envios-busca-limpar" onClick={() => setBusca("")} aria-label="Limpar busca">
              ×
            </button>
          ) : null}
        </div>

        <div className="envios-toolbar-acoes">
          <button
            type="button"
            className={filtrosAbertos ? "envios-btn-acao ativo" : "envios-btn-acao"}
            aria-expanded={filtrosAbertos}
            onClick={() => setFiltrosAbertos((v) => !v)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
            </svg>
            Filtros
            {qtdFiltros > 0 ? <span className="envios-badge">{qtdFiltros}</span> : null}
          </button>

          <label className="envios-btn-acao envios-btn-ordenar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M8 6h12M8 12h8M8 18h4" strokeLinecap="round" />
            </svg>
            <span className="envios-btn-ordenar-rotulo">{HIST_ORDEM_REC[ordem]}</span>
            <select
              value={ordem}
              onChange={(e) => setOrdem(e.target.value as typeof ordem)}
              aria-label="Ordenar recebimentos"
            >
              {Object.entries(HIST_ORDEM_REC).map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <span className="envios-contagem-inline">
            {filtradas.length}/{linhas.length}
          </span>
        </div>

        {filtrosAbertos ? (
          <div className="envios-filtros-painel">
            <div className="envios-filtros-bloco">
              <span className="envios-filtros-titulo">Natureza</span>
              <div className="envios-grade-opcoes envios-grade-opcoes-3">
                {dado.porNatureza.map((n) => {
                  const ligada = naturezas.has(n.natureza);
                  return (
                    <button
                      key={n.natureza}
                      type="button"
                      className={ligada ? "envios-opcao ativo" : "envios-opcao"}
                      aria-pressed={ligada}
                      onClick={() => alternarNatureza(n.natureza)}
                    >
                      <i className={`rec-ponto ${CLASSE_REC[n.natureza] ?? "nat-encargo"}`} aria-hidden />
                      {ROTULO_REC[n.natureza] ?? n.natureza}
                    </button>
                  );
                })}
              </div>
              {naturezas.size === 0 ? (
                <span className="envios-filtros-dica">Nenhuma marcada — mostrando todas.</span>
              ) : null}
            </div>

            <div className="envios-filtros-bloco">
              <span className="envios-filtros-titulo">Período</span>
              <div className="envios-segmento">
                {FILTRO_PERIODO_OPCOES.map(([v, r]) => (
                  <button
                    key={v}
                    type="button"
                    className={periodo === v ? "envios-segmento-item ativo" : "envios-segmento-item"}
                    aria-pressed={periodo === v}
                    onClick={() => setPeriodo(v)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="envios-filtros-bloco">
              <span className="envios-filtros-titulo">Faixa de valor</span>
              <div className="envios-valor-faixa">
                <label className="envios-campo-mini">
                  <span>Mínimo</span>
                  <input
                    value={valorMin}
                    onChange={(e) => setValorMin(mascaraDinheiro(e.target.value))}
                    inputMode="numeric"
                    placeholder="R$ 0,00"
                  />
                </label>
                <label className="envios-campo-mini">
                  <span>Máximo</span>
                  <input
                    value={valorMax}
                    onChange={(e) => setValorMax(mascaraDinheiro(e.target.value))}
                    inputMode="numeric"
                    placeholder="R$ 0,00"
                  />
                </label>
              </div>
            </div>

            <div className="envios-filtros-rodape">
              {qtdFiltros > 0 || ordem !== "recente" ? (
                <button type="button" className="time-link" onClick={limpar}>
                  Limpar filtros
                </button>
              ) : (
                <span className="envios-filtros-dica">Nenhum filtro aplicado</span>
              )}
              <button type="button" className="envios-btn-aplicar" onClick={() => setFiltrosAbertos(false)}>
                Ver {filtradas.length} resultado{filtradas.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {filtradas.length === 0 ? (
        <p className="time-sub envios-vazio">Nada com esses filtros. Tente outro termo ou limpe a busca.</p>
      ) : (
        <>
          <p className="hist-rec-total">
            <strong>{brl(totalFiltrado)}</strong>
            <span>
              {qtdFiltros > 0
                ? `em ${filtradas.length} pagamento${filtradas.length === 1 ? "" : "s"} filtrado${filtradas.length === 1 ? "" : "s"}`
                : `em ${filtradas.length} pagamento${filtradas.length === 1 ? "" : "s"}, desde ${formatMesRef(linhas[linhas.length - 1].mes)}`}
            </span>
          </p>
          {/*
            AGRUPADO POR MÊS — mas só quando a ordem é por data.

            Sem isso a lista do Fernando é vinte e cinco linhas seguidas
            dizendo "Pró-labore · Inter", e a única informação que muda entre
            elas (o mês) está espremida numa coluna de 56px. Com o mês virando
            cabeçalho, a repetição some dentro da estrutura e cada faixa ganha
            o total do mês — que é a pergunta real de quem rola até março.

            Ordenado por VALOR o agrupamento seria mentira: as faixas
            apareceriam fora de ordem cronológica e um "total de março" no meio
            da lista somaria só as linhas de março que calharam de estar ali.
            Nesse caso, lista corrida.
          */}
          {porData ? (
            grupos.map((g) => (
              <section key={g.mes} className="hist-rec-mes">
                <h3>
                  {/* Maiúscula na fonte, não com `text-transform: capitalize`
                      — aquele maiusculiza TODA palavra e escrevia
                      "Agosto De 2026". */}
                  {nomeMesRec(g.mes).charAt(0).toUpperCase() + nomeMesRec(g.mes).slice(1)}
                  <b>{brl(g.cents)}</b>
                </h3>
                <ul className="rec-linhas rec-linhas-longa">
                  {g.linhas.map((l, i) => (
                    <li key={`${l.data}-${i}`}>
                      <span className="rec-linha-dia">
                        {l.data.slice(8, 10)}/{l.data.slice(5, 7)}
                      </span>
                      <i className={`rec-ponto ${CLASSE_REC[l.natureza] ?? "nat-encargo"}`} aria-hidden />
                      <span className="rec-linha-nat">
                        {ROTULO_REC[l.natureza] ?? l.natureza}
                        <span className="rec-linha-conta">{l.conta}</span>
                      </span>
                      <span className="rec-linha-valor">{brl(l.valorCents)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <ul className="rec-linhas rec-linhas-longa">
              {filtradas.map((l, i) => (
                <li key={`${l.data}-${i}`}>
                  <span className="rec-linha-dia">
                    {l.data.slice(8, 10)}/{l.data.slice(5, 7)}/{l.data.slice(2, 4)}
                  </span>
                  <i className={`rec-ponto ${CLASSE_REC[l.natureza] ?? "nat-encargo"}`} aria-hidden />
                  <span className="rec-linha-nat">
                    {ROTULO_REC[l.natureza] ?? l.natureza}
                    <span className="rec-linha-conta">{l.conta}</span>
                  </span>
                  <span className="rec-linha-valor">{brl(l.valorCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function ListaEnvios({ envios, compacta = false }: { envios: Envio[]; compacta?: boolean }) {
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState("");
  const [periodo, setPeriodo] = useState("tudo");
  const [ordem, setOrdem] = useState<"recente" | "antigo" | "valor_desc" | "valor_asc" | "titulo">("recente");
  const [valorMin, setValorMin] = useState("");
  const [valorMax, setValorMax] = useState("");
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [detalhes, setDetalhes] = useState<Record<string, DetalheEnvio>>({});
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);
  const [erroDetalhe, setErroDetalhe] = useState<string | null>(null);
  const [grupoFiltro, setGrupoFiltro] = useState("");

  const filtrados = useMemo(() => {
    const t = semAcento(busca.trim());
    const min = valorMin ? centavosDoTexto(valorMin) : null;
    const max = valorMax ? centavosDoTexto(valorMax) : null;
    /*
     * O limite é STRING `YYYY-MM-DD`, não `Date`.
     *
     * `dataDoEnvio` devolve a data do gasto, que é um dia civil sem hora — e
     * `new Date("2026-01-15")` no JS é meia-noite UTC, que em São Paulo é 15/01
     * às 21h do dia 14. Comparar os dois faria o item da borda entrar ou sair
     * do filtro dependendo do fuso do aparelho. Duas strings ISO comparam por
     * ordem alfabética e são o mesmo dia em qualquer lugar.
     */
    const limite =
      periodo === "7d" || periodo === "30d" || periodo === "90d"
        ? (() => {
            const d = new Date();
            d.setDate(d.getDate() - Number(periodo.replace("d", "")));
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          })()
        : null;

    let lista = envios.filter((e) => {
      if (grupoFiltro && e.grupoChave !== grupoFiltro) return false;
      if (tipo && e.origem !== tipo) return false;
      if (estadoFiltro && e.statusExtrato !== estadoFiltro) return false;
      if (limite && dataDoEnvio(e) < limite) return false;
      if (min !== null && (e.valorCents === null || e.valorCents < min)) return false;
      if (max !== null && (e.valorCents === null || e.valorCents > max)) return false;
      if (!t) return true;
      return semAcento(e.titulo).includes(t) || semAcento(e.code).includes(t);
    });

    lista = [...lista].sort((a, b) => {
      if (ordem === "titulo") return a.titulo.localeCompare(b.titulo, "pt-BR");
      if (ordem === "valor_desc") return (b.valorCents ?? -1) - (a.valorCents ?? -1);
      if (ordem === "valor_asc") return (a.valorCents ?? Infinity) - (b.valorCents ?? Infinity);
      const da = dataDoEnvio(a);
      const db = dataDoEnvio(b);
      if (ordem === "antigo") return da.localeCompare(db) || a.criadoEm.localeCompare(b.criadoEm);
      return db.localeCompare(da) || b.criadoEm.localeCompare(a.criadoEm);
    });

    return lista;
  }, [envios, busca, tipo, estadoFiltro, periodo, ordem, valorMin, valorMax, grupoFiltro]);

  const limparFiltros = () => {
    setBusca("");
    setTipo("");
    setEstadoFiltro("");
    setPeriodo("tudo");
    setOrdem("recente");
    setValorMin("");
    setValorMax("");
    setGrupoFiltro("");
  };

  const filtrosAtivos =
    Boolean(
      busca || tipo || estadoFiltro || periodo !== "tudo" || valorMin || valorMax || ordem !== "recente" || grupoFiltro
    );

  const qtdFiltros = useMemo(() => {
    let n = 0;
    if (busca) n++;
    if (tipo) n++;
    if (estadoFiltro) n++;
    if (periodo !== "tudo") n++;
    if (valorMin || valorMax) n++;
    if (grupoFiltro) n++;
    return n;
  }, [busca, tipo, estadoFiltro, periodo, valorMin, valorMax, grupoFiltro]);

  const pillsAtivos = useMemo(() => {
    const pills: { chave: string; rotulo: string; limpar: () => void }[] = [];
    if (busca.trim()) {
      pills.push({ chave: "busca", rotulo: `“${busca.trim()}”`, limpar: () => setBusca("") });
    }
    if (tipo) {
      pills.push({ chave: "tipo", rotulo: rotuloFiltroTipo(tipo), limpar: () => setTipo("") });
    }
    if (estadoFiltro) {
      pills.push({ chave: "status", rotulo: rotuloFiltroStatus(estadoFiltro), limpar: () => setEstadoFiltro("") });
    }
    if (periodo !== "tudo") {
      pills.push({ chave: "periodo", rotulo: rotuloFiltroPeriodo(periodo), limpar: () => setPeriodo("tudo") });
    }
    if (valorMin || valorMax) {
      const faixa = [valorMin || "…", valorMax || "…"].join(" – ");
      pills.push({
        chave: "valor",
        rotulo: `Valor ${faixa}`,
        limpar: () => {
          setValorMin("");
          setValorMax("");
        }
      });
    }
    if (ordem !== "recente") {
      pills.push({ chave: "ordem", rotulo: ORDEM_ENVIO_ROTULO[ordem], limpar: () => setOrdem("recente") });
    }
    if (grupoFiltro) {
      pills.push({ chave: "grupo", rotulo: "Mesmo grupo", limpar: () => setGrupoFiltro("") });
    }
    return pills;
  }, [busca, tipo, estadoFiltro, periodo, valorMin, valorMax, ordem, grupoFiltro]);

  const carregarDetalhe = async (e: Envio) => {
    const k = chaveEnvio(e);
    setAberto(k);
    if (detalhes[k]) return;
    setCarregandoDetalhe(true);
    setErroDetalhe(null);
    try {
      const r = await fetch(`/api/time/envios/${e.origem}/${e.origemId}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.detalhe) setDetalhes((d) => ({ ...d, [k]: j.detalhe }));
      else setErroDetalhe((j.erro as string) ?? "Não foi possível carregar o detalhe.");
    } finally {
      setCarregandoDetalhe(false);
    }
  };

  const alternarDetalhe = async (e: Envio) => {
    const k = chaveEnvio(e);
    if (aberto === k) {
      setAberto(null);
      setErroDetalhe(null);
      return;
    }
    await carregarDetalhe(e);
  };

  const abrirRelacionado = (origem: string, origemId: number) => {
    const alvo = envios.find((e) => e.origem === origem && e.origemId === origemId);
    if (!alvo) return;
    void carregarDetalhe(alvo);
    document.getElementById(`envio-${origem}-${origemId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  // Voltar de /time/item/... com #envio-origem-id reabre o detalhe e rola até a linha.
  const hashAbertoRef = useRef(false);
  useEffect(() => {
    if (hashAbertoRef.current || envios.length === 0) return;
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    const m = /^envio-([a-z_]+)-(\d+)$/.exec(hash);
    if (!m) return;
    const alvo = envios.find((e) => e.origem === m[1] && e.origemId === Number(m[2]));
    if (!alvo) return;
    hashAbertoRef.current = true;
    void carregarDetalhe(alvo);
    requestAnimationFrame(() => {
      document.getElementById(`envio-${alvo.origem}-${alvo.origemId}`)?.scrollIntoView({
        block: "nearest",
        behavior: "smooth"
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na chegada com hash; carregarDetalhe muda a cada render
  }, [envios]);

  // O invólucro (`.time-tela-padrao`) e o cabeçalho pertencem ao `Historico`,
  // que é quem sabe qual das duas metades está na tela.
  if (envios.length === 0) {
    return <p className="time-sub envios-vazio">Você ainda não enviou nada.</p>;
  }

  if (compacta) {
    return (
      <div className="envios-extrato envios-extrato-compacto">
        <div className="envios-tabela">
          {envios.map((e) => (
            <LinhaExtrato key={`${e.origem}-${e.origemId}`} e={e} compacta />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="envios-toolbar">
        <div className="campo-busca envios-busca">
          <svg className="campo-busca-icone" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Item, código ou valor"
            autoComplete="off"
          />
          {busca ? (
            <button type="button" className="envios-busca-limpar" onClick={() => setBusca("")} aria-label="Limpar busca">
              ×
            </button>
          ) : null}
        </div>

        <div className="envios-toolbar-acoes">
          <button
            type="button"
            className={filtrosAbertos ? "envios-btn-acao ativo" : "envios-btn-acao"}
            aria-expanded={filtrosAbertos}
            onClick={() => setFiltrosAbertos((v) => !v)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
            </svg>
            Filtros
            {qtdFiltros > 0 ? <span className="envios-badge">{qtdFiltros}</span> : null}
          </button>

          <label className="envios-btn-acao envios-btn-ordenar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M8 6h12M8 12h8M8 18h4" strokeLinecap="round" />
            </svg>
            {/* O `<select>` é invisível de propósito (`opacity: 0`) para o
                celular abrir o seletor nativo. Sem este rótulo por baixo, o
                botão era um ícone mudo: a lista podia estar por maior valor e
                nada na tela dizia isso. */}
            <span className="envios-btn-ordenar-rotulo">{ORDEM_ENVIO_ROTULO[ordem]}</span>
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as typeof ordem)} aria-label="Ordenar lista">
              {Object.entries(ORDEM_ENVIO_ROTULO).map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <span className="envios-contagem-inline">
            {filtrados.length}/{envios.length}
          </span>
        </div>

        {pillsAtivos.length > 0 ? (
          <div className="envios-pills" role="list" aria-label="Filtros ativos">
            {pillsAtivos.map((p) => (
              <button key={p.chave} type="button" className="envios-pill" role="listitem" onClick={p.limpar}>
                {p.rotulo}
                <span aria-hidden>×</span>
              </button>
            ))}
            {pillsAtivos.length > 1 ? (
              <button type="button" className="envios-pill envios-pill-limpar" onClick={limparFiltros}>
                Limpar tudo
              </button>
            ) : null}
          </div>
        ) : null}

        {filtrosAbertos ? (
          <div className="envios-filtros-painel">
            <div className="envios-filtros-bloco">
              <span className="envios-filtros-titulo">Tipo</span>
              <div className="envios-grade-opcoes envios-grade-opcoes-3">
                {FILTRO_TIPO_OPCOES.map(([v, r]) => (
                  <button
                    key={v || "todos"}
                    type="button"
                    className={tipo === v ? "envios-opcao ativo" : "envios-opcao"}
                    aria-pressed={tipo === v}
                    onClick={() => setTipo(v)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="envios-filtros-bloco">
              <span className="envios-filtros-titulo">Status</span>
              <div className="envios-grade-opcoes envios-grade-opcoes-3">
                {FILTRO_STATUS_OPCOES.map(([v, r]) => (
                  <button
                    key={v || "todos"}
                    type="button"
                    className={estadoFiltro === v ? "envios-opcao ativo" : "envios-opcao"}
                    aria-pressed={estadoFiltro === v}
                    onClick={() => setEstadoFiltro(v)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="envios-filtros-bloco">
              <span className="envios-filtros-titulo">Período</span>
              <div className="envios-segmento">
                {FILTRO_PERIODO_OPCOES.map(([v, r]) => (
                  <button
                    key={v}
                    type="button"
                    className={periodo === v ? "envios-segmento-item ativo" : "envios-segmento-item"}
                    aria-pressed={periodo === v}
                    onClick={() => setPeriodo(v)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="envios-filtros-bloco">
              <span className="envios-filtros-titulo">Faixa de valor</span>
              <div className="envios-valor-faixa">
                <label className="envios-campo-mini">
                  <span>Mínimo</span>
                  <input
                    value={valorMin}
                    onChange={(e) => setValorMin(mascaraDinheiro(e.target.value))}
                    inputMode="numeric"
                    placeholder="R$ 0,00"
                  />
                </label>
                <label className="envios-campo-mini">
                  <span>Máximo</span>
                  <input
                    value={valorMax}
                    onChange={(e) => setValorMax(mascaraDinheiro(e.target.value))}
                    inputMode="numeric"
                    placeholder="R$ 0,00"
                  />
                </label>
              </div>
            </div>

            <div className="envios-filtros-rodape">
              {filtrosAtivos ? (
                <button type="button" className="time-link" onClick={limparFiltros}>
                  Limpar filtros
                </button>
              ) : (
                <span className="envios-filtros-dica">Nenhum filtro aplicado</span>
              )}
              <button type="button" className="envios-btn-aplicar" onClick={() => setFiltrosAbertos(false)}>
                Ver {filtrados.length} resultado{filtrados.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {filtrados.length === 0 ? (
        <p className="time-sub envios-vazio">Nada com esses filtros. Tente outro termo ou limpe a busca.</p>
      ) : (
        <div className="envios-tabela" role="table" aria-label="Extrato de envios">
          <div className="envios-tabela-cabeca" role="row">
            <span role="columnheader">Data</span>
            <span role="columnheader">Tipo</span>
            <span role="columnheader">Item</span>
            <span role="columnheader">Valor</span>
            <span role="columnheader">Status</span>
          </div>
          {filtrados.map((e) => {
            const k = chaveEnvio(e);
            const abertoLinha = aberto === k;
            return (
              <div
                key={k}
                id={`envio-${e.origem}-${e.origemId}`}
                className={`envios-bloco-linha${abertoLinha ? " envios-bloco-aberto" : ""}`}
              >
                <LinhaExtrato
                  e={e}
                  compacta={false}
                  aberto={abertoLinha}
                  onToggle={() => void alternarDetalhe(e)}
                />
                {abertoLinha ? (
                  <DetalheEnvioPainel
                    detalhe={detalhes[k] ?? null}
                    carregando={carregandoDetalhe && !detalhes[k]}
                    erro={abertoLinha ? erroDetalhe : null}
                    aoAbrirRelacionado={abrirRelacionado}
                    aoVerGrupo={() => setGrupoFiltro(e.grupoChave)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
