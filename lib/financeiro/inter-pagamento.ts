import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";

/**
 * Cliente mTLS de ESCRITA para o Banco Inter — inclusão de pagamento PIX.
 *
 * ===========================================================================
 * O ÚNICO VERBO QUE EXISTE AQUI É "INCLUIR PAGAMENTO"
 * ===========================================================================
 * A regra do dono, literal: "quero apenas programar os pagamentos, mas toda
 * aprovação vai ter que ser feita pelo aplicativo do banco, ou seja lança para
 * pagamento mas não realiza o pagamento."
 *
 * A migration 0075 diz o mesmo do lado do schema: `aguardando_autorizacao` é o
 * estado em que o produto termina o seu trabalho — a pessoa está no aplicativo
 * do banco e nenhuma transição a partir dali é automática.
 *
 * Portanto: se a API Banking do Inter tiver endpoint de aprovação, autorização
 * em lote, confirmação ou cancelamento de pagamento — e ela provavelmente tem,
 * porque os ERPs que integram com ela oferecem "aprovar pelo sistema" — ELE NÃO
 * ENTRA NESTE ARQUIVO. Não é esquecimento nem falta de tempo: é a regra. Quem
 * for acrescentar um segundo verbo aqui está mudando a garantia do produto e
 * precisa da decisão do dono antes, não do code review depois.
 *
 * ===========================================================================
 * POR QUE `node:https` E NÃO `fetch`
 * ===========================================================================
 * O `fetch` global do Node IGNORA `https.Agent` em silêncio: a requisição sai,
 * sem certificado de cliente, e o Inter devolve erro de handshake que parece
 * credencial errada. Mesma decisão de `scripts/lib/inter.mjs`, e pelo mesmo
 * motivo — mandar certificado por fetch exigiria um dispatcher do `undici`,
 * dependência nova para resolver o que `node:https` resolve com zero.
 *
 * ===========================================================================
 * CREDENCIAIS SEPARADAS DAS DE LEITURA — E ISSO NÃO É ZELO EXCESSIVO
 * ===========================================================================
 * `docs/integracao-bancaria-open-finance-e-inter.md:150` registra o aviso da
 * Conta Azul: marcar permissões além de "Consultar extrato e saldo" numa
 * integração do Inter **faz a integração falhar**. A integração de hoje é a que
 * alimenta o extrato — o sync inteiro do financeiro depende dela. Pedir escopo
 * de pagamento NA MESMA integração arrisca derrubar a leitura para ganhar a
 * escrita.
 *
 * Então este arquivo lê variáveis PRÓPRIAS, de uma SEGUNDA integração criada no
 * Internet Banking com o escopo de pagamento, e nunca as de leitura:
 *
 *   INTER_PAG_CLIENT_ID
 *   INTER_PAG_CLIENT_SECRET
 *   INTER_PAG_CERT_PATH
 *   INTER_PAG_KEY_PATH
 *   INTER_PAG_CONTA_CORRENTE   (opcional — vira header `x-conta-corrente`)
 *
 * Não há variante `_B64`, ao contrário do cliente de leitura. Ela existe lá
 * porque o container do Railway não recebe arquivo — e produção é exatamente
 * onde este módulo não pode rodar (ver a trava abaixo). Caminho de arquivo
 * basta, e a ausência do base64 é mais uma porta fechada.
 *
 * NADA daqui logga ou devolve client_secret, token, certificado ou chave. As
 * mensagens de erro nunca ecoam o corpo ENVIADO — só o recebido.
 */

/*
 * ===========================================================================
 * CONSTANTES NÃO VERIFICADAS — leia antes do primeiro teste real
 * ===========================================================================
 * O Inter NÃO publica OpenAPI. `docs/integracao-bancaria-open-finance-e-inter.md:175`
 * registra o método: o portal é uma aplicação JavaScript que não entrega
 * conteúdo a leitor automatizado, e a especificação não está em URL pública.
 * Tudo o que a casa sabe sobre a API veio de bibliotecas open-source e da
 * documentação de ERPs.
 *
 * Some-se a isso o fato decisivo: a credencial que a XPE tem hoje é
 * `extrato.read` e SÓ LEITURA. Nenhuma linha abaixo pôde ser exercitada contra
 * a API real. Nem uma.
 *
 * Por isso endpoint, escopo, nome de header e forma do corpo estão concentrados
 * AQUI, e não espalhados pelas funções: a primeira chamada real quase
 * certamente vai corrigir algum deles, e a correção tem de ser de uma linha num
 * lugar só. O que se sabe de cada um:
 *
 *   HOST_INTER          VERIFICADO — o sync de extrato usa este host todo dia.
 *   CAMINHO_TOKEN       VERIFICADO — mesmo endpoint do cliente de leitura.
 *   CAMINHO_PIX         PALPITE. Vem do padrão /banking/v2/* dos endpoints de
 *                       leitura que funcionam. Pode ser /banking/v2/pix, pode
 *                       ser /pix/v2/... (o Inter tem família "Pix" separada da
 *                       "Banking"), pode exigir sufixo.
 *   ESCOPO_PIX_ESCRITA  PALPITE. Segue a convenção `<recurso>.<verbo>` do
 *                       `extrato.read`. O nome que o portal mostra ao criar a
 *                       integração é a fonte da verdade.
 *   HEADER_IDEMPOTENCIA PALPITE. Nenhuma fonte consultada nomeia o header de
 *                       idempotência do Inter. Mandar um header que o banco
 *                       ignora é inofensivo; ACREDITAR que ele protege sem
 *                       verificar não é — por isso a ordem também guarda a
 *                       chave no banco (lib/financeiro/pagar-programar.ts).
 *   HEADER_CONTA        VERIFICADO — doc 2.4: "necessário só se a aplicação
 *                       estiver ligada a mais de uma conta".
 *   Forma do corpo      PALPITE inteiro, campo a campo.
 */
const HOST_INTER = "cdpj.partners.bancointer.com.br";
const CAMINHO_TOKEN = "/oauth/v2/token";
const CAMINHO_PIX = "/banking/v2/pix";
const ESCOPO_PIX_ESCRITA = "pagamento-pix.write";
const HEADER_IDEMPOTENCIA = "x-id-idempotente";
const HEADER_CONTA = "x-conta-corrente";

/**
 * Teto por requisição. O cliente de leitura usa 60s, que serve a um job em
 * lote; aqui a chamada acontece dentro de um request HTTP do admin, e uma
 * requisição pendurada por um minuto é pior que uma falha rápida com o motivo.
 */
const TIMEOUT_MS = 30_000;

/** Margem do cache de token, igual à do cliente de leitura (scripts/lib/inter.mjs:112). */
const MARGEM_TOKEN_S = 60;

export type OrdemPix = {
  valorCents: number;
  chave: string;
  /** YYYY-MM-DD, ou null para "hoje" — o campo sai do corpo quando é null. */
  dataPagamento: string | null;
  descricao: string;
};

export type RespostaPix = {
  codigoSolicitacao: string | null;
  tipoRetorno: string | null;
  status: string | null;
  httpStatus: number;
  cru: unknown;
};

/**
 * Erro de chamada ao Inter, com o status e o CORPO do banco preservados.
 *
 * O corpo de erro do Inter não traz segredo — ele descreve o que estava errado
 * na requisição — e propagá-lo é o que faz o primeiro teste real ser
 * diagnóstico em vez de adivinhação. Sem isto, "HTTP 400" seria a única pista
 * para descobrir qual dos palpites acima estava errado.
 */
export class ErroInterPagamento extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly corpo: string
  ) {
    super(message);
    this.name = "ErroInterPagamento";
  }
}

/**
 * A escrita bancária está ligada?
 *
 * DUAS condições, e a dupla é deliberada:
 *
 *   NODE_ENV !== "production"     sozinho não protege. `next build` e
 *                                 `next start` na máquina do dono põem
 *                                 NODE_ENV=production — e aí a trava cairia
 *                                 justamente na hora em que alguém está
 *                                 testando o build localmente, que é quando o
 *                                 dedo escorrega.
 *
 *   INTER_PAGAMENTO_LOCAL === "1" sozinha não protege. Variável de ambiente é
 *                                 exatamente o tipo de coisa que se liga "só
 *                                 para testar" no painel do Railway e fica
 *                                 ligada. `git push` na main É o deploy
 *                                 (AGENTS.md), então não existe passo manual
 *                                 onde alguém repararia.
 *
 * Juntas: para a escrita acontecer em produção, seria preciso ligar a variável
 * NO RAILWAY **e** o Railway parar de rodar em modo produção. Não acontece por
 * acidente.
 *
 * Devolve motivo legível em vez de boolean seco porque quem chamar a rota e
 * levar 503 precisa saber QUAL das duas faltou.
 */
export function pagamentoInterHabilitado(): { ok: boolean; motivo: string | null } {
  if (process.env.NODE_ENV === "production") {
    return {
      ok: false,
      motivo:
        "escrita bancária desligada: NODE_ENV=production. Programar pagamento no Inter só roda na máquina local, por decisão do dono."
    };
  }
  if (process.env.INTER_PAGAMENTO_LOCAL !== "1") {
    return {
      ok: false,
      motivo:
        "escrita bancária desligada: INTER_PAGAMENTO_LOCAL não está em '1'. Ligue no .env.local para habilitar o envio ao Inter."
    };
  }
  return { ok: true, motivo: null };
}

/** Levanta se a escrita estiver desligada. Chamado ANTES de abrir socket. */
function exigirHabilitado(): void {
  const { ok, motivo } = pagamentoInterHabilitado();
  if (!ok) throw new ErroInterPagamento(motivo ?? "escrita bancária desligada", 503, "");
}

function lerArquivo(variavel: string, rotulo: string): string {
  const caminho = process.env[variavel]?.trim();
  if (!caminho) {
    throw new ErroInterPagamento(`${rotulo} não configurado: defina ${variavel}`, 503, "");
  }
  const absoluto = resolve(caminho);
  if (!existsSync(absoluto)) {
    throw new ErroInterPagamento(`${rotulo} não encontrado em ${variavel}`, 503, "");
  }
  return readFileSync(absoluto, "utf8");
}

type Credenciais = { clientId: string; clientSecret: string; cert: string; key: string; conta: string | null };

/**
 * Lidas a cada chamada, de propósito.
 *
 * Cachear cert e chave em memória de módulo economizaria dois `readFileSync` de
 * poucos KB — e, num módulo que só roda na máquina local e algumas vezes por
 * dia, isso não vale manter material criptográfico vivo no processo entre
 * requisições. O cache que importa é o do token, logo abaixo.
 */
function credenciais(): Credenciais {
  const clientId = process.env.INTER_PAG_CLIENT_ID?.trim();
  const clientSecret = process.env.INTER_PAG_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new ErroInterPagamento(
      "INTER_PAG_CLIENT_ID/INTER_PAG_CLIENT_SECRET ausentes — a integração de pagamento é SEPARADA da de extrato",
      503,
      ""
    );
  }
  return {
    clientId,
    clientSecret,
    cert: lerArquivo("INTER_PAG_CERT_PATH", "certificado de pagamento"),
    key: lerArquivo("INTER_PAG_KEY_PATH", "chave privada de pagamento"),
    conta: process.env.INTER_PAG_CONTA_CORRENTE?.trim() || null
  };
}

function pedir(args: {
  cert: string;
  key: string;
  path: string;
  method: string;
  headers?: Record<string, string | number>;
  body?: string;
}): Promise<{ status: number; body: string }> {
  return new Promise((resolver, rejeitar) => {
    const req = httpsRequest(
      {
        host: HOST_INTER,
        path: args.path,
        method: args.method,
        headers: args.headers ?? {},
        cert: args.cert,
        key: args.key,
        timeout: TIMEOUT_MS
      },
      (res) => {
        let dados = "";
        res.on("data", (pedaco) => (dados += pedaco));
        res.on("end", () => resolver({ status: res.statusCode ?? 0, body: dados }));
      }
    );
    req.on("timeout", () => req.destroy(new Error(`timeout de ${TIMEOUT_MS / 1000}s`)));
    req.on("error", rejeitar);
    if (args.body) req.write(args.body);
    req.end();
  });
}

/**
 * Cache por ESCOPO, não global.
 *
 * O token do Inter é emitido para um escopo; reaproveitar o de `extrato.read`
 * numa chamada de pagamento devolveria 403 e o erro pareceria "credencial sem
 * permissão" em vez de "cache errado". A chave do mapa evita a confusão.
 */
const tokensPorEscopo = new Map<string, { token: string; expiraEm: number }>();

/**
 * Token OAuth client_credentials com mTLS.
 *
 * Vale 60 minutos (doc 2.3) e é para ser reutilizado. Guarda com 60s de margem,
 * no molde de scripts/lib/inter.mjs:81-114.
 */
export async function obterTokenPagamento(escopo: string): Promise<string> {
  exigirHabilitado();

  const emCache = tokensPorEscopo.get(escopo);
  if (emCache && Date.now() < emCache.expiraEm) return emCache.token;

  const { clientId, clientSecret, cert, key } = credenciais();
  const corpo = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: escopo
  }).toString();

  const res = await pedir({
    cert,
    key,
    path: CAMINHO_TOKEN,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(corpo)
    },
    body: corpo
  });

  // A mensagem NUNCA ecoa o corpo enviado: ali vai o client_secret. O corpo
  // RECEBIDO entra porque é a mensagem do banco sobre o que estava errado, e
  // com escopo não verificado (ver constantes) é a única pista útil.
  if (res.status !== 200) {
    throw new ErroInterPagamento(
      `token do Inter falhou para o escopo "${escopo}": HTTP ${res.status}`,
      res.status,
      res.body.slice(0, 500)
    );
  }

  let json: { access_token?: string; expires_in?: number };
  try {
    json = JSON.parse(res.body) as { access_token?: string; expires_in?: number };
  } catch {
    throw new ErroInterPagamento("token do Inter veio em corpo não-JSON", res.status, res.body.slice(0, 300));
  }
  if (!json.access_token) {
    throw new ErroInterPagamento("token do Inter veio sem access_token", res.status, "");
  }

  const token = json.access_token;
  tokensPorEscopo.set(escopo, {
    token,
    expiraEm: Date.now() + Math.max(0, (json.expires_in ?? 3600) - MARGEM_TOKEN_S) * 1000
  });
  return token;
}

/**
 * Centavos → reais com 2 casas, por inteiro.
 *
 * `valorCents / 100` seria correto até 2^53, mas `toFixed` sobre float é o
 * lugar clássico onde um centavo some num arredondamento. Aqui não há float:
 * parte inteira e resto, formatados como texto.
 */
function reais(valorCents: number): string {
  const negativo = valorCents < 0;
  const abs = Math.abs(Math.trunc(valorCents));
  const texto = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negativo ? `-${texto}` : texto;
}

/**
 * Inclui um pagamento PIX por chave.
 *
 * INCLUI. Não aprova, não autoriza, não confirma e não consulta-para-aprovar.
 * O que sai daqui é uma ordem esperando um humano no aplicativo do banco — o
 * `tipoRetorno` da resposta é justamente o que o Inter usa para dizer se a
 * ordem ficou pendente de aprovação, e o produto trata QUALQUER retorno como
 * "aguardando autorização" (ver lib/financeiro/pagar-programar.ts).
 *
 * `idempotencia` vai no header E é gravada no banco pelo chamador. O header é
 * palpite (ver constantes); o registro no banco não é, e é ele que garante que
 * reenviar a mesma ordem não crie uma segunda.
 */
export async function incluirPagamentoPix(ordem: OrdemPix, idempotencia: string): Promise<RespostaPix> {
  exigirHabilitado();

  if (!Number.isSafeInteger(ordem.valorCents) || ordem.valorCents <= 0) {
    throw new ErroInterPagamento("valorCents tem de ser inteiro positivo", 422, "");
  }
  if (!ordem.chave.trim()) {
    throw new ErroInterPagamento("chave PIX vazia", 422, "");
  }

  const { cert, key, conta } = credenciais();
  const bearer = await obterTokenPagamento(ESCOPO_PIX_ESCRITA);

  // Forma do corpo: PALPITE inteiro (ver bloco de constantes). `valor` vai como
  // número JSON porque é assim que as bibliotecas open-source consultadas o
  // mostram; se o Inter exigir string, é uma linha.
  const corpoObj: Record<string, unknown> = {
    valor: Number(reais(ordem.valorCents)),
    descricao: ordem.descricao.slice(0, 140),
    destinatario: { tipo: "CHAVE", chave: ordem.chave.trim() }
  };
  // Omitido quando null: mandar `dataPagamento: null` costuma ser recusado como
  // campo inválido, enquanto ausente significa "hoje".
  if (ordem.dataPagamento) corpoObj.dataPagamento = ordem.dataPagamento;

  const corpo = JSON.stringify(corpoObj);
  const headers: Record<string, string | number> = {
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Content-Length": Buffer.byteLength(corpo),
    [HEADER_IDEMPOTENCIA]: idempotencia
  };
  // Só quando declarado: a app ligada a mais de uma conta exige o header, e a
  // ligada a uma só pode recusá-lo (doc 2.4).
  if (conta) headers[HEADER_CONTA] = conta;

  const res = await pedir({ cert, key, path: CAMINHO_PIX, method: "POST", headers, body: corpo });

  let cru: unknown = null;
  try {
    cru = res.body ? JSON.parse(res.body) : null;
  } catch {
    cru = res.body;
  }

  if (res.status < 200 || res.status >= 300) {
    // O corpo do banco vai junto. Sem ele, o primeiro teste real seria um
    // "HTTP 404" mudo sobre qual dos palpites acima está errado.
    throw new ErroInterPagamento(
      `Inter POST ${CAMINHO_PIX} falhou: HTTP ${res.status}`,
      res.status,
      res.body.slice(0, 1000)
    );
  }

  const objeto = (cru ?? {}) as Record<string, unknown>;
  const texto = (valor: unknown): string | null => (typeof valor === "string" && valor ? valor : null);

  return {
    codigoSolicitacao: texto(objeto.codigoSolicitacao) ?? texto(objeto.codigoSolicitacaoPagamento),
    tipoRetorno: texto(objeto.tipoRetorno),
    status: texto(objeto.status),
    httpStatus: res.status,
    cru
  };
}
