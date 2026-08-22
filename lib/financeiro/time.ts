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
  try {
    const r = await queryOne<{ ok: boolean }>(
      `SELECT (to_regclass('fin_time_envio') IS NOT NULL
           AND to_regclass('fin_time_sessao') IS NOT NULL
           AND to_regclass('fin_notificacao') IS NOT NULL) AS ok`
    );
    return r?.ok === true;
  } catch (erro) {
    if (erro instanceof FinanceUnavailableError) return false;
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
  nfeKey?: unknown;
  nfeNumero?: unknown;
  nfeSerie?: unknown;
  anexo?: AnexoEntrada | null;
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

  const nfeBruta = typeof corpo.nfeKey === "string" ? corpo.nfeKey.replace(/\D/g, "") : "";
  if (nfeBruta && nfeBruta.length !== 44) throw new TimeError("a chave da NF-e tem 44 dígitos");
  const fornecedor = opcionalTexto(corpo.fornecedor, 200);
  const nfeNumero = opcionalTexto(corpo.nfeNumero, 40);

  if (corpo.kind === "nota_entrada" && !nfeBruta && !nfeNumero && !fornecedor) {
    throw new TimeError("uma nota precisa de pelo menos a chave, o número ou o nome de quem emitiu");
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

    const envio = await client.query<{ id: number; code: string }>(
      `INSERT INTO fin_time_envio
         (entity_id, kind, person_id, identidade_prova, titulo, descricao, amount_cents,
          incurred_on, due_on, pagamento, ja_pago, categoria_sugerida_id,
          fornecedor_nome, fornecedor_documento, nfe_key, nfe_numero, nfe_serie, nfe_emissao,
          status, enviado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, $11, $12, $13, $14, $15, $16, $17,
               CASE WHEN $2 = 'nota_entrada' THEN $8::date ELSE NULL END,
               'enviado', now())
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
        opcionalTexto(corpo.nfeSerie, 10)
      ]
    );

    let chave: string | null = null;
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

    return { id: envio.rows[0].id, code: envio.rows[0].code, anexo: chave };
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

/** Os tipos de reembolso e as categorias que a tela oferece. Nada de dinheiro aqui. */
export async function opcoesDoTime() {
  const [tipos, categorias] = await Promise.all([
    query<{ slug: string; name: string; requires_nfe: boolean }>(
      `SELECT slug, name, requires_nfe FROM fin_reimbursement_type WHERE is_active ORDER BY sort_order, name`
    ),
    query<{ id: number; code: string; name: string }>(
      `SELECT c.id, c.code, c.name FROM fin_category c
         JOIN fin_entity e ON e.id = c.entity_id AND e.slug = $1
        WHERE c.code LIKE '4.%' OR c.code LIKE '5.%' OR c.code LIKE '8.%'
        ORDER BY c.code`,
      [ENTITY]
    )
  ]);
  return {
    tipos: tipos.map((t) => ({ slug: t.slug, nome: t.name, exigeNfe: t.requires_nfe })),
    categorias: categorias.map((c) => ({ id: Number(c.id), rotulo: `${c.code} ${c.name}` }))
  };
}
