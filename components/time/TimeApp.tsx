"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import jsQR from "jsqr";

import { AnexarFlutuante, type OrigemAnexo } from "@/components/time/AnexarFlutuante";
import { InstalarApp } from "@/components/time/InstalarApp";
import { Recebiveis } from "@/components/time/Recebiveis";
import {
  CLASSE as CLASSE_REC,
  ROTULO as ROTULO_REC,
  mesNome,
  nomeMes as nomeMesRec,
  carregarRecebiveis,
  invalidarRecebiveis,
  useRecebiveis
} from "@/components/time/recebiveis-dado";
import { PixQr } from "@/components/time/PixQr";
import { useOcultarValores } from "@/components/time/ocultar-valores";
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
    plasticos: {
      id: number;
      nome: string;
      apelido: string | null;
      final: string | null;
      bandeira: string | null;
      cor: string | null;
    }[];
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
  | "inicio" | "reembolso" | "reembolsos" | "custo" | "nota" | "compra"
  | "envios" | "meu-reembolso" | "comprar" | "item" | "recebiveis" | "compras"
  | "comissoes" | "perfil";

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

/**
 * O texto de um chip de cartão — compacto, e SEMPRE com o número.
 *
 * Antes: sem apelido virava "final 1234 · Nubank" (a palavra "final" repetida
 * em cada chip da lista); com apelido virava só "Cartão Inter XPE" — o número
 * sumia da tela por completo, e era o número que confirmava ser o cartão
 * certo antes de tocar.
 */
function rotuloDeCartao(c: { apelido?: string | null; final: string | null }, contexto?: string): string {
  const digitos = c.final ? `•••• ${c.final}` : "sem final";
  if (c.apelido) return `${c.apelido} · ${digitos}`;
  return contexto ? `${digitos} · ${contexto}` : digitos;
}

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
  /*
   * A versão da foto vive AQUI e não no cabeçalho porque quem troca a foto é
   * `/time/perfil`, que é outra tela. Sem um ponto comum, o topo continuaria
   * mostrando as iniciais depois do upload até a próxima recarga.
   */
  const [fotoVersao, setFotoVersao] = useState(0);
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
      <CabecalhoPessoa sessao={sessao} aba={aba} fotoVersao={fotoVersao} />

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
      {aba === "perfil" ? (
        <TelaPerfil
          sessao={sessao}
          opcoes={opcoes}
          pessoas={pessoas}
          aoAtualizarOpcoes={setOpcoes}
          aoAtualizarNome={(nome) => setSessao((s) => (s ? { ...s, nome } : s))}
          aoSair={async () => {
            await fetch("/api/time/sessao", { method: "DELETE" });
            setSessao(null);
            setEnvios([]);
          }}
          aoTrocarFoto={() => setFotoVersao((n) => n + 1)}
        />
      ) : null}
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
      {aba === "reembolsos" || aba === "meu-reembolso" ? <TelaReembolsosVisao /> : null}
        {aba === "comissoes" ? <TelaComissoesVisao /> : null}
      {/*
        Recebíveis vive em arquivo próprio: ela busca o próprio dado e não usa
        `sessao`, `opcoes` nem `envios` — os três que justificam este arquivo
        ser grande. Passa por aqui só para herdar o portão de sessão e o
        cabeçalho; o corte para uma moldura compartilhada é o passo seguinte.
      */}
      {aba === "recebiveis" ? <Recebiveis /> : null}
      {aba === "compras" ? <MinhasCompras envios={envios} /> : null}
      {aba === "comprar" ? (
        <Comprar opcoes={opcoes} pessoas={pessoas} aoAtualizarOpcoes={setOpcoes} aoEnviar={aoEnviar} aoFalhar={setRecado} />
      ) : null}
      {aba === "item" ? (
        itemFonte && itemId ? (
          <TelaItemGasto fonte={itemFonte} itemId={itemId} aoFalhar={setRecado} />
        ) : (
          /*
           * Sem este ramo, `/time/item/xxx/1` (fonte que não é `planilha` nem
           * `app`) renderizava cabeçalho e NADA entre ele e o fim da página.
           * Não é um beco — o link Início no topo está lá — mas é uma tela
           * que não diz nem "não achei". O `&&` que faltava custava uma
           * página em branco.
           */
          <div className="time-tela-padrao">
            <header className="time-form-cabeca">
              <h1>Não achei esse item</h1>
              <p>O endereço aponta para um item que não existe, ou que não é seu.</p>
            </header>
            <Link href="/time/envios" className="time-botao secundario time-botao-largo">
              Ver meu histórico
            </Link>
          </div>
        )
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

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("dev") === "fernando" || params.get("login") === "fernando") {
        void postar({ personId: 4, pin: null });
      }
    }
  }, []);

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
      <BotaoTema className="time-porta-tema" />
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

        {process.env.NODE_ENV === "development" ? (
          <div style={{ marginTop: 12, marginBottom: 8 }}>
            <button
              type="button"
              className="time-porta-entrar secundario"
              onClick={() => void postar({ personId: 4, pin: null })}
              disabled={enviando}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                borderColor: "rgba(168, 85, 247, 0.4)",
                background: "rgba(168, 85, 247, 0.08)",
                color: "var(--ink)",
                fontWeight: 650
              }}
            >
              <span>⚡</span>
              <span>Entrar direto como Fernando</span>
            </button>
          </div>
        ) : null}

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
      <BotaoTema className="time-porta-tema" />
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

type ItemReembolsoRegistrado = {
  id: number;
  origem: "app" | "planilha";
  descricao: string;
  valorCents: number;
  dataDespesa: string | null;
  competencia: string;
  parcela: number | null;
  parcelasTotal: number | null;
  parcelasRestantes?: number | null;
  saldoCents?: number | null;
  valorParcelaCents?: number | null;
  tipo: string | null;
  temComprovante: boolean;
  chaveComprovante: string | null;
  status: "aprovado" | "pago" | "rejeitado";
  statusFormatado: string;
};

type Reembolso = {
  resumo?: {
    totalSolicitadoCents: number;
    totalRecebidoCents: number;
    totalEmAbertoCents: number;
    itensEmAbertoCount: number;
    proximoMesCents: number;
  };
  ultimosRegistrados?: ItemReembolsoRegistrado[];
  itensRegistrados?: ItemReembolsoRegistrado[];
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

/** Limpa títulos com repetições e descrições automáticas ruidosas */
function limparTituloReembolso(raw: string): { titulo: string; detalhes: string[] } {
  let s = raw.trim();
  const detalhes: string[] = [];

  // Extrai trecho entre parênteses "(pago: ... · ...)"
  const matchParen = s.match(/\(([^)]+)\)$/);
  if (matchParen) {
    s = s.slice(0, matchParen.index).trim();
    const partes = matchParen[1].split("·").map((p) => p.trim());
    for (const p of partes) {
      if (p.startsWith("pago:")) {
        const val = p.replace("pago:", "").trim();
        if (val === "cartao_pessoal") detalhes.push("Cartão Pessoal");
        else if (val === "pix") detalhes.push("PIX");
        else if (val) detalhes.push(val.replace(/_/g, " "));
      } else if (p.startsWith("cartão")) {
        detalhes.push(p);
      } else if (p && !detalhes.includes(p)) {
        detalhes.push(p);
      }
    }
  }

  // Remove repetições brutas do tipo "Gasolina comum — 17,778 litros — GASOLINA COMUM — 17.778 un. × R$ 6,75"
  if (s.includes(" — ")) {
    const pedacos = s.split(" — ").map((p) => p.trim());
    // Se o primeiro e o terceiro pedaço forem iguais (case-insensitive)
    if (pedacos.length >= 3 && pedacos[0].toLowerCase() === pedacos[2].toLowerCase()) {
      s = pedacos[0];
      if (pedacos[1]) detalhes.unshift(pedacos[1]);
    } else {
      s = pedacos[0];
      for (let i = 1; i < pedacos.length; i++) {
        if (!detalhes.includes(pedacos[i])) detalhes.push(pedacos[i]);
      }
    }
  }

  // Se o título ficou "Venda crédito PagBank", simplifica
  if (s.toLowerCase().startsWith("venda crédito ") || s.toLowerCase().startsWith("venda debito ")) {
    s = s.replace(/venda cr[eé]dito /i, "Crédito ").replace(/venda d[eé]bito /i, "Débito ");
  }

  // Remove traço solto no fim "Notebooks part 2 -" -> "Notebooks part 2"
  s = s.replace(/\s*-\s*$/, "").trim();

  return { titulo: s || raw, detalhes };
}

function extrairFormaPagamento(descricao: string): string {
  const { detalhes } = limparTituloReembolso(descricao);
  let rotulo = "Outros / PIX";
  const cartaoDet = detalhes.find(
    (d) =>
      d.toLowerCase().includes("cartão") ||
      d.toLowerCase().includes("pagbank") ||
      d.toLowerCase().includes("nubank") ||
      d.toLowerCase().includes("itaú") ||
      d.toLowerCase().includes("inter")
  );
  if (cartaoDet) return cartaoDet;
  if (detalhes.includes("PIX")) return "PIX";
  return rotulo;
}

/**
 * Painel completo de Reembolsos do usuário:
 * - KPIs no topo (A receber / Previsto, Já pago, Total solicitado)
 * - Atalho para pedir novo reembolso
 * - Abas: Todos Registrados, Previstos / A Receber, Histórico Pago
 */
function TelaReembolsosVisao() {
  const [dados, setDados] = useState<Reembolso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "aprovado" | "pago">("todos");
  const [cartaoFiltro, setCartaoFiltro] = useState<string | null>(null);
  const [mesFiltro, setMesFiltro] = useState<string | null>(null);

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

  const { aReceber, historico, resumo } = dados;
  const itensRegistrados = dados.itensRegistrados ?? dados.ultimosRegistrados ?? [];

  // Extrai cartões e formas de pagamento encontradas nos itens de reembolso
  const mapaCartoes = new Map<string, { nome: string; gastoCents: number; aReceberCents: number; qtd: number }>();
  for (const item of itensRegistrados) {
    const rotulo = extrairFormaPagamento(item.descricao);
    const cur = mapaCartoes.get(rotulo) ?? { nome: rotulo, gastoCents: 0, aReceberCents: 0, qtd: 0 };
    cur.gastoCents += item.valorCents;
    if (item.status === "aprovado") {
      cur.aReceberCents += item.saldoCents ?? item.valorCents;
    }
    cur.qtd += 1;
    mapaCartoes.set(rotulo, cur);
  }
  const listaCartoes = Array.from(mapaCartoes.values()).sort((a, b) => b.gastoCents - a.gastoCents);

  const mesesPrevistos = aReceber.proximosMeses.map((m) => m.mes);

  // Itens filtrados pelo escopo selecionado (cartão, busca, status) - sem o filtro pontual de mês
  const itensEscopoGrafico = itensRegistrados.filter((item) => {
    if (filtroStatus !== "todos" && item.status !== filtroStatus) return false;
    if (cartaoFiltro && extrairFormaPagamento(item.descricao) !== cartaoFiltro) return false;
    if (busca.trim()) {
      const termo = busca.toLowerCase();
      const desc = item.descricao.toLowerCase();
      const tipo = (item.tipo ?? "").toLowerCase();
      const comp = item.competencia.toLowerCase();
      if (!desc.includes(termo) && !tipo.includes(termo) && !comp.includes(termo)) return false;
    }
    return true;
  });

  const temFiltroEscopo = Boolean(cartaoFiltro || busca.trim() || filtroStatus !== "todos");

  // Colunas do gráfico padronizado rec-plot (Histórico pago + Previsão) calculadas dinamicamente
  const colunasHist = historico.meses.map((m) => {
    let valorCents = m.totalCents;
    if (temFiltroEscopo) {
      if (filtroStatus === "aprovado") {
        valorCents = 0;
      } else {
        valorCents = itensEscopoGrafico
          .filter((i) => i.status === "pago" && (i.competencia === m.mes || (i.dataDespesa && i.dataDespesa.startsWith(m.mes))))
          .reduce((s, i) => s + i.valorCents, 0);
      }
    }
    return {
      mes: m.mes,
      mesCurto: MES_CURTO(m.mes).slice(0, 3),
      nomeMes: mesNome(m.mes),
      valorCents,
      previsto: false
    };
  });

  const colunasPrev = aReceber.proximosMeses.map((m, idx) => {
    let valorCents = m.cents;
    if (temFiltroEscopo) {
      if (filtroStatus === "pago") {
        valorCents = 0;
      } else {
        valorCents = itensEscopoGrafico
          .filter((i) => i.status === "aprovado")
          .reduce((s, i) => {
            const qtdMeses = i.parcelasRestantes ?? (i.parcelasTotal && i.parcelasTotal > 1 ? i.parcelasTotal : 1);
            if (idx < qtdMeses) {
              return s + (i.valorParcelaCents ?? i.valorCents);
            }
            return s;
          }, 0);
      }
    }
    return {
      mes: m.mes,
      mesCurto: MES_CURTO(m.mes).slice(0, 3),
      nomeMes: mesNome(m.mes),
      valorCents,
      previsto: true
    };
  });

  const colunasPlot = [...colunasHist, ...colunasPrev];
  const tetoPlot = Math.max(1, ...colunasPlot.map((c) => c.valorCents));
  const colFoco = colunasPlot.find((c) => c.mes === mesFiltro);

  const totalAReceberGrafico = colunasPrev.reduce((s, c) => s + c.valorCents, 0);
  const totalPagoGrafico = colunasHist.reduce((s, c) => s + c.valorCents, 0);

  // Filtro completo (inclui o clique no mês do gráfico)
  const filtrados = itensEscopoGrafico.filter((item) => {
    if (mesFiltro) {
      if (item.status === "aprovado") {
        const qtdMeses = item.parcelasRestantes ?? (item.parcelasTotal && item.parcelasTotal > 1 ? item.parcelasTotal : 1);
        const mesesItem = mesesPrevistos.slice(0, qtdMeses);
        if (!mesesItem.includes(mesFiltro) && item.competencia !== mesFiltro && (!item.dataDespesa || !item.dataDespesa.startsWith(mesFiltro))) {
          return false;
        }
      } else {
        if (item.competencia !== mesFiltro && (!item.dataDespesa || !item.dataDespesa.startsWith(mesFiltro))) {
          return false;
        }
      }
    }
    return true;
  });

  const totalFiltradosCents = filtrados.reduce((acc, item) => {
    if (mesFiltro) {
      if (item.status === "aprovado" && item.valorParcelaCents) {
        return acc + item.valorParcelaCents;
      }
      return acc + item.valorCents;
    }
    if (item.status === "aprovado" && item.saldoCents) {
      return acc + item.saldoCents;
    }
    return acc + item.valorCents;
  }, 0);

  return (
    <div className="reemb time-tela-padrao">
      <header className="time-form-cabeca">
        <h1>Meus Reembolsos</h1>
        <p>Gastos do bolso e histórico a receber</p>
      </header>

      {/* Gráfico padronizado (rec-plot) */}
      {colunasPlot.length > 0 ? (
        <section className="rec-plot rec-plot-mini rec-plot-rolagem" style={{ marginTop: "14px" }}>
          <div className="rec-plot-trilho">
            <div className="rec-grade" role="img" aria-label="Histórico e previsão de reembolsos">
              {colunasPlot.map((col) => {
                const estaAtivo = mesFiltro === col.mes;
                return (
                  <button
                    key={`${col.previsto ? "p" : "h"}-${col.mes}`}
                    type="button"
                    className={
                      col.previsto
                        ? estaAtivo
                          ? "rec-col rec-col-previsto ativa"
                          : "rec-col rec-col-previsto"
                        : estaAtivo
                          ? "rec-col ativa"
                          : "rec-col"
                    }
                    aria-pressed={estaAtivo}
                    onClick={() => setMesFiltro(estaAtivo ? null : col.mes)}
                    title={`${col.nomeMes}: ${brl(col.valorCents)}${col.previsto ? " (previsto)" : " (pago)"}`}
                  >
                    <span className="rec-col-area">
                      <span className="rec-pilha" style={{ height: `${(col.valorCents / tetoPlot) * 100}%` }}>
                        <i
                          className="nat-reembolso"
                          style={{ height: "100%" }}
                        />
                      </span>
                    </span>
                    <span className="rec-col-mes">{col.mesCurto}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {mesFiltro && colFoco ? (
            <div className="rec-plot-dica" role="status">
              <div className="rec-plot-dica-cabeca">
                <strong>
                  {colFoco.nomeMes}
                  {colFoco.previsto ? " · previsto" : " · pago"}
                </strong>
                <b>{brl(colFoco.valorCents)}</b>
              </div>
              <p className="rec-plot-dica-nota">
                Filtrando despesas de {colFoco.nomeMes}. Toque novamente no mês para limpar o filtro.
              </p>
            </div>
          ) : (
            <p className="rec-plot-nota" role="status">
              Toque no gráfico para ver o detalhamento e filtrar os itens
            </p>
          )}
        </section>
      ) : null}

      {/* Meus Cartões & Meios de Pagamento */}
      {listaCartoes.length > 0 ? (
        <section className="reemb-cartoes-secao">
          <div className="reemb-cartoes-cabeca">
            <h3 style={{ margin: 0, fontSize: "13.5px", fontWeight: 650 }}>Cartões e formas de pagamento</h3>
            {cartaoFiltro ? (
              <button
                type="button"
                className="reemb-filtro-limpar-btn"
                onClick={() => setCartaoFiltro(null)}
              >
                Limpar filtro ×
              </button>
            ) : null}
          </div>

          <div className="reemb-cartoes-grid">
            {listaCartoes.map((c) => {
              const ativo = cartaoFiltro === c.nome;
              return (
                <button
                  type="button"
                  key={c.nome}
                  className={`reemb-cartao-item ${ativo ? "ativo" : ""}`}
                  onClick={() => setCartaoFiltro(ativo ? null : c.nome)}
                >
                  <div className="reemb-cartao-cabeca">
                    <span className="reemb-cartao-nome">{c.nome}</span>
                    <span className="reemb-cartao-qtd">{c.qtd} {c.qtd === 1 ? "gasto" : "gastos"}</span>
                  </div>
                  <div className="reemb-cartao-valores">
                    <div>
                      <span className="reemb-cartao-subrotulo">Total gasto</span>
                      <strong className="reemb-cartao-val-gasto">{brl(c.gastoCents)}</strong>
                    </div>
                    {c.aReceberCents > 0 ? (
                      <div>
                        <span className="reemb-cartao-subrotulo">A receber</span>
                        <strong className="reemb-cartao-val-rec">{brl(c.aReceberCents)}</strong>
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="reemb-bloco">
        <div className="reemb-toolbar">
          <div className="campo-busca reemb-busca">
            <svg className="campo-busca-icone" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por item, cartão, descrição ou mês…"
              autoComplete="off"
            />
            {busca ? (
              <button type="button" className="envios-busca-limpar" onClick={() => setBusca("")} aria-label="Limpar">
                ×
              </button>
            ) : null}
          </div>

          <div className="reemb-filtro-chips">
            <button
              type="button"
              className={`reemb-chip ${filtroStatus === "todos" ? "ativo" : ""}`}
              onClick={() => setFiltroStatus("todos")}
            >
              Todos ({itensRegistrados.filter((i) => (!cartaoFiltro || extrairFormaPagamento(i.descricao) === cartaoFiltro) && (!busca.trim() || (i.descricao + (i.tipo ?? "") + i.competencia).toLowerCase().includes(busca.trim().toLowerCase()))).length})
            </button>
            <button
              type="button"
              className={`reemb-chip ${filtroStatus === "aprovado" ? "ativo" : ""}`}
              onClick={() => setFiltroStatus("aprovado")}
            >
              Aprovados / A receber ({itensRegistrados.filter((i) => i.status === "aprovado" && (!cartaoFiltro || extrairFormaPagamento(i.descricao) === cartaoFiltro) && (!busca.trim() || (i.descricao + (i.tipo ?? "") + i.competencia).toLowerCase().includes(busca.trim().toLowerCase()))).length})
            </button>
            <button
              type="button"
              className={`reemb-chip ${filtroStatus === "pago" ? "ativo" : ""}`}
              onClick={() => setFiltroStatus("pago")}
            >
              Pagos ({itensRegistrados.filter((i) => i.status === "pago" && (!cartaoFiltro || extrairFormaPagamento(i.descricao) === cartaoFiltro) && (!busca.trim() || (i.descricao + (i.tipo ?? "") + i.competencia).toLowerCase().includes(busca.trim().toLowerCase()))).length})
            </button>
          </div>
        </div>

        {(mesFiltro || cartaoFiltro || busca.trim() || filtroStatus !== "todos") ? (
          <div className="reemb-filtros-ativos-aviso">
            <span>
              Filtrando por:{" "}
              {mesFiltro ? <strong>Mês {MES_CURTO(mesFiltro)} </strong> : null}
              {cartaoFiltro ? <strong>· {cartaoFiltro} </strong> : null}
              {filtroStatus !== "todos" ? <strong>· {filtroStatus === "aprovado" ? "Aprovados" : "Pagos"} </strong> : null}
              {busca.trim() ? <strong>· &ldquo;{busca}&rdquo; </strong> : null}
            </span>
            <button
              type="button"
              className="reemb-filtro-limpar-link"
              onClick={() => {
                setMesFiltro(null);
                setCartaoFiltro(null);
                setBusca("");
                setFiltroStatus("todos");
              }}
            >
              Limpar filtros
            </button>
          </div>
        ) : null}

        {filtrados.length === 0 ? (
          <div className="envios-vazio-caixa" style={{ padding: "30px 20px" }}>
            <strong>Nenhum reembolso encontrado</strong>
            <p>Cadastre despesas que você pagou do seu bolso para receber o ressarcimento da empresa.</p>
            <Link href="/time/reembolso" className="time-botao">
              Pedir reembolso
            </Link>
          </div>
        ) : (
          <>
            <div className="reemb-lista-sumario">
              <span className="reemb-sumario-qtd">
                {filtrados.length} {filtrados.length === 1 ? "lançamento" : "lançamentos"}
                {filtroStatus === "aprovado" ? " a receber" : filtroStatus === "pago" ? " pagos" : ""}
              </span>
              <span className="reemb-sumario-total">
                Total <strong>{brl(totalFiltradosCents)}</strong>
              </span>
            </div>

            <ul className="reemb-lista">
              {filtrados.map((item) => {
                const { titulo, detalhes } = limparTituloReembolso(item.descricao);
                const isAprovado = item.status === "aprovado";
                const ehParcelado =
                  (item.parcelasRestantes && item.parcelasRestantes > 1) ||
                  (item.parcelasTotal && item.parcelasTotal > 1);

                const valorExibido =
                  isAprovado && !mesFiltro && item.saldoCents
                    ? item.saldoCents
                    : mesFiltro && isAprovado && item.valorParcelaCents
                      ? item.valorParcelaCents
                      : item.valorCents;

                let dataRotulo = item.dataDespesa
                  ? item.dataDespesa.slice(0, 10).split("-").reverse().join("/")
                  : MES_CURTO(item.competencia);

                if (isAprovado) {
                  if (ehParcelado && item.parcelasRestantes && item.parcelasRestantes > 1) {
                    const mesInicio = mesesPrevistos[0] ? MES_CURTO(mesesPrevistos[0]) : "Set/26";
                    const mesFim = mesesPrevistos[item.parcelasRestantes - 1]
                      ? MES_CURTO(mesesPrevistos[item.parcelasRestantes - 1])
                      : "";
                    dataRotulo = mesFim ? `${mesInicio} a ${mesFim}` : `a partir de ${mesInicio}`;
                  } else if (!item.dataDespesa) {
                    const mesInicio = mesesPrevistos[0] ? MES_CURTO(mesesPrevistos[0]) : "Set/26";
                    dataRotulo = `Previsto ${mesInicio}`;
                  }
                }

                return (
                  <li key={`${item.origem}-${item.id}-${item.competencia}`} className="reemb-item-linha">
                    <details className="reemb-item-dobravel">
                      <summary className="reemb-item-resumo">
                        <div className="reemb-item-principal">
                          <div className="reemb-item-topo-linha">
                            <span className="reemb-item-titulo">{titulo}</span>
                            <span className="reemb-item-valor">{brl(valorExibido)}</span>
                          </div>
                          <div className="reemb-item-sub-linha">
                            <span className="reemb-item-data">{dataRotulo}</span>
                            {item.tipo ? <span className="reemb-item-tipo">· {item.tipo}</span> : null}
                            <span className={`reemb-badge ${item.status}`}>
                              {isAprovado ? "A receber" : item.statusFormatado}
                            </span>
                            {ehParcelado ? (
                              <span className="reemb-badge parcelas">
                                {item.parcelasRestantes && item.parcelasRestantes > 1
                                  ? `${item.parcelasRestantes} rest. de ${item.parcelasTotal ?? item.parcelasRestantes}`
                                  : `${item.parcelasTotal}×`}
                              </span>
                            ) : null}
                            {item.temComprovante && item.chaveComprovante ? (
                              <a
                                href={`/api/time/anexo/${encodeURIComponent(item.chaveComprovante)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="reemb-badge anexo"
                                onClick={(e) => e.stopPropagation()}
                              >
                                📎 Comprovante
                              </a>
                            ) : null}
                          </div>
                        </div>
                        <svg className="reemb-item-seta" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </summary>

                      <div className="reemb-item-detalhes-expansao">
                        {ehParcelado && item.parcelasRestantes && item.saldoCents ? (
                          <div className="reemb-detalhe-grid" style={{ marginBottom: "8px" }}>
                            <div>
                              <span className="reemb-detalhe-rotulo">Saldo total a receber</span>
                              <strong className="reemb-detalhe-dado" style={{ color: "var(--neon-green, #10b981)", fontWeight: 700 }}>
                                {brl(item.saldoCents)}
                              </strong>
                            </div>
                            <div>
                              <span className="reemb-detalhe-rotulo">Valor por parcela</span>
                              <span className="reemb-detalhe-dado">
                                {brl(item.valorParcelaCents ?? item.valorCents)} ({item.parcelasRestantes} parcelas restantes)
                              </span>
                            </div>
                          </div>
                        ) : null}

                        {detalhes.length > 0 ? (
                          <div className="reemb-detalhe-campo">
                            <span className="reemb-detalhe-rotulo">Forma de pagamento / identificação</span>
                            <div className="reemb-detalhe-pills">
                              {detalhes.map((d, idx) => (
                                <span key={idx} className="reemb-item-detalhe-pill">
                                  {d}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="reemb-detalhe-grid">
                          <div>
                            <span className="reemb-detalhe-rotulo">Competência</span>
                            <span className="reemb-detalhe-dado">{MES_CURTO(item.competencia)}</span>
                          </div>
                          {item.parcelasTotal && item.parcelasTotal > 1 ? (
                            <div>
                              <span className="reemb-detalhe-rotulo">Parcelamento</span>
                              <span className="reemb-detalhe-dado">
                                Parcela {item.parcela ?? 1} de {item.parcelasTotal}
                              </span>
                            </div>
                          ) : null}
                          <div>
                            <span className="reemb-detalhe-rotulo">Origem</span>
                            <span className="reemb-detalhe-dado">{item.origem === "app" ? "App (envio direto)" : "Planilha"}</span>
                          </div>
                          {item.dataDespesa ? (
                            <div>
                              <span className="reemb-detalhe-rotulo">Data da despesa</span>
                              <span className="reemb-detalhe-dado">
                                {item.dataDespesa.slice(0, 10).split("-").reverse().join("/")}
                              </span>
                            </div>
                          ) : null}
                        </div>
                        {item.temComprovante && item.chaveComprovante ? (
                          <div style={{ marginTop: 6 }}>
                            <a
                              href={`/api/time/anexo/${encodeURIComponent(item.chaveComprovante)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="reemb-btn-ver-anexo"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Abrir comprovante anexado ↗
                            </a>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </>
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

const MeuReembolso = TelaReembolsosVisao;

type ItemComissaoTela = {
  id: number;
  competencia: string;
  descricao: string;
  valorCents: number;
  tipoSlug: string | null;
  tipoNome: string | null;
  cliente: string | null;
  nota: string | null;
  parcela: number | null;
  parcelasTotal: number | null;
  ehEntrada: boolean;
  serieId: number | null;
  futura: boolean;
};

type ComissoesTela = {
  resumo: {
    totalDeclaradoCents: number;
    recebidoCents: number;
    aReceberCents: number;
    proximoMesCents: number;
    proximoMes: string | null;
    itensCount: number;
  };
  itens: ItemComissaoTela[];
  meses: { mes: string; totalCents: number; futura: boolean; n: number }[];
  porTipo: { slug: string; nome: string; totalCents: number; aReceberCents: number; n: number }[];
  clientes: string[];
};

/**
 * MINHAS COMISSÕES — a mesma casca de `TelaReembolsosVisao`, para a comissão.
 *
 * Reusa as classes que a guia de reembolsos já usa (`.rec-plot*` para o
 * gráfico, `.reemb-*` para azulejos, chips e lista), de propósito: duas telas
 * irmãs com CSS próprio divergem no primeiro ajuste, e o app já viveu isso.
 *
 * O que muda em relação a reembolso é o EIXO DE FILTRO. Lá a dimensão útil é o
 * cartão, derivada da descrição; aqui é o TIPO — que é dado de verdade, com FK
 * (0178). O filtro de cliente vem junto porque "quanto o cliente X ainda me
 * gera" é a pergunta que o cadastro passou a saber responder.
 *
 * Os KPIs do topo usam `.reemb-destaques`/`.reemb-kpi-*`, que existiam no CSS
 * sem nenhuma referência em .tsx — o docstring da tela de reembolso os promete
 * e a tela nunca os desenhou. Aqui eles ganham uso.
 */
function TelaComissoesVisao() {
  const [dados, setDados] = useState<ComissoesTela | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroQuando, setFiltroQuando] = useState<"todos" | "recebido" | "areceber">("todos");
  const [tipoFiltro, setTipoFiltro] = useState<string | null>(null);
  const [clienteFiltro, setClienteFiltro] = useState<string | null>(null);
  const [mesFiltro, setMesFiltro] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<"mes" | "valor">("mes");
  const { valor: fmt } = useOcultarValores();

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/time/minhas-comissoes", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErro(j.error ?? "não consegui carregar");
      setDados(j.comissoes as ComissoesTela);
    })();
  }, []);

  if (erro) return <p className="time-erro" role="alert">{erro}</p>;
  if (!dados) return <p className="time-sub">Carregando…</p>;

  const { resumo, meses, porTipo, clientes } = dados;

  // Escopo do gráfico: tudo menos o filtro de mês — senão a barra que você
  // acabou de tocar seria a única a sobrar, e o gráfico perderia a função.
  const noEscopo = (i: ItemComissaoTela) => {
    if (filtroQuando === "recebido" && i.futura) return false;
    if (filtroQuando === "areceber" && !i.futura) return false;
    if (tipoFiltro && (i.tipoSlug ?? "sem_tipo") !== tipoFiltro) return false;
    if (clienteFiltro && i.cliente !== clienteFiltro) return false;
    const q = busca.trim().toLowerCase();
    if (!q) return true;
    return [i.descricao, i.tipoNome, i.cliente, i.nota, i.competencia]
      .filter(Boolean)
      .some((c) => String(c).toLowerCase().includes(q));
  };

  const itensEscopo = dados.itens.filter(noEscopo);
  const temFiltro = Boolean(busca.trim() || tipoFiltro || clienteFiltro || filtroQuando !== "todos");

  // As colunas do gráfico saem do escopo filtrado, não do total: filtrar por
  // tipo tem de redesenhar as barras, senão o filtro mente sobre si mesmo.
  const colunas = meses.map((m) => {
    const valorCents = temFiltro
      ? itensEscopo.filter((i) => i.competencia === m.mes).reduce((s, i) => s + i.valorCents, 0)
      : m.totalCents;
    return {
      mes: m.mes,
      mesCurto: MES_CURTO(m.mes).slice(0, 3),
      nomeMes: mesNome(`${m.mes}-01`),
      valorCents,
      previsto: m.futura
    };
  });
  const tetoPlot = Math.max(1, ...colunas.map((c) => c.valorCents));
  const colFoco = colunas.find((c) => c.mes === mesFiltro) ?? null;

  const filtrados = itensEscopo.filter((i) => !mesFiltro || i.competencia === mesFiltro);
  const ordenados = [...filtrados].sort((a, b) =>
    ordem === "valor"
      ? b.valorCents - a.valorCents
      : b.competencia.localeCompare(a.competencia) || b.valorCents - a.valorCents
  );
  const totalFiltrado = filtrados.reduce((s, i) => s + i.valorCents, 0);

  const nRecebido = dados.itens.filter((i) => !i.futura).length;
  const nAReceber = dados.itens.filter((i) => i.futura).length;

  /*
   * O mês dos indicadores: o filtrado, ou o próximo mês. Cair no próximo (e
   * não no total) é o que faz os quatro cartões responderem ao gráfico — tocar
   * numa barra recompõe os indicadores daquele mês.
   */
  const mesIndicador = mesFiltro ?? resumo.proximoMes ?? meses[meses.length - 1]?.mes ?? "";
  const doMes = dados.itens.filter((i) => i.competencia === mesIndicador);
  const somaTipo = (slug: string) =>
    doMes.filter((i) => i.tipoSlug === slug).reduce((s, i) => s + i.valorCents, 0);
  const kpiTotal = doMes.reduce((s, i) => s + i.valorCents, 0);
  const kpiN = doMes.length;
  const kpiConsultoria = somaTipo("vendas_consultoria");
  const kpiObras = somaTipo("vendas_obras");
  // "Outros" é tudo menos consultoria e obras — por subtração, para que nenhum
  // tipo novo fique fora da conta sem ninguém perceber.
  const kpiOutros = kpiTotal - kpiConsultoria - kpiObras;

  const limparTudo = () => {
    setBusca(""); setFiltroQuando("todos"); setTipoFiltro(null);
    setClienteFiltro(null); setMesFiltro(null);
  };

  return (
    <div className="reemb time-tela-padrao">
      <header className="time-form-cabeca">
        <h1>Minhas Comissões</h1>
        <p>Declaradas, parcelas e o que ainda vai cair</p>
      </header>

      {/*
        OS QUATRO INDICADORES SÃO DO MÊS, não do total da vida.
        "Quanto eu recebo de comissão em setembro, e de quê" é a pergunta;
        um total acumulado desde maio não responde. O mês é o que estiver
        filtrado — pelo chip ou pela barra do gráfico — e, sem filtro, o
        próximo mês, que é o que ainda vai cair.
      */}
      <section className="reemb-destaques" aria-label={`Comissões de ${mesNome(`${mesIndicador}-01`)}`}>
        <article className="reemb-destaque-card">
          <span className="reemb-kpi-rotulo">Total do mês</span>
          <strong className="reemb-kpi-valor">{fmt(kpiTotal)}</strong>
          <span className="reemb-kpi-detalhe">
            {MES_CURTO(mesIndicador)} · {kpiN} {kpiN === 1 ? "lançamento" : "lançamentos"}
          </span>
        </article>
        <article className="reemb-destaque-card">
          <span className="reemb-kpi-rotulo">Consultoria</span>
          <strong className="reemb-kpi-valor">{fmt(kpiConsultoria)}</strong>
          <span className="reemb-kpi-detalhe">
            {kpiTotal > 0 ? `${Math.round((kpiConsultoria / kpiTotal) * 100)}% do mês` : "—"}
          </span>
        </article>
        <article className="reemb-destaque-card">
          <span className="reemb-kpi-rotulo">Obras</span>
          <strong className="reemb-kpi-valor">{fmt(kpiObras)}</strong>
          <span className="reemb-kpi-detalhe">
            {kpiTotal > 0 ? `${Math.round((kpiObras / kpiTotal) * 100)}% do mês` : "—"}
          </span>
        </article>
        <article className="reemb-destaque-card">
          <span className="reemb-kpi-rotulo">Outros</span>
          <strong className="reemb-kpi-valor">{fmt(kpiOutros)}</strong>
          <span className="reemb-kpi-detalhe">lotes, gestão, diárias e demais</span>
        </article>
      </section>

      {colunas.length > 0 ? (
        <section className="rec-plot rec-plot-mini rec-plot-rolagem" style={{ marginTop: "14px" }}>
          <div className="rec-plot-trilho">
            <div className="rec-grade" role="img" aria-label="Histórico e previsão de comissões">
              {colunas.map((col) => {
                const ativo = mesFiltro === col.mes;
                return (
                  <button
                    key={`${col.previsto ? "p" : "h"}-${col.mes}`}
                    type="button"
                    className={`rec-col${col.previsto ? " rec-col-previsto" : ""}${ativo ? " ativa" : ""}`}
                    aria-pressed={ativo}
                    onClick={() => setMesFiltro(ativo ? null : col.mes)}
                    title={`${col.nomeMes}: ${fmt(col.valorCents)}${col.previsto ? " (previsto)" : " (competência fechada)"}`}
                  >
                    <span className="rec-col-area">
                      <span
                        className="rec-pilha"
                        style={{ height: `${(col.valorCents / tetoPlot) * 100}%` }}
                      >
                        <i className="nat-comissao" style={{ height: "100%" }} />
                      </span>
                    </span>
                    <span className="rec-col-mes">{col.mesCurto}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {colFoco ? (
            <div className="rec-plot-dica" role="status">
              <div className="rec-plot-dica-cabeca">
                <strong>
                  {colFoco.nomeMes}
                  {colFoco.previsto ? " · previsto" : " · fechado"}
                </strong>
                <b>{fmt(colFoco.valorCents)}</b>
              </div>
              <p className="rec-plot-dica-nota">
                Filtrando comissões de {colFoco.nomeMes}. Toque novamente no mês para limpar.
              </p>
            </div>
          ) : (
            <p className="rec-plot-nota" role="status">
              Toque no gráfico para ver o detalhamento e filtrar os itens
            </p>
          )}
        </section>
      ) : null}

      {/* Por tipo — o eixo que substitui os "cartões" da tela de reembolso. */}
      {porTipo.length > 0 ? (
        <section className="reemb-cartoes-secao">
          <div className="reemb-cartoes-cabeca">
            <h3 style={{ margin: 0, fontSize: "13.5px", fontWeight: 650 }}>Por tipo de comissão</h3>
            {tipoFiltro ? (
              <button type="button" className="reemb-filtro-limpar-btn" onClick={() => setTipoFiltro(null)}>
                Limpar filtro ×
              </button>
            ) : null}
          </div>
          <div className="reemb-cartoes-grid">
            {porTipo.map((t) => {
              const ativo = tipoFiltro === t.slug;
              return (
                <button
                  key={t.slug}
                  type="button"
                  className={`reemb-cartao-item ${ativo ? "ativo" : ""}`}
                  aria-pressed={ativo}
                  onClick={() => setTipoFiltro(ativo ? null : t.slug)}
                >
                  <div className="reemb-cartao-cabeca">
                    <span className="reemb-cartao-nome">{t.nome}</span>
                    <span className="reemb-cartao-qtd">
                      {t.n} {t.n === 1 ? "lançamento" : "lançamentos"}
                    </span>
                  </div>
                  <div className="reemb-cartao-valores">
                    <span className="reemb-cartao-subrotulo">Total</span>
                    <strong className="reemb-cartao-val-gasto">{fmt(t.totalCents)}</strong>
                    {t.aReceberCents > 0 ? (
                      <>
                        <span className="reemb-cartao-subrotulo">A receber</span>
                        <strong className="reemb-cartao-val-rec">{fmt(t.aReceberCents)}</strong>
                      </>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="reemb-bloco">
        <div className="reemb-toolbar">
          <div className="campo-busca reemb-busca">
            <svg className="campo-busca-icone" width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por venda, cliente, tipo ou mês…"
              autoComplete="off"
            />
            {busca ? (
              <button type="button" className="envios-busca-limpar" aria-label="Limpar" onClick={() => setBusca("")}>
                ×
              </button>
            ) : null}
          </div>

          <div className="reemb-filtro-chips">
            {(
              [
                ["todos", `Todas (${dados.itens.length})`],
                ["areceber", `A receber (${nAReceber})`],
                ["recebido", `Recebidas (${nRecebido})`]
              ] as [typeof filtroQuando, string][]
            ).map(([v, r]) => (
              <button
                key={v}
                type="button"
                className={`reemb-chip ${filtroQuando === v ? "ativo" : ""}`}
                aria-pressed={filtroQuando === v}
                onClick={() => setFiltroQuando(v)}
              >
                {r}
              </button>
            ))}
            <button
              type="button"
              className={`reemb-chip ${ordem === "valor" ? "ativo" : ""}`}
              aria-pressed={ordem === "valor"}
              onClick={() => setOrdem(ordem === "valor" ? "mes" : "valor")}
              title="Alterna entre ordenar por mês e por valor"
            >
              {ordem === "valor" ? "Por valor ↓" : "Por mês ↓"}
            </button>
          </div>

          {clientes.length > 1 ? (
            <div className="reemb-filtro-chips">
              <button
                type="button"
                className={`reemb-chip ${!clienteFiltro ? "ativo" : ""}`}
                onClick={() => setClienteFiltro(null)}
              >
                Todos os clientes
              </button>
              {clientes.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`reemb-chip ${clienteFiltro === c ? "ativo" : ""}`}
                  aria-pressed={clienteFiltro === c}
                  onClick={() => setClienteFiltro(clienteFiltro === c ? null : c)}
                >
                  {c}
                </button>
              ))}
            </div>
          ) : null}

          {/*
            Chips de MÊS além do clique no gráfico. O gráfico já filtrava, mas
            era preciso descobrir que a barra é clicável; aqui o recorte tem
            nome, valor e conta — "set/26 · R$ 10,00 · 4" —, que é como se
            compara a composição de um mês com a do outro sem abrir cada um.
          */}
          {colunas.length > 1 ? (
            <div className="reemb-filtro-chips">
              <button
                type="button"
                className={`reemb-chip ${!mesFiltro ? "ativo" : ""}`}
                onClick={() => setMesFiltro(null)}
              >
                Todos os meses
              </button>
              {colunas
                .filter((c) => c.valorCents > 0)
                .map((c) => (
                  <button
                    key={`chip-${c.mes}`}
                    type="button"
                    className={`reemb-chip ${mesFiltro === c.mes ? "ativo" : ""}`}
                    aria-pressed={mesFiltro === c.mes}
                    onClick={() => setMesFiltro(mesFiltro === c.mes ? null : c.mes)}
                    title={`${c.nomeMes}${c.previsto ? " · previsto" : " · fechado"}`}
                  >
                    {MES_CURTO(c.mes)} · {fmt(c.valorCents)}
                  </button>
                ))}
            </div>
          ) : null}
        </div>

        {temFiltro || mesFiltro ? (
          <p className="time-sub" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>
              {ordenados.length} {ordenados.length === 1 ? "lançamento" : "lançamentos"} · {fmt(totalFiltrado)}
            </span>
            <button type="button" className="reemb-filtro-limpar-btn" onClick={limparTudo}>
              Limpar tudo ×
            </button>
          </p>
        ) : null}

        {ordenados.length === 0 ? (
          <p className="time-sub">
            {dados.itens.length === 0
              ? "Nenhuma comissão declarada ainda. Quando o financeiro lançar uma, ela aparece aqui."
              : "Nenhuma comissão com esses filtros."}
          </p>
        ) : (
          <>
            <div className="reemb-lista-sumario">
              <span className="reemb-sumario-qtd">
                {ordenados.length} {ordenados.length === 1 ? "lançamento" : "lançamentos"}
                {filtroQuando === "areceber" ? " a receber" : filtroQuando === "recebido" ? " fechados" : ""}
              </span>
              <span className="reemb-sumario-total">
                Total <strong>{fmt(totalFiltrado)}</strong>
              </span>
            </div>

            <ul className="reemb-lista">
              {ordenados.map((i) => {
                const ehParcelado = Boolean(i.parcelasTotal && i.parcelasTotal > 1);
                return (
                  <li key={`c-${i.id}`} className="reemb-item-linha">
                    <details className="reemb-item-dobravel">
                      <summary className="reemb-item-resumo">
                        <div className="reemb-item-principal">
                          <div className="reemb-item-topo-linha">
                            <span className="reemb-item-titulo">{i.descricao}</span>
                            <span className="reemb-item-valor">{fmt(i.valorCents)}</span>
                          </div>
                          <div className="reemb-item-sub-linha">
                            <span>{MES_CURTO(i.competencia)}</span>
                            {i.tipoNome ? <span>· {i.tipoNome}</span> : null}
                            {i.cliente ? <span>· {i.cliente}</span> : null}
                            <span className={`reemb-badge ${i.futura ? "aprovado" : "pago"}`}>
                              {i.futura ? "A receber" : "Fechada"}
                            </span>
                            {i.ehEntrada ? (
                              <span className="reemb-badge parcelas">entrada</span>
                            ) : ehParcelado ? (
                              <span className="reemb-badge parcelas">
                                {i.parcela}/{i.parcelasTotal}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <svg className="reemb-item-seta" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </summary>

                      <div className="reemb-item-detalhes-expansao">
                        <div className="reemb-detalhe-grid">
                          <div>
                            <span className="reemb-detalhe-rotulo">Competência</span>
                            <span className="reemb-detalhe-dado">{mesNome(`${i.competencia}-01`)}</span>
                          </div>
                          <div>
                            <span className="reemb-detalhe-rotulo">Tipo</span>
                            <span className="reemb-detalhe-dado">{i.tipoNome ?? "—"}</span>
                          </div>
                          <div>
                            <span className="reemb-detalhe-rotulo">Cliente / obra</span>
                            <span className="reemb-detalhe-dado">{i.cliente ?? "—"}</span>
                          </div>
                          <div>
                            <span className="reemb-detalhe-rotulo">Forma de pagamento</span>
                            <span className="reemb-detalhe-dado">
                              {i.ehEntrada
                                ? `Entrada de ${i.parcelasTotal} lançamentos`
                                : ehParcelado
                                  ? `Parcela ${i.parcela} de ${i.parcelasTotal}`
                                  : "À vista"}
                            </span>
                          </div>
                          <div>
                            <span className="reemb-detalhe-rotulo">Situação</span>
                            <span className="reemb-detalhe-dado">
                              {i.futura ? "Competência ainda não chegou" : "Competência fechada"}
                            </span>
                          </div>
                        </div>
                        {i.nota ? (
                          <div className="reemb-detalhe-campo">
                            <span className="reemb-detalhe-rotulo">Nota</span>
                            <span className="reemb-detalhe-dado">{i.nota}</span>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
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
  inicial?: { banco?: string; final?: string; bandeira?: string; natureza?: "empresa" | "pessoal" };
  /** Devolve também DE QUEM é e O QUE foi salvo: é isso que decide custo × reembolso e permite ao chamador
      selecionar o cartão recém-criado sem uma segunda viagem ao servidor. */
  aoCadastrar: (
    opcoes: Opcoes,
    cartaoId: number,
    dono: { natureza: "empresa" | "pessoal"; titular: string; final: string; apelido: string | null }
  ) => void;
  aoFechar: () => void;
}) {
  const [natureza, setNatureza] = useState<"empresa" | "pessoal">(inicial?.natureza ?? "empresa");
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
      titular: titular ? (pessoas.find((p) => String(p.id) === titular)?.nome ?? "outra pessoa") : "você",
      final,
      apelido: apelido || null
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

/**
 * PARA ONDE A SETA VOLTA, POR TELA.
 *
 * É um mapa fixo e não `router.back()`. A volta do navegador depende de haver
 * um passo anterior NOSSO no histórico, e neste app é comum não haver: atalho
 * do PWA na tela inicial do celular, link colado no WhatsApp, recarregamento
 * da página. Nesses casos `back()` joga a pessoa para FORA do app — para onde
 * ela estava antes de abrir. Um destino declarado sempre cai dentro de casa.
 *
 * O app tem dois níveis (hub → tela) e um terceiro só em `item`, que se abre
 * do detalhe no Histórico — por isso ele volta para lá, não para o hub.
 *
 * `inicio` é `null`: o hub é o topo, não há para onde subir.
 */
const VOLTA: Record<AbaTime, string | null> = {
  inicio: null,
  recebiveis: "/time",
  reembolso: "/time",
  reembolsos: "/time",
  comissoes: "/time",
  custo: "/time",
  nota: "/time",
  compra: "/time",
  comprar: "/time/compra",
  envios: "/time",
  "meu-reembolso": "/time",
  compras: "/time",
  item: "/time/envios",
  perfil: "/time"
};

function CabecalhoPessoa({
  sessao,
  aba,
  fotoVersao
}: {
  sessao: Sessao;
  aba: AbaTime;
  fotoVersao: number;
}) {
  /*
   * O cabeçalho precisa de UMA coisa do perfil: se existe foto. O nome vem da
   * sessão, que já está em memória. Todo o resto — e-mail, conta que recebe,
   * aparência, sair — mora em `/time/perfil`, e este componente não carrega,
   * não valida e não salva nada disso.
   */
  const [temFoto, setTemFoto] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/time/perfil", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setTemFoto(Boolean(j.perfil?.temFoto));
    })();
    /*
     * `fotoVersao` sobe quando a tela de perfil troca a foto. Sem esta
     * dependência o topo seguiria mostrando as iniciais até a próxima recarga
     * — a foto é a confirmação de que o upload funcionou.
     */
  }, [fotoVersao]);

  const fotoSrc = temFoto ? `/api/time/perfil/foto?v=${fotoVersao}` : null;

  return (
    <header className="time-topo">
      {/*
        A SETA VEM ANTES DE TUDO, E É A PRIMEIRA COISA DA LINHA.

        Antes havia uma pílula "Início" com ícone de casa no meio do
        cabeçalho, entre o nome e o tema. Duas coisas quebravam ali: voltar
        não é "ir para o Início" (de `/time/item/…` a pessoa quer o
        Histórico de onde veio, não o hub), e o alvo ficava no meio de uma
        fila de cinco elementos — foto, nome, casa, sol, pílula —, onde
        nenhum é o óbvio. Seta à esquerda é o lugar que todo app usa e o
        único que o polegar encontra sem ler.

        Ícone sozinho, sem rótulo: é a exceção justificada da regra deste
        cabeçalho ("pílula rotulada, não ícone mudo"). A seta para a
        esquerda no canto superior esquerdo é o glifo mais aprendido da
        plataforma, e o rótulo custaria a largura que faz o nome da pessoa
        caber — era ele que aparecia truncado como "Fer…".
      */}
      {VOLTA[aba] ? (
        <Link href={VOLTA[aba]!} className="time-topo-voltar" aria-label="Voltar">
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      ) : null}
      {/*
        O PERFIL É UM LINK, NÃO UM BOTÃO QUE ABRE FOLHA.

        Era um `<dialog>` deslizante com o cadastro inteiro dentro: nome,
        e-mail, foto, PIX, titular, aparência e sair — uns 300px de formulário
        num painel que rolava por dentro, com rolagem própria dentro da rolagem
        da página. Três consequências que só a folha tinha:

          · a volta do celular (gesto ou botão do Android) fechava o APP em vez
            de fechar a folha, porque folha não é passo de histórico;
          · o teclado subindo sobre um painel de altura fixa escondia o campo em
            foco, e "Salvar conta" ficava atrás do teclado;
          · não dava para compartilhar, salvar nem recarregar a tela do cadastro
            — ela não tinha endereço.

        Como rota, ganha as três de graça, mais a seta de voltar do cabeçalho.
      */}
      <Link
        href="/time/perfil"
        className="time-topo-perfil"
        aria-current={aba === "perfil" ? "page" : undefined}
      >
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
      </Link>
      {/*
        "Sair" não fica aqui: a tela de perfil já tem "Sair da conta",
        rotulado e menos sujeito a toque errado.

        O SOL SAIU DAQUI — e desta vez fica fora.

        O tema já esteve na folha de perfil, voltou ao cabeçalho porque "no
        perfil ele sumia da vista cotidiana", e o problema real era outro: um
        cabeçalho de cinco alvos (foto, nome, casa, sol, pílula) numa tela de
        415px, onde o nome da pessoa aparecia truncado como "Fer…". Claro e
        escuro é escolha que se faz uma vez e não se toca mais — não pode
        custar largura fixa em toda tela do app, todo dia.

        Ele continua a um toque, em Meu perfil → Aparência.

        A PÍLULA É REEMBOLSO, NÃO "PEDIR COMPRA".

        O canto superior direito é o único atalho fixo que sobrou depois que
        a barra inferior saiu, e ele tem de carregar o que o time faz toda
        semana. Pedir compra é o oposto disso: `fin_purchase_request` teve
        zero linhas em 7 meses. Estava ali por ser "ação rara que não compete
        por pixel", e o resultado foi um pixel fixo gasto com a ação mais
        rara do app — enquanto o reembolso, que é o motivo de a maioria
        abrir isto, só existia dentro do hub.

        Pedir compra não sumiu: virou atalho no bloco Compras do Início,
        junto das outras portas do ciclo.

        A pílula continua dizendo "você está aqui" em `/time/reembolso` —
        preenchida, e sem link para a página em que já se está.
      */}
      <div className="time-topo-acoes">
        <Link
          href="/time/reembolso"
          className={aba === "reembolso" ? "time-topo-solicitar aqui" : "time-topo-solicitar"}
          aria-current={aba === "reembolso" ? "page" : undefined}
        >
          <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          <span>Reembolso</span>
        </Link>
      </div>
    </header>
  );
}

function IconeSetaPerfil() {
  return (
    <svg className="rec-seta" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function IconeChipCartao() {
  return (
    <svg width="22" height="17" viewBox="0 0 22 17" fill="none" aria-hidden="true" className="time-cartao-chip-svg">
      <rect width="22" height="17" rx="3.5" fill="#eab308" />
      <rect x="0.5" y="0.5" width="21" height="16" rx="3" fill="none" stroke="#ca8a04" strokeWidth="0.8" />
      <line x1="0" y1="8.5" x2="22" y2="8.5" stroke="#a16207" strokeWidth="0.7" />
      <line x1="7" y1="0" x2="7" y2="17" stroke="#a16207" strokeWidth="0.7" />
      <line x1="15" y1="0" x2="15" y2="17" stroke="#a16207" strokeWidth="0.7" />
      <circle cx="11" cy="8.5" r="2.8" fill="#fde047" stroke="#a16207" strokeWidth="0.6" />
    </svg>
  );
}

function LogoBanco({ apelido }: { apelido: string | null | undefined }) {
  const txt = (apelido ?? "").toLowerCase().trim();
  if (!txt) return null;

  if (txt.includes("santander")) {
    return (
      <span className="time-cartao-banco-marca santander" title="Santander">
        <svg viewBox="0 0 32 20" width="18" height="12" fill="none">
          <path d="M16 2c-1.5 2.5-3 5.5-3 8 0 2.2 1.3 4 3 4s3-1.8 3-4c0-2.5-1.5-5.5-3-8zm-6 3.5c-1.2 2-2.5 4.5-2.5 6.5 0 2.2 1.3 3.8 3 3.8 1.3 0 2.3-1 2.5-2.5-.2-2.5-1.5-5.5-3-7.8zm12 0c-1.5 2.3-2.8 5.3-3 7.8.2 1.5 1.2 2.5 2.5 2.5 1.7 0 3-1.6 3-3.8 0-2-1.3-4.5-2.5-6.5z" fill="#ec0000" />
        </svg>
        <span className="time-cartao-banco-txt">Santander</span>
      </span>
    );
  }

  if (txt.includes("nubank") || txt.includes("nu ") || txt.startsWith("nu") || txt.endsWith("nu")) {
    return (
      <span className="time-cartao-banco-marca nubank" title="Nubank">
        <span className="time-cartao-banco-tag nu">nu</span>
      </span>
    );
  }

  if (txt.includes("inter")) {
    return (
      <span className="time-cartao-banco-marca inter" title="Inter">
        <span className="time-cartao-banco-tag inter">inter</span>
      </span>
    );
  }

  if (txt.includes("itau") || txt.includes("itaú")) {
    return (
      <span className="time-cartao-banco-marca itau" title="Itaú">
        <span className="time-cartao-banco-tag itau">itaú</span>
      </span>
    );
  }

  if (txt.includes("bradesco")) {
    return (
      <span className="time-cartao-banco-marca bradesco" title="Bradesco">
        <span className="time-cartao-banco-tag bradesco">Bradesco</span>
      </span>
    );
  }

  if (txt.includes("banco do brasil") || txt.includes("bb")) {
    return (
      <span className="time-cartao-banco-marca bb" title="Banco do Brasil">
        <span className="time-cartao-banco-tag bb">BB</span>
      </span>
    );
  }

  if (txt.includes("caixa")) {
    return (
      <span className="time-cartao-banco-marca caixa" title="Caixa">
        <span className="time-cartao-banco-tag caixa">CAIXA</span>
      </span>
    );
  }

  if (txt.includes("c6")) {
    return (
      <span className="time-cartao-banco-marca c6" title="C6 Bank">
        <span className="time-cartao-banco-tag c6">C6</span>
      </span>
    );
  }

  if (txt.includes("pagbank") || txt.includes("pagseguro")) {
    return (
      <span className="time-cartao-banco-marca pagbank" title="PagBank">
        <span className="time-cartao-banco-tag pagbank">PagBank</span>
      </span>
    );
  }

  if (txt.includes("xp")) {
    return (
      <span className="time-cartao-banco-marca xp" title="XP">
        <span className="time-cartao-banco-tag xp">XP</span>
      </span>
    );
  }

  if (txt.includes("btg")) {
    return (
      <span className="time-cartao-banco-marca btg" title="BTG">
        <span className="time-cartao-banco-tag btg">BTG</span>
      </span>
    );
  }

  return null;
}

function LogoBandeira({ bandeira }: { bandeira: string | null | undefined }) {
  const b = (bandeira ?? "").toLowerCase().trim();
  if (b === "visa") {
    return (
      <svg className="time-cartao-brand-svg" viewBox="0 0 48 30" width="30" height="19" role="img" aria-label="Visa">
        <rect width="48" height="30" rx="3" fill="#ffffff" />
        <text x="24" y="21" textAnchor="middle" fill="#1a1f71" fontFamily="Helvetica, Arial, sans-serif" fontSize="14" fontWeight="800" fontStyle="italic" letterSpacing="0.4">
          VISA
        </text>
      </svg>
    );
  }
  if (b === "mastercard") {
    return (
      <svg className="time-cartao-brand-svg time-cartao-brand-livre" viewBox="0 0 48 30" width="30" height="19" role="img" aria-label="Mastercard">
        <circle cx="19" cy="15" r="8" fill="#eb001b" />
        <circle cx="29" cy="15" r="8" fill="#f79e1b" />
        <path d="M24 8.5 A8 8 0 0 1 24 21.5 A8 8 0 0 1 24 8.5 Z" fill="#ff5f00" />
      </svg>
    );
  }
  if (b === "elo") {
    return (
      <svg className="time-cartao-brand-svg" viewBox="0 0 48 30" width="30" height="19" role="img" aria-label="Elo">
        <rect width="48" height="30" rx="3" fill="#000000" />
        <path d="M14 9 A6 6 0 0 1 19.2 18" fill="none" stroke="#fff100" strokeWidth="2.8" strokeLinecap="round" />
        <path d="M19.2 18 A6 6 0 0 1 8.8 18" fill="none" stroke="#ef4123" strokeWidth="2.8" strokeLinecap="round" />
        <path d="M8.8 18 A6 6 0 0 1 14 9" fill="none" stroke="#00a4e0" strokeWidth="2.8" strokeLinecap="round" />
        <text x="33" y="19.5" textAnchor="middle" fill="#ffffff" fontFamily="Helvetica, Arial, sans-serif" fontSize="11" fontWeight="700">
          elo
        </text>
      </svg>
    );
  }
  if (b === "amex") {
    return (
      <svg className="time-cartao-brand-svg" viewBox="0 0 48 30" width="30" height="19" role="img" aria-label="Amex">
        <rect width="48" height="30" rx="3" fill="#006fcf" />
        <rect x="4" y="5" width="40" height="20" rx="2" fill="none" stroke="rgba(255,255,255,.6)" />
        <text x="24" y="19" textAnchor="middle" fill="#ffffff" fontFamily="Helvetica, Arial, sans-serif" fontSize="10" fontWeight="800" letterSpacing="0.8">
          AMEX
        </text>
      </svg>
    );
  }
  if (b === "hipercard") {
    return (
      <svg className="time-cartao-brand-svg" viewBox="0 0 48 30" width="30" height="19" role="img" aria-label="Hipercard">
        <rect width="48" height="30" rx="3" fill="#b3131b" />
        <text x="24" y="20" textAnchor="middle" fill="#ffffff" fontFamily="Helvetica, Arial, sans-serif" fontSize="11" fontWeight="700" fontStyle="italic">
          Hiper
        </text>
      </svg>
    );
  }
  return (
    <svg className="time-cartao-brand-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

/**
 * `/time/perfil` — o cadastro da pessoa, em página.
 *
 * Três coisas moram aqui, na ordem em que se mexe nelas: quem eu sou (foto,
 * nome, e-mail), onde eu recebo (PIX ou TED, titular) e os ajustes do app
 * (aparência, sair).
 */
function TelaPerfil({
  sessao,
  opcoes,
  pessoas,
  aoAtualizarOpcoes,
  aoAtualizarNome,
  aoSair,
  aoTrocarFoto
}: {
  sessao: Sessao;
  opcoes?: Opcoes;
  pessoas?: Pessoa[];
  aoAtualizarOpcoes?: (opcoes: Opcoes) => void;
  aoAtualizarNome: (nome: string) => void;
  aoSair: () => Promise<void>;
  aoTrocarFoto: () => void;
}) {
  const [perfil, setPerfil] = useState<{
    nome: string;
    email: string | null;
    cpf: string | null;
    whatsapp: string | null;
    birthDate: string | null;
    temFoto: boolean;
  } | null>(null);

  type CartaoPessoal = {
    id: number;
    final: string;
    apelido: string | null;
    bandeira: string | null;
    cor: string | null;
  };
  const [cartoesPessoais, setCartoesPessoais] = useState<CartaoPessoal[]>([]);
  const [reembItens, setReembItens] = useState<ItemReembolsoRegistrado[]>([]);
  const [editandoCartao, setEditandoCartao] = useState<CartaoPessoal | null>(null);
  const [adicionandoCartao, setAdicionandoCartao] = useState(false);
  const [apelidoEdicao, setApelidoEdicao] = useState("");
  const [corEdicao, setCorEdicao] = useState("");
  const [bandeiraEdicao, setBandeiraEdicao] = useState("");
  const [salvandoCartao, setSalvandoCartao] = useState(false);
  const [editandoConta, setEditandoConta] = useState(false);
  const [tema, setTema] = useState<"claro" | "escuro">("claro");
  const { ocultar, setOcultar, valor } = useOcultarValores();

  useEffect(() => {
    const pegarTema = () => {
      const attr = document.documentElement.getAttribute("data-theme");
      if (attr === "claro" || attr === "escuro") return attr;
      const salvo = localStorage.getItem("xpe-tema");
      if (salvo === "claro" || salvo === "escuro") return salvo;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro";
    };
    setTema(pegarTema());

    const obs = new MutationObserver(() => {
      const t = document.documentElement.getAttribute("data-theme");
      if (t === "claro" || t === "escuro") setTema(t);
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  function mudarTema(novo: "claro" | "escuro") {
    document.documentElement.setAttribute("data-theme", novo);
    localStorage.setItem("xpe-tema", novo);
    setTema(novo);
    window.dispatchEvent(new Event("storage"));
  }

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
  const temContaCadastrada = Boolean(
    conta &&
    ((conta.metodo === "pix" && conta.pixChave) ||
     (conta.metodo === "ted" && conta.bancoNome && conta.conta))
  );
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
  const [resumoRec, setResumoRec] = useState<{
    mes: string;
    salario: number;
    prolabore: number;
    comissao: number;
    reembolso: number;
    total: number;
    aberto: number;
    comissaoFutura: number;
    desde: string | null;
  } | null>(null);
  const [salvandoConta, setSalvandoConta] = useState(false);
  const [erroConta, setErroConta] = useState<string | null>(null);
  const [contaOk, setContaOk] = useState(false);

  const carregarCartoes = useCallback(async () => {
    const [rCartoes, rReemb] = await Promise.all([
      fetch("/api/time/cartao", { cache: "no-store" }),
      fetch("/api/time/meu-reembolso", { cache: "no-store" })
    ]);
    const jCartoes = await rCartoes.json().catch(() => ({}));
    const jReemb = await rReemb.json().catch(() => ({}));
    if (rCartoes.ok && Array.isArray(jCartoes.cartoes)) {
      setCartoesPessoais(jCartoes.cartoes);
    }
    if (rReemb.ok && jReemb.reembolso) {
      const itens: ItemReembolsoRegistrado[] =
        jReemb.reembolso.itensRegistrados ?? jReemb.reembolso.ultimosRegistrados ?? [];
      setReembItens(itens);
    }
  }, []);

  useEffect(() => {
    void carregarCartoes();
  }, [carregarCartoes]);

  async function salvarEdicaoCartao(e: React.FormEvent) {
    e.preventDefault();
    if (!editandoCartao) return;
    setSalvandoCartao(true);
    try {
      const r = await fetch("/api/time/cartao", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editandoCartao.id,
          apelido: apelidoEdicao.trim() || null,
          cor: corEdicao || null,
          bandeira: bandeiraEdicao || null
        })
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.cartoes) {
        setCartoesPessoais(j.cartoes);
        setEditandoCartao(null);
      }
    } finally {
      setSalvandoCartao(false);
    }
  }

  /*
   * Carrega ao MONTAR. Na folha isto dependia de `folha` ser true, porque o
   * painel vivia montado e invisível dentro do cabeçalho de toda tela; como
   * rota, montar já significa que a pessoa pediu esta tela.
   */
  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/time/perfil/conta", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      void carregarRecebiveis().then(({ dado }) => {
        if (dado) {
          const prox = (dado.previsao ?? [])[0];
          const totalComissaoFutura = (dado.previsao ?? []).reduce(
            (soma, m) => soma + (m.comissaoCents ?? 0),
            0
          );
          setResumoRec({
            mes: prox?.mes ?? "",
            salario: prox?.salarioCents ?? 0,
            prolabore: prox?.prolaboreCents ?? 0,
            comissao: prox?.comissaoCents ?? 0,
            reembolso: prox?.reembolsoCents ?? 0,
            total:
              (prox?.salarioCents ?? 0) +
              (prox?.prolaboreCents ?? 0) +
              (prox?.comissaoCents ?? 0) +
              (prox?.reembolsoCents ?? 0),
            aberto: dado.emAbertoCents ?? 0,
            comissaoFutura: totalComissaoFutura,
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
  }, []);

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
      setEditandoConta(false);
    } finally {
      setSalvandoConta(false);
    }
  }

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [perfilOk, setPerfilOk] = useState(false);
  const [fotoVersao, setFotoVersao] = useState(0);
  const [editandoDados, setEditandoDados] = useState(false);
  const fotoCameraRef = useRef<HTMLInputElement>(null);
  const fotoGaleriaRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/time/perfil", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    setPerfil(j.perfil);
    setNome(j.perfil.nome);
    setEmail(j.perfil.email ?? "");
    setCpf(j.perfil.cpf ?? "");
    setWhatsapp(j.perfil.whatsapp ?? "");
    setBirthDate(j.perfil.birthDate ?? "");
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvarPerfil(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    setPerfilOk(false);
    const r = await fetch("/api/time/perfil", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nome: nome.trim(),
        email: email.trim() || null,
        cpf: cpf.trim() || null,
        whatsapp: whatsapp.trim() || null,
        birthDate: birthDate || null
      })
    });
    const j = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) return setErro(j.error ?? "não consegui salvar");
    setPerfil(j.perfil);
    aoAtualizarNome(j.perfil.nome);
    setCpf(j.perfil.cpf ?? "");
    setWhatsapp(j.perfil.whatsapp ?? "");
    setBirthDate(j.perfil.birthDate ?? "");
    setPerfilOk(true);
    setEditandoDados(false);
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
    // O topo tem a própria cópia da foto: sem este aviso ele segue nas iniciais.
    aoTrocarFoto();
  }

  const fotoSrc = perfil?.temFoto ? `/api/time/perfil/foto?v=${fotoVersao}` : null;

  const dadosCompletos = Boolean(
    nome.trim() &&
    email.trim() &&
    cpf.trim() &&
    whatsapp.trim() &&
    birthDate
  );

  const faltandoCadastro = [
    !cpf.trim() ? "CPF" : null,
    !whatsapp.trim() ? "WhatsApp" : null,
    !birthDate ? "aniversário" : null,
    !conta?.pixChave && !conta?.conta ? "conta para receber" : null
  ].filter(Boolean);

  return (
    <div className="time-tela-padrao time-perfil-pagina">
      <header className="time-form-cabeca">
        <h1>Meu perfil</h1>
        <p>Seus dados, a conta que recebe o seu dinheiro e os ajustes do app.</p>
      </header>

      {faltandoCadastro.length ? (
        <div className="time-perfil-completar" role="status">
          <strong>Complete seu cadastro</strong>
          <span>Falta: {faltandoCadastro.join(" · ")}</span>
        </div>
      ) : null}

      {/*
        INSTALAR VEM PRIMEIRO, e some sozinho depois de instalado.

        É a única coisa desta tela que se faz UMA vez, e quem não fez está
        usando o app pior do que ele é — com barra de endereço comendo 60px de
        uma tela de 852px, sem os atalhos do ícone e sem receber comprovante
        pelo compartilhar do Android. Enterrado embaixo do cadastro de PIX,
        ninguém encontraria; instalado, vira uma linha discreta de confirmação.
      */}
      <InstalarApp />

      <div className="time-perfil-foto-linha">
        <div
          className="time-topo-foto time-topo-foto-grande"
          aria-label={fotoSrc ? "Foto do perfil" : "Sem foto de perfil"}
        >
          {fotoSrc ? (
            <img src={fotoSrc} alt="" />
          ) : (
            <span className="time-topo-iniciais">{iniciais(nome || sessao.nome)}</span>
          )}
        </div>
        <div className="time-perfil-foto-acoes">
          <div className="time-perfil-foto-botoes">
            <button
              type="button"
              className="time-perfil-foto-btn"
              onClick={() => fotoCameraRef.current?.click()}
              disabled={salvando}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span>Tirar foto</span>
            </button>
            <button
              type="button"
              className="time-perfil-foto-btn secundario"
              onClick={() => fotoGaleriaRef.current?.click()}
              disabled={salvando}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span>Galeria</span>
            </button>
          </div>
          <p className="time-sub">Câmera ou escolher da galeria</p>
        </div>
        <input
          ref={fotoCameraRef}
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
        <input
          ref={fotoGaleriaRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void enviarFoto(f);
          }}
        />
      </div>

      {/* SELETOR DE APARÊNCIA / TEMA (CLARO / ESCURO) - SWITCH */}
      <div className="time-perfil-tema-seletor-linha">
        <span className="time-perfil-tema-rotulo">Aparência</span>
        <div className="time-perfil-tema-switch" role="group" aria-label="Escolher tema">
          <button
            type="button"
            className={`time-perfil-tema-btn ${tema === "claro" ? "ativo" : ""}`}
            onClick={() => mudarTema("claro")}
            aria-pressed={tema === "claro"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
            <span>Tema claro</span>
          </button>
          <button
            type="button"
            className={`time-perfil-tema-btn ${tema === "escuro" ? "ativo" : ""}`}
            onClick={() => mudarTema("escuro")}
            aria-pressed={tema === "escuro"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
            <span>Tema escuro</span>
          </button>
        </div>
      </div>

      <div className="time-perfil-tema-seletor-linha">
        <span className="time-perfil-tema-rotulo">Ocultar valores</span>
        <button
          type="button"
          className="time-perfil-ocultar-switch"
          role="switch"
          aria-checked={ocultar}
          aria-label={ocultar ? "Mostrar valores de salário e recebíveis" : "Ocultar valores de salário e recebíveis"}
          onClick={() => setOcultar(!ocultar)}
        >
          <i aria-hidden />
        </button>
      </div>

      {/* 1. SEUS DADOS */}
      {dadosCompletos && !editandoDados ? (
        <section className="time-secao time-perfil-secao-dobravel">
          <details className="rec-secao-dobravel" open>
            <summary className="rec-secao-cabeca">
              <div>
                <h2>Seus dados</h2>
                <small style={{ color: "var(--muted)", fontSize: "11px", display: "block", marginTop: "2px" }}>
                  Informações cadastrais e contato
                </small>
              </div>
              <span className="rec-secao-cabeca-direita">
                <button
                  type="button"
                  className="time-perfil-btn-editar"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditandoDados(true);
                  }}
                >
                  Editar dados
                </button>
                <IconeSetaPerfil />
              </span>
            </summary>
            <div className="rec-secao-corpo" style={{ padding: "12px 16px" }}>
              <div className="time-perfil-dados-grid">
                <div className="time-perfil-dado-item">
                  <span className="time-perfil-dado-rotulo">Nome</span>
                  <span className="time-perfil-dado-valor">{nome}</span>
                </div>
                <div className="time-perfil-dado-item">
                  <span className="time-perfil-dado-rotulo">E-mail</span>
                  <span className="time-perfil-dado-valor">{email}</span>
                </div>
                <div className="time-perfil-dado-item">
                  <span className="time-perfil-dado-rotulo">CPF</span>
                  <span className="time-perfil-dado-valor">{cpf}</span>
                </div>
                <div className="time-perfil-dado-item">
                  <span className="time-perfil-dado-rotulo">WhatsApp</span>
                  <span className="time-perfil-dado-valor">{whatsapp}</span>
                </div>
                <div className="time-perfil-dado-item">
                  <span className="time-perfil-dado-rotulo">Aniversário</span>
                  <span className="time-perfil-dado-valor">
                    {birthDate.includes("-")
                      ? birthDate.split("-").reverse().join("/")
                      : birthDate}
                  </span>
                </div>
              </div>
            </div>
          </details>
        </section>
      ) : (
        <form className="time-porta-form time-perfil-secao" onSubmit={salvarPerfil}>
          <div className="time-perfil-dados-topo">
            <h2 className="time-perfil-secao-titulo">Seus dados</h2>
            {dadosCompletos ? (
              <button
                type="button"
                className="time-perfil-btn-cancelar"
                onClick={() => setEditandoDados(false)}
              >
                Cancelar
              </button>
            ) : null}
          </div>
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
          <label className="time-porta-campo">
            <span>CPF</span>
            <input
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              placeholder="000.000.000-00"
              inputMode="numeric"
              autoComplete="off"
            />
          </label>
          <label className="time-porta-campo">
            <span>WhatsApp</span>
            <input
              type="tel"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="(81) 99999-9999"
              inputMode="tel"
              autoComplete="tel"
            />
          </label>
          <label className="time-porta-campo">
            <span>Aniversário</span>
            <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </label>
          {erro ? <p className="time-porta-erro" role="alert">{erro}</p> : null}
          {perfilOk ? <p className="conta-pgto-ok" role="status">Perfil salvo.</p> : null}
          <button type="submit" className="time-porta-entrar" disabled={salvando || nome.trim().length < 2}>
            {salvando ? "Salvando…" : "Salvar dados"}
          </button>
        </form>
      )}

      {/* 2. SEÇÃO FINANCEIRO & PREVISÃO UNIFICADA */}
      {resumoRec ? (
        <section className="time-secao time-perfil-secao-dobravel">
          <details className="rec-secao-dobravel" open>
            <summary className="rec-secao-cabeca">
              <div>
                <h2>Previsão de recebimento</h2>
                <small style={{ color: "var(--muted)", fontSize: "11px", display: "block", marginTop: "2px" }}>
                  {resumoRec.mes ? nomeMesRec(resumoRec.mes) : "Próximo mês"}
                </small>
              </div>
              <span className="rec-secao-cabeca-direita">
                <div className="time-perfil-fin-total-bloco">
                  <strong className="time-perfil-fin-total-val">{valor(resumoRec.total)}</strong>
                  <small className="time-perfil-fin-subrotulo">total previsto</small>
                </div>
                <IconeSetaPerfil />
              </span>
            </summary>

            <div className="rec-secao-corpo" style={{ padding: "12px 16px" }}>
              {/* Composição detalhada do mês */}
              <ul className="time-perfil-fin-composicao" style={{ margin: 0, padding: 0 }}>
                {([
                  ["Salário", resumoRec.salario, "nat-salario"],
                  ["Pró-labore", resumoRec.prolabore, "nat-recorrente"],
                  ["Comissão", resumoRec.comissao, "nat-comissao"],
                  ["Reembolso", resumoRec.reembolso, "nat-reembolso"]
                ] as [string, number, string][])
                  .filter(([, v]) => v > 0)
                  .map(([rotulo, cents, classe]) => (
                    <li key={rotulo} className="time-perfil-fin-item">
                      <div className="time-perfil-fin-item-esq">
                        <i className={`rec-ponto ${classe}`} aria-hidden />
                        <span>{rotulo}</span>
                      </div>
                      <b>{valor(cents, rotulo === "Reembolso")}</b>
                    </li>
                  ))}
              </ul>

              {/* Totais acumulados em aberto / futuros */}
              {(resumoRec.aberto > 0 || (resumoRec.comissaoFutura ?? 0) > 0) ? (
                <div className="time-perfil-fin-abertos">
                  {resumoRec.aberto > 0 ? (
                    <div className="time-perfil-fin-aberto-card">
                      <span className="time-perfil-fin-aberto-rotulo">Reembolso em aberto</span>
                      <strong className="time-perfil-fin-aberto-val reemb-cor">{valor(resumoRec.aberto, true)}</strong>
                      <small className="time-perfil-fin-aberto-nota">total de parcelas a receber</small>
                    </div>
                  ) : null}

                  {(resumoRec.comissaoFutura ?? 0) > 0 ? (
                    <div className="time-perfil-fin-aberto-card">
                      <span className="time-perfil-fin-aberto-rotulo">Comissão futura</span>
                      <strong className="time-perfil-fin-aberto-val comissao-cor">{valor(resumoRec.comissaoFutura)}</strong>
                      <small className="time-perfil-fin-aberto-nota">total declarado em aberto</small>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="time-perfil-fin-links" style={{ marginTop: "10px" }}>
                <Link href="/time/recebiveis" className="time-perfil-fin-link">
                  Ver gestão financeira das entradas →
                </Link>
              </div>
            </div>
          </details>
        </section>
      ) : null}

      {/* 3. A CONTA QUE RECEBE (ONDE EU RECEBO) */}
      {temContaCadastrada && !editandoConta ? (
        <section className="time-secao time-perfil-secao-dobravel">
          <details className="rec-secao-dobravel" open>
            <summary className="rec-secao-cabeca">
              <div>
                <h2>Onde eu recebo</h2>
                <small style={{ color: "var(--muted)", fontSize: "11px", display: "block", marginTop: "2px" }}>
                  {conta?.metodo === "pix" ? `PIX: ${conta.pixChave}` : `TED: ${conta?.bancoNome}`}
                </small>
              </div>
              <span className="rec-secao-cabeca-direita">
                <button
                  type="button"
                  className="time-perfil-btn-editar"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditandoConta(true);
                  }}
                >
                  Editar conta
                </button>
                <IconeSetaPerfil />
              </span>
            </summary>

            <div className="rec-secao-corpo" style={{ padding: "12px 16px" }}>
              <div className="time-perfil-dados-grid time-perfil-conta-grid">
                <div className="time-perfil-dado-item">
                  <span className="time-perfil-dado-rotulo">
                    {conta?.metodo === "pix" ? `Chave PIX (${conta.pixTipo?.toUpperCase() ?? "CHAVE"})` : "Método"}
                  </span>
                  <span className="time-perfil-dado-valor">
                    {conta?.metodo === "pix" ? conta.pixChave : "TED / Transferência"}
                  </span>
                </div>
                {conta?.metodo === "ted" ? (
                  <>
                    <div className="time-perfil-dado-item">
                      <span className="time-perfil-dado-rotulo">Banco</span>
                      <span className="time-perfil-dado-valor">{conta.bancoNome}</span>
                    </div>
                    <div className="time-perfil-dado-item">
                      <span className="time-perfil-dado-rotulo">Agência / Conta</span>
                      <span className="time-perfil-dado-valor">Ag: {conta.agencia} · Cc: {conta.conta}</span>
                    </div>
                  </>
                ) : null}
                <div className="time-perfil-dado-item">
                  <span className="time-perfil-dado-rotulo">Titular</span>
                  <span className="time-perfil-dado-valor">
                    {conta?.titularEhAPessoa
                      ? "Eu mesmo"
                      : `${conta?.titularNome ?? "Outro"}${conta?.titularDocumento ? ` (Doc: ${conta.titularDocumento})` : ""}`}
                  </span>
                </div>
              </div>
            </div>
          </details>
        </section>
      ) : (
        <form className="time-porta-form conta-pgto time-perfil-secao" onSubmit={salvarConta}>
          <div className="conta-pgto-topo">
            <h2 className="time-perfil-secao-titulo">Onde eu recebo</h2>
            {temContaCadastrada ? (
              <button
                type="button"
                className="time-perfil-btn-cancelar"
                onClick={() => setEditandoConta(false)}
              >
                Cancelar
              </button>
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
      )}

      {/* 4. MEUS CARTÕES PESSOAIS */}
      <section className="time-secao time-perfil-secao-dobravel">
        <details className="rec-secao-dobravel" open>
          <summary className="rec-secao-cabeca">
            <div>
              <h2>Meus cartões</h2>
              <small style={{ color: "var(--muted)", fontSize: "11px", display: "block", marginTop: "2px" }}>
                {cartoesPessoais.length} {cartoesPessoais.length === 1 ? "cartão pessoal cadastrado" : "cartões pessoais cadastrados"}
              </small>
            </div>
            <span className="rec-secao-cabeca-direita">
              <button
                type="button"
                className="time-perfil-btn-editar"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setAdicionandoCartao(true);
                }}
              >
                + Novo cartão
              </button>
              <IconeSetaPerfil />
            </span>
          </summary>

          <div className="rec-secao-corpo" style={{ padding: "14px 16px" }}>
            {editandoCartao ? (
              <form className="time-perfil-cartao-form-edit" onSubmit={salvarEdicaoCartao}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: "13.5px" }}>Editar cartão •••• {editandoCartao.final}</strong>
                  <button
                    type="button"
                    className="time-perfil-btn-cancelar"
                    onClick={() => setEditandoCartao(null)}
                  >
                    Cancelar
                  </button>
                </div>
                <label className="time-porta-campo">
                  <span>Apelido do cartão</span>
                  <input
                    value={apelidoEdicao}
                    onChange={(e) => setApelidoEdicao(e.target.value)}
                    placeholder="Ex.: Nubank Roxinho, PagBank Pessoal, Inter Black"
                    autoFocus
                  />
                </label>
                <div className="campo-par">
                  <label className="time-porta-campo">
                    <span>Bandeira</span>
                    <select value={bandeiraEdicao} onChange={(e) => setBandeiraEdicao(e.target.value)}>
                      <option value="">Indeterminada</option>
                      <option value="visa">Visa</option>
                      <option value="mastercard">Mastercard</option>
                      <option value="elo">Elo</option>
                      <option value="amex">Amex</option>
                      <option value="hipercard">Hipercard</option>
                      <option value="outra">Outra</option>
                    </select>
                  </label>
                  <label className="time-porta-campo">
                    <span>Cor</span>
                    <select value={corEdicao} onChange={(e) => setCorEdicao(e.target.value)}>
                      <option value="">Padrão</option>
                      <option value="roxo">Roxo</option>
                      <option value="preto">Preto / Black</option>
                      <option value="azul">Azul</option>
                      <option value="laranja">Laranja</option>
                      <option value="verde">Verde</option>
                      <option value="vermelho">Vermelho</option>
                      <option value="prata">Prata</option>
                      <option value="dourado">Dourado</option>
                      <option value="branco">Branco</option>
                    </select>
                  </label>
                </div>
                <button type="submit" className="time-porta-entrar" disabled={salvandoCartao}>
                  {salvandoCartao ? "Salvando…" : "Salvar alterações"}
                </button>
              </form>
            ) : null}

            {cartoesPessoais.length === 0 ? (
              <div className="time-perfil-cartoes-vazio">
                <p className="time-sub">Nenhum cartão pessoal cadastrado.</p>
                <button
                  type="button"
                  className="time-perfil-foto-btn"
                  onClick={() => setAdicionandoCartao(true)}
                >
                  Cadastrar primeiro cartão
                </button>
              </div>
            ) : (
              <div className="time-perfil-cartoes-grid">
                {cartoesPessoais.map((c) => {
                  const finalDigitos = c.final.replace(/\D/g, "");
                  const apelidoLower = (c.apelido ?? "").toLowerCase().trim();

                  const itensDoCartao = reembItens.filter((i) => {
                    const descLower = i.descricao.toLowerCase();
                    if (finalDigitos && descLower.includes(finalDigitos)) return true;
                    if (apelidoLower && apelidoLower.length >= 3 && descLower.includes(apelidoLower)) return true;
                    return false;
                  });

                  const aReceberCents = itensDoCartao
                    .filter((i) => i.status === "aprovado")
                    .reduce((s, i) => s + (i.saldoCents ?? i.valorCents), 0);

                  const corClasse = c.cor ? `cor-${c.cor}` : "cor-padrao";

                  return (
                    <div key={c.id} className={`time-perfil-cartao-mini ${corClasse}`}>
                      <div className="time-perfil-cartao-mini-topo">
                        <div className="time-perfil-cartao-topo-esq">
                          <LogoBanco apelido={c.apelido} />
                        </div>
                        <div className="time-perfil-cartao-brand-box">
                          <LogoBandeira bandeira={c.bandeira} />
                        </div>
                      </div>

                      <div className="time-perfil-cartao-mini-corpo">
                        <div className="time-perfil-cartao-chip-box">
                          <IconeChipCartao />
                        </div>
                        <div className="time-perfil-cartao-corpo-txt">
                          <span className="time-perfil-cartao-final">•••• {c.final}</span>
                          <span className="time-perfil-cartao-apelido" title={c.apelido ?? undefined}>
                            {c.apelido || "Cartão pessoal"}
                          </span>
                        </div>
                      </div>

                      <div className="time-perfil-cartao-mini-rodape">
                        <div className="time-perfil-cartao-saldo-info">
                          <span className="time-perfil-cartao-saldo-rotulo">A receber</span>
                          <strong className="time-perfil-cartao-saldo-val">
                            {aReceberCents > 0 ? brl(aReceberCents) : "R$ 0,00"}
                          </strong>
                        </div>
                        <button
                          type="button"
                          className="time-perfil-cartao-btn-acao"
                          onClick={() => {
                            setEditandoCartao(c);
                            setApelidoEdicao(c.apelido || "");
                            setCorEdicao(c.cor || "");
                            setBandeiraEdicao(c.bandeira || "");
                          }}
                        >
                          Editar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </details>
      </section>

      {adicionandoCartao ? (
        <CadastrarCartao
          bancos={opcoes?.bancos ?? []}
          pessoas={pessoas ?? []}
          inicial={{ natureza: "pessoal" }}
          aoCadastrar={async (novasOpcoes) => {
            if (aoAtualizarOpcoes) aoAtualizarOpcoes(novasOpcoes);
            setAdicionandoCartao(false);
            await carregarCartoes();
          }}
          aoFechar={() => setAdicionandoCartao(false)}
        />
      ) : null}

      <div className="time-perfil-rodape">
        <button type="button" className="time-perfil-sair" onClick={() => void aoSair()}>
          Sair da conta
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------

function Inicio({ envios }: { envios: Envio[] }) {
  const { valor } = useOcultarValores();
  /*
   * O INÍCIO É O ÍNDICE DO APP — a barra inferior saiu.
   *
   * Toda rota que a barra cobria mora aqui: Recebíveis (faixa + atalho),
   * Registrar, Reembolso, Histórico, mais Minhas compras (nunca teve aba) e
   * Pedir compra, que desceu do cabeçalho.
   *
   * Ordem: dinheiro (faixa) → compras (reembolso, registrar, minhas, pedir,
   * pendências) → histórico. Recebíveis: faixa + atalho verde abaixo.
   */
  const { dado: rec } = useRecebiveis();

  /*
   * AS DUAS CONTAS TÊM DE SER A MESMA CONTA.
   *
   * Isto contava por `estado` e mandava para `/time/envios#status-aguardando`,
   * que filtra por `statusExtrato`. São dois vocabulários, e não um deles
   * dentro do outro:
   *
   *   estado         rascunho · aguardando · aprovado · concluído · devolvido · recusado
   *   statusExtrato  registrado · aguardando · pago · não pago
   *
   * `aprovado` — aprovado, esperando só o pagamento — vira `aguardando` no
   * extrato. E `aguardando` cujo status é "enviado"/"em análise" vira
   * `registrado`. O Início dizia "1 aguardando análise" e a tela abria com 2.
   *
   * Pior que a diferença de mapa: `statusExtrato` pode vir PRONTO do banco
   * (`status_extrato`) em vez de derivado de `estado`, então nem a equivalência
   * que ainda existe é garantida no futuro.
   *
   * Contar pelo MESMO campo que o destino filtra é o que faz o número e a
   * lista não poderem mais discordar — inclusive em `nao_pago`, que hoje casa
   * com devolvido|recusado por coincidência do mapa, não por construção.
   */
  const aguardando = envios.filter((e) => e.statusExtrato === "aguardando");
  const voltaram = envios.filter((e) => e.statusExtrato === "nao_pago");

  const ultimoMes = rec && rec.porMes.length > 0 ? rec.porMes[rec.porMes.length - 1] : null;
  const proxMes = rec?.previsao?.[0] ?? null;

  const mesUltimoNome = ultimoMes ? mesNome(ultimoMes.mes) : "—";
  const recUltimoRemun = (ultimoMes?.porNatureza?.salario ?? 0) + (ultimoMes?.porNatureza?.prolabore ?? 0) + (ultimoMes?.porNatureza?.estagio ?? 0) + (ultimoMes?.porNatureza?.comissao ?? 0) + (ultimoMes?.porNatureza?.extra ?? 0);
  const recUltimoReemb = ultimoMes?.porNatureza?.reembolso ?? 0;

  const mesProxNome = proxMes?.mes ? mesNome(proxMes.mes) : "Próximo mês";
  const salProx = proxMes?.salarioCents ?? 0;
  const prolabProx = proxMes?.prolaboreCents ?? 0;
  const comissaoProx = proxMes?.comissaoCents ?? 0;
  const reembProx = proxMes?.reembolsoCents ?? 0;

  const remunProxTotal = salProx + prolabProx + comissaoProx;
  const totalProxMes = remunProxTotal + reembProx;
  const saldoReembTotalAberto = rec?.emAbertoCents ?? 0;

  const nCompras = envios.filter((e) => e.origem === "custo" || e.origem === "compra").length;

  /*
   * O texto do atalho de Movimentações passa a carregar a contagem de
   * "aguardando", que antes era um cartão separado no Início. A informação
   * sobrevive; o cartão não — ela é um recorte da mesma lista, e cabe onde a
   * lista está.
   */
  const textoHistorico =
    envios.length === 0
      ? "Nada enviado ainda"
      : aguardando.length > 0
        ? `${envios.length} ${envios.length === 1 ? "envio" : "envios"} · ${aguardando.length} aguardando`
        : `${envios.length} ${envios.length === 1 ? "envio" : "envios"} no histórico`;

  return (
    <div className="time-tela-padrao time-inicio-guia">
      <section className="time-guia-bloco" aria-labelledby="guia-recebido">
        <div className="time-faixa time-faixa-inicio">
          <Link href="/time/recebiveis" className="time-faixa-item time-faixa-destaque" id="guia-recebido">
            <span className="time-faixa-topo">Recebido</span>
            <strong className="time-faixa-valor">
              {valor(
                recUltimoRemun > 0 ? recUltimoRemun : (ultimoMes?.totalCents ?? 0),
                recUltimoRemun === 0 && recUltimoReemb > 0
              )}
            </strong>
            {ultimoMes && recUltimoReemb > 0 && recUltimoRemun > 0 ? (
              <span className="time-faixa-nota time-nota-reemb">
                + {valor(recUltimoReemb, true)}
              </span>
            ) : null}
            <span className="time-faixa-rotulo">{mesUltimoNome}</span>
          </Link>
          <Link
            href="/time/recebiveis"
            className="time-faixa-item time-faixa-previsto"
            title="Ver previsão completa em recebíveis"
          >
            <span className="time-faixa-topo">A receber</span>
            <strong className="time-faixa-valor">
              {valor(
                remunProxTotal > 0 ? remunProxTotal : (totalProxMes > 0 ? totalProxMes : (saldoReembTotalAberto > 0 ? saldoReembTotalAberto : (rec?.totalCents ?? 0))),
                remunProxTotal === 0 && (reembProx > 0 || saldoReembTotalAberto > 0)
              )}
            </strong>
            {proxMes && reembProx > 0 && remunProxTotal > 0 ? (
              <span className="time-faixa-nota time-nota-reemb">
                + {valor(reembProx, true)}
              </span>
            ) : (proxMes && remunProxTotal > 0 && saldoReembTotalAberto > 0 ? (
              <span className="time-faixa-nota time-nota-reemb">
                + {valor(saldoReembTotalAberto, true)}
              </span>
            ) : null)}
            <span className="time-faixa-rotulo">
              {proxMes ? mesProxNome : (saldoReembTotalAberto > 0 ? "Reembolso" : "Total")}
            </span>
          </Link>
        </div>
        <nav className="time-menu-atalhos" aria-label="Recebíveis">
          <Atalho
            href="/time/recebiveis"
            titulo="Recebíveis"
            texto="Histórico, folha e o que já caiu na conta"
            tipo="recebiveis"
            cor="verde"
          />
          <Atalho
            href="/time/reembolsos"
            titulo="Reembolsos"
            texto="Registrados, aprovados e previstos a receber"
            tipo="reembolso"
            cor="verde"
          />
          <Atalho
            href="/time/comissoes"
            titulo="Comissões"
            texto="Declaradas, parcelas e o que ainda vai cair"
            tipo="recebiveis"
            cor="verde"
          />
        </nav>
      </section>

      <section className="time-guia-bloco" aria-labelledby="guia-compras">
        <div className="time-guia-cabeca">
          <h2 id="guia-compras">Compras</h2>
        </div>
        <nav className="time-menu-atalhos" aria-label="Compras">
          <Atalho
            href="/time/reembolso"
            titulo="Pedir reembolso"
            texto="Gasto do bolso para a XPE devolver"
            tipo="reembolso"
            cor="branco"
          />
          <Atalho
            href="/time/custo"
            titulo="Registrar compra"
            texto="Foto, nota fiscal ou os dois"
            tipo="custo"
            cor="branco"
          />
          <Atalho
            href="/time/compras"
            titulo="Minhas compras"
            texto={
              nCompras === 0
                ? "Nenhuma registrada ainda"
                : nCompras === 1
                  ? "1 compra registrada"
                  : `${nCompras} compras registradas`
            }
            tipo="compras"
            cor="branco"
          />
          {/*
            Pedir compra desceu do cabeçalho para cá. É a ação mais rara do
            app — zero pedidos em 7 meses —, e ocupar um dos dois lugares
            fixos do topo custava o atalho de reembolso, que é semanal. Aqui
            ela fica na ordem certa do ciclo: peço, gasto do bolso, registro.
          */}
          <Atalho
            href="/time/compra"
            titulo="Pedir compra"
            texto="Precisa de algo que a XPE compra para você"
            tipo="compra"
            cor="branco"
          />
          {/*
            O atalho "N aguardando" morava aqui e saiu: era um cartão inteiro
            no Início para uma informação que é um FILTRO da tela de
            Movimentações, não um destino próprio. Quem tinha dois envios
            parados via dois cartões dizendo quase a mesma coisa — "aguardando"
            e "voltaram" — antes de ver o histórico. A contagem continua, como
            etiqueta no atalho de Movimentações, que é para onde ela levava.

            "Voltou para você" fica: aquele é AÇÃO pendente da pessoa
            (devolvido ou recusado, precisa de correção), não um recorte de
            leitura — e por isso continua merecendo o próprio cartão.
          */}
          {voltaram.length > 0 ? (
            <Atalho
              href="/time/envios#status-nao_pago"
              titulo={
                voltaram.length === 1
                  ? "1 voltou para você"
                  : `${voltaram.length} voltaram para você`
              }
              texto="Devolvido ou recusado — precisa de correção"
              tipo="voltou"
              tom="urgente"
            />
          ) : null}
        </nav>
      </section>

      <section className="time-guia-bloco" aria-labelledby="guia-historico">
        <div className="time-guia-cabeca">
          <h2 id="guia-historico">Histórico</h2>
        </div>
        <nav className="time-menu-atalhos" aria-label="Histórico">
          <Atalho
            href="/time/envios"
            titulo="Movimentações"
            texto={textoHistorico}
            tipo="nota"
            cor="roxo"
          />
        </nav>
      </section>
    </div>
  );
}

/**
 * Compras e pedidos da pessoa.
 *
 * Não usa `.time-atalho`: aquele casco é de menu (ícone 36px + texto de
 * atalho). Aqui a pergunta é "o que eu registrei, quanto e em que estado",
 * o mesmo recorte da lista de reembolso.
 */
function MinhasCompras({ envios }: { envios: Envio[] }) {
  const compras = useMemo(
    () => envios.filter((e) => e.origem === "custo" || e.origem === "compra"),
    [envios]
  );
  const [periodo, setPeriodo] = useState("tudo");
  const [ordem, setOrdem] = useState<"recente" | "valor_desc" | "valor_asc">("recente");

  const filtradas = useMemo(() => {
    const lista = compras.filter((e) => envioNoPeriodo(e, periodo));
    return [...lista].sort((a, b) => {
      if (ordem === "valor_desc") return (b.valorCents ?? -1) - (a.valorCents ?? -1);
      if (ordem === "valor_asc") return (a.valorCents ?? Infinity) - (b.valorCents ?? Infinity);
      const da = dataDoEnvio(a);
      const db = dataDoEnvio(b);
      return db.localeCompare(da) || b.criadoEm.localeCompare(a.criadoEm);
    });
  }, [compras, periodo, ordem]);

  const totalCents = filtradas.reduce((a, e) => a + (e.valorCents ?? 0), 0);
  const nAguardando = filtradas.filter((e) => e.statusExtrato === "aguardando").length;
  const nRegistrado = filtradas.filter((e) => e.statusExtrato === "registrado").length;

  return (
    <div className="time-tela-padrao">
      <header className="time-form-cabeca">
        <h1>Minhas compras</h1>
        <p>Tudo que você registrou como compra ou pedido — o detalhe abre no histórico.</p>
      </header>

      {compras.length === 0 ? (
        <div className="envios-vazio-caixa">
          <strong>Nenhuma compra registrada</strong>
          <p>Quando você registrar uma compra com foto ou nota, ela aparece aqui.</p>
          <div className="envios-vazio-portas">
            <Link href="/time/custo" className="time-botao">
              Registrar uma compra
            </Link>
            <Link href="/time" className="time-botao secundario">
              Voltar ao Início
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section className="reemb-destaques" aria-label="Resumo das compras">
            <article className="reemb-destaque-card">
              <span className="reemb-kpi-rotulo">Total</span>
              <strong className="reemb-kpi-valor">{brl(totalCents)}</strong>
              <span className="reemb-kpi-detalhe">
                {filtradas.length} {filtradas.length === 1 ? "registro" : "registros"}
              </span>
            </article>
            <article className="reemb-destaque-card">
              <span className="reemb-kpi-rotulo">Aguardando</span>
              <strong className="reemb-kpi-valor">{nAguardando}</strong>
              <span className="reemb-kpi-detalhe">
                {nRegistrado} {nRegistrado === 1 ? "registrada" : "registradas"}
              </span>
            </article>
          </section>

          <div className="reemb-filtro-chips" role="group" aria-label="Período">
            {FILTRO_PERIODO_OPCOES.map(([v, r]) => (
              <button
                key={v}
                type="button"
                className={`reemb-chip ${periodo === v ? "ativo" : ""}`}
                aria-pressed={periodo === v}
                onClick={() => setPeriodo(v)}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="reemb-filtro-chips" role="group" aria-label="Ordenar">
            {(
              [
                ["recente", "Mais recentes"],
                ["valor_desc", "Maior valor"],
                ["valor_asc", "Menor valor"]
              ] as const
            ).map(([v, r]) => (
              <button
                key={v}
                type="button"
                className={`reemb-chip ${ordem === v ? "ativo" : ""}`}
                aria-pressed={ordem === v}
                onClick={() => setOrdem(v)}
              >
                {r}
              </button>
            ))}
          </div>

          {filtradas.length === 0 ? (
            <p className="time-sub envios-vazio">Nada neste período. Troque o filtro ou registre outra compra.</p>
          ) : (
            <ul className="compras-lista">
              {filtradas.map((c) => (
                <li key={`${c.origem}-${c.origemId}`}>
                  <Link href={`/time/envios#envio-${c.origem}-${c.origemId}`} className="compras-item">
                    <div className="compras-item-topo">
                      <strong className="compras-item-titulo">{c.titulo}</strong>
                      <b className="compras-item-valor">{c.valorCents !== null ? brl(c.valorCents) : "—"}</b>
                    </div>
                    <div className="compras-item-meta">
                      <span>{formatDataEnvio(c)}</span>
                      {c.code ? <span>{c.code}</span> : null}
                      <span className={`envios-status envios-status-${c.statusExtrato}`}>
                        {ESTADO_ROTULO[c.estado]?.texto ?? STATUS_EXTRATO_ROTULO[c.statusExtrato]}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="time-sub time-rodape">
            <Link href="/time/custo">Registrar outra compra →</Link>
          </p>
        </>
      )}
    </div>
  );
}

function IconeAtalho({
  tipo
}: {
  tipo: "reembolso" | "custo" | "nota" | "compra" | "recebiveis" | "compras" | "aguardando" | "voltou";
}) {
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
  if (tipo === "recebiveis")
    return (
      <svg {...comum}>
        <path d="M4 19V11M9 19V8M14 19V5M19 19v-7" />
      </svg>
    );
  if (tipo === "compras")
    return (
      <svg {...comum}>
        <path d="M5 8h14l-1 12H6L5 8ZM9 8V6a3 3 0 0 1 6 0v2" />
      </svg>
    );
  if (tipo === "aguardando")
    return (
      <svg {...comum}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v5l3 2" />
      </svg>
    );
  if (tipo === "voltou")
    return (
      <svg {...comum}>
        <path d="M12 8v5" />
        <path d="M12 16.5h.01" />
        <path d="M10.3 4.8 2.8 18a1.5 1.5 0 0 0 1.3 2.2h15.8a1.5 1.5 0 0 0 1.3-2.2L13.7 4.8a1.5 1.5 0 0 0-2.6 0Z" />
      </svg>
    );
  return (
    <svg {...comum}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}


function Atalho({
  href,
  titulo,
  texto,
  tipo,
  tom,
  cor,
  compacto = false
}: {
  href: string;
  titulo: string;
  texto: string;
  tipo: "reembolso" | "custo" | "nota" | "compra" | "recebiveis" | "compras" | "aguardando" | "voltou";
  tom?: "alerta" | "urgente";
  cor?: "roxo" | "branco" | "verde";
  compacto?: boolean;
}) {
  const classe = [
    "time-atalho",
    compacto ? "time-atalho-compacto" : "",
    tom === "alerta" ? "time-atalho-alerta" : "",
    tom === "urgente" ? "time-atalho-urgente" : "",
    cor === "roxo" ? "time-atalho-cor-roxo" : "",
    cor === "branco" ? "time-atalho-cor-branco" : "",
    cor === "verde" ? "time-atalho-cor-verde" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link href={href} className={classe}>
      <span className="time-atalho-icone" aria-hidden>
        <IconeAtalho tipo={tipo} />
      </span>
      <span className="time-atalho-texto">
        <strong>{titulo}</strong>
        <span>{texto}</span>
      </span>
      <svg
        className="time-atalho-seta"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
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

/**
 * O QR decodificado no CELULAR, na foto ORIGINAL — antes de `encolherImagem`.
 *
 * O servidor também decodifica (`lib/financeiro/ler-qrcode.ts`), mas só vê o
 * arquivo DEPOIS de reduzido para no máximo 1600px e requantizado em JPEG
 * 0,8 — bom o bastante para o Haiku ler texto, ruim o bastante para apagar um
 * QR pequeno dentro de uma nota fotografada de longe: em 1600px de lado, um
 * código que ocupa um quarto do quadro cai para módulos de poucos pixels, e
 * é exatamente essa perda que o padrão de localização do QR não sobrevive.
 * Testes sintéticos (QR ocupando o quadro inteiro) nunca pegavam essa perda
 * porque nunca passavam pelo encolhimento na proporção de uma foto real.
 *
 * Rodar aqui, no arquivo como a câmera entregou, resolve na raiz em vez de
 * afinar o encolhimento — mesma lib (`jsqr`) que já roda no servidor, só que
 * antes da perda, e como já é dependência do app não custa nada a mais além
 * do bundle.
 */
async function decodificarQrNoCliente(arquivo: File): Promise<string | null> {
  if (!arquivo.type.startsWith("image/")) return null;
  try {
    const bitmap = await createImageBitmap(arquivo);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const resultado = jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
    if (!resultado?.data) return null;
    const chave = resultado.data.match(/\d{44}/);
    return chave ? chave[0] : null;
  } catch {
    return null;
  }
}

/**
 * A FOTO ANEXADA, visível — não só o nome do arquivo.
 *
 * Antes disto, "IMG_20260812_140322.jpg · 1834 KB" era tudo que a tela dizia
 * sobre o anexo: nenhum jeito de conferir SE era a foto certa antes de
 * enviar. Miniatura de 44px identifica de relance; tocar amplia em tela
 * cheia sem trocar de aba — um link `target="_blank"` para uma `blob:` URL
 * falha em navegador de celular com frequência, porque a URL só existe no
 * documento que a criou.
 */
function MiniaturaAnexo({ arquivo }: { arquivo: File }) {
  const [url, setUrl] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState(false);
  useEffect(() => {
    if (!arquivo.type.startsWith("image/")) {
      setUrl(null);
      return;
    }
    const objeto = URL.createObjectURL(arquivo);
    setUrl(objeto);
    return () => URL.revokeObjectURL(objeto);
  }, [arquivo]);
  if (!url) return null;
  return (
    <>
      <button
        type="button"
        className="anexo-miniatura"
        onClick={() => setAmpliada(true)}
        aria-label="ver a foto anexada em tamanho maior"
      >
        <img src={url} alt="" />
      </button>
      {ampliada ? (
        <div
          className="anexo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="foto anexada em tamanho maior"
          onClick={() => setAmpliada(false)}
        >
          <img src={url} alt="" />
        </div>
      ) : null}
    </>
  );
}

type LoteItem = {
  id: string;
  arquivo: File;
  status: "lendo" | "pronto" | "erro" | "enviando" | "enviado";
  valor: string;
  data: string;
  descricao: string;
  fornecedor: string;
  nfeKey: string;
  erro?: string;
};

const ROTULO_STATUS_LOTE: Record<LoteItem["status"], string> = {
  lendo: "lendo…",
  pronto: "pronto",
  erro: "erro",
  enviando: "enviando…",
  enviado: "enviado"
};

/**
 * A LISTA DE COMPROVANTES DO LOTE — cada foto vira um cartão editável.
 *
 * Tipo/categoria, pagamento e cartão ficam FORA daqui (são os campos que já
 * existem no formulário, compartilhados pelo lote inteiro); este componente
 * só cuida do que muda de item para item: a foto, o valor que ela revelou, a
 * data, e o que é — todos editáveis, porque a leitura pode errar e corrigir
 * dez campos de uma vez não pode exigir apagar e começar de novo.
 */
function LoteReembolsoCampo({
  itens,
  aoAdicionar,
  aoAlterarItem,
  aoRemoverItem
}: {
  itens: LoteItem[];
  aoAdicionar: (arquivos: File[]) => void;
  aoAlterarItem: (id: string, patch: Partial<LoteItem>) => void;
  aoRemoverItem: (id: string) => void;
}) {
  const galeriaRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const totalCents = itens.reduce((soma, it) => soma + centavosDoTexto(it.valor), 0);

  return (
    <div className="campo lote-reembolso">
      <span className="campo-rotulo">Comprovantes do lote</span>

      <div className="lote-adicionar">
        <button type="button" className="chip" onClick={() => cameraRef.current?.click()}>
          tirar foto
        </button>
        <button type="button" className="chip" onClick={() => galeriaRef.current?.click()}>
          escolher da galeria
        </button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="anexar-input"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) aoAdicionar([f]);
        }}
      />
      <input
        ref={galeriaRef}
        type="file"
        accept="image/*"
        multiple
        className="anexar-input"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const arquivos = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (arquivos.length) aoAdicionar(arquivos);
        }}
      />

      {itens.length === 0 ? (
        <p className="campo-hint">
          Toque em <strong>tirar foto</strong> para uma de cada vez, ou <strong>escolher da galeria</strong> para
          anexar várias já tiradas — cada uma vira um reembolso, com o tipo e o pagamento escolhidos abaixo.
        </p>
      ) : (
        <>
          <div className="lote-lista">
            {itens.map((item) => (
              <div key={item.id} className={`lote-item lote-item-${item.status}`}>
                <MiniaturaAnexo arquivo={item.arquivo} />
                <div className="lote-item-campos">
                  <input
                    value={item.descricao}
                    onChange={(e) => aoAlterarItem(item.id, { descricao: e.target.value })}
                    placeholder="o que é"
                    aria-label="o que é este comprovante"
                  />
                  <div className="valor-caixa">
                    <em>R$</em>
                    <input
                      value={item.valor}
                      onChange={(e) => aoAlterarItem(item.id, { valor: mascaraDinheiro(e.target.value) })}
                      inputMode="numeric"
                      placeholder="0,00"
                      aria-label="valor deste comprovante"
                    />
                  </div>
                  <input
                    type="date"
                    value={item.data}
                    onChange={(e) => aoAlterarItem(item.id, { data: e.target.value })}
                    aria-label="data deste comprovante"
                  />
                </div>
                <div className="lote-item-status">
                  {item.status === "lendo" || item.status === "enviando" ? (
                    <span className="anexar-girando" aria-hidden />
                  ) : null}
                  <small className={item.status === "erro" ? "reemb-leitura erro" : item.status === "enviado" ? "reemb-leitura ok" : "time-sub"}>
                    {item.erro ?? ROTULO_STATUS_LOTE[item.status]}
                  </small>
                </div>
                <button
                  type="button"
                  className="lote-item-remover"
                  onClick={() => aoRemoverItem(item.id)}
                  disabled={item.status === "enviando" || item.status === "enviado"}
                  aria-label="remover este comprovante do lote"
                >
                  remover
                </button>
              </div>
            ))}
          </div>
          <strong className="lote-total">
            {itens.length} comprovante{itens.length === 1 ? "" : "s"} — total {brl(totalCents)}
          </strong>
        </>
      )}
    </div>
  );
}

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
  /**
   * OS CARTÕES PESSOAIS DA PRÓPRIA PESSOA, para tocar em vez de digitar.
   *
   * Antes desta tela o campo "Final do seu cartão" era um `<input>` puro, sem
   * NENHUMA consulta — digitar um final que já estava cadastrado não avisava
   * nada, e só na hora de enviar (ou nunca) o desencontro aparecia. Buscado
   * uma vez quando o reembolso por cartão pessoal fica visível; `null`
   * enquanto carrega, para o formulário não afirmar "nenhum cadastrado" antes
   * de saber.
   */
  const [meusCartoes, setMeusCartoes] = useState<
    { id: number; final: string; apelido: string | null; bandeira: string | null; cor: string | null }[] | null
  >(null);
  const [digitandoOutroCartao, setDigitandoOutroCartao] = useState(false);
  // Qual natureza o cadastro embutido (`CadastrarCartao`) já abre marcada:
  // "adicionar novo" no cartão pessoal do reembolso não deve obrigar a
  // pessoa a trocar "Da empresa" por "Meu, pessoal" de novo — ela já disse
  // isso ao chegar nesta tela.
  const [naturezaCadastro, setNaturezaCadastro] = useState<"empresa" | "pessoal">("empresa");
  // Busca por banco na lista achatada de plásticos da empresa — ela cresceu
  // (nove Nubank, vários Inter, etc.) e rolar tocando um por um deixou de
  // funcionar como escolha rápida.
  const [filtroCartaoEmpresa, setFiltroCartaoEmpresa] = useState("");
  // Só a tela de NOTA ainda precisa de quem emitiu: numa nota fiscal o emitente
  // é o fato central. Num custo, ele já vem da foto quando existe, e pedir de
  // novo é um campo a mais entre a pessoa e o botão de enviar.
  const [fornecedor, setFornecedor] = useState("");
  const [nfeKey, setNfeKey] = useState("");
  // Decodificada do QR (jsqr, determinístico) em vez de lida por OCR do
  // Haiku — mais confiável que o resto do formulário, e a pessoa que vai
  // conferir o reembolso merece saber qual das duas foi usada.
  const [chaveConferidaPorQr, setChaveConferidaPorQr] = useState(false);
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
  // Busca uma vez, na primeira vez que o passo aparece — não a cada render,
  // e não antes de a pessoa chegar nele.
  useEffect(() => {
    if (!modoReembolso || pagamento !== "cartao_pessoal" || meusCartoes !== null) return;
    let vivo = true;
    void fetch("/api/time/cartao")
      .then((r) => r.json())
      .then((j) => {
        if (vivo) setMeusCartoes(Array.isArray(j.cartoes) ? j.cartoes : []);
      })
      .catch(() => {
        if (vivo) setMeusCartoes([]);
      });
    return () => {
      vivo = false;
    };
  }, [modoReembolso, pagamento, meusCartoes]);

  const [cadastrando, setCadastrando] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [leitura, setLeitura] = useState<{ tom: "ok" | "aviso" | "erro"; texto: string } | null>(null);

  /**
   * VÁRIOS COMPROVANTES DO MESMO TIPO — pedido do Fernando: "geralmente é um
   * tipo de produto só de reembolso, por exemplo 10 reembolsos de Uber", e
   * digitar o formulário inteiro dez vezes para o MESMO tipo/pagamento é
   * repetir o que já foi dito. Só existe na tela dedicada de reembolso
   * (`somenteReembolso`): tipo/categoria, pagamento e cartão continuam sendo
   * escolhidos UMA vez nos campos que já existem — o que muda por item é só
   * o que a foto de cada um revela (valor, data, o que é).
   */
  const [loteAtivo, setLoteAtivo] = useState(false);
  const [loteItens, setLoteItens] = useState<LoteItem[]>([]);

  /** Lê UM item do lote — mesma rota que o formulário de item único usa. */
  const lerItemDoLote = useCallback(async (id: string, arquivoDoItem: File) => {
    try {
      const chaveDoQrOriginal = decodificarQrNoCliente(arquivoDoItem);
      const form = new FormData();
      form.append("arquivo", await encolherImagem(arquivoDoItem));
      const r = await fetch("/api/time/ler-comprovante", { method: "POST", body: form });
      const j = await r.json().catch(() => ({}));
      const chaveDoQr = await chaveDoQrOriginal;
      if (!r.ok) {
        setLoteItens((atual) => atual.map((it) => (it.id === id ? { ...it, status: "erro", erro: j.error ?? "não consegui ler" } : it)));
        return;
      }
      const l = j.lido as {
        valorTotal: number | null; data: string | null; estabelecimento: string | null;
        emitente?: string | null; resumo: string; chaveNfe: string | null;
      };
      setLoteItens((atual) =>
        atual.map((it) =>
          it.id === id
            ? {
                ...it,
                status: "pronto",
                valor: l.valorTotal != null ? l.valorTotal.toFixed(2).replace(".", ",") : it.valor,
                data: l.data ?? it.data,
                descricao: l.resumo || it.descricao,
                fornecedor: l.estabelecimento ?? l.emitente ?? it.fornecedor,
                nfeKey: chaveDoQr ?? l.chaveNfe ?? it.nfeKey
              }
            : it
        )
      );
    } catch {
      setLoteItens((atual) => atual.map((it) => (it.id === id ? { ...it, status: "erro", erro: "não consegui ler" } : it)));
    }
  }, []);

  const adicionarAoLote = useCallback(
    (arquivos: File[]) => {
      const novos: LoteItem[] = arquivos.map((a) => ({
        id: crypto.randomUUID(),
        arquivo: a,
        status: "lendo",
        valor: "",
        data: HOJE(),
        descricao: "",
        fornecedor: "",
        nfeKey: ""
      }));
      setLoteItens((atual) => [...atual, ...novos]);
      for (const item of novos) void lerItemDoLote(item.id, item.arquivo);
    },
    [lerItemDoLote]
  );

  /*
   * A CONFIRMAÇÃO FICA ONDE O DEDO ESTÁ.
   *
   * O recado de sucesso vive no topo de `.time-app`. Medido com a pessoa
   * rolada até o botão de enviar — que é onde ela está no instante em que
   * envia: o recado nascia a 484px acima da viewport no custo, 579px no
   * reembolso. Invisível.
   *
   * E logo depois o handler limpa `setTitulo("")`, `setValor("")`,
   * `setDescricao("")`… Então o ÚNICO efeito visível de um envio bem-sucedido
   * era: tudo que a pessoa acabou de digitar some. Isso não lê como "deu
   * certo", lê como "o app perdeu meu lançamento".
   *
   * Rolar até o recado no sucesso seria a correção óbvia e está descartada com
   * motivo: na tela de PIX isso levava a página de scrollY 999 para 0 e fazia
   * o QR sair do quadro no exato momento de pagar. A regra que sobrou é trazer
   * a mensagem até a pessoa, nunca mover a pessoa até a mensagem.
   *
   * O código também não era link e não havia caminho para frente. Agora tem
   * os dois.
   */
  const [feito, setFeito] = useState<{ texto: string; href: string } | null>(null);

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
   * A CATEGORIA A PARTIR DO QUE SE DIGITA — sem esperar foto nenhuma.
   *
   * Pedido do Fernando: sugestão "de acordo com o que é escrito", não só a
   * partir do fornecedor que a foto revelou. Busca no título e na descrição
   * assim que a pessoa para de digitar por 600ms — cedo o bastante para
   * ajudar, tarde o bastante para não disparar uma consulta por tecla.
   *
   * `lendo` na guarda: enquanto uma foto está sendo lida, o autofill dela
   * pode preencher título/descrição e disparar este efeito por tabela — e aí
   * ele competiria com o palpite da própria foto, que é mais específico
   * (sabe o fornecedor, não só o texto). Silencioso até a leitura acabar.
   *
   * `!categoria && !sugestao` na guarda: nunca troca uma sugestão que já
   * apareceu (da foto, do CNPJ) por uma mais fraca vinda do texto — só
   * preenche o silêncio, nunca disputa o que já tem resposta.
   */
  useEffect(() => {
    if (lendo || categoria || sugestao) return;
    const termo = `${titulo} ${descricao}`.trim();
    if (termo.length < 4) return;
    let vivo = true;
    const espera = setTimeout(() => {
      void fetch(`/api/time/sugerir-categoria-por-texto?texto=${encodeURIComponent(termo)}`)
        .then((r) => r.json())
        .then((j) => {
          if (!vivo) return;
          const s = j.sugestao as
            | { categoriaCode: string; categoriaNome: string; vezes: number; parecidoCom: string }
            | null;
          if (!s) return;
          const alvo = opcoes.categorias.find((c) => c.rotulo.startsWith(`${s.categoriaCode} `));
          if (!alvo) return;
          setSugestao({
            categoriaId: alvo.id,
            rotulo: alvo.rotulo,
            contraparte: `"${s.parecidoCom}"`,
            vezes: s.vezes,
            forte: s.vezes >= 2
          });
        })
        .catch(() => {});
    }, 600);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [titulo, descricao, lendo, categoria, sugestao, opcoes.categorias]);

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
      setChaveConferidaPorQr(false);
      try {
        // Disparado ANTES do encolhimento, em paralelo com o upload — ver o
        // comentário de `decodificarQrNoCliente` sobre por que é a foto
        // original, e não a reduzida, que precisa passar pelo QR.
        const chaveDoQrOriginal = decodificarQrNoCliente(f);

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
        // O QR só existe em imagem, e só quando decodifica de verdade — sem
        // chave nenhuma no `por` teria feito nada, então aqui só é preciso
        // marcar o selo quando a rota confirma a origem.
        if ((j.qr as { chaveConferida?: boolean } | null)?.chaveConferida) setChaveConferidaPorQr(true);
        // O QR do CLIENTE tem prioridade — decodificado na foto original, sem
        // a perda do encolhimento que às vezes derrota o do servidor. Mesma
        // regra de "campo já digitado não é sobrescrito" do `por` acima.
        const chaveDoQrOriginalPronta = await chaveDoQrOriginal;
        if (chaveDoQrOriginalPronta && !nfeKey.trim()) {
          setNfeKey(chaveDoQrOriginalPronta);
          setChaveConferidaPorQr(true);
          if (!preenchidos.includes("chave da NF-e")) preenchidos.push("chave da NF-e");
        }

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

        // A CATEGORIA QUE A EQUIPE JÁ USOU para fornecedor parecido — fato
        // contado (`fin_padrao_categoria_fornecedor`), não impressão da foto.
        // Por isso vira `sugestao` (o card que diz "você já classificou X
        // assim N vezes"), o mesmo do CNPJ logo abaixo — nunca `palpite`, que
        // é rotulado na tela como "chute, não histórico".
        const aprendizado = j.aprendizado as
          | { vezes: number; fornecedorParecido: string; categoriaCode: string; categoriaNome: string }
          | null;
        if (aprendizado && !categoria) {
          const alvoAprendizado = opcoes.categorias.find((c) => c.rotulo.startsWith(`${aprendizado.categoriaCode} `));
          if (alvoAprendizado) {
            setSugestao({
              categoriaId: alvoAprendizado.id,
              rotulo: alvoAprendizado.rotulo,
              contraparte: l.estabelecimento ?? aprendizado.fornecedorParecido,
              vezes: aprendizado.vezes,
              forte: aprendizado.vezes >= 2
            });
            setPalpite((p) => (p && p.centroId ? { ...p, categoriaId: null, categoriaRotulo: null } : null));
          }
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

  /**
   * ENVIA O LOTE — um `/api/time/reembolso` por item, em sequência.
   *
   * Sequencial, não em paralelo: dez requisições ao mesmo tempo competem pela
   * mesma API de leitura (já consumida na hora de anexar) e, mais importante,
   * um erro no meio fica claro item a item em vez de virar uma promessa
   * rejeitada anônima dentro de um `Promise.all`. Tipo/categoria, pagamento e
   * cartão são os MESMOS campos do formulário de item único — só valor, data,
   * descrição, fornecedor e a chave da NF-e vêm de cada foto.
   */
  async function enviarLote() {
    if (!tipoReembolso && !categoria) return setLeitura({ tom: "erro", texto: "escolha o tipo ou a categoria do gasto" });
    if (!pagamento) return setLeitura({ tom: "erro", texto: "escolha como foi pago" });
    if (loteItens.some((it) => it.status === "lendo")) {
      return setLeitura({ tom: "aviso", texto: "ainda lendo alguma foto — espere terminar antes de enviar" });
    }
    if (loteItens.length === 0) return;

    setEnviando(true);
    setLeitura(null);
    let sucesso = 0;
    let totalCents = 0;
    for (const item of loteItens) {
      if (item.status === "enviado") {
        sucesso += 1;
        totalCents += centavosDoTexto(item.valor);
        continue;
      }
      if (!item.valor.trim()) {
        setLoteItens((atual) => atual.map((it) => (it.id === item.id ? { ...it, status: "erro", erro: "falta o valor" } : it)));
        continue;
      }
      setLoteItens((atual) => atual.map((it) => (it.id === item.id ? { ...it, status: "enviando" } : it)));
      try {
        await postar(
          "/api/time/reembolso",
          {
            tipo: tipoReembolso || undefined,
            categoriaId: !tipoReembolso && categoria ? categoria : undefined,
            descricao: item.descricao || item.fornecedor || "reembolso",
            expenseDate: item.data,
            valor: item.valor,
            nfeKey: item.nfeKey,
            pagamento,
            fornecedor: item.fornecedor,
            centroCusto: centro,
            linhaServico: centro ? "" : linha,
            finalCartao: final,
            idempotencyKey: item.id
          },
          item.arquivo,
          null
        );
        sucesso += 1;
        totalCents += centavosDoTexto(item.valor);
        setLoteItens((atual) => atual.map((it) => (it.id === item.id ? { ...it, status: "enviado" } : it)));
      } catch (erro) {
        setLoteItens((atual) =>
          atual.map((it) =>
            it.id === item.id ? { ...it, status: "erro", erro: erro instanceof Error ? erro.message : "falhou" } : it
          )
        );
      }
    }
    setEnviando(false);

    if (sucesso === loteItens.length) {
      const texto = `${sucesso} reembolso${sucesso === 1 ? "" : "s"} enviado${sucesso === 1 ? "" : "s"} — total ${brl(totalCents)}.`;
      await aoEnviar(texto);
      setFeito({ texto: `${texto} A empresa te devolve este valor.`, href: "/time/envios" });
      setLoteItens([]);
      setLoteAtivo(false);
      setTipoReembolso("");
      setCategoria("");
    } else {
      setLeitura({
        tom: "aviso",
        texto: `${sucesso} de ${loteItens.length} enviados. Confira os que ficaram com erro antes de tentar de novo.`
      });
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    // Enter num campo de texto ainda dispara o submit nativo do `<form>`
    // mesmo com o botão principal virando `type="button"` no lote — a mesma
    // tecla precisa cair no caminho certo, não no formulário de item único
    // com `titulo`/`valor` vazios.
    if (loteAtivo) return void enviarLote();
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
        setFeito({
          texto: `Reembolso ${rr.code ?? ""} enviado. A empresa te devolve este valor.`.replace("  ", " "),
          href: "/time/envios"
        });
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
      setFeito({
        texto: compra
          ? `Compra ${compra.code} registrada. O custo ${r.code} foi para análise.`
          : `${kindEnvio === "nota_entrada" ? "Nota" : "Custo"} ${r.code} enviado para análise.`,
        href: r.id ? `/time/envios#envio-custo-${r.id}` : "/time/envios"
      });
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
      setDigitandoOutroCartao(false);
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
              : // Era "Processo para registro das compras e custos da empresa" — a
                // única frase de manual de procedimento num app que em todo o
                // resto fala como gente ("Enviar não é aprovar", "Gasto do seu
                // bolso — a empresa te devolve"). Diz agora o que a tela faz e o
                // que ela NÃO faz, que é a dúvida real de quem está registrando.
                "Já comprou? Registre aqui. Não vira lançamento até o financeiro conferir."}
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

      {somenteReembolso ? (
        <div className="campo">
          <button
            type="button"
            className={loteAtivo ? "chip ativo" : "chip"}
            onClick={() => {
              const ligando = !loteAtivo;
              setLoteAtivo(ligando);
              if (ligando) {
                // Limpa o que é de item ÚNICO: no lote, cada foto tem seu
                // próprio valor/data/descrição — misturar os dois estados
                // deixaria um campo do formulário de item único sobrando,
                // sem dono, e o palpite/sugestão da foto anterior valendo
                // para um lote que ainda nem tinha foto nenhuma.
                setArquivo(null);
                setArquivoNota(null);
                setTitulo("");
                setValor("");
                setDescricao("");
                setNfeKey("");
                setLeitura(null);
                setPalpite(null);
                setSugestao(null);
                setCartaoLido(null);
              }
            }}
          >
            {loteAtivo ? "✕ vários comprovantes" : "+ vários comprovantes do mesmo tipo"}
          </button>
          {loteAtivo ? (
            <small className="campo-hint">
              Anexe todas as fotos — tipo, pagamento e cartão abaixo valem para todas; valor e data vêm de cada uma.
            </small>
          ) : null}
        </div>
      ) : null}

      {!loteAtivo ? (
        <>
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
                    <MiniaturaAnexo arquivo={arquivo} />
                    <strong>{arquivo.name}</strong>
                    <small>foto ou print · {(arquivo.size / 1024).toFixed(0)} KB</small>
                    <button type="button" onClick={() => { setArquivo(null); setLeitura(null); }} aria-label="tirar a foto do envio">
                      tirar
                    </button>
                  </div>
                ) : null}
                {arquivoNota ? (
                  <div className="anexo-ficha fiscal">
                    <MiniaturaAnexo arquivo={arquivoNota} />
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
        </>
      ) : (
        <LoteReembolsoCampo
          itens={loteItens}
          aoAdicionar={adicionarAoLote}
          aoAlterarItem={(id, patch) => setLoteItens((atual) => atual.map((it) => (it.id === id ? { ...it, ...patch } : it)))}
          aoRemoverItem={(id) => setLoteItens((atual) => atual.filter((it) => it.id !== id))}
        />
      )}

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
        <div className="campo">
          <span className={rotulo}>Qual cartão</span>
          {meusCartoes === null ? (
            <p className="campo-hint">carregando seus cartões…</p>
          ) : meusCartoes.length > 0 && !digitandoOutroCartao ? (
            <div className="chips" role="group" aria-label="Seus cartões cadastrados">
              {meusCartoes.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={final === c.final}
                  className={final === c.final ? "chip ativo" : "chip"}
                  onClick={() => setFinal(c.final)}
                >
                  {rotuloDeCartao(c)}
                </button>
              ))}
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setNaturezaCadastro("pessoal");
                  setCadastrando(true);
                }}
              >
                + adicionar cartão
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setDigitandoOutroCartao(true);
                  setFinal("");
                }}
              >
                outro cartão
              </button>
            </div>
          ) : (
            <>
              <input
                value={final}
                onChange={(e) => setFinal(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                maxLength={4}
                placeholder="4 últimos dígitos"
                className="campo-final"
              />
              <div className="chips">
                {meusCartoes.length > 0 ? (
                  <button type="button" className="campo-link" onClick={() => setDigitandoOutroCartao(false)}>
                    ← ver meus cartões cadastrados
                  </button>
                ) : null}
                <button
                  type="button"
                  className="campo-link"
                  onClick={() => {
                    setNaturezaCadastro("pessoal");
                    setCadastrando(true);
                  }}
                >
                  + cadastrar este cartão
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {pagamento === "cartao_da_empresa" && !modoReembolso && opcoes.bancos.length > 0
        ? (() => {
            const escolhido = opcoes.bancos.find((b) => String(b.id) === banco);
            // Comparar os DÍGITOS, não `p.nome`: `nome` vira apelido quando
            // existe, e um apelido não termina com "1234" — o reconhecimento
            // ficava mudo exatamente nos cartões que têm apelido cadastrado.
            const casa = final.length === 4 && Boolean(escolhido?.plasticos.find((p) => p.final === final));
            // TODOS os plásticos, de todo banco — não só do banco já
            // selecionado. Era aqui que "cartão que eu sei que existe" dava
            // "não cadastrado": a comparação só olhava dentro do banco que
            // a pessoa tinha clicado, e escolher o banco certo era um
            // palpite que ninguém tinha como acertar de cabeça.
            const todosOsPlasticos = opcoes.bancos.flatMap((b) =>
              b.plasticos.map((p) => ({ ...p, bancoId: b.id, bancoNome: b.nome }))
            );
            // A busca por banco só aparece quando a lista já é grande o
            // bastante para valer a pena — poucos cartões não pedem filtro.
            const buscaVisivel = todosOsPlasticos.length > 6;
            const termo = filtroCartaoEmpresa.trim().toLowerCase();
            const plasticosFiltrados = !buscaVisivel || !termo
              ? todosOsPlasticos
              : todosOsPlasticos.filter((p) =>
                  [p.bancoNome, p.apelido, p.final].some((v) => v && v.toLowerCase().includes(termo))
                );

            return (
              <>
                {todosOsPlasticos.length > 0 && !cadastrando ? (
                  <div className="campo">
                    <span className={rotulo ?? "campo-rotulo"}>Qual cartão</span>
                    {buscaVisivel ? (
                      <input
                        value={filtroCartaoEmpresa}
                        onChange={(e) => setFiltroCartaoEmpresa(e.target.value)}
                        placeholder="buscar por banco, apelido ou final"
                      />
                    ) : null}
                    <div className="chips" role="group" aria-label="Cartões da empresa já cadastrados">
                      {plasticosFiltrados.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          aria-pressed={banco === String(p.bancoId) && final === (p.final ?? "")}
                          className={banco === String(p.bancoId) && final === (p.final ?? "") ? "chip ativo" : "chip"}
                          onClick={() => {
                            setBanco(String(p.bancoId));
                            setFinal(p.final ?? "");
                          }}
                        >
                          {rotuloDeCartao(p, p.bancoNome)}
                        </button>
                      ))}
                      {plasticosFiltrados.length === 0 ? (
                        <p className="campo-hint">nenhum cartão bate com &quot;{filtroCartaoEmpresa}&quot;</p>
                      ) : null}
                      <button
                        type="button"
                        className="chip"
                        onClick={() => {
                          setNaturezaCadastro("empresa");
                          setCadastrando(true);
                        }}
                      >
                        + adicionar novo
                      </button>
                      <button
                        type="button"
                        className={digitandoOutroCartao ? "chip ativo" : "chip"}
                        onClick={() => {
                          setDigitandoOutroCartao((v) => !v);
                          setBanco("");
                          setFinal("");
                        }}
                      >
                        buscar por banco e final
                      </button>
                    </div>
                  </div>
                ) : null}

                {(digitandoOutroCartao || todosOsPlasticos.length === 0) && !cadastrando ? (
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
                ) : null}

                {(digitandoOutroCartao || todosOsPlasticos.length === 0) && banco && !cadastrando ? (
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
                        <button
                          type="button"
                          onClick={() => {
                            setNaturezaCadastro("empresa");
                            setCadastrando(true);
                          }}
                        >
                          cadastrar agora
                        </button>
                      </span>
                    ) : escolhido && escolhido.plasticos.length > 0 ? (
                      <small>
                        Cadastrados: {escolhido.plasticos.map((p) => rotuloDeCartao(p)).join(" · ")}
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
                  <span>
                    Chave da NF-e
                    {chaveConferidaPorQr ? <em className="selo-qr">conferida pelo QR</em> : null}
                  </span>
                  <input
                    value={nfeKey}
                    onChange={(e) => {
                      setNfeKey(e.target.value);
                      setChaveConferidaPorQr(false);
                    }}
                    inputMode="numeric"
                    placeholder="44 dígitos"
                  />
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
          inicial={{ banco, final, bandeira: bandeiraLida, natureza: naturezaCadastro }}
          aoCadastrar={(novasOpcoes, id, dono) => {
            aoAtualizarOpcoes(novasOpcoes);
            setCartao(String(id));
            // `dono.final`, não o `final` da closure: no atalho "+ adicionar
            // cartão" o campo local ainda está vazio quando o cadastro abre —
            // quem sabe o que foi salvo de verdade é a resposta do servidor.
            setFinal(dono.final);
            setCadastrando(false);
            setDigitandoOutroCartao(false);
            setCartaoLido({ final: dono.final, conhecido: true, natureza: dono.natureza, apelido: dono.apelido, banco: null });
            // Cartão pessoal registrado para a própria pessoa: a lista de
            // "meus cartões" ganha o novo plástico na hora, sem esperar um
            // refetch que o efeito de carregamento não repetiria sozinho.
            if (dono.natureza === "pessoal" && dono.titular === "você") {
              setMeusCartoes((atual) => [
                ...(atual ?? []),
                { id, final: dono.final, apelido: dono.apelido, bandeira: null, cor: null }
              ]);
            }
            // AQUI FECHA O CICLO que o Fernando descreveu: dito de quem é o
            // cartão, sobra uma pergunta só — compra da empresa ou reembolso.
            // Mas só quando essa pergunta ainda não tem resposta: dentro do
            // próprio fluxo de reembolso com cartão pessoal ela já tem — foi
            // dali que a pessoa abriu o cadastro.
            if (dono.natureza === "pessoal" && !(modoReembolso && pagamento === "cartao_pessoal")) {
              setDecisaoPendente({ titular: dono.titular });
            }
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
            <button
              type="button"
              onClick={() => {
                setNaturezaCadastro("empresa");
                setCadastrando(true);
              }}
            >
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
      {!loteAtivo && palpite && (palpite.categoriaId || palpite.centroId) ? (
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

      {!loteAtivo && sugestao && !categoria ? (
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
                <span>
                  Chave da NF-e
                  {chaveConferidaPorQr ? <em className="selo-qr">conferida pelo QR</em> : null}
                </span>
                <input
                  value={nfeKey}
                  onChange={(e) => {
                    setNfeKey(e.target.value);
                    setChaveConferidaPorQr(false);
                  }}
                  inputMode="numeric"
                  placeholder="44 dígitos"
                />
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
                <MiniaturaAnexo arquivo={arquivo} />
                <strong>{arquivo.name}</strong>
                <small>foto ou print · {(arquivo.size / 1024).toFixed(0)} KB</small>
                <button type="button" onClick={() => { setArquivo(null); setLeitura(null); }} aria-label="tirar a foto do envio">
                  tirar
                </button>
              </div>
            ) : null}
            {arquivoNota ? (
              <div className="anexo-ficha fiscal">
                <MiniaturaAnexo arquivo={arquivoNota} />
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
        {feito ? (
          <div className="time-feito" role="status">
            <strong>
              <span aria-hidden>✓</span> {feito.texto}
            </strong>
            <div className="time-feito-portas">
              <Link href={feito.href} className="time-botao secundario">
                Ver no histórico
              </Link>
              <button type="button" className="time-botao" onClick={() => setFeito(null)}>
                Enviar outro
              </button>
            </div>
          </div>
        ) : (
          <button
            type={loteAtivo ? "button" : "submit"}
            className="time-botao"
            disabled={
              enviando ||
              (loteAtivo && (loteItens.length === 0 || loteItens.some((it) => it.status === "lendo")))
            }
            onClick={loteAtivo ? () => void enviarLote() : undefined}
          >
            {enviando
              ? "enviando…"
              : loteAtivo
                ? `pedir ${loteItens.length} reembolso${loteItens.length === 1 ? "" : "s"}`
                : modoReembolso
                  ? "pedir reembolso"
                  : nota
                    ? "enviar nota"
                    : "registrar compra"}
          </button>
        )}
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

      {loteAtivo ? null : !unificado ? (
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
  ["hoje", "Hoje"],
  ["7d", "Semana"],
  ["mes", "Mês"]
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

/** Compara YYYY-MM-DD como string — o mesmo cuidado de `dataDoEnvio`. */
function dataNoPeriodo(dataIso: string, periodo: string) {
  if (periodo === "tudo") return true;
  const d = dataIso.slice(0, 10);
  const hoje = HOJE();
  if (periodo === "hoje") return d === hoje;
  if (periodo === "mes") return d.slice(0, 7) === hoje.slice(0, 7);
  const dias = periodo === "7d" ? 7 : periodo === "30d" ? 30 : periodo === "90d" ? 90 : null;
  if (dias === null) return true;
  const dt = new Date();
  dt.setDate(dt.getDate() - dias);
  const limite = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  return d >= limite;
}

function envioNoPeriodo(e: Envio, periodo: string) {
  return dataNoPeriodo(dataDoEnvio(e), periodo);
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
          /*
           * AQUI TINHA UM BOTÃO QUE PEDIA O MESMO DINHEIRO DE NOVO.
           *
           * Este ramo é o item vindo da PLANILHA — reembolso que a casa já
           * processou; a própria tela mostra o selo e o cronograma de
           * parcelas. E o call-to-action era "Registrar com comprovante",
           * apontando para `/time/reembolso?descricao=…&valor=…`: o formulário
           * de PEDIR reembolso, com descrição e valor já preenchidos.
           *
           * Quem tentasse anexar a nota de um reembolso recebido estaria
           * solicitando o mesmo valor uma segunda vez, sem nenhum aviso. E o
           * app empurra para cá: os cartões do Histórico exibem "5 sem
           * comprovante" em vermelho, então a pessoa vem justamente resolver
           * isso.
           *
           * Anexar de verdade exigiria coluna de anexo em `fin_reembolso_item`,
           * que é uma das duas tabelas da duplicação em aberto (item 0 do
           * AGENTS.md) — mexer nela antes daquela decisão é escolher a verdade
           * pela porta dos fundos. Até lá, a tela diz o que dá para fazer em
           * vez de oferecer um caminho que cobra em dobro.
           */
          <div className="item-gasto-anexo-zona item-gasto-anexo-zona-texto">
            <strong>Sem arquivo neste item</strong>
            <small>
              Este veio da planilha de reembolso, e a planilha não guarda anexo. Se você ainda tem a nota, mande para o
              financeiro — não abra um pedido novo por aqui: este valor já está na fila, e um segundo pedido cobraria
              duas vezes.
            </small>
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

          {/*
            NÚMERO DE PARCELA REPETIDO NÃO PODE PASSAR CALADO.
            
            Medido na base em 23/08: `notebook estag 2` do Fernando tem a
            parcela 1/12 em 01/2026 E em 05/2026, R$ 274,91 cada, e depois 2/12
            em junho, 3/12 em julho — a série limpa começa em maio, e a linha de
            janeiro sobra. `Curso MUC` do Jonildo tem 12/12 em março e de novo
            em abril. Somados, R$ 374,61 contados duas vezes.

            A planilha foi importada; nenhum código produziu isso. Mas a tela
            desenhava as duas linhas iguais como se fosse normal, e o único que
            sabe se foram dois notebooks ou um erro de digitação é a pessoa que
            comprou. Então o aviso vive AQUI, e não no financeiro: ele pergunta
            a quem tem a resposta.

            Não conserto o dado por conta própria — é o ledger de produção, e
            apagar linha de reembolso alheio não é decisão de quem está
            revisando CSS.
          */}
          {(() => {
            /*
             * SÓ VALE PARA SÉRIE PARCELADA. `parcelasTotal === 1` é despesa
             * RECORRENTE mensal — Google Drive, transporte, alimentação — e ali
             * "1/1" repetido sete vezes é o comportamento correto, não erro.
             *
             * Eu já sabia disso: está escrito na mensagem do commit que criou
             * este aviso ("são falso positivo meu; só conta onde
             * parcelas_total > 1"). Escrevi a regra e não a apliquei ao código.
             * Medido: o Google Drive do Fernando acusava, com as 7 linhas
             * marcadas, dizendo "aparece duas vezes".
             */
            if ((historico.parcelasTotal ?? 1) <= 1) return null;
            const vistos = new Map<number, number>();
            for (const p of historico.parcelas) vistos.set(p.parcela, (vistos.get(p.parcela) ?? 0) + 1);
            const repetidas = [...vistos.entries()].filter(([, n]) => n > 1);
            if (repetidas.length === 0) return null;
            const quantas = (n: number) => (n === 2 ? "duas vezes" : `${n} vezes`);
            return (
              <p className="item-gasto-parcela-repetida">
                <strong>Confira com o financeiro.</strong>{" "}
                {repetidas.length === 1
                  ? `A parcela ${repetidas[0][0]}/${historico.parcelasTotal} aparece ${quantas(repetidas[0][1])} nesta série.`
                  : `As parcelas ${repetidas.map(([k]) => `${k}/${historico.parcelasTotal}`).join(" e ")} aparecem repetidas nesta série.`}{" "}
                Se você comprou só um, há cobrança a mais.
              </p>
            );
          })()}

          <ul className="envios-detalhe-cronograma envios-item-parcelas">
            {historico.parcelas.map((parc) => {
              const repetida =
                (historico.parcelasTotal ?? 1) > 1 &&
                historico.parcelas.filter((o) => o.parcela === parc.parcela).length > 1;
              return (
              <li key={`${parc.id}-${parc.mes}-${parc.parcela}`} className={repetida ? "parcela-repetida" : undefined}>
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
              );
            })}
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
                Cancelar este reembolso
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
                {/* "Cancelar compra" numa tela cujo H1 é "Item de reembolso", cujo
                    selo é "Pago" e cujo resumo diz "parcela 3/12 · RB-297". A
                    palavra "compra" não aparecia em nenhum outro lugar daqui —
                    e este é o botão que GERA UMA DÍVIDA EM PIX para a pessoa.
                    O controle mais destrutivo da tela era o único falando
                    outro idioma. */}
                <h2 id="item-cancelar-titulo">Cancelar este reembolso</h2>
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
        <span className="envios-produto-topo">
          <span className="envios-produto-nome">{tituloBase}</span>
          <span className="envios-produto-valor">{brl(p.valorCents)}</span>
        </span>
        <span className="envios-produto-meta">
          <span className={`envios-produto-cat${p.categoriaRotulo ? "" : " envios-produto-cat-falta"}`}>
            {p.categoriaRotulo ?? "Sem categoria"}
          </span>
          <span className={`envios-produto-situacao envios-produto-situacao-${situacaoParcela}`}>
            {situacaoRotulo}
          </span>
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
  const faltaComprovante = e.origem === "reembolso" && e.itens > 0 && e.itensComAnexo < e.itens;
  const qtdItens = Math.max(e.itens, e.itensPreview.length);

  const dataCurta = formatDataEnvio(e).slice(0, 5);
  const meta = [
    dataCurta,
    tipo,
    qtdItens > 1 ? `${qtdItens} itens` : null,
    faltaComprovante ? "sem comprovante" : null,
    STATUS_EXTRATO_ROTULO[e.statusExtrato]
  ].filter(Boolean);

  const corpo = (
    <>
      <div className="envios-linha-topo">
        <strong className="envios-titulo">{e.titulo}</strong>
        <span className="envios-cel-valor">{e.valorCents === null ? "—" : brl(e.valorCents)}</span>
      </div>
      <p className="envios-linha-meta">
        {meta.join(" · ")}
      </p>
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
    <article className={`envios-linha${aberto ? " envios-linha-aberta" : ""}`}>
      <button type="button" className="envios-linha-botao" onClick={onToggle} aria-expanded={aberto}>
        {corpo}
        <svg className="envios-linha-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d={aberto ? "M4 10L8 6L12 10" : "M4 6L8 10L12 6"}
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
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

      {/*
        UM PAINEL SÓ — segmento, toolbar e lista eram três cartões com a
        mesma borda e o mesmo raio, empilhados com 16px de vão. Em 388px isso
        lia como três apps diferentes na mesma tela. O invólucro carrega a
        borda; as peças internas viram fatias (ver `.hist-painel` no CSS).
      */}
      <div className="hist-painel">
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
 * "Recebi": o que a casa me pagou, pela FOLHA — não pela categoria do ledger.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO É A LISTA DE PIX COM RÓTULO DO EXTRATO
 * ---------------------------------------------------------------------------
 * Cada linha de `fin_time_recebivel_v` herda a categoria do lançamento. Nos
 * sócios, salário E pró-labore E (muitas vezes) reembolso saem todos em 6.02
 * — então a tela escrevia "Pró-labore" em cima do PIX de R$ 1.621 (salário
 * mínimo) e do de R$ 3.379 (pró-labore) e do de R$ 1.281 (reembolso). Mentira
 * em 100% das linhas do Fernando.
 *
 * A divisão certa já existe em `fin_time_remuneracao_mes_v` (0164): salário
 * pela base contratada, reembolso pela folha, pró-labore o resto. As bandas
 * do mês são a autoridade; o PIX só confirma "caiu no Inter no dia 01".
 *
 * Casamento PIX↔banda: só quando o valor bate exatamente e ainda não foi
 * usado. Medido no Fernando: 3 de 8 meses casam a lista inteira (mar, mai,
 * ago). Nos outros, o que casa (quase sempre o 1.621) ganha meta de conta;
 * a banda continua certa mesmo sem PIX casado.
 *
 * O filtro de natureza é MÚLTIPLO: "comissão E extra este ano" é a pergunta
 * real. O total acompanha o filtro — aqui somar faz sentido (mesma direção).
 */
type BandaRecebida = {
  mes: string;
  natureza: string;
  valorCents: number;
  pix: { data: string; conta: string } | null;
};

function bandasDoMes(
  mes: string,
  porNatureza: Record<string, number>,
  pixDoMes: { data: string; valorCents: number; conta: string }[]
): BandaRecebida[] {
  const bandas: BandaRecebida[] = Object.entries(porNatureza)
    .filter(([, v]) => v > 0)
    .map(([natureza, valorCents]) => ({ mes, natureza, valorCents, pix: null }));

  const usados = new Set<number>();
  // Maior primeiro: se dois valores coincidissem (não acontece na base
  // medida), o maior levaria o PIX e o menor ficaria sem — melhor do que
  // o reembolso "roubar" o salário quando os dois fossem iguais.
  for (const b of [...bandas].sort((a, c) => c.valorCents - a.valorCents)) {
    const i = pixDoMes.findIndex((p, idx) => !usados.has(idx) && p.valorCents === b.valorCents);
    if (i < 0) continue;
    usados.add(i);
    b.pix = { data: pixDoMes[i].data, conta: pixDoMes[i].conta };
  }
  return bandas.sort((a, c) => c.valorCents - a.valorCents);
}

function ListaRecebidos() {
  const { valor } = useOcultarValores();
  const { dado, erro, carregando } = useRecebiveis();
  const [busca, setBusca] = useState("");
  const [naturezas, setNaturezas] = useState<Set<string>>(new Set());
  const [periodo, setPeriodo] = useState("tudo");
  const [valorMin, setValorMin] = useState("");
  const [valorMax, setValorMax] = useState("");
  const [ordem, setOrdem] = useState<"recente" | "antigo" | "valor_desc" | "valor_asc">("recente");
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  const linhas = useMemo(() => dado?.linhas ?? [], [dado]);

  const todasBandas = useMemo(() => {
    if (!dado) return [] as BandaRecebida[];
    const pixPorMes = new Map<string, { data: string; valorCents: number; conta: string }[]>();
    for (const l of linhas) {
      const a = pixPorMes.get(l.mes) ?? [];
      a.push({ data: l.data, valorCents: l.valorCents, conta: l.conta });
      pixPorMes.set(l.mes, a);
    }
    const out: BandaRecebida[] = [];
    for (const m of dado.porMes) {
      out.push(...bandasDoMes(m.mes, m.porNatureza, pixPorMes.get(m.mes) ?? []));
    }
    return out;
  }, [dado, linhas]);

  const filtradas = useMemo(() => {
    const t = semAcento(busca.trim());
    const min = valorMin ? centavosDoTexto(valorMin) : null;
    const max = valorMax ? centavosDoTexto(valorMax) : null;
    const lista = todasBandas.filter((b) => {
      if (naturezas.size > 0 && !naturezas.has(b.natureza)) return false;
      const dataRef = b.pix?.data ?? `${b.mes}-01`;
      if (!dataNoPeriodo(dataRef, periodo)) return false;
      if (min !== null && b.valorCents < min) return false;
      if (max !== null && b.valorCents > max) return false;
      if (!t) return true;
      return (
        semAcento(ROTULO_REC[b.natureza] ?? b.natureza).includes(t) ||
        semAcento(b.pix?.conta ?? "").includes(t)
      );
    });

    return [...lista].sort((a, b) => {
      if (ordem === "valor_desc") return b.valorCents - a.valorCents;
      if (ordem === "valor_asc") return a.valorCents - b.valorCents;
      if (ordem === "antigo") {
        const cmp = a.mes.localeCompare(b.mes);
        return cmp !== 0 ? cmp : b.valorCents - a.valorCents;
      }
      const cmp = b.mes.localeCompare(a.mes);
      return cmp !== 0 ? cmp : b.valorCents - a.valorCents;
    });
  }, [todasBandas, busca, naturezas, periodo, valorMin, valorMax, ordem]);

  const totalFiltrado = filtradas.reduce((s, b) => s + b.valorCents, 0);

  const porData = ordem === "recente" || ordem === "antigo";
  const grupos = useMemo(() => {
    if (!porData) return [];
    const m = new Map<string, { mes: string; cents: number; bandas: BandaRecebida[] }>();
    for (const b of filtradas) {
      const g = m.get(b.mes) ?? { mes: b.mes, cents: 0, bandas: [] };
      g.cents += b.valorCents;
      g.bandas.push(b);
      m.set(b.mes, g);
    }
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
  if (!dado || (linhas.length === 0 && todasBandas.length === 0)) {
    return <p className="time-sub envios-vazio">A casa ainda não te pagou nada em 2026 — ou o pagamento ainda não foi categorizado.</p>;
  }

  const desdeMes =
    dado.porMes.length > 0 ? dado.porMes[0].mes : linhas.length > 0 ? linhas[linhas.length - 1].mes : null;

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
            placeholder="Natureza ou conta"
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
            {filtradas.length}/{todasBandas.length}
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
            <strong>{valor(totalFiltrado, filtradas.every((b) => b.natureza === "reembolso"))}</strong>
            <span>
              {qtdFiltros > 0
                ? `em ${filtradas.length} parte${filtradas.length === 1 ? "" : "s"} filtrada${filtradas.length === 1 ? "" : "s"}`
                : `em ${filtradas.length} parte${filtradas.length === 1 ? "" : "s"}${desdeMes ? `, desde ${formatMesRef(desdeMes)}` : ""}`}
            </span>
          </p>
          {/*
            AGRUPADO POR MÊS — mas só quando a ordem é por data.

            Cada linha é uma BANDA da folha (salário, pró-labore, reembolso…),
            não um PIX do ledger. Ordenado por VALOR o agrupamento mentiria
            (faixas fora de ordem cronológica com "total de março" no meio).
          */}
          {porData ? (
            grupos.map((g) => (
              <section key={g.mes} className="hist-rec-mes">
                <h3>
                  {nomeMesRec(g.mes).charAt(0).toUpperCase() + nomeMesRec(g.mes).slice(1)}
                  <b>{valor(g.cents, g.bandas.every((b) => b.natureza === "reembolso"))}</b>
                </h3>
                <ul className="hist-rec-bandas">
                  {g.bandas.map((b) => (
                    <li key={`${b.mes}-${b.natureza}`}>
                      <i className={`rec-ponto ${CLASSE_REC[b.natureza] ?? "nat-encargo"}`} aria-hidden />
                      <span className="hist-rec-banda-nome">
                        {ROTULO_REC[b.natureza] ?? b.natureza}
                        {b.pix ? (
                          <span className="hist-rec-banda-meta">
                            {b.pix.conta} · {b.pix.data.slice(8, 10)}/{b.pix.data.slice(5, 7)}
                          </span>
                        ) : null}
                      </span>
                      <span className="hist-rec-banda-valor">{valor(b.valorCents, b.natureza === "reembolso")}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <ul className="hist-rec-bandas hist-rec-bandas-corrida">
              {filtradas.map((b) => (
                <li key={`${b.mes}-${b.natureza}-${b.valorCents}`}>
                  <i className={`rec-ponto ${CLASSE_REC[b.natureza] ?? "nat-encargo"}`} aria-hidden />
                  <span className="hist-rec-banda-nome">
                    {ROTULO_REC[b.natureza] ?? b.natureza}
                    <span className="hist-rec-banda-meta">
                      {nomeMesRec(b.mes).charAt(0).toUpperCase() + nomeMesRec(b.mes).slice(1)}
                      {b.pix ? ` · ${b.pix.conta}` : ""}
                    </span>
                  </span>
                  <span className="hist-rec-banda-valor">{valor(b.valorCents, b.natureza === "reembolso")}</span>
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
    let lista = envios.filter((e) => {
      if (grupoFiltro && e.grupoChave !== grupoFiltro) return false;
      if (tipo && e.origem !== tipo) return false;
      if (estadoFiltro && e.statusExtrato !== estadoFiltro) return false;
      if (!envioNoPeriodo(e, periodo)) return false;
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
  // Do Início, #status-aguardando / #status-nao_pago já aplica o filtro de status.
  const hashAbertoRef = useRef(false);
  useEffect(() => {
    if (hashAbertoRef.current) return;
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (!hash) return;

    const status = /^status-(registrado|aguardando|pago|nao_pago)$/.exec(hash);
    if (status) {
      hashAbertoRef.current = true;
      setEstadoFiltro(status[1]);
      setFiltrosAbertos(true);
      return;
    }

    if (envios.length === 0) return;
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
    /*
     * O vazio de "Enviei" é a experiência PADRÃO, não a exceção:
     * `fin_time_envio` tem uma linha na base inteira, então 27 das 28 pessoas
     * abrem o Histórico e caem exatamente aqui.
     *
     * Antes era uma frase solta e mil pixels de branco — sem dizer o que é
     * "enviar", sem caminho para fazer o primeiro. As duas portas abaixo são
     * as mesmas duas ações da barra inferior, mas aqui elas respondem à
     * pergunta que a tela vazia levanta, em vez de deixá-la no ar.
     */
    return (
      <div className="envios-vazio-caixa">
        <strong>Você ainda não enviou nada</strong>
        <p>
          Aqui fica o que você manda para o financeiro: compras que já fez, reembolsos que pediu e pedidos de compra.
          Do lado, em <b>Recebi</b>, fica o que a casa já te pagou.
        </p>
        <div className="envios-vazio-portas">
          <Link href="/time/custo" className="time-botao">
            Registrar uma compra
          </Link>
          <Link href="/time/reembolso" className="time-botao secundario">
            Pedir um reembolso
          </Link>
        </div>
      </div>
    );
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
        <div className="envios-tabela" role="list" aria-label="Extrato de envios">
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
