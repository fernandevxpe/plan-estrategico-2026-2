"use client";

import { useCallback, useEffect, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";

import type { CadastroAppPessoa, CartaoPessoaResumo } from "@/lib/financeiro/pessoa-cadastro-app";
import { urlDaOrigem } from "@/lib/url-origem";

import { corDoCartao, TINTA_DO_PLASTICO } from "./FinCartaoPainelTopo";

const PIX_TIPOS = [
  { id: "cpf", rotulo: "CPF" },
  { id: "cnpj", rotulo: "CNPJ" },
  { id: "email", rotulo: "E-mail" },
  { id: "telefone", rotulo: "Telefone" },
  { id: "aleatoria", rotulo: "Aleatória" }
] as const;

const STATUS_CARTAO: Record<string, string> = {
  ativo: "ativo",
  historico: "histórico",
  cancelado: "cancelado"
};

/** Mesma regra do servidor — fácil de ditar no WhatsApp. */
function senhaFacil(personId: number): string {
  return `XPE123${String(personId % 1000).padStart(3, "0")}`;
}

type Props = {
  personId: number;
  nome: string;
  onSalvo?: () => void;
};

export function FinPessoaCadastroApp({ personId, nome, onSalvo }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [definindoSenha, setDefinindoSenha] = useState(false);
  const [criandoAcesso, setCriandoAcesso] = useState(false);

  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [pixTipo, setPixTipo] = useState("cpf");
  const [pixChave, setPixChave] = useState("");
  const [recebeSalario, setRecebeSalario] = useState(true);
  const [recebeReembolso, setRecebeReembolso] = useState(true);
  const [senhaNova, setSenhaNova] = useState("");
  const [cartoes, setCartoes] = useState<CartaoPessoaResumo[]>([]);
  const [senhaInfo, setSenhaInfo] = useState<CadastroAppPessoa["senha"] | null>(null);
  const [pendencias, setPendencias] = useState<CadastroAppPessoa["pendencias"] | null>(null);

  const preencher = useCallback((dados: CadastroAppPessoa) => {
    setEmail(dados.email ?? "");
    setCpf(dados.cpf ?? "");
    setWhatsapp(dados.whatsapp ?? "");
    setBirthDate(dados.birthDate ?? "");
    setPixTipo(dados.pagamento?.pixTipo ?? "cpf");
    setPixChave(dados.pagamento?.pixChave ?? "");
    setRecebeSalario(dados.pagamento?.recebeSalario !== false);
    setRecebeReembolso(dados.pagamento?.recebeReembolso !== false);
    setCartoes(dados.cartoes);
    setSenhaInfo(dados.senha);
    setPendencias(dados.pendencias);
    if (!dados.senha.temSenha) {
      setSenhaNova(senhaFacil(dados.personId));
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);
    void (async () => {
      try {
        const resposta = await fetch(urlDaOrigem(`/api/financeiro/pessoas/${personId}/cadastro-app`));
        const corpo = await resposta.json();
        if (!resposta.ok) {
          if (vivo) setErro(corpo.error ?? "não carregou o cadastro do app");
          return;
        }
        if (vivo) preencher(corpo as CadastroAppPessoa);
      } catch (falha) {
        if (vivo) setErro(falha instanceof Error ? falha.message : "não carregou");
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [personId, preencher]);

  function corpoSalvar() {
    return {
      email: email.trim() || null,
      cpf: cpf.trim() || null,
      whatsapp: whatsapp.trim() || null,
      birthDate: birthDate || null,
      pagamento: {
        metodo: "pix",
        pixTipo,
        pixChave,
        recebeSalario,
        recebeReembolso
      }
    };
  }

  async function salvarCadastro() {
    setErro(null);
    setAviso(null);
    setSalvando(true);
    try {
      const resposta = await fetch(urlDaOrigem(`/api/financeiro/pessoas/${personId}/cadastro-app`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpoSalvar())
      });
      const corpo = await resposta.json();
      if (!resposta.ok) {
        setErro(corpo.error ?? "não salvou");
        return;
      }
      preencher(corpo as CadastroAppPessoa);
      setAviso("Cadastro do app salvo.");
      onSalvo?.();
      startTransition(() => router.refresh());
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "não salvou");
    } finally {
      setSalvando(false);
    }
  }

  async function definirSenha(senha: string) {
    const resposta = await fetch(urlDaOrigem(`/api/financeiro/pessoas/${personId}/senha-app`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha })
    });
    const corpo = await resposta.json();
    if (!resposta.ok) throw new Error(corpo.error ?? "não definiu a senha");
    const relido = await fetch(urlDaOrigem(`/api/financeiro/pessoas/${personId}/cadastro-app`));
    const dados = await relido.json();
    if (relido.ok) preencher(dados as CadastroAppPessoa);
    return senha;
  }

  async function acaoDefinirSenha() {
    const senha = senhaNova.trim() || senhaFacil(personId);
    if (!senha.trim()) {
      setErro("Informe a senha de entrega.");
      return;
    }
    setErro(null);
    setAviso(null);
    setDefinindoSenha(true);
    try {
      await definirSenha(senha);
      setAviso(`Senha de entrega: ${senha} — copie e envie; a pessoa troca no primeiro login.`);
      onSalvo?.();
      startTransition(() => router.refresh());
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "não definiu a senha");
    } finally {
      setDefinindoSenha(false);
    }
  }

  async function criarAcesso() {
    if (!email.trim()) {
      setErro("Informe o e-mail — é o login do app.");
      return;
    }
    setErro(null);
    setAviso(null);
    setCriandoAcesso(true);
    const senha = senhaNova.trim() || senhaFacil(personId);
    try {
      const patch = await fetch(urlDaOrigem(`/api/financeiro/pessoas/${personId}/cadastro-app`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpoSalvar())
      });
      const patchCorpo = await patch.json();
      if (!patch.ok) {
        setErro(patchCorpo.error ?? "não salvou o cadastro");
        return;
      }
      preencher(patchCorpo as CadastroAppPessoa);
      await definirSenha(senha);
      setAviso(
        `Acesso criado. Login: ${email.trim().toLowerCase()} · Senha: ${senha} — envie pelo WhatsApp; troca obrigatória no 1º login.`
      );
      onSalvo?.();
      startTransition(() => router.refresh());
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "não criou o acesso");
    } finally {
      setCriandoAcesso(false);
    }
  }

  if (carregando) {
    return <p className="fin-card-hint fin-pessoa-cadastro-app-carregando">Carregando cadastro do app…</p>;
  }

  const faltaSenha = !senhaInfo?.temSenha;

  return (
    <div className="fin-pessoa-cadastro-app" role="group" aria-label={`App do time — ${nome}`}>
      <div className="fin-pessoa-cadastro-app-topo">
        <div>
          <h4 className="fin-pessoa-cadastro-app-titulo">App do time</h4>
          <p className="fin-card-hint fin-pessoa-cadastro-app-sub">
            Contato, PIX e senha de entrega — o que a pessoa preenche em Meu perfil, editável pelo admin.
          </p>
        </div>
        {faltaSenha ? (
          <button
            type="button"
            className="fin-btn-primary fin-pessoa-cadastro-app-criar"
            disabled={criandoAcesso || !email.trim()}
            onClick={() => void criarAcesso()}
          >
            {criandoAcesso ? "Criando…" : "Criar acesso"}
          </button>
        ) : null}
      </div>

      {erro ? (
        <div className="fin-alert" role="alert">
          {erro}
        </div>
      ) : null}
      {aviso ? (
        <div className="fin-alert fin-pessoa-cadastro-app-aviso" role="status">
          {aviso}
        </div>
      ) : null}

      {pendencias &&
      (pendencias.whatsapp ||
        pendencias.email ||
        pendencias.cpf ||
        pendencias.pix ||
        pendencias.nascimento ||
        pendencias.senha) ? (
        <p className="fin-card-hint fin-pessoa-cadastro-app-pendencias">
          Falta:{" "}
          {[
            pendencias.email ? "e-mail" : null,
            pendencias.cpf ? "CPF" : null,
            pendencias.whatsapp ? "WhatsApp" : null,
            pendencias.nascimento ? "aniversário" : null,
            pendencias.pix ? "PIX" : null,
            pendencias.senha ? "senha do app" : null
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}

      <div className="fin-pessoa-cadastro-app-grid">
        <fieldset className="fin-pessoa-cadastro-app-bloco">
          <legend>Quem é</legend>
          <label className="fin-field">
            <span>E-mail (login do app)</span>
            <input
              className="fin-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@exemplo.com"
              autoComplete="off"
            />
          </label>
          <label className="fin-field">
            <span>CPF</span>
            <input
              className="fin-input"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              placeholder="000.000.000-00"
              inputMode="numeric"
              autoComplete="off"
            />
          </label>
          <label className="fin-field">
            <span>WhatsApp</span>
            <input
              className="fin-input"
              type="tel"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="(81) 99999-9999"
              inputMode="tel"
            />
          </label>
          <label className="fin-field">
            <span>Aniversário</span>
            <input
              className="fin-input"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
          </label>
        </fieldset>

        <fieldset className="fin-pessoa-cadastro-app-bloco">
          <legend>Chave PIX</legend>
          <div className="fin-pessoa-cadastro-app-chips" role="group" aria-label="Tipo da chave PIX">
            {PIX_TIPOS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={pixTipo === t.id ? "chip ativo" : "chip"}
                aria-pressed={pixTipo === t.id}
                onClick={() => setPixTipo(t.id)}
              >
                {t.rotulo}
              </button>
            ))}
          </div>
          <label className="fin-field fin-field-wide">
            <span>Chave</span>
            <input
              className="fin-input"
              value={pixChave}
              onChange={(e) => setPixChave(e.target.value)}
              inputMode={pixTipo === "email" || pixTipo === "aleatoria" ? "text" : "numeric"}
              placeholder={
                pixTipo === "cpf"
                  ? "000.000.000-00"
                  : pixTipo === "cnpj"
                    ? "00.000.000/0000-00"
                    : pixTipo === "telefone"
                      ? "(81) 99999-9999"
                      : pixTipo === "email"
                        ? "voce@exemplo.com"
                        : "chave aleatória"
              }
            />
          </label>
          <div className="fin-pessoa-cadastro-app-checks">
            <label className="fin-check">
              <input
                type="checkbox"
                checked={recebeSalario}
                onChange={(e) => setRecebeSalario(e.target.checked)}
              />
              <span>Recebe salário nesta chave</span>
            </label>
            <label className="fin-check">
              <input
                type="checkbox"
                checked={recebeReembolso}
                onChange={(e) => setRecebeReembolso(e.target.checked)}
              />
              <span>Recebe reembolso nesta chave</span>
            </label>
          </div>
        </fieldset>

        <fieldset className="fin-pessoa-cadastro-app-bloco">
          <legend>Senha de entrega</legend>
          {senhaInfo?.temSenha ? (
            <p className="fin-card-hint">
              Senha definida
              {senhaInfo.definidaEm ? ` em ${senhaInfo.definidaEm.split("-").reverse().join("/")}` : ""}
              {senhaInfo.trocarNaEntrada ? " · troca na primeira entrada" : ""}
            </p>
          ) : (
            <p className="fin-card-hint fin-badge-atencao">
              Sem senha — use &quot;Criar acesso&quot; ou defina abaixo. Padrão sugerido: {senhaFacil(personId)}.
            </p>
          )}
          <label className="fin-field fin-field-wide">
            <span>Senha para enviar à pessoa</span>
            <input
              className="fin-input fin-pessoa-cadastro-app-senha"
              type="text"
              value={senhaNova}
              onChange={(e) => setSenhaNova(e.target.value)}
              placeholder={senhaFacil(personId)}
              autoComplete="off"
              spellCheck={false}
            />
            <em className="fin-field-hint">
              Texto visível de propósito — você copia e manda no WhatsApp. Padrão fácil: XPE123 + 3 dígitos.
            </em>
          </label>
          <div className="fin-pessoa-cadastro-app-senha-acoes">
            <button
              type="button"
              className="fin-btn-secondary"
              onClick={() => setSenhaNova(senhaFacil(personId))}
            >
              Usar {senhaFacil(personId)}
            </button>
            <button
              type="button"
              className="fin-btn-secondary"
              disabled={definindoSenha}
              onClick={() => void acaoDefinirSenha()}
            >
              {definindoSenha ? "Definindo…" : "Só definir senha"}
            </button>
          </div>
        </fieldset>
      </div>

      <div className="fin-import-acoes">
        <button type="button" className="fin-btn-primary" disabled={salvando} onClick={() => void salvarCadastro()}>
          {salvando ? "Salvando…" : "Salvar cadastro"}
        </button>
      </div>

      {cartoes.length ? (
        <div className="fin-pessoa-cadastro-app-cartoes">
          <p>
            <strong>Cartões usados ({cartoes.length})</strong>
            <span className="fin-card-hint fin-pessoa-cadastro-app-cartoes-hint">
              Só os 4 últimos dígitos — o número completo nunca fica guardado.
            </span>
          </p>
          <div className="fin-pessoa-cartoes-row">
            {cartoes.map((c) => (
              <CartaoMiniPessoa key={c.id} cartao={c} />
            ))}
          </div>
        </div>
      ) : (
        <p className="fin-card-hint">Nenhum cartão cadastrado em nome desta pessoa ainda.</p>
      )}
    </div>
  );
}

function CartaoMiniPessoa({ cartao }: { cartao: CartaoPessoaResumo }) {
  const hex = cartao.cor ? TINTA_DO_PLASTICO[cartao.cor] : null;
  const corSerie = corDoCartao(cartao.id, cartao.cor);
  const inativo = cartao.status === "historico" || cartao.status === "cancelado";
  const estilo = {
    "--fin-cartao-plast-serie": corSerie,
    ...(hex ? { "--fin-cartao-plast-cor": hex } : {})
  } as CSSProperties;

  return (
    <article
      className="fin-cartao-plast-card fin-pessoa-cartao-mini"
      style={estilo}
      data-inativo={inativo ? "sim" : "nao"}
      data-sem-cor={hex ? "nao" : "sim"}
    >
      <span className="fin-cartao-plast-tarja" aria-hidden />
      <div className="fin-cartao-plast-conteudo">
        <div className="fin-cartao-plast-ident">
          <div className="fin-cartao-plast-nome">
            <span className="fin-cartao-plast-ponto" aria-hidden />
            {cartao.apelido ? (
              <>
                <strong className="fin-cartao-plast-apelido">{cartao.apelido}</strong>
                {cartao.last4 ? <span className="fin-cartao-plast-final">•••• {cartao.last4}</span> : null}
              </>
            ) : cartao.last4 ? (
              <strong className="fin-cartao-plast-final fin-cartao-plast-final-titulo">•••• {cartao.last4}</strong>
            ) : (
              <strong className="fin-cartao-plast-apelido">sem final</strong>
            )}
          </div>
          <div className="fin-pessoa-cartao-mini-meta">
            {cartao.bandeira ? <span className="fin-tag">{cartao.bandeira}</span> : null}
            {cartao.tipo ? <span className="fin-tag">{cartao.tipo}</span> : null}
            <span className="fin-tag">{STATUS_CARTAO[cartao.status] ?? cartao.status}</span>
            {cartao.cadastradoPeloTime ? (
              <span className="fin-tag" title="Cadastrado pelo app do time">
                time
              </span>
            ) : cartao.linhaNome ? (
              <span className="fin-tag">{cartao.linhaNome}</span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
