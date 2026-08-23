import Link from "next/link";

/**
 * O 404 do app do time.
 *
 * ---------------------------------------------------------------------------
 * O ÚNICO BECO SEM SAÍDA QUE EXISTIA
 * ---------------------------------------------------------------------------
 * Sem este arquivo, uma URL inválida sob `/time` caía no 404 padrão do Next:
 * página branca, "This page could not be found." em inglês, sem barra
 * inferior, sem link nenhum.
 *
 * Num navegador isso é um incômodo. Aqui é uma armadilha: o
 * `manifest.webmanifest` declara `display: "standalone"`, então no app
 * instalado NÃO EXISTE barra de endereço. A única saída era o gesto de voltar
 * do sistema — e quem chegou por um link velho no WhatsApp não tem para onde
 * voltar. Fica preso numa tela em inglês que não parece o app dele.
 *
 * Não uso `TimeApp` aqui de propósito: ele são ~6.000 linhas que buscam sessão,
 * opções e envios, e o 404 não precisa de nada disso — precisa carregar rápido
 * e ter um caminho. As três portas cobrem o que a pessoa provavelmente queria.
 */

export const metadata = { title: "Não achei — XPE Time" };

export default function TimeNaoAchei() {
  return (
    <div className="time-tela-padrao">
      <header className="time-form-cabeca">
        <h1>Não achei essa tela</h1>
        <p>O endereço pode ter mudado, ou o link que te trouxe já era.</p>
      </header>

      <div className="time-404-portas">
        <Link href="/time" className="time-botao time-botao-largo">
          Ir para o Início
        </Link>
        <Link href="/time/envios" className="time-botao secundario time-botao-largo">
          Ver meu histórico
        </Link>
        <Link href="/time/recebiveis" className="time-botao secundario time-botao-largo">
          Ver o que eu recebo
        </Link>
      </div>
    </div>
  );
}
