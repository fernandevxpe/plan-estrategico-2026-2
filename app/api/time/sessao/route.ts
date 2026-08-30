import { cookies, headers } from "next/headers";

import { respostaDeErro, sessaoAtual } from "@/app/api/time/_sessao";
import { CABECALHO_PORTA, type Porta } from "@/lib/auth/perfis";
import {
  COOKIE_SESSAO,
  TimeError,
  abrirSessao,
  autenticar,
  encerrarSessao,
  listarPessoas,
  schemaTimeDisponivel,
  type Sessao
} from "@/lib/financeiro/time";

/**
 * Quem está usando o app do time.
 *
 * GET    — a sessão atual (ou null). A lista de pessoas só acompanha quando a
 *          porta é `basic`; ver abaixo.
 * POST   — abre a sessão. Dois caminhos, e não é gosto:
 *            · e-mail + senha       — sempre aceito
 *            · personId (+ pin)     — só pela porta `basic`
 * DELETE — encerra.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O CAMINHO DECLARADO SOBREVIVE, E POR QUE ELE É RESTRITO
 * ---------------------------------------------------------------------------
 * Declarar quem se é (clicar no próprio nome numa lista) nunca foi prova de
 * identidade, e o produto sempre disse isso em voz alta — `prova='declarada'`
 * fica gravado em cada envio. Isso era proporcional enquanto o Basic Auth da
 * plataforma ficava na frente: a credencial compartilhada já provava "alguém do
 * time", e a lista de nomes era visível para quem tivesse a senha de qualquer
 * jeito.
 *
 * Agora `/api/time` é isento do Basic, para o app instalável funcionar. Pela
 * porta nova não há credencial compartilhada por trás — declarar quem se é
 * viraria "escolha de quem você quer ser". Por isso:
 *
 *   · porta `basic`  → declarado continua valendo (ninguém do time perde acesso
 *                      hoje), e a lista de pessoas acompanha o GET;
 *   · porta `sessao` → só e-mail e senha, e o GET **não devolve a lista**.
 *
 * A lista fora do GET não é detalhe: ela é o cadastro de quem trabalha aqui, e
 * devolvê-la sem credencial nenhuma transformaria o login num diretório da
 * empresa aberto na internet.
 */

export const dynamic = "force-dynamic";

/**
 * Falha para o lado FECHADO. `basic` é privilégio (libera o login declarado e a
 * lista de pessoas), então ele só existe quando o middleware afirmou que a
 * credencial compartilhada foi conferida. Ausência de cabeçalho — middleware
 * que não rodou, chamada interna, adaptador futuro — vale `sessao`.
 */
async function porta(): Promise<Porta> {
  return (await headers()).get(CABECALHO_PORTA) === "basic" ? "basic" : "sessao";
}

export async function GET() {
  try {
    if (!(await schemaTimeDisponivel())) {
      return Response.json({
        disponivel: false,
        motivo: "migration 0105 não aplicada neste ambiente",
        sessao: null,
        pessoas: [],
        porta: await porta()
      });
    }
    const via = await porta();
    const sessao = await sessaoAtual();
    // Sem sessão e sem Basic: nada de lista. Com sessão, a pessoa já provou
    // quem é — e a lista é o que o formulário de reembolso de terceiro usa.
    const pessoas = via === "basic" || sessao ? await listarPessoas() : [];
    return Response.json({ disponivel: true, motivo: null, sessao, pessoas, porta: via });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}

export async function POST(request: Request) {
  try {
    if (!(await schemaTimeDisponivel())) {
      throw new TimeError("o app do time ainda não foi liberado neste ambiente (migration 0105 não aplicada)", 503);
    }
    const corpo = (await request.json().catch(() => ({}))) as {
      email?: unknown;
      senha?: unknown;
      personId?: unknown;
      pin?: unknown;
    };
    const userAgent = request.headers.get("user-agent");

    const email = typeof corpo.email === "string" ? corpo.email.trim() : "";
    const senha = typeof corpo.senha === "string" ? corpo.senha : "";

    let resultado: { token: string; sessao: Sessao };
    if (email || senha) {
      resultado = await autenticar(email, senha, userAgent);
    } else {
      if ((await porta()) !== "basic" && process.env.NODE_ENV !== "development") {
        throw new TimeError("entre com e-mail e senha", 401);
      }
      const personId = Number(corpo.personId);
      const pin = typeof corpo.pin === "string" && corpo.pin.trim() ? corpo.pin.trim() : null;
      resultado = await abrirSessao(personId, pin, userAgent);
    }

    // httpOnly: o token não precisa ser lido por JavaScript nenhum, e não sendo
    // legível ele não vaza por XSS. sameSite=lax: o app é navegado, não
    // embutido em terceiro.
    (await cookies()).set(COOKIE_SESSAO, resultado.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    });

    return Response.json({ ok: true, sessao: resultado.sessao });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}

export async function DELETE() {
  try {
    const jar = await cookies();
    await encerrarSessao(jar.get(COOKIE_SESSAO)?.value ?? null);
    jar.delete(COOKIE_SESSAO);
    return Response.json({ ok: true });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
