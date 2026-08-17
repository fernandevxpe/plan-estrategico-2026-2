/**
 * O vocabulário de certeza, em componentes.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO EXISTE
 * ---------------------------------------------------------------------------
 * A base inteira foi construída sobre uma regra: uma medida pode ser nula,
 * nunca pode ser nula SEM MOTIVO. `lib/financeiro/contratos/base.ts` já modela
 * isso do lado do servidor — `Medida` carrega `valorCents: number | null` mais
 * o motivo quando é null.
 *
 * O que faltava era a outra ponta. Uma API que devolve o motivo e uma tela que
 * mostra "R$ 0,00" reintroduz exatamente a mentira que o banco foi construído
 * para não contar: zero é afirmação sobre o dinheiro, ausência é afirmação
 * sobre o dado. Estes componentes existem para tornar essa confusão difícil de
 * cometer — quem passar um valor nulo sem motivo recebe um erro de tipo.
 * ---------------------------------------------------------------------------
 */

export type Camada = "firme" | "provavel" | "observado" | "atrasado" | "indeterminado";

const ROTULO: Record<Camada, string> = {
  firme: "firme",
  provavel: "provável",
  observado: "observado",
  atrasado: "atrasado",
  indeterminado: "indeterminado"
};

/** O que cada camada significa, para o title= — a tela ensina o vocabulário. */
const EXPLICA: Record<Camada, string> = {
  firme: "cobrança emitida ou documento: data e valor certos",
  provavel: "o contrato declara, mas a cobrança ainda não saiu",
  observado: "paga há 12+ meses sem contrato formal — padrão, não promessa",
  atrasado: "já deveria ter entrado; não é receita de mês futuro",
  indeterminado: "sem evidência suficiente para afirmar"
};

export function SeloCamada({ camada, texto }: { camada: Camada; texto?: string }) {
  return (
    <span className="cert-selo" data-cert={camada} title={EXPLICA[camada]}>
      {texto ? `${ROTULO[camada]} · ${texto}` : ROTULO[camada]}
    </span>
  );
}

/**
 * Uma medida com valor conhecido, OU um motivo. Nunca as duas coisas nulas, e
 * nunca valor nulo sem motivo — o tipo obriga.
 */
export type MedidaProps =
  | {
      rotulo: string;
      valorCents: number;
      motivo?: never;
      /** Fração de 0 a 1. Ausente = cobertura total. */
      cobertura?: number;
      /** Ex.: "4 contas · extrato de ontem" */
      detalhe?: string;
      /** Frase de viés, quando a cobertura parcial distorce para um lado. */
      vies?: string;
    }
  | {
      rotulo: string;
      valorCents: null;
      /** Obrigatório quando não há valor. É o ponto inteiro deste componente. */
      motivo: string;
      cobertura?: never;
      detalhe?: string;
      vies?: never;
    };

export const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function Medida(props: MedidaProps) {
  const indeterminado = props.valorCents === null;

  return (
    <div
      className={`medida${indeterminado ? " cert-hachura" : ""}`}
      data-estado={indeterminado ? "indeterminado" : "conhecido"}
    >
      <span className="medida-k">{props.rotulo}</span>

      {indeterminado ? (
        <>
          <span className="medida-v">indeterminado</span>
          <span className="medida-sub">{props.motivo}</span>
        </>
      ) : (
        <>
          <span className="medida-v">{brl(props.valorCents)}</span>
          {props.detalhe ? <span className="medida-sub">{props.detalhe}</span> : null}
          {/* A barra só aparece quando há o que informar. Uma barra cheia em
              tudo vira ruído e o olho para de enxergar a parcial. */}
          {props.cobertura !== undefined && props.cobertura < 1 ? (
            <>
              <span className="medida-cob" data-parcial="1">
                <i style={{ width: `${Math.round(props.cobertura * 100)}%` }} />
              </span>
              <span className="medida-sub">
                cobre {Math.round(props.cobertura * 100)}%
                {props.vies ? ` · ${props.vies}` : ""}
              </span>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * A ressalva que vem ANTES do número, não depois.
 *
 * O caso que motivou: na visão competência, o mês corrente sempre parece o
 * melhor do ano, porque a folha dele ainda não saiu. Agosto/2026 aparecia com
 * margem de 51% e pessoal zerado. Um rodapé explicando isso chega tarde — a
 * pessoa já leu o número e formou opinião.
 */
export function Ressalva({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--cert-observado-bg)",
        borderLeft: "3px solid var(--cert-observado)",
        padding: "10px 14px",
        borderRadius: "0 5px 5px 0",
        fontSize: 13,
        color: "var(--ink)"
      }}
    >
      {children}
    </div>
  );
}

/**
 * Linha de lacuna dentro de uma tabela.
 *
 * Indentada sob o grupo a que pertenceria, nunca num rodapé. É o que faz
 * R$ 54.126,76 de item de cartão sem categoria pararem de ser invisíveis na
 * DRE — eles são despesa real, só não se sabe ainda de qual linha.
 */
export function LinhaLacuna({
  rotulo,
  valorCents,
  colunasVazias = 0,
  motivo
}: {
  rotulo: string;
  valorCents: number;
  colunasVazias?: number;
  motivo: string;
}) {
  return (
    <tr className="linha-lacuna" title={motivo}>
      <td>↳ {rotulo}</td>
      {Array.from({ length: colunasVazias }, (_, i) => (
        <td key={i} />
      ))}
      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brl(valorCents)}</td>
      <td>
        <SeloCamada camada="indeterminado" />
      </td>
    </tr>
  );
}
