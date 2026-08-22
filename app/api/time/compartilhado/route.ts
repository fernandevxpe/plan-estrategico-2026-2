import { cookies } from "next/headers";

import { lerCorpo, sessaoAtual } from "@/app/api/time/_sessao";
import { COOKIE_SESSAO, guardarAnexoAvulso } from "@/lib/financeiro/time";

/**
 * Recebe o arquivo que veio da folha de compartilhamento do sistema.
 *
 * O fluxo que isto habilita: a pessoa recebe o comprovante no app do banco,
 * toca em compartilhar, escolhe XPE — e chega aqui, com o arquivo no corpo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTA ROTA REDIRECIONA EM VEZ DE RESPONDER
 * ---------------------------------------------------------------------------
 * O `share_target` do manifest faz o navegador NAVEGAR para esta URL com um
 * POST. Se ela devolvesse JSON, a pessoa veria JSON cru na tela — o navegador
 * está navegando, não fazendo fetch. Então ela guarda o arquivo, e manda a
 * pessoa para o formulário com a chave na URL.
 *
 * O 303 (See Other) é deliberado: ele converte o POST num GET no destino. Com
 * 302 alguns navegadores repetiriam o POST no formulário, e um "atualizar" na
 * página reenviaria o arquivo.
 *
 * ---------------------------------------------------------------------------
 * SEM SESSÃO, NÃO SE PERDE O ARQUIVO
 * ---------------------------------------------------------------------------
 * Quem compartilha pode não estar logado. Devolver 401 aqui jogaria fora o
 * comprovante que a pessoa acabou de mandar — e ela não tenta de novo. Então
 * manda para o login, e o `?compartilhado=1` faz a tela dizer por que ela está
 * ali em vez de parecer que o compartilhamento não funcionou.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const base = new URL(request.url).origin;

  const sessao = await sessaoAtual();
  if (!sessao) {
    return Response.redirect(`${base}/time?compartilhado=1`, 303);
  }

  try {
    const { dados, arquivo } = await lerCorpo(request);
    if (!arquivo) {
      // Compartilhamento só de texto ou link: ainda serve de rascunho.
      const titulo = typeof dados.titulo === "string" ? dados.titulo : "";
      const texto = typeof dados.texto === "string" ? dados.texto : "";
      const destino = new URL(`${base}/time/custo`);
      if (titulo || texto) destino.searchParams.set("titulo", `${titulo} ${texto}`.trim().slice(0, 200));
      return Response.redirect(destino.toString(), 303);
    }

    const token = (await cookies()).get(COOKIE_SESSAO)?.value ?? null;
    const chave = await guardarAnexoAvulso(sessao, arquivo, token);

    const destino = new URL(`${base}/time/custo`);
    destino.searchParams.set("anexo", chave);
    destino.searchParams.set("nome", arquivo.nome.slice(0, 120));
    return Response.redirect(destino.toString(), 303);
  } catch {
    // Erro aqui não pode virar página branca: a pessoa está no meio de um
    // gesto do sistema operacional e não tem como voltar com o arquivo.
    return Response.redirect(`${base}/time/custo?erro=compartilhamento`, 303);
  }
}
