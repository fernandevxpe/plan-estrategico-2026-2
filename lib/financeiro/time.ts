import "server-only";

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import { FinanceUnavailableError, query, queryOne, transaction } from "@/lib/financeiro/db";

/**
 * O app do time — a camada de servidor.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE MÓDULO PODE E O QUE ELE NÃO PODE
 * ---------------------------------------------------------------------------
 * Ele é o ÚNICO caminho de escrita que o perfil comum tem nesta plataforma.
 * Até aqui o time só lia. Por isso a lista do que ele não faz importa mais que
 * a do que ele faz:
 *
 *   · não lê saldo, DRE, folha, margem, tributo, nem o envio de outra pessoa;
 *   · não escreve em fin_transaction, fin_account nem fin_document;
 *   · não decide nada — tudo que entra por aqui nasce aguardando um humano.
 *
 * A escolha de arquitetura que sustenta isso: **nenhuma função deste arquivo
 * aceita `personId` do cliente.** Toda leitura e toda escrita recebem uma
 * `Sessao` já resolvida a partir do cookie, e o `person_id` vem de lá. Um
 * parâmetro de pessoa na assinatura seria um parâmetro que alguém, um dia,
 * preenche com o valor que veio do formulário — e aí "cada um vê o que enviou"
 * vira uma frase.
 *
 * ---------------------------------------------------------------------------
 * A HONESTIDADE SOBRE A IDENTIDADE
 * ---------------------------------------------------------------------------
 * O Basic Auth desta plataforma tem DOIS pares: um de admin e um do time
 * inteiro. Uma credencial compartilhada autentica "alguém do time", nunca
 * "quem". Então:
 *
 *   · a pessoa DECLARA quem é, e isso vira uma sessão em banco (token opaco);
 *   · a declaração é escopo suficiente para separar as caixas de envio;
 *   · ela NÃO é prova de identidade, e o produto diz isso em voz alta —
 *     `prova = 'declarada'` fica gravado em cada envio;
 *   · se alguém cadastrar PIN em `fin_person_acesso` (nasce vazia), aquela
 *     pessoa passa a precisar do PIN e o envio grava `prova = 'pin'`.
 *
 * Chamar cookie de autenticação seria inventar evidência. Esta base não faz
 * isso com dinheiro; não vai fazer com identidade.
 */

const ENTITY = "xpe";

/** Nome do cookie da sessão do time. `__Host-` não dá porque a app roda sob path próprio em dev. */
export const COOKIE_SESSAO = "xpe_time_sessao";

/** Sessão longa de propósito: o app é usado com a mão suja, no meio da rua. */
const DIAS_DE_SESSAO = 30;

export class TimeError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "TimeError";
    this.status = status;
  }
}

const sha256 = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");

// ---------------------------------------------------------------------------
// O schema pode não estar aplicado
// ---------------------------------------------------------------------------
/**
 * A 0105 é entregue validada e NÃO aplicada (é a regra desta base: migração
 * validada não é migração aplicada). Até alguém aplicá-la, as telas do time têm
 * de dizer isso — e não estourar consulta contra tabela que não existe, que
 * apareceria como "o app do time está quebrado".
 */
export async function schemaTimeDisponivel(): Promise<boolean> {
  return (await estadoDoTime()).disponivel;
}

/**
 * Por que o app não está de pé — e a distinção não é preciosismo.
 *
 * `schemaTimeDisponivel` devolvia `false` tanto para "a migration não foi
 * aplicada" quanto para "o banco não respondeu", e a tela dizia sempre a
 * primeira. O proxy TCP do Railway derruba conexão sem avisar, então uma queda
 * de dois segundos aparecia para a pessoa como "migration 0105 não aplicada" —
 * uma frase que manda procurar o problema no lugar errado, e que num app do
 * time nem faz sentido para quem lê.
 */
export async function estadoDoTime(): Promise<{ disponivel: boolean; motivo: string | null }> {
  try {
    const r = await queryOne<{ ok: boolean }>(
      `SELECT (to_regclass('fin_time_envio') IS NOT NULL
           AND to_regclass('fin_time_sessao') IS NOT NULL
           AND to_regclass('fin_notificacao') IS NOT NULL) AS ok`
    );
    return r?.ok === true
      ? { disponivel: true, motivo: null }
      : { disponivel: false, motivo: "o schema do app do time ainda não foi aplicado neste banco" };
  } catch (erro) {
    if (erro instanceof FinanceUnavailableError) {
      return { disponivel: false, motivo: "o banco não respondeu agora — tente de novo em alguns segundos" };
    }
    throw erro;
  }
}

// ---------------------------------------------------------------------------
// Identidade
// ---------------------------------------------------------------------------

export type Pessoa = { id: number; nome: string; area: string | null; exigePin: boolean };

export type ProvaDeIdentidade = "declarada" | "pin" | "senha";

export type Sessao = {
  personId: number;
  nome: string;
  prova: ProvaDeIdentidade;
  admin: boolean;
  trocarSenha: boolean;
  expiraEm: string;
};

// ---------------------------------------------------------------------------
// Senha — scrypt, não sha256
// ---------------------------------------------------------------------------
/**
 * O PIN ao lado usa sha256(pin || salt), e para um PIN de 4 dígitos atrás do
 * Basic Auth compartilhado isso era proporcional. Senha exposta na internet
 * não é: sha256 é rápido de propósito, e é isso que a torna péssima aqui —
 * uma GPU testa bilhões por segundo contra um hash vazado.
 *
 * scrypt tem custo de memória e de tempo declarados. Os parâmetros viajam
 * dentro do próprio hash (`scrypt$N$r$p$salt$hash`) para que endurecer o custo
 * amanhã não invalide as senhas de hoje.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, tamanho: 32 } as const;

/**
 * Memória de sobra sobre o pior caso previsto.
 *
 * scrypt consome ~128 · N · r bytes. Com N=16384 e r=8 são 16 MiB; o teto de
 * 256 MiB acomoda N=262144 sem que endurecer o custo passe a LANÇAR — e lançar
 * aqui é pior que ser lento, porque `conferirSenha` engoliria a exceção e
 * devolveria `false`, trancando a pessoa com a mensagem "senha incorreta".
 */
const MAXMEM = 256 * 1024 * 1024;

/**
 * scrypt ASSÍNCRONO. A versão síncrona bloqueia o event loop inteiro por ~80ms
 * por tentativa — e como `/api/time/sessao` é alcançável sem credencial
 * nenhuma, um laço de `curl` anônimo travaria todas as rotas do processo,
 * inclusive o financeiro. Não é hipótese: o pool tem 5 conexões e é o mesmo.
 */
const scryptAsync = promisify(scrypt) as (
  senha: string | Buffer,
  salt: string | Buffer,
  tamanho: number,
  opcoes: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

export async function hashDeSenha(senha: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(senha.normalize("NFKC"), salt, SCRYPT.tamanho, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: MAXMEM
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * Comparação em tempo constante, e tolerante a hash malformado.
 *
 * `timingSafeEqual` estoura se os buffers tiverem tamanhos diferentes — o que
 * por si só já vazaria o comprimento. Por isso o tamanho esperado sai dos
 * parâmetros guardados, nunca do que está sendo comparado.
 *
 * A GUARDA DE COMPRIMENTO NÃO É PARANOIA. Sem ela, um `senha_hash` cujo último
 * segmento fosse um único caractere hex daria `esperado.length === 0`, scrypt
 * devolveria um buffer vazio, e `timingSafeEqual(<0>, <0>)` é **true** — senha
 * universal para aquela pessoa. `hashDeSenha` nunca produz essa forma, e o
 * CHECK do banco (`[0-9a-f]+`) a aceita: é exatamente o formato que um backdoor
 * teria. Tamanho errado é hash inválido, não hash fraco.
 */
export async function conferirSenha(senha: string, guardado: string | null): Promise<boolean> {
  if (!guardado) return false;
  const partes = guardado.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, hashHex] = partes;

  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (!Number.isInteger(N) || !Number.isInteger(R) || !Number.isInteger(P)) return false;
  if (N < 2 || (N & (N - 1)) !== 0 || R < 1 || P < 1) return false;

  let esperado: Buffer;
  try {
    esperado = Buffer.from(hashHex, "hex");
    if (esperado.length !== SCRYPT.tamanho) return false;
    const calculado = await scryptAsync(senha.normalize("NFKC"), Buffer.from(saltHex, "hex"), esperado.length, {
      N,
      r: R,
      p: P,
      maxmem: MAXMEM
    });
    return timingSafeEqual(calculado, esperado);
  } catch {
    return false;
  }
}

/**
 * Quem o time pode dizer que é.
 *
 * Só pessoas ATIVAS. `exigePin` é derivado da existência de linha em
 * `fin_person_acesso`: a tabela nasce vazia, então hoje ninguém exige PIN e
 * todo mundo entra declarando. Quando o Fernando decidir cadastrar, a mesma
 * tela passa a pedir a senha — sem deploy.
 */
export async function listarPessoas(): Promise<Pessoa[]> {
  const linhas = await query<{ id: number; name: string; area: string | null; exige_pin: boolean }>(
    `SELECT p.id, p.name, p.area,
            (a.pin_sha256 IS NOT NULL AND a.status = 'ativo') AS exige_pin
       FROM fin_person p
       JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $1
       LEFT JOIN fin_person_acesso a ON a.person_id = p.id
      WHERE p.status = 'ativo'
      ORDER BY p.name`,
    [ENTITY]
  );
  return linhas.map((l) => ({ id: Number(l.id), nome: l.name, area: l.area, exigePin: l.exige_pin }));
}

/**
 * Abre a sessão. Devolve o token em claro UMA vez — só o resumo fica no banco.
 *
 * O PIN é conferido quando existe. Note que a comparação é sobre o hash e que
 * o "não existe PIN" e o "PIN errado" produzem mensagens diferentes de
 * propósito: aqui não há o que esconder de quem já passou pelo Basic Auth do
 * time, e uma mensagem genérica só faria a pessoa achar que o app quebrou.
 */
export async function abrirSessao(personId: number, pin: string | null, userAgent: string | null) {
  if (!Number.isInteger(personId) || personId <= 0) throw new TimeError("escolha quem é você");

  return transaction(async (client) => {
    const pessoa = await client.query<{ id: number; name: string; is_admin: boolean }>(
      `SELECT p.id, p.name, p.is_admin FROM fin_person p
         JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $2
        WHERE p.id = $1 AND p.status = 'ativo'`,
      [personId, ENTITY]
    );
    if (!pessoa.rows[0]) throw new TimeError("pessoa não encontrada ou inativa", 404);

    // `pin_sha256 IS NOT NULL`, não "existe linha". Depois da 0134 uma linha
    // pode existir só com SENHA, e tratar isso como "tem PIN" trancava a pessoa
    // com a mensagem "PIN incorreto" — sobre um PIN que ela nunca teve.
    const acesso = await client.query<{ pin_sha256: string | null; pin_salt: string | null; status: string }>(
      `SELECT pin_sha256, pin_salt, status FROM fin_person_acesso
        WHERE person_id = $1 AND pin_sha256 IS NOT NULL AND pin_salt IS NOT NULL`,
      [personId]
    );

    let prova: "declarada" | "pin" = "declarada";
    if (acesso.rows[0]) {
      if (acesso.rows[0].status !== "ativo") throw new TimeError("acesso bloqueado — fale com o admin", 403);
      if (!pin) throw new TimeError("esta pessoa tem PIN cadastrado", 401);
      if (sha256(`${pin}${acesso.rows[0].pin_salt}`) !== acesso.rows[0].pin_sha256) {
        throw new TimeError("PIN incorreto", 401);
      }
      prova = "pin";
      await client.query(`UPDATE fin_person_acesso SET last_seen_at = now() WHERE person_id = $1`, [personId]);
    }

    const token = randomBytes(32).toString("base64url");
    const linha = await client.query<{ expira_em: Date }>(
      `INSERT INTO fin_time_sessao (token_sha256, person_id, prova, expira_em, user_agent)
       VALUES ($1, $2, $3, now() + ($4 || ' days')::interval, $5)
       RETURNING expira_em`,
      [sha256(token), personId, prova, String(DIAS_DE_SESSAO), userAgent?.slice(0, 300) ?? null]
    );

    return {
      token,
      sessao: {
        personId,
        nome: pessoa.rows[0].name,
        prova,
        admin: pessoa.rows[0].is_admin === true,
        trocarSenha: false,
        expiraEm: linha.rows[0].expira_em.toISOString()
      } satisfies Sessao
    };
  });
}

/**
 * Entrar com e-mail e senha. É este o caminho quando `/time` não está mais
 * atrás do Basic Auth.
 *
 * Três decisões que valem a explicação:
 *
 * 1. **A mensagem de erro é a mesma para e-mail inexistente e senha errada.**
 *    O caminho declarado (`abrirSessao`) podia distinguir, porque quem chegava
 *    lá já tinha passado pela credencial do time e a lista de pessoas era
 *    visível de qualquer jeito. Aqui não: mensagens diferentes transformam o
 *    login num confirmador de quem trabalha na empresa.
 *
 * 2. **O hash é conferido mesmo quando o e-mail não existe.** Sem isso, "não
 *    achei o e-mail" responde em 1ms e "senha errada" em ~80ms, e o relógio
 *    entrega a lista de endereços válidos sem nunca acertar uma senha.
 *
 * 3. **O bloqueio é por atraso progressivo, não permanente.** Conta travada
 *    para sempre por tentativa alheia é negação de serviço contra a própria
 *    pessoa — o inverso do que a trava deveria proteger.
 */
/**
 * Um hash real, de uma senha que ninguém sabe, para conferir contra quando o
 * e-mail não existe. Sem isto, "não achei o e-mail" responde em 1ms e "senha
 * errada" em ~80ms, e o relógio entrega a lista de endereços válidos sem que o
 * atacante jamais acerte uma senha.
 *
 * Preguiçoso e memorizado: calcular no import custaria ~80ms de scrypt em todo
 * cold start de qualquer rota que importe este módulo, inclusive as que nunca
 * autenticam.
 */
let senhaFalsa: Promise<string> | null = null;
function hashInexistente(): Promise<string> {
  senhaFalsa ??= hashDeSenha(randomBytes(24).toString("hex"));
  return senhaFalsa;
}

/** 1–4 sem espera; da 5ª em diante dobra, teto de 15 min. */
function esperaPorFalhas(falhas: number): number {
  return falhas < 5 ? 0 : Math.min(15 * 60, 30 * 2 ** (falhas - 5));
}

export async function autenticar(email: string, senha: string, userAgent: string | null) {
  const alvo = String(email ?? "").trim().toLowerCase();
  const segredo = String(senha ?? "");
  if (!alvo || !segredo) throw new TimeError("informe e-mail e senha", 400);

  // FORA DE TRANSAÇÃO, e isto é deliberado. A primeira versão fazia tudo dentro
  // de `transaction()` e dava `throw` no caminho de erro — o que fazia o
  // ROLLBACK apagar o contador de falhas que acabara de ser gravado. O rate
  // limit existia no código e não existia no banco: força bruta ilimitada,
  // porque o único registro do erro morria junto com ele.
  //
  // O segundo motivo é o pool: são 5 conexões compartilhadas com o financeiro
  // inteiro, e segurar uma delas durante o scrypt transformaria um endpoint
  // anônimo em derrubada do módulo financeiro.
  const p = await queryOne<{
    id: number;
    name: string;
    is_admin: boolean;
    senha_hash: string | null;
    status: string | null;
    senha_trocar: boolean | null;
    falhas: number | null;
    bloqueado_ate: Date | null;
  }>(
    `SELECT p.id, p.name, p.is_admin,
            a.senha_hash, a.status, a.senha_trocar, a.falhas, a.bloqueado_ate
       FROM fin_person p
       JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $2
       LEFT JOIN fin_person_acesso a ON a.person_id = p.id
      WHERE lower(p.email) = $1 AND p.status = 'ativo'`,
    [alvo, ENTITY]
  );

  // O bloqueio é checado ANTES do hash: não adianta gastar 80ms de CPU numa
  // tentativa que já vai ser recusada — seria o próprio rate limit virando
  // amplificador de carga.
  const travado = Boolean(p?.bloqueado_ate && p.bloqueado_ate > new Date());

  // Roda SEMPRE, inclusive sem pessoa e inclusive travado: é o que iguala o
  // tempo de resposta entre "e-mail não existe" e "senha errada".
  const confere = await conferirSenha(segredo, p?.senha_hash ?? (await hashInexistente()));

  if (!p || !p.senha_hash) throw new TimeError("e-mail ou senha incorretos", 401);
  if (p.status === "bloqueado") throw new TimeError("e-mail ou senha incorretos", 401);
  if (travado) throw new TimeError("e-mail ou senha incorretos", 401);

  if (!confere) {
    const falhas = (p.falhas ?? 0) + 1;
    const espera = esperaPorFalhas(falhas);
    // Query própria, fora de qualquer transação que possa reverter: é a única
    // memória que o sistema tem de que alguém está tentando.
    await query(
      `UPDATE fin_person_acesso
          SET falhas = $2,
              bloqueado_ate = CASE WHEN $3::int > 0 THEN now() + ($3 || ' seconds')::interval ELSE NULL END
        WHERE person_id = $1`,
      [p.id, falhas, espera]
    );
    throw new TimeError("e-mail ou senha incorretos", 401);
  }

  const token = randomBytes(32).toString("base64url");
  const criada = await queryOne<{ expira_em: Date }>(
    `INSERT INTO fin_time_sessao (token_sha256, person_id, prova, expira_em, user_agent)
     VALUES ($1, $2, 'senha', now() + ($3 || ' days')::interval, $4)
     RETURNING expira_em`,
    [sha256(token), p.id, String(DIAS_DE_SESSAO), userAgent?.slice(0, 300) ?? null]
  );
  await query(
    `UPDATE fin_person_acesso SET falhas = 0, bloqueado_ate = NULL, last_seen_at = now() WHERE person_id = $1`,
    [p.id]
  );

  return {
    token,
    sessao: {
      personId: Number(p.id),
      nome: p.name,
      prova: "senha",
      admin: p.is_admin === true,
      trocarSenha: p.senha_trocar === true,
      expiraEm: criada!.expira_em.toISOString()
    } satisfies Sessao
  };
}

/**
 * Trocar a própria senha. De quem é vem da sessão — nunca de um parâmetro.
 *
 * A senha atual é exigida mesmo com sessão válida: a sessão dura 30 dias de
 * propósito (o app é usado com a mão suja, no meio da rua), e um celular
 * esquecido na mesa não pode virar troca de senha.
 *
 * O token é VALIDADO contra uma sessão viva desta pessoa antes de qualquer
 * coisa. A primeira versão só o usava como `<>` para poupar a sessão corrente,
 * e um token errado passava batido derrubando todas as sessões — inclusive a
 * de quem estava trocando — sem erro nenhum.
 */
export async function trocarSenha(
  sessao: Sessao,
  tokenCorrente: string,
  atual: string,
  nova: string
): Promise<void> {
  const senhaNova = String(nova ?? "");
  if (senhaNova.length < 8) throw new TimeError("a nova senha precisa de pelo menos 8 caracteres", 422);
  if (String(atual ?? "") === senhaNova) throw new TimeError("a nova senha tem de ser diferente da atual", 422);
  // Só quem entrou POR senha troca senha. Sessão declarada não tem o que trocar,
  // e deixar o caminho aberto seria confiar em falhar fechado por acidente.
  if (sessao.prova !== "senha") throw new TimeError("entre com e-mail e senha para trocar a senha", 403);

  const tokenSha = sha256(String(tokenCorrente ?? ""));
  const viva = await queryOne<{ id: number }>(
    `SELECT id FROM fin_time_sessao
      WHERE token_sha256 = $1 AND person_id = $2 AND expira_em > now() AND encerrada_em IS NULL`,
    [tokenSha, sessao.personId]
  );
  if (!viva) throw new TimeError("identifique-se para continuar", 401);

  const acesso = await queryOne<{ senha_hash: string | null; falhas: number | null; bloqueado_ate: Date | null }>(
    `SELECT senha_hash, falhas, bloqueado_ate FROM fin_person_acesso WHERE person_id = $1`,
    [sessao.personId]
  );
  if (acesso?.bloqueado_ate && acesso.bloqueado_ate > new Date()) {
    throw new TimeError("muitas tentativas — espere um pouco antes de tentar de novo", 429);
  }

  // Este é o SEGUNDO oráculo de senha do sistema: com o cookie em mãos dá para
  // adivinhar a senha atual sem limite. Ele conta as falhas na mesma tabela que
  // o login, então a trava é compartilhada.
  if (!(await conferirSenha(String(atual ?? ""), acesso?.senha_hash ?? (await hashInexistente())))) {
    const falhas = (acesso?.falhas ?? 0) + 1;
    const espera = esperaPorFalhas(falhas);
    await query(
      `UPDATE fin_person_acesso
          SET falhas = $2,
              bloqueado_ate = CASE WHEN $3::int > 0 THEN now() + ($3 || ' seconds')::interval ELSE NULL END
        WHERE person_id = $1`,
      [sessao.personId, falhas, espera]
    );
    throw new TimeError("senha atual incorreta", 401);
  }

  const hashNovo = await hashDeSenha(senhaNova);
  await transaction(async (client) => {
    await client.query(
      `UPDATE fin_person_acesso
          SET senha_hash = $2, senha_set_at = now(), senha_set_by = 'a própria pessoa',
              senha_trocar = false, falhas = 0, bloqueado_ate = NULL
        WHERE person_id = $1`,
      [sessao.personId, hashNovo]
    );
    // As outras sessões caem: trocar senha porque desconfiou de algo tem de
    // expulsar quem estiver dentro. A corrente é poupada para a pessoa não ser
    // deslogada pelo próprio acerto.
    await client.query(
      `UPDATE fin_time_sessao SET encerrada_em = now()
        WHERE person_id = $1 AND encerrada_em IS NULL AND id <> $2`,
      [sessao.personId, viva.id]
    );
  });
}

/** Resolve o cookie em sessão, ou `null`. Toda rota do time começa por aqui. */
export async function lerSessao(token: string | null | undefined): Promise<Sessao | null> {
  if (!token) return null;
  const linha = await queryOne<{
    person_id: number;
    name: string;
    prova: ProvaDeIdentidade;
    is_admin: boolean;
    senha_trocar: boolean | null;
    expira_em: Date;
  }>(
    `UPDATE fin_time_sessao s SET ultimo_uso = now()
       FROM fin_person p
       LEFT JOIN fin_person_acesso a ON a.person_id = p.id
      WHERE s.token_sha256 = $1
        AND p.id = s.person_id
        AND s.expira_em > now()
        AND s.encerrada_em IS NULL
        AND p.status = 'ativo'
        -- Bloquear o acesso de alguém tem de derrubar a sessão viva também.
        -- Sem isto o admin bloqueia, acredita que revogou, e o cookie de 30
        -- dias continua valendo em todas as rotas.
        AND COALESCE(a.status, 'ativo') <> 'bloqueado'
      RETURNING s.person_id, p.name, s.prova, p.is_admin, a.senha_trocar, s.expira_em`,
    [sha256(token)]
  );
  if (!linha) return null;
  return {
    personId: Number(linha.person_id),
    nome: linha.name,
    prova: linha.prova,
    admin: linha.is_admin === true,
    // Só cobra troca de quem entrou POR senha: quem entrou declarado ainda não
    // tem senha para trocar, e pedir isso a ele seria um beco sem saída.
    trocarSenha: linha.prova === "senha" && linha.senha_trocar === true,
    expiraEm: linha.expira_em.toISOString()
  };
}

export async function encerrarSessao(token: string | null | undefined): Promise<void> {
  if (!token) return;
  await query(`UPDATE fin_time_sessao SET encerrada_em = now() WHERE token_sha256 = $1 AND encerrada_em IS NULL`, [
    sha256(token)
  ]);
}

/** Atalho para as rotas: sessão obrigatória, 401 quando não há. */
export function exigirSessao(sessao: Sessao | null): Sessao {
  if (!sessao) throw new TimeError("identifique-se para continuar", 401);
  return sessao;
}

// ---------------------------------------------------------------------------
// Anexos — o comprovante
// ---------------------------------------------------------------------------

/**
 * Guarda o arquivo e devolve a chave.
 *
 * Onde: no PostgreSQL, gzip + sha256, dentro da transação — o mesmo padrão que
 * `docs/ARMAZENAMENTO-RAILWAY.md` já descreve para os artefatos. O volume do
 * Railway é CACHE: a próxima reimplantação o esvazia, e comprovante fiscal que
 * some na reimplantação não é comprovante.
 *
 * A chave carrega a data e o sha para o arquivo ser localizável mesmo se a
 * linha de metadado for perdida.
 */
const TETO_ANEXO_BYTES = 10 * 1024 * 1024;
const MIMES_ACEITOS = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "text/xml",
  "application/xml"
]);

export type AnexoEntrada = {
  nome: string;
  mime: string;
  bytes: Buffer;
};

/**
 * Guarda um arquivo que chegou ANTES de existir lançamento para prendê-lo.
 *
 * É o caso do compartilhamento: a pessoa recebe o comprovante no app do banco e
 * despacha para cá antes de preencher qualquer coisa. Se o arquivo não fosse
 * guardado neste instante, ele se perderia no caminho até o formulário — e a
 * pessoa não repete o gesto.
 *
 * O blob entra sem linha em `fin_payment_attachment`: o vínculo nasce quando o
 * envio for criado. Fica órfão se ela desistir no meio, e é aceitável —
 * comprovante encolhido pesa ~250 KB, e perder o arquivo de quem compartilhou
 * custa mais que guardar alguns que ninguém usou. A chave leva o `person_id`
 * para uma limpeza futura saber de quem é cada rascunho.
 */
export async function guardarAnexoAvulso(sessao: Sessao, anexo: AnexoEntrada, _token: string | null): Promise<string> {
  return transaction(async (client) => {
    const chave = await guardarAnexo(client, anexo, `time:${sessao.personId}`);
    return chave;
  });
}

export async function guardarAnexo(
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  anexo: AnexoEntrada,
  autor: string
): Promise<string> {
  if (anexo.bytes.length === 0) throw new TimeError("o arquivo veio vazio");
  if (anexo.bytes.length > TETO_ANEXO_BYTES) {
    throw new TimeError("comprovante acima de 10 MB — fotografe em resolução menor", 413);
  }
  if (!MIMES_ACEITOS.has(anexo.mime)) {
    throw new TimeError(`tipo de arquivo não aceito: ${anexo.mime || "desconhecido"} (aceito PDF, foto ou XML)`);
  }

  const sha = sha256(anexo.bytes);
  const comprimido = gzipSync(anexo.bytes, { level: 9 });
  const chave = `time/${new Date().toISOString().slice(0, 10)}/${sha.slice(0, 16)}`;

  // ON CONFLICT: a mesma foto enviada duas vezes é o mesmo arquivo. Guardar de
  // novo dobraria o byte sem acrescentar prova.
  await client.query(
    `INSERT INTO fin_anexo_blob (storage_key, conteudo, content_type, content_encoding, sha256,
                                 bytes_originais, bytes_gravados, file_name, uploaded_by)
     VALUES ($1, $2, $3, 'gzip', $4, $5, $6, $7, $8)
     ON CONFLICT (storage_key) DO NOTHING`,
    [chave, comprimido, anexo.mime, sha, anexo.bytes.length, comprimido.length, anexo.nome.slice(0, 200), autor]
  );
  return chave;
}

async function registrarAnexo(
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  entityId: number,
  alvo: "fin_reimbursement_item" | "fin_time_envio" | "fin_purchase_request",
  alvoId: number,
  tipo: "comprovante" | "nota_fiscal" | "cotacao",
  anexo: AnexoEntrada,
  autor: string
) {
  const chave = await guardarAnexo(client, anexo, autor);
  await client.query(
    `INSERT INTO fin_payment_attachment (entity_id, target_table, target_id, kind, storage_key,
                                         file_name, file_sha256, file_bytes, mime_type, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT DO NOTHING`,
    [
      entityId,
      alvo,
      alvoId,
      tipo,
      chave,
      anexo.nome.slice(0, 200),
      sha256(anexo.bytes),
      anexo.bytes.length,
      anexo.mime,
      autor
    ]
  );
  return chave;
}

async function entidadeId(client: { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }) {
  const r = await client.query(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTITY]);
  const id = r.rows[0]?.id;
  if (id === undefined) throw new TimeError("entidade não configurada", 503);
  return Number(id);
}

// ---------------------------------------------------------------------------
// Validação de entrada — o vocabulário compartilhado
// ---------------------------------------------------------------------------

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function exigirTexto(v: unknown, campo: string, max = 500): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw new TimeError(`${campo} é obrigatório`);
  return s.slice(0, max);
}

export function opcionalTexto(v: unknown, max = 2000): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
}

export function exigirData(v: unknown, campo: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!DATA_ISO.test(s)) throw new TimeError(`${campo} precisa ser uma data (AAAA-MM-DD)`);
  return s;
}

/**
 * Centavos a partir do que a pessoa digitou.
 *
 * Aceita "1.234,56", "1234.56" e "1234" porque é o que sai de teclado de
 * celular brasileiro. Nunca aceita zero nem negativo: valor zero num envio é
 * quase sempre campo esquecido, e sinal negativo aqui inverteria o sentido do
 * dinheiro num módulo cujo sentido é fixo (saída).
 */
export function exigirCentavos(v: unknown, campo: string): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    const c = Math.round(v);
    if (c <= 0) throw new TimeError(`${campo} precisa ser maior que zero`);
    return c;
  }
  const bruto = typeof v === "string" ? v.trim() : "";
  if (!bruto) throw new TimeError(`${campo} é obrigatório`);
  const normal = bruto.replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const numero = Number(normal);
  if (!Number.isFinite(numero)) throw new TimeError(`${campo} não parece um valor`);
  const cents = Math.round(numero * 100);
  if (cents <= 0) throw new TimeError(`${campo} precisa ser maior que zero`);
  return cents;
}

// ---------------------------------------------------------------------------
// 1. Reembolso
// ---------------------------------------------------------------------------

export type NovoReembolso = {
  tipo?: unknown;
  descricao?: unknown;
  expenseDate?: unknown;
  valor?: unknown;
  nfeKey?: unknown;
  comprovante?: AnexoEntrada | null;
};

/**
 * Lança um item de reembolso da PESSOA DA SESSÃO.
 *
 * Reusa fin_reimbursement/fin_reimbursement_item (0012) — a matriz pessoa × mês
 * do admin continua sendo a mesma tabela, então o que o time envia aparece lá
 * sem nenhuma sincronização. O que muda é o comprovante: `receipt_artifact_key`
 * existe desde a 0012 esperando exatamente por isto, e hoje está preenchido em
 * 0 de 193 itens.
 *
 * O mês de competência é derivado da DATA DA DESPESA, não escolhido: deixar a
 * pessoa escolher produziria "gasolina de março" dentro do reembolso de junho,
 * e a matriz pessoa × mês perderia o significado.
 */
export async function criarReembolsoDoTime(sessao: Sessao, corpo: NovoReembolso) {
  const descricao = exigirTexto(corpo.descricao, "descrição");
  const data = exigirData(corpo.expenseDate, "data da despesa");
  const valorCents = exigirCentavos(corpo.valor, "valor");
  const tipo = opcionalTexto(corpo.tipo, 80);
  const nfeBruta = typeof corpo.nfeKey === "string" ? corpo.nfeKey.replace(/\D/g, "") : "";
  if (nfeBruta && nfeBruta.length !== 44) throw new TimeError("a chave da NF-e tem 44 dígitos");
  const mes = `${data.slice(0, 7)}-01`;

  return transaction(async (client) => {
    const entityId = await entidadeId(client);

    let categoryId: number | null = null;
    if (tipo) {
      const t = await client.query<{ category_id: number | null; requires_nfe: boolean }>(
        `SELECT category_id, requires_nfe FROM fin_reimbursement_type WHERE slug = $1 AND is_active`,
        [tipo]
      );
      if (!t.rows[0]) throw new TimeError(`tipo de reembolso desconhecido: ${tipo}`);
      if (t.rows[0].requires_nfe && !nfeBruta) throw new TimeError("este tipo exige a chave da NF-e (44 dígitos)");
      categoryId = t.rows[0].category_id;
    }

    // O reembolso do mês da pessoa. Volta para 'rascunho' → 'enviado' abaixo;
    // um reembolso já pago não pode receber item novo, senão o total muda
    // depois do pagamento.
    const existente = await client.query<{ id: number; status: string }>(
      `SELECT id, status FROM fin_reimbursement WHERE person_id = $1 AND reference_month = $2::date`,
      [sessao.personId, mes]
    );
    if (existente.rows[0] && ["aprovado", "pago"].includes(existente.rows[0].status)) {
      throw new TimeError(
        `o reembolso de ${data.slice(5, 7)}/${data.slice(0, 4)} já foi ${existente.rows[0].status} — lance no mês corrente`,
        409
      );
    }

    const reembolso =
      existente.rows[0] ??
      (
        await client.query<{ id: number }>(
          `INSERT INTO fin_reimbursement (entity_id, person_id, reference_month, status, submitted_at)
           VALUES ($1, $2, $3::date, 'enviado', now()) RETURNING id`,
          [entityId, sessao.personId, mes]
        )
      ).rows[0];

    const item = await client.query<{ id: number }>(
      `INSERT INTO fin_reimbursement_item
         (reimbursement_id, category_id, reimbursement_type, description, expense_date, amount_cents, nfe_key)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7) RETURNING id`,
      [reembolso.id, categoryId, tipo, descricao, data, valorCents, nfeBruta || null]
    );

    let chave: string | null = null;
    if (corpo.comprovante) {
      chave = await registrarAnexo(
        client,
        entityId,
        "fin_reimbursement_item",
        item.rows[0].id,
        "comprovante",
        corpo.comprovante,
        `time:${sessao.nome}`
      );
      await client.query(`UPDATE fin_reimbursement_item SET receipt_artifact_key = $2 WHERE id = $1`, [
        item.rows[0].id,
        chave
      ]);
    }

    // Rascunho que ganhou item enviado pelo app passa a 'enviado': o envio é o
    // ato, não um botão a mais.
    await client.query(
      `UPDATE fin_reimbursement SET status = 'enviado', submitted_at = coalesce(submitted_at, now())
        WHERE id = $1 AND status = 'rascunho'`,
      [reembolso.id]
    );

    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
       VALUES ($1, 'fin_reimbursement_item', $2, 'insert', $3::jsonb,
               ARRAY['description','amount_cents','receipt_artifact_key'], $4)`,
      [
        entityId,
        item.rows[0].id,
        JSON.stringify({
          reimbursement_id: reembolso.id,
          person_id: sessao.personId,
          description: descricao,
          amount_cents: valorCents,
          receipt_artifact_key: chave,
          identidade: sessao.prova
        }),
        `app-time:${sessao.nome}`
      ]
    );

    return { itemId: item.rows[0].id, reembolsoId: reembolso.id, comprovante: chave, mes };
  });
}

// ---------------------------------------------------------------------------
// 2 e 3. Custo e nota de entrada
// ---------------------------------------------------------------------------

export type NovoEnvio = {
  kind: "custo" | "nota_entrada";
  titulo?: unknown;
  descricao?: unknown;
  valor?: unknown;
  data?: unknown;
  vencimento?: unknown;
  pagamento?: unknown;
  jaPago?: unknown;
  fornecedor?: unknown;
  fornecedorDocumento?: unknown;
  categoriaSugerida?: unknown;
  centroCusto?: unknown;
  linhaServico?: unknown;
  cartao?: unknown;
  banco?: unknown;
  final?: unknown;
  parcelas?: unknown;
  nfeKey?: unknown;
  nfeNumero?: unknown;
  nfeSerie?: unknown;
  anexo?: AnexoEntrada | null;
  /** Chave de um blob já guardado — veio pela folha de compartilhamento. */
  anexoChave?: unknown;
  /**
   * UUID gerado pelo cliente por TENTATIVA (0145). Reenviado igual em cada
   * retentativa, é o que distingue "a resposta se perdeu" de "são duas
   * compras iguais" — distinção que só o cliente consegue fazer.
   */
  idempotencyKey?: unknown;
};

const PAGAMENTOS = new Set([
  "ja_paguei_do_meu",
  "cartao_da_empresa",
  "boleto",
  "pix_da_empresa",
  "debito_automatico",
  "a_definir"
]);

export async function criarEnvioDoTime(sessao: Sessao, corpo: NovoEnvio) {
  if (corpo.kind !== "custo" && corpo.kind !== "nota_entrada") throw new TimeError("tipo de envio inválido");
  const titulo = exigirTexto(corpo.titulo, corpo.kind === "custo" ? "o que foi" : "descrição da nota", 200);
  const valorCents = exigirCentavos(corpo.valor, "valor");
  const data = exigirData(corpo.data, corpo.kind === "custo" ? "data do custo" : "data de emissão");
  const vencimento =
    typeof corpo.vencimento === "string" && DATA_ISO.test(corpo.vencimento.trim()) ? corpo.vencimento.trim() : null;
  const pagamento = typeof corpo.pagamento === "string" && PAGAMENTOS.has(corpo.pagamento) ? corpo.pagamento : "a_definir";

  // A fronteira com o reembolso, dita em voz alta em vez de resolvida em
  // silêncio: se a pessoa pagou do bolso, o caminho que devolve o dinheiro dela
  // é o reembolso. Aceitar aqui criaria uma despesa da empresa sem ninguém a
  // ressarcir, e o dinheiro dela sumiria do processo.
  if (corpo.kind === "custo" && pagamento === "ja_paguei_do_meu") {
    throw new TimeError("você pagou do seu bolso — use a tela de reembolso, que é a que te devolve o dinheiro");
  }

  // Parcelas: NULL é à vista. O CHECK da 0141 recusa 1 de propósito — "uma
  // parcela" e "à vista" são fatos diferentes na fatura.
  const nParcelas = Number(corpo.parcelas);
  const parcelas = Number.isInteger(nParcelas) && nParcelas >= 2 && nParcelas <= 48 ? nParcelas : null;

  const nfeBruta = typeof corpo.nfeKey === "string" ? corpo.nfeKey.replace(/\D/g, "") : "";
  if (nfeBruta && nfeBruta.length !== 44) throw new TimeError("a chave da NF-e tem 44 dígitos");
  const fornecedor = opcionalTexto(corpo.fornecedor, 200);
  const nfeNumero = opcionalTexto(corpo.nfeNumero, 40);

  if (corpo.kind === "nota_entrada" && !nfeBruta && !nfeNumero && !fornecedor) {
    throw new TimeError("uma nota precisa de pelo menos a chave, o número ou o nome de quem emitiu");
  }

  // A chave de idempotência (0145). Formato conferido aqui porque um texto
  // qualquer viraria erro de tipo do Postgres no meio da transação, e o que a
  // pessoa leria seria "invalid input syntax for type uuid" em vez de qualquer
  // coisa útil. Ausente é aceito: um cliente antigo continua enviando.
  const chaveEnvio = typeof corpo.idempotencyKey === "string" && UUID.test(corpo.idempotencyKey.trim())
    ? corpo.idempotencyKey.trim()
    : null;

  // Antes de abrir a transação: se esta tentativa já gravou, devolve o que ela
  // gravou. É o caso da resposta perdida na volta — a compra entrou, a pessoa
  // não soube, e tocou de novo. Ela merece ver "enviado", não um segundo custo.
  if (chaveEnvio) {
    const jaFoi = await queryOne<{ id: number; code: string }>(
      `SELECT id, code FROM fin_time_envio WHERE idempotency_key = $1 AND person_id = $2`,
      [chaveEnvio, sessao.personId]
    );
    if (jaFoi) return { id: jaFoi.id, code: jaFoi.code, anexo: null, repetido: true };
  }

  return transaction(async (client) => {
    const entityId = await entidadeId(client);

    let categoriaId: number | null = null;
    if (corpo.categoriaSugerida !== undefined && corpo.categoriaSugerida !== null && corpo.categoriaSugerida !== "") {
      const c = await client.query<{ id: number }>(
        `SELECT id FROM fin_category WHERE id = $1 AND entity_id = $2`,
        [Number(corpo.categoriaSugerida), entityId]
      );
      categoriaId = c.rows[0]?.id ?? null;
    }

    // O eixo DESTINO. Os dois são opcionais de propósito: campo obrigatório num
    // formulário preenchido na rua é campo preenchido com qualquer coisa, e
    // qualquer coisa é pior que um vazio declarado. Id que não existe vira
    // NULL em silêncio pelo mesmo motivo da categoria acima — o envio não pode
    // ser recusado por causa de um select desatualizado no celular de alguém.
    const centroCustoId = await refValida(client, "fin_cost_center", corpo.centroCusto, entityId);
    const linhaServicoId = await refValida(client, "fin_product_line", corpo.linhaServico, entityId);

    // O plástico. Só faz sentido quando a forma de pagamento é cartão — o CHECK
    // da 0138 recusaria a combinação incoerente, e recusar o envio inteiro por
    // isso perderia o lançamento. Descarta o cartão e mantém o resto.
    let cartaoId: number | null = null;
    let bancoId: number | null = null;
    let last4: string | null = null;
    if (pagamento === "cartao_da_empresa" || pagamento === "ja_paguei_do_meu") {
      const idPlastico = Number(corpo.cartao);
      if (Number.isInteger(idPlastico) && idPlastico > 0) {
        // O banco DERIVA do plástico. Guardar os dois vindos do formulário
        // abriria espaço para eles divergirem — plástico do Nubank com banco
        // Inter —, e o CHECK da 0140 não pega essa combinação, só a ausência.
        const c = await client.query(
          `SELECT id, card_account_id FROM fin_card WHERE id = $1 AND status = 'registrado'`,
          [idPlastico]
        );
        if (c.rows[0]) {
          cartaoId = Number(c.rows[0].id);
          bancoId = Number(c.rows[0].card_account_id);
        }
      }
      if (!bancoId) {
        const idBanco = Number(corpo.banco);
        if (Number.isInteger(idBanco) && idBanco > 0) {
          const a = await client.query(`SELECT id FROM fin_card_account WHERE id = $1 AND is_active`, [idBanco]);
          bancoId = a.rows[0] ? Number(a.rows[0].id) : null;
        }
      }

      // O FINAL DIGITADO. Casando com um plástico registrado, o vínculo é feito
      // sozinho — a pessoa digita quatro dígitos e ganha o cartão certo sem
      // escolher de lista nenhuma. Não casando, o final fica guardado assim
      // mesmo: é o dado que ela tem na mão, e perdê-lo por falta de cadastro
      // prévio seria jogar fora justamente o que casa com a fatura depois.
      const digitado = String(corpo.final ?? "").replace(/\D/g, "").slice(-4);
      if (digitado.length === 4) {
        last4 = digitado;
        if (!cartaoId) {
          const achado = await client.query(
            `SELECT id, card_account_id FROM fin_card
              WHERE last4 = $1 AND status = 'registrado'
                AND ($2::bigint IS NULL OR card_account_id = $2)
              LIMIT 2`,
            [digitado, bancoId]
          );
          // Dois plásticos com o mesmo final é improvável; se acontecer, não dá
          // para escolher. Fica só o final, e o vínculo espera um humano.
          if (achado.rows.length === 1) {
            cartaoId = Number(achado.rows[0].id);
            bancoId = Number(achado.rows[0].card_account_id);
          }
        }
      } else if (cartaoId) {
        const c = await client.query(`SELECT last4 FROM fin_card WHERE id = $1`, [cartaoId]);
        last4 = (c.rows[0]?.last4 as string | null) ?? null;
      }
    }

    // AINDA NÃO SE DERIVA A LINHA DO PROJETO, e isso é uma lacuna declarada, não
    // um esquecimento. O plano diz que escolher a obra deveria responder "é LDC
    // ou LIE?" sozinho — e responderia, porque o ERP sabe o tipo de serviço de
    // cada contrato. Só que `fin_cost_center` espelha o projeto SEM esse campo:
    // não há de onde derivar. Inventar a derivação com o dado que existe seria
    // gravar um palpite com cara de fato.
    //
    // Até o espelho do ERP trazer o tipo de serviço, os dois campos convivem: o
    // projeto responde "para quem", a linha responde "para qual serviço", e
    // quem preenche é a pessoa — quando souber.

    const envio = await client.query<{ id: number; code: string }>(
      `INSERT INTO fin_time_envio
         (entity_id, kind, person_id, identidade_prova, titulo, descricao, amount_cents,
          incurred_on, due_on, pagamento, ja_pago, categoria_sugerida_id,
          cost_center_id, product_line_id, card_id, card_account_id, card_last4, parcelas,
          fornecedor_nome, fornecedor_documento, nfe_key, nfe_numero, nfe_serie, nfe_emissao,
          idempotency_key, status, enviado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, $11, $12, $18, $19, $20, $21, $22, $23,
               $13, $14, $15, $16, $17,
               CASE WHEN $2 = 'nota_entrada' THEN $8::date ELSE NULL END,
               $24::uuid, 'enviado', now())
       RETURNING id, code`,
      [
        entityId,
        corpo.kind,
        sessao.personId,
        sessao.prova,
        titulo,
        opcionalTexto(corpo.descricao),
        valorCents,
        data,
        vencimento,
        pagamento,
        corpo.jaPago === true || corpo.jaPago === "true",
        categoriaId,
        fornecedor,
        opcionalTexto(corpo.fornecedorDocumento, 40),
        nfeBruta || null,
        nfeNumero,
        opcionalTexto(corpo.nfeSerie, 10),
        centroCustoId,
        linhaServicoId,
        cartaoId,
        bancoId,
        last4,
        parcelas,
        chaveEnvio
      ]
    );

    let chave: string | null = null;

    // O arquivo que veio compartilhado já está em `fin_anexo_blob`; falta só
    // prendê-lo a este envio. Sem isto o blob fica órfão e a pessoa acha que o
    // comprovante se perdeu — e da segunda vez ela não compartilha mais.
    const jaGuardado = typeof corpo.anexoChave === "string" ? corpo.anexoChave.trim() : "";
    if (!corpo.anexo && jaGuardado) {
      const existe = await client.query(`SELECT storage_key FROM fin_anexo_blob WHERE storage_key = $1`, [jaGuardado]);
      if (existe.rows[0]) {
        chave = jaGuardado;
        await client.query(
          `INSERT INTO fin_payment_attachment
             (entity_id, target_table, target_id, kind, storage_key, uploaded_by)
           VALUES ($1, 'fin_time_envio', $2, 'comprovante', $3, $4)
           ON CONFLICT DO NOTHING`,
          [entityId, envio.rows[0].id, jaGuardado, `time:${sessao.personId}`]
        );
      }
    }

    if (corpo.anexo) {
      chave = await registrarAnexo(
        client,
        entityId,
        "fin_time_envio",
        envio.rows[0].id,
        corpo.kind === "nota_entrada" ? "nota_fiscal" : "comprovante",
        corpo.anexo,
        `time:${sessao.nome}`
      );
    }

    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
       VALUES ($1, 'fin_time_envio', $2, 'insert', $3::jsonb, ARRAY['titulo','amount_cents','kind'], $4)`,
      [
        entityId,
        envio.rows[0].id,
        JSON.stringify({
          kind: corpo.kind,
          person_id: sessao.personId,
          titulo,
          amount_cents: valorCents,
          identidade: sessao.prova,
          anexo: chave
        }),
        `app-time:${sessao.nome}`
      ]
    );

    return { id: envio.rows[0].id, code: envio.rows[0].code, anexo: chave, repetido: false };
  });
}

// ---------------------------------------------------------------------------
// 4. Pedido de compra — com os links
// ---------------------------------------------------------------------------

export type LinkCompra = { url?: unknown; loja?: unknown; titulo?: unknown; preco?: unknown };

export type NovaCompra = {
  titulo?: unknown;
  descricao?: unknown;
  justificativa?: unknown;
  quantidade?: unknown;
  unidade?: unknown;
  valor?: unknown;
  urgencia?: unknown;
  precisaAte?: unknown;
  links?: LinkCompra[];
};

const URGENCIAS = new Set(["critica", "alta", "normal", "baixa"]);

/**
 * O pedido de compra do time, com o "link de coisas pra comprar".
 *
 * Grava em fin_purchase_request (0075) com `source='app_time'` — o valor já
 * estava previsto no CHECK da tabela desde que ela nasceu, esperando este
 * caminho existir. A tabela tinha 0 linhas.
 *
 * `amount_basis` é derivado da evidência, não perguntado: se veio link com
 * preço, a base é 'cotacao' e `quotes_count` conta os links; se não veio, é
 * 'estimativa'. Perguntar produziria "cotação" declarada sem cotação nenhuma.
 */
export async function criarCompraDoTime(sessao: Sessao, corpo: NovaCompra) {
  const titulo = exigirTexto(corpo.titulo, "o que você precisa comprar", 200);
  const justificativa = exigirTexto(corpo.justificativa, "para que serve", 2000);
  const valorCents = exigirCentavos(corpo.valor, "valor estimado");
  const urgencia = typeof corpo.urgencia === "string" && URGENCIAS.has(corpo.urgencia) ? corpo.urgencia : "normal";
  const precisaAte =
    typeof corpo.precisaAte === "string" && DATA_ISO.test(corpo.precisaAte.trim()) ? corpo.precisaAte.trim() : null;

  const quantidade =
    corpo.quantidade === undefined || corpo.quantidade === null || corpo.quantidade === ""
      ? null
      : Number(String(corpo.quantidade).replace(",", "."));
  if (quantidade !== null && (!Number.isFinite(quantidade) || quantidade <= 0)) {
    throw new TimeError("quantidade precisa ser maior que zero");
  }

  const links = (Array.isArray(corpo.links) ? corpo.links : [])
    .map((l) => ({
      url: typeof l?.url === "string" ? l.url.trim() : "",
      loja: opcionalTexto(l?.loja, 120),
      titulo: opcionalTexto(l?.titulo, 200),
      preco: l?.preco
    }))
    .filter((l) => l.url);

  for (const l of links) {
    // A mesma trava do CHECK, adiantada para a mensagem ser útil: um
    // `javascript:` num campo que a tela do aprovador renderiza como âncora é
    // execução de script no navegador de quem decide.
    if (!/^https?:\/\/[^\s]+$/i.test(l.url)) {
      throw new TimeError(`link inválido: ${l.url.slice(0, 60)} — cole o endereço começando com https://`);
    }
  }

  return transaction(async (client) => {
    const entityId = await entidadeId(client);

    const comPreco = links.filter((l) => l.preco !== undefined && l.preco !== null && l.preco !== "");
    const pedido = await client.query<{ id: number; code: string }>(
      `INSERT INTO fin_purchase_request
         (entity_id, title, description, justification, amount_cents, amount_basis, quotes_count,
          quantity, unit, needed_by, priority, status, source, requested_by, requested_person_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11, 'enviada', 'app_time', $12, $13)
       RETURNING id, code`,
      [
        entityId,
        titulo,
        opcionalTexto(corpo.descricao),
        justificativa,
        valorCents,
        comPreco.length > 0 ? "cotacao" : "estimativa",
        comPreco.length,
        quantidade,
        opcionalTexto(corpo.unidade, 20),
        precisaAte,
        urgencia,
        sessao.nome,
        sessao.personId
      ]
    );

    for (const l of links) {
      const preco =
        l.preco === undefined || l.preco === null || l.preco === "" ? null : exigirCentavos(l.preco, "preço do link");
      await client.query(
        `INSERT INTO fin_purchase_request_link (purchase_request_id, url, loja, titulo, price_cents, price_reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (purchase_request_id, url) DO NOTHING`,
        [pedido.rows[0].id, l.url.slice(0, 2000), l.loja, l.titulo, preco, preco === null ? "quem enviou não informou o preço" : null]
      );
    }

    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
       VALUES ($1, 'fin_purchase_request', $2, 'insert', $3::jsonb, ARRAY['title','amount_cents','priority'], $4)`,
      [
        entityId,
        pedido.rows[0].id,
        JSON.stringify({
          title: titulo,
          amount_cents: valorCents,
          priority: urgencia,
          links: links.length,
          person_id: sessao.personId,
          identidade: sessao.prova
        }),
        `app-time:${sessao.nome}`
      ]
    );

    return { id: pedido.rows[0].id, code: pedido.rows[0].code, links: links.length };
  });
}

// ---------------------------------------------------------------------------
// 5. Acompanhar
// ---------------------------------------------------------------------------

export type EnvioDoTime = {
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

/**
 * O que ESTA pessoa enviou. `sessao` e não `personId`: ver o cabeçalho.
 *
 * O filtro é `person_id = $1` e não tem sobrecarga sem filtro. Uma função que
 * aceite "sem pessoa = tudo" é a que alguém chama sem argumento numa refatoração
 * e ninguém percebe até o dia em que o time inteiro vê o reembolso do sócio.
 */
export async function listarMeusEnvios(sessao: Sessao): Promise<EnvioDoTime[]> {
  const linhas = await query<Record<string, unknown>>(
    `SELECT origem, origem_id, code, titulo, amount_cents, data_ref, status, estado_simples,
            resposta, decidido_em, decidido_por, created_at, itens, itens_com_anexo
       FROM fin_time_envios_v
      WHERE person_id = $1
      ORDER BY created_at DESC
      LIMIT 200`,
    [sessao.personId]
  );

  return linhas.map((l) => ({
    origem: String(l.origem),
    origemId: Number(l.origem_id),
    code: String(l.code ?? ""),
    titulo: String(l.titulo ?? ""),
    valorCents: l.amount_cents === null ? null : Number(l.amount_cents),
    dataRef: l.data_ref ? new Date(l.data_ref as string).toISOString().slice(0, 10) : null,
    status: String(l.status),
    estado: String(l.estado_simples ?? "aguardando") as EnvioDoTime["estado"],
    resposta: (l.resposta as string) ?? null,
    decididoEm: l.decidido_em ? new Date(l.decidido_em as string).toISOString() : null,
    decididoPor: (l.decidido_por as string) ?? null,
    criadoEm: new Date(l.created_at as string).toISOString(),
    itens: Number(l.itens ?? 0),
    itensComAnexo: Number(l.itens_com_anexo ?? 0)
  }));
}

/**
 * O reembolso da PESSOA da sessão: o histórico mensal, o que ainda falta receber
 * e como isso se distribui pelos próximos meses.
 *
 * ---------------------------------------------------------------------------
 * DUAS FONTES, E A DIVERGÊNCIA DITA EM VOZ ALTA
 * ---------------------------------------------------------------------------
 * Existem DOIS modelos de reembolso carregados no mesmo banco, importados da
 * mesma planilha por scripts diferentes com meses de distância:
 *
 *   fin_reimbursement (0012)  o FLUXO — pedir, aprovar, pagar. É o que a tela do
 *                             admin usa. Total por mês e status.
 *   fin_reembolso_item (0129) a CONTA — parcela correta, saldo por item. Tem o
 *                             tratamento do "2x*" que o outro não tem.
 *
 * Eles divergem em R$ 40,21 no acervo (dois casos: o `2x*` do Decézaris em maio
 * e um item de fevereiro que só existe num deles). Enquanto o Fernando não
 * decidir qual é a verdade, esta função **não escolhe por ele**: usa cada uma
 * para o que ela sabe, e devolve `fonte` em cada bloco para a tela poder dizer
 * de onde veio o número. Escolher em silêncio seria inventar a resposta que
 * falta.
 *
 * Nenhuma consulta aqui aceita pessoa como parâmetro — o escopo é a `Sessao`.
 */
export async function meuReembolso(sessao: Sessao) {
  const [meses, saldo] = await Promise.all([
    // O histórico: o que já foi pago e o que está aprovado esperando.
    query<{ mes: string; total_cents: string; status: string; itens: number }>(
      `SELECT to_char(r.reference_month, 'YYYY-MM') AS mes,
              sum(i.amount_cents)::text AS total_cents,
              r.status,
              count(i.id)::int AS itens
         FROM fin_reimbursement r
         JOIN fin_reimbursement_item i ON i.reimbursement_id = r.id
        WHERE r.person_id = $1
        GROUP BY 1, r.status
        ORDER BY 1`,
      [sessao.personId]
    ),
    // O que falta: parcela a parcela, do modelo que sabe contar parcela.
    query<{
      descricao: string;
      parcela: number;
      parcelas_total: number;
      valor_parcela_cents: string;
      parcelas_restantes: number;
      saldo_cents: string;
    }>(
      `SELECT descricao, parcela, parcelas_total, valor_parcela_cents::text,
              parcelas_restantes, saldo_cents::text
         FROM fin_reembolso_saldo_v
        WHERE person_id = $1 AND NOT quitado
        ORDER BY saldo_cents DESC`,
      [sessao.personId]
    )
  ]);

  const restantes = saldo.map((l) => ({
    descricao: l.descricao,
    parcela: l.parcela,
    parcelasTotal: l.parcelas_total,
    parcelaCents: Number(l.valor_parcela_cents),
    parcelasRestantes: l.parcelas_restantes,
    saldoCents: Number(l.saldo_cents)
  }));

  // A projeção é aritmética simples e declarada: cada item em aberto contribui
  // com uma parcela por mês até acabar. Não há previsão estatística aqui — o
  // que se sabe é o contratado, e é só isso que se mostra.
  const horizonte = Math.min(12, Math.max(0, ...restantes.map((r) => r.parcelasRestantes)));
  const proximos = Array.from({ length: horizonte }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + i + 1);
    return {
      mes: d.toISOString().slice(0, 7),
      cents: restantes.filter((r) => r.parcelasRestantes > i).reduce((soma, r) => soma + r.parcelaCents, 0)
    };
  });

  return {
    historico: {
      fonte: "fin_reimbursement (0012) — o fluxo de pedido, aprovação e pagamento",
      meses: meses.map((m) => ({
        mes: m.mes,
        totalCents: Number(m.total_cents),
        status: m.status,
        itens: m.itens
      }))
    },
    aReceber: {
      fonte: "fin_reembolso_saldo_v (0129) — o modelo que trata o 2x* da planilha",
      totalCents: restantes.reduce((s, r) => s + r.saldoCents, 0),
      itens: restantes,
      proximosMeses: proximos
    },
    // A tela mostra isto. Esconder que há duas contagens seria escolher uma
    // sem dizer, e a diferença aparece na primeira conferência que alguém fizer.
    ressalva:
      restantes.length > 0
        ? "O histórico e o saldo saem de dois registros diferentes da mesma planilha, e eles divergem em alguns centavos no acervo. A unificação está pendente de decisão."
        : null
  };
}

/**
 * Resolve um id que veio do formulário, ou `null`.
 *
 * Id inexistente vira NULL em silêncio, e não erro: o select do celular pode
 * estar desatualizado (obra encerrada, linha desativada), e recusar o envio
 * inteiro por causa disso faria a pessoa perder o lançamento e a foto. O vazio
 * é declarado e a fila do admin o enxerga; o envio perdido não volta.
 *
 * A tabela vem de uma união fechada, nunca de string do cliente — é o que
 * impede este helper de virar uma via de injeção de nome de tabela.
 */
async function refValida(
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  tabela: "fin_cost_center" | "fin_product_line",
  valor: unknown,
  entityId: number
): Promise<number | null> {
  if (valor === undefined || valor === null || valor === "") return null;
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) return null;
  const r = await client.query(
    `SELECT id FROM ${tabela} WHERE id = $1 AND entity_id = $2 AND is_active`,
    [id, entityId]
  );
  return r.rows[0] ? Number(r.rows[0].id) : null;
}

/**
 * As compras aprovadas que ainda não foram feitas.
 *
 * `aprovada` é "pode comprar"; `atendida` é "comprei". Entre os dois mora esta
 * lista — e ela é de quem PEDIU, resolvida pela sessão como todo o resto deste
 * módulo. Uma assinatura com `personId` aqui seria a porta pela qual, um dia,
 * alguém veria a fila de compras de outra pessoa.
 */
export async function minhasComprasAprovadas(sessao: Sessao) {
  const linhas = await query<{
    id: number;
    code: string;
    title: string;
    amount_cents: string;
    needed_by: Date | null;
    decided_at: Date | null;
    links: number;
  }>(
    `SELECT c.id, c.code, c.title, c.amount_cents::text, c.needed_by, c.decided_at,
            (SELECT count(*) FROM fin_purchase_request_link l WHERE l.purchase_request_id = c.id)::int AS links
       FROM fin_purchase_request c
      WHERE c.requested_person_id = $1 AND c.status = 'aprovada'
      ORDER BY c.needed_by NULLS LAST, c.decided_at`,
    [sessao.personId]
  );
  return linhas.map((l) => ({
    id: Number(l.id),
    code: l.code,
    titulo: l.title,
    pedidoCents: Number(l.amount_cents),
    precisaAte: l.needed_by ? l.needed_by.toISOString().slice(0, 10) : null,
    aprovadaEm: l.decided_at ? l.decided_at.toISOString() : null,
    links: l.links
  }));
}

/**
 * Fecha a compra: registra o que REALMENTE foi gasto.
 *
 * Cria um custo normal — com obra, cartão, comprovante, tudo — e o amarra à
 * solicitação, que passa a `atendida`. Os dois valores ficam: o pedido em
 * `fin_purchase_request.amount_cents`, o gasto no custo. A diferença entre eles
 * é a única medida de quanto a estimativa erra, e sobrescrever o pedido
 * apagaria isso.
 *
 * O índice único da 0139 garante que dois cliques não criem dois custos para a
 * mesma compra. Aqui a checagem vem antes, para a mensagem ser legível em vez
 * de um erro de constraint.
 */
export async function realizarCompra(sessao: Sessao, compraId: number, corpo: NovoEnvio) {
  const id = Number(compraId);
  if (!Number.isInteger(id) || id <= 0) throw new TimeError("qual compra?", 400);

  const compra = await queryOne<{ id: number; status: string }>(
    `SELECT id, status FROM fin_purchase_request WHERE id = $1 AND requested_person_id = $2`,
    [id, sessao.personId]
  );
  if (!compra) throw new TimeError("compra não encontrada", 404);
  if (compra.status === "atendida") throw new TimeError("esta compra já foi registrada", 409);
  if (compra.status !== "aprovada") throw new TimeError("esta compra ainda não foi aprovada", 409);

  const envio = await criarEnvioDoTime(sessao, { ...corpo, kind: "custo" });

  await transaction(async (client) => {
    await client.query(`UPDATE fin_time_envio SET purchase_request_id = $2 WHERE id = $1`, [envio.id, id]);
    await client.query(
      `UPDATE fin_purchase_request SET status = 'atendida', updated_at = now() WHERE id = $1`,
      [id]
    );
    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
       SELECT entity_id, 'fin_purchase_request', $1, 'update', $2::jsonb, ARRAY['status'], $3
         FROM fin_purchase_request WHERE id = $1`,
      [id, JSON.stringify({ status: "atendida", envio: envio.code }), `time:${sessao.personId}`]
    );
  });

  return envio;
}

/**
 * Cadastra um cartão pelo app.
 *
 * Não existia caminho de escrita para cartão na aplicação: um grep por
 * `insert into fin_card` em `.ts` devolvia zero. Cartão só nascia por migration
 * ou por script de sync — e quem está no caixa com um plástico que o sistema
 * não conhece não tinha o que fazer.
 *
 * DUAS NATUREZAS, e elas se comportam diferente:
 *
 *   `empresa` — pertence a uma linha de crédito existente (Nubank, Inter). O
 *               gasto vira dívida da fatura, e o pagamento dela é que é caixa.
 *   `pessoal` — pertence a UMA PESSOA, sem linha de crédito. O gasto nele vira
 *               reembolso: é dinheiro do bolso de alguém que a empresa deve.
 *
 * Cartão pessoal é sempre da pessoa da SESSÃO. Deixar cadastrar cartão em nome
 * de outro abriria a porta para alguém apontar reembolso para o cartão errado —
 * e a única pessoa que sabe o final do cartão dela é ela.
 */
export type NovoCartao = {
  natureza?: unknown;
  banco?: unknown;
  final?: unknown;
  apelido?: unknown;
  bandeira?: unknown;
  tipo?: unknown;
};

const BANDEIRAS = new Set(["visa", "mastercard", "elo", "amex", "hipercard", "outra"]);
const TIPOS_DE_PLASTICO = new Set(["fisico", "virtual", "adicional"]);

export async function cadastrarCartao(sessao: Sessao, corpo: NovoCartao) {
  const natureza = corpo.natureza === "pessoal" ? "pessoal" : "empresa";
  const final = String(corpo.final ?? "").replace(/\D/g, "").slice(-4);
  if (final.length !== 4) throw new TimeError("preciso dos 4 últimos dígitos do cartão");

  const apelido = opcionalTexto(corpo.apelido, 60);
  const bandeira = BANDEIRAS.has(String(corpo.bandeira)) ? String(corpo.bandeira) : null;
  const tipo = TIPOS_DE_PLASTICO.has(String(corpo.tipo)) ? String(corpo.tipo) : "desconhecido";

  return transaction(async (client) => {
    let contaId: number | null = null;
    if (natureza === "empresa") {
      const id = Number(corpo.banco);
      if (!Number.isInteger(id) || id <= 0) throw new TimeError("diga de qual banco é o cartão");
      const a = await client.query(`SELECT id FROM fin_card_account WHERE id = $1 AND is_active`, [id]);
      if (!a.rows[0]) throw new TimeError("banco não encontrado", 404);
      contaId = Number(a.rows[0].id);
    }

    // O índice único da 0142 já barraria, mas a mensagem dele seria um erro de
    // constraint. Aqui a pessoa entende o que aconteceu — e o mais provável é
    // que o cartão dela JÁ esteja cadastrado, o que é uma boa notícia.
    const existe = await client.query<{ id: number; label: string | null }>(
      natureza === "empresa"
        ? `SELECT id, label FROM fin_card WHERE card_account_id = $1 AND last4 = $2`
        : `SELECT id, label FROM fin_card WHERE holder_person_id = $1 AND last4 = $2 AND card_account_id IS NULL`,
      [natureza === "empresa" ? contaId : sessao.personId, final]
    );
    if (existe.rows[0]) {
      throw new TimeError(
        `este cartão já está cadastrado${existe.rows[0].label ? ` como "${existe.rows[0].label}"` : ""}`,
        409
      );
    }

    const r = await client.query<{ id: number }>(
      `INSERT INTO fin_card
         (card_account_id, holder_person_id, last4, label, brand, kind, status,
          origem, cadastrado_por_person_id, cadastrado_em)
       VALUES ($1, $2, $3, $4, $5, $6, 'registrado', 'app_time', $7, now())
       RETURNING id`,
      [
        contaId,
        // Cartão da empresa também guarda quem cadastrou como titular quando é
        // pessoal; no da empresa o titular fica em aberto, porque quem cadastra
        // não é necessariamente quem carrega o plástico.
        natureza === "pessoal" ? sessao.personId : null,
        final,
        apelido,
        bandeira,
        tipo,
        sessao.personId
      ]
    );

    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
       VALUES ((SELECT id FROM fin_entity WHERE slug = $5), 'fin_card', $1, 'insert', $2::jsonb,
               ARRAY['last4','label','brand','kind'], $3)`,
      [
        r.rows[0].id,
        JSON.stringify({ last4: final, label: apelido, brand: bandeira, kind: tipo, natureza }),
        `time:${sessao.personId}`,
        null,
        ENTITY
      ]
    );

    return { id: Number(r.rows[0].id), final, apelido, bandeira, natureza };
  });
}

/**
 * Sugere a categoria a partir de QUEM recebeu o dinheiro.
 *
 * ---------------------------------------------------------------------------
 * POR QUE PELA CONTRAPARTE, E NUNCA PELO TEXTO
 * ---------------------------------------------------------------------------
 * Medido no acervo: buscar "posto" devolve 261 receitas somando R$ 103.755,62
 * contra 842 despesas de R$ 6.351,14 — dezesseis vezes mais receita que
 * despesa, porque a XPE tem clientes chamados "Posto Quarto de Milha". Palavra
 * do título é o sinal mais fraco que existe aqui.
 *
 * O CNPJ é o mais forte, e ele já vem da foto: a extração lê o documento do
 * comprovante e até agora o descartava. Medido por backtest prospectivo, só
 * sobre lançamentos rotulados por HUMANO (os rotulados por regra de contraparte
 * seriam circulares — a regra medindo a si mesma):
 *
 *   contraparte com ≥5 lançamentos anteriores ....... 76,4% de acerto
 *   chute cego (categoria mais comum) ............... 26,7%
 *
 * Um em quatro vem errado, e é por isso que isto SUGERE e mostra a razão. A
 * pessoa lê "você já classificou isto como X, 7 vezes" e decide. Preencher em
 * silêncio com 76% seria transformar um em cada quatro custos num erro que
 * ninguém confere, porque já veio preenchido.
 */
export async function sugerirCategoria(documento: string) {
  const digitos = String(documento ?? "").replace(/\D/g, "");
  if (digitos.length !== 11 && digitos.length !== 14) return null;

  // Lê a VIEW, não o ledger. `test-perfil-guard` proíbe este módulo de tocar a
  // tabela de lançamentos, e a regra está certa: o prefixo /api/time é o único
  // caminho de escrita do perfil comum, e o que o sustenta é ele não alcançar o
  // ledger. A view expõe documento, categoria e contagem — nunca valor.
  const linha = await queryOne<{
    category_id: number;
    categoria_code: string;
    categoria_nome: string;
    contraparte: string;
    vezes: number;
    total: number;
    forte: boolean;
  }>(
    `SELECT category_id, categoria_code, categoria_nome, contraparte, vezes, total, forte
       FROM fin_sugestao_categoria_v WHERE documento = $1`,
    [digitos]
  );
  if (!linha) return null;

  return {
    categoriaId: Number(linha.category_id),
    rotulo: `${linha.categoria_code} ${linha.categoria_nome}`,
    contraparte: linha.contraparte,
    vezes: Number(linha.vezes),
    total: Number(linha.total),
    forte: linha.forte === true
  };
}

/**
 * O que os formulários oferecem. Nada de dinheiro aqui.
 *
 * Além dos tipos e das categorias, vêm os dois níveis do eixo DESTINO:
 *
 *   `centros`  a obra ou o projeto. UM TOQUE e preenche dois eixos — o núcleo
 *              sai daqui, e a linha de produto sai do projeto. É o campo que
 *              tira o centro de custo dos 0,0% em que está.
 *   `linhas`   a linha de serviço (LDC, LIE, ICV…), para quando NÃO há projeto:
 *              combustível para rodar um laudo acontece antes do contrato
 *              existir, ou cobre três clientes no mesmo dia.
 *
 * Os projetos vêm antes dos funcionais na ordenação porque é neles que o custo
 * de campo cai, e são eles que a pessoa procura.
 */
export async function opcoesDoTime() {
  const [tipos, categorias, centros, linhas, cartoes] = await Promise.all([
    query<{ slug: string; name: string; requires_nfe: boolean }>(
      `SELECT slug, name, requires_nfe FROM fin_reimbursement_type WHERE is_active ORDER BY sort_order, name`
    ),
    query<{ id: number; code: string; name: string }>(
      `SELECT c.id, c.code, c.name FROM fin_category c
         JOIN fin_entity e ON e.id = c.entity_id AND e.slug = $1
        WHERE c.code LIKE '4.%' OR c.code LIKE '5.%' OR c.code LIKE '8.%'
        ORDER BY c.code`,
      [ENTITY]
    ),
    // Ordenadas por USO RECENTE, não por nome — a contagem vem de
    // `fin_centro_uso_recente_v` (0144), e não de `fin_transaction`: o app do
    // time não alcança o ledger, e ordenar uma lista não é motivo para abrir
    // exceção nessa regra.
    //
    // Medido: os cinco centros mais usados nos últimos 90 dias cobrem 61,2% dos
    // lançamentos que têm centro de custo. Ordenar por eles transforma uma
    // busca entre 28 opções em cinco toques prováveis — e NÃO decide nada, que
    // é a diferença entre ajudar e chutar. Pré-selecionar a obra seria um
    // palpite gravado com cara de fato, num campo cuja função é justamente
    // tirar o indicador de destino dos 0,0%.
    query<{ id: number; name: string; kind: string; nucleo: string | null; recentes: number }>(
      `SELECT cc.id, cc.name, cc.kind, cc.nucleo, u.recentes
         FROM fin_cost_center cc
         JOIN fin_entity e ON e.id = cc.entity_id AND e.slug = $1
         JOIN fin_centro_uso_recente_v u ON u.cost_center_id = cc.id
        WHERE cc.is_active
        ORDER BY (cc.kind <> 'projeto'), u.recentes DESC, cc.name`,
      [ENTITY]
    ),
    query<{ id: number; slug: string; name: string }>(
      `SELECT pl.id, pl.slug, pl.name FROM fin_product_line pl
         JOIN fin_entity e ON e.id = pl.entity_id AND e.slug = $1
        WHERE pl.is_active
        ORDER BY pl.sort_order, pl.name`,
      [ENTITY]
    ),
    // Os BANCOS, com os plásticos vivos dentro de cada um.
    //
    // O banco é o que se pergunta; o plástico é opcional. O Inter tem ZERO
    // plásticos cadastrados (a fonte não os expõe) e mesmo assim precisa ser
    // escolhível — senão não há como registrar uma compra feita nele, que é
    // justamente onde estão os R$ 40.862,41 sem itemização de 2026.
    //
    // Cartão histórico ou cancelado fica de fora: escolher um que não existe
    // mais garante que a fatura nunca vai casar.
    query<{
      conta_id: number;
      conta: string;
      emissor: string | null;
      card_id: number | null;
      last4: string | null;
      label: string | null;
      brand: string | null;
    }>(
      `SELECT a.id AS conta_id, coalesce(i.name, a.name) AS conta, i.name AS emissor,
              c.id AS card_id, c.last4, c.label, c.brand
         FROM fin_card_account a
         LEFT JOIN fin_card_issuer i ON i.id = a.issuer_id
         LEFT JOIN fin_card c ON c.card_account_id = a.id AND c.status = 'registrado'
        WHERE a.is_active AND a.nature = 'credito'
        ORDER BY conta, (c.label IS NULL), c.label, c.last4`
    )
  ]);
  return {
    tipos: tipos.map((t) => ({ slug: t.slug, nome: t.name, exigeNfe: t.requires_nfe })),
    categorias: categorias.map((c) => ({ id: Number(c.id), rotulo: `${c.code} ${c.name}` })),
    centros: centros.map((c) => ({
      id: Number(c.id),
      nome: c.name,
      ehProjeto: c.kind === "projeto",
      nucleo: c.nucleo,
      recentes: Number(c.recentes ?? 0)
    })),
    linhas: linhas.map((l) => ({ id: Number(l.id), slug: l.slug, nome: l.name })),
    bancos: Object.values(
      cartoes.reduce<
        Record<
          number,
          { id: number; nome: string; plasticos: { id: number; nome: string; final: string | null; bandeira: string | null }[] }
        >
      >(
        (acc, l) => {
          const id = Number(l.conta_id);
          acc[id] ??= { id, nome: l.conta, plasticos: [] };
          if (l.card_id) {
            acc[id].plasticos.push({
              id: Number(l.card_id),
              // Sem apelido cadastrado, o final é o que existe. Melhor
              // "final 7626" que um nome inventado que ninguém reconhece.
              nome: l.label ?? `final ${l.last4 ?? "????"}`,
              final: l.last4,
              bandeira: l.brand
            });
          }
          return acc;
        },
        {}
      )
    )
  };
}
