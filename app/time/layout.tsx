import { TimeShell } from "@/components/time/TimeShell";

/**
 * O layout do app do time.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ELE NÃO USA O `AppShell`
 * ---------------------------------------------------------------------------
 * Usava. E isso virou um vazamento no dia em que `/time` saiu de trás do Basic
 * Auth para poder ser instalado: o `AppShell` lê `sync-state.json` e monta o
 * indicador de frescor, cujo `title` concatena `lastError` e o nome da etapa
 * que falhou. Ou seja, a mensagem crua do pipeline (Pipedrive, Meta, Chatwoot,
 * Inter) ia para dentro do HTML de uma página que agora responde sem
 * credencial. Junto ia o menu inteiro da plataforma — o mapa de rotas para
 * quem nunca provou nada.
 *
 * Nada disso é do app do time. Ele tem seis telas e uma pergunta: o que você
 * precisa mandar para o financeiro. O casco próprio resolve o vazamento e, de
 * quebra, é o que o Fernando pediu — "desacoplado na interface, backend 100%
 * integrado".
 *
 * NÃO HÁ LINK DE VOLTA PARA A PLATAFORMA, e a ausência é deliberada. `/` é
 * protegida por Basic Auth, então esse link era o único caminho de dentro do
 * app para uma URL que responde 401 — e um 401 no Android faz o Chrome abrir a
 * caixa de usuário e senha do navegador, que é exatamente o que não pode
 * acontecer num app instalado. Quem quiser a plataforma digita o endereço.
 */
export const dynamic = "force-dynamic";

export default function TimeLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="page time-page">
      <div className="shell" id="conteudo">
        <TimeShell>{children}</TimeShell>
      </div>
    </main>
  );
}
