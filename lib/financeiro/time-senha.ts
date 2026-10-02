import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { query, queryOne, transaction } from "@/lib/financeiro/db";
import { TimeError, hashDeSenha } from "@/lib/financeiro/time";

/**
 * "Esqueci minha senha" do app do time — por link no e-mail (0196).
 *
 * Antes, quem esquecia a senha lia "Peça ao Fernando ou ao Igor" e esperava. Em
 * 02/10/2026 a Audrey passou o dia sem entrar, com 4 tentativas erradas.
 *
 * O PEDIDO NÃO MUDA NADA. Ele é anônimo — um e-mail digitado num formulário
 * aberto —, então trocar a senha ali deixaria qualquer um trancar um colega para
 * fora. O pedido só gera um link; a senha muda quando alguém abre a caixa de
 * entrada e escolhe outra.
 *
 * Nenhuma função daqui recebe pessoa: o escopo vem do e-mail (pedido) ou do
 * token (redefinição), a mesma disciplina que `scripts/test-perfil-guard.mjs`
 * impõe em toda a superfície de `/api/time`.
 */

const ENTITY = "xpe";
const VALIDADE_MIN = 30;
/** Um pedido por pessoa a cada 2 minutos: o botão apertado três vezes não manda três e-mails. */
const INTERVALO_MIN_SEG = 120;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/*
 * O endereço do link vem do AMBIENTE, nunca do cabeçalho `Host` da requisição.
 * O pedido é anônimo: montar o link com o Host que ele mandou deixaria um
 * atacante pedir a recuperação de um colega e fazê-lo receber, do remetente
 * legítimo, um link para o domínio do atacante — com o token dentro.
 *
 * `APP_URL` não serve: no `.env.local` ele ainda aponta para um deploy antigo
 * da Vercel. Por isso uma variável própria, com a produção como padrão.
 */
function baseDoLink(): string {
  return (process.env.TIME_APP_URL || "https://plataforma-gestao.xpeconsultoria.com").replace(/\/+$/, "");
}

/**
 * Pede o link. Devolve SEMPRE o mesmo resultado, exista o e-mail ou não: a
 * resposta diferente seria a lista de e-mails do time aberta na internet — o
 * mesmo motivo de `autenticar` responder "e-mail ou senha incorretos" para os
 * dois casos.
 */
export async function pedirRecuperacaoDeSenha(email: string, userAgent: string | null): Promise<void> {
  const alvo = String(email ?? "").trim().toLowerCase();
  if (!alvo || !alvo.includes("@") || alvo.length > 200) throw new TimeError("informe o seu e-mail", 400);

  const pessoa = await queryOne<{ id: number; name: string; email: string }>(
    `SELECT p.id, p.name, p.email
       FROM fin_person p
       JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $2
       JOIN fin_person_acesso a ON a.person_id = p.id AND a.status = 'ativo'
      WHERE lower(p.email) = $1 AND p.status = 'ativo'`,
    [alvo, ENTITY]
  );
  if (!pessoa) return;

  const recente = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM fin_time_senha_token
      WHERE person_id = $1 AND criado_em > now() - ($2 || ' seconds')::interval`,
    [pessoa.id, INTERVALO_MIN_SEG]
  );
  if ((recente?.n ?? 0) > 0) return;

  const token = randomBytes(32).toString("base64url");
  await query(
    `INSERT INTO fin_time_senha_token (person_id, token_sha256, expira_em, pedido_de)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval, $4)`,
    [pessoa.id, sha256(token), VALIDADE_MIN, userAgent ? userAgent.slice(0, 300) : null]
  );

  const link = `${baseDoLink()}/time?redefinir=${token}`;
  const primeiroNome = pessoa.name.split(" ")[0];
  await enviarEmail({
    para: pessoa.email,
    assunto: "Redefinir sua senha — app XPE",
    texto:
      `Olá, ${primeiroNome}.\n\n` +
      `Para criar uma senha nova no app do time da XPE, abra este link:\n\n${link}\n\n` +
      `Ele vale por ${VALIDADE_MIN} minutos e só pode ser usado uma vez.\n` +
      `Se não foi você que pediu, ignore este e-mail: a sua senha atual continua valendo.\n`,
    html:
      `<p>Olá, ${escaparHtml(primeiroNome)}.</p>` +
      `<p>Para criar uma senha nova no app do time da XPE, toque no botão:</p>` +
      `<p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#7c3aed;color:#fff;` +
      `border-radius:8px;text-decoration:none;font-weight:600">Criar nova senha</a></p>` +
      `<p style="color:#666;font-size:13px">O link vale por ${VALIDADE_MIN} minutos e só pode ser usado uma vez.<br>` +
      `Se não foi você que pediu, ignore este e-mail: a sua senha atual continua valendo.</p>`
  });
}

/**
 * Troca a senha com o token do e-mail. Depois disso todas as sessões da pessoa
 * caem — quem pediu recuperação pode estar desconfiando de um acesso — e ela
 * entra de novo com a senha nova.
 */
export async function redefinirSenhaComToken(token: string, nova: string): Promise<void> {
  const bruto = String(token ?? "").trim();
  const senha = String(nova ?? "");
  if (!bruto) throw new TimeError("link inválido — peça um novo", 400);
  if (senha.length < 8) throw new TimeError("a nova senha precisa de pelo menos 8 caracteres", 422);

  const hashNovo = await hashDeSenha(senha);

  await transaction(async (client) => {
    const { rows } = await client.query<{ id: number; person_id: number }>(
      `SELECT id, person_id FROM fin_time_senha_token
        WHERE token_sha256 = $1 AND usado_em IS NULL AND expira_em > now()
        FOR UPDATE`,
      [sha256(bruto)]
    );
    const alvo = rows[0];
    if (!alvo) throw new TimeError("este link expirou ou já foi usado — peça um novo", 410);

    await client.query(
      `UPDATE fin_person_acesso
          SET senha_hash = $2, senha_set_at = now(), senha_set_by = 'a própria pessoa (link do e-mail)',
              senha_trocar = false, falhas = 0, bloqueado_ate = NULL
        WHERE person_id = $1`,
      [alvo.person_id, hashNovo]
    );
    // O link usado e qualquer outro aberto da mesma pessoa morrem juntos.
    await client.query(
      `UPDATE fin_time_senha_token SET usado_em = now()
        WHERE person_id = $1 AND usado_em IS NULL`,
      [alvo.person_id]
    );
    await client.query(
      `UPDATE fin_time_sessao SET encerrada_em = now()
        WHERE person_id = $1 AND encerrada_em IS NULL`,
      [alvo.person_id]
    );
  });
}

async function enviarEmail(m: { para: string; assunto: string; texto: string; html: string }): Promise<void> {
  const chave = process.env.RESEND_API_KEY;
  const de = process.env.EMAIL_REMETENTE;
  if (!chave || !de) {
    // Falha alta e no log, não na resposta: a resposta é igual para todos.
    console.error("[time-senha] RESEND_API_KEY ou EMAIL_REMETENTE ausente — e-mail de recuperação não enviado");
    return;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: de, to: [m.para], subject: m.assunto, text: m.texto, html: m.html })
  });
  if (!r.ok) {
    const corpo = await r.text().catch(() => "");
    console.error(`[time-senha] Resend recusou o envio: ${r.status} ${corpo.slice(0, 300)}`);
  }
}

function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
