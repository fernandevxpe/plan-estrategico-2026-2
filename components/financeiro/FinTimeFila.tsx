"use client";

import { useCallback, useEffect, useState } from "react";

import { Medida, Ressalva, SeloCamada, brl } from "@/components/financeiro/Certeza";

/**
 * A fila do que o time mandou — o lado de quem decide.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA TELA MOSTRA QUE AS OUTRAS FILAS NÃO MOSTRAM
 * ---------------------------------------------------------------------------
 * **Com que força se sabe quem enviou.** A credencial do time é uma só; quem
 * declarou ser o Igor pode não ser o Igor. Esconder isso do decisor faria a
 * aprovação parecer mais sólida do que é. O selo `identidade declarada` fica ao
 * lado do nome, sempre — não como alerta vermelho, que viraria ruído, mas como
 * qualificação da evidência, no mesmo vocabulário de `Certeza.tsx`.
 *
 * **Se veio comprovante.** Aprovar sem anexo é possível e às vezes correto (um
 * PIX de R$ 12 de estacionamento), mas tem de ser uma escolha visível.
 *
 * **O link, clicável, com o preço que ele tinha no dia.** É o que separa
 * "cotação" de "achismo" no pedido de compra.
 */

type Link = { url: string; loja: string | null; titulo: string | null; precoCents: number | null };
type Item = {
  origem: "custo" | "nota_entrada" | "compra";
  id: number;
  code: string;
  pessoa: string;
  pessoaId: number;
  titulo: string;
  detalhe: string | null;
  valorCents: number;
  data: string | null;
  status: string;
  enviadoEm: string | null;
  identidade: "declarada" | "pin" | null;
  anexos: number;
  links: Link[];
};

type Fila = {
  disponivel: boolean;
  motivo: string | null;
  envios: Item[];
  totalCents: number;
  semComprovante: number;
  saude: {
    itens: number;
    com_comprovante: number;
    sem_comprovante: number;
    sem_comprovante_cents: number;
    pct_com_comprovante: number | null;
  } | null;
};

const ORIGEM: Record<string, string> = { custo: "Custo", nota_entrada: "Nota de entrada", compra: "Compra" };

export function FinTimeFila() {
  const [fila, setFila] = useState<Fila | null>(null);
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const [ator, setAtor] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/financeiro/time", { cache: "no-store" });
    if (!r.ok) return setErro("não consegui ler a fila");
    setFila(await r.json());
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function decidir(item: Item, decisao: "aprovar" | "devolver" | "recusar") {
    setErro(null);
    const chave = `${item.origem}-${item.id}`;
    const r = await fetch("/api/financeiro/time", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        origem: item.origem === "compra" ? "compra" : "envio",
        id: item.id,
        decisao,
        motivo: motivos[chave] ?? null,
        ator: ator || "admin"
      })
    });
    const j = await r.json();
    if (!r.ok) return setErro(j.error ?? "não consegui registrar");
    setMotivos({ ...motivos, [chave]: "" });
    await carregar();
  }

  if (!fila) return <p className="time-sub">carregando…</p>;

  if (!fila.disponivel) {
    return (
      <div className="time-aviso">
        <h2>A fila do time ainda não existe neste banco</h2>
        <p>{fila.motivo}</p>
      </div>
    );
  }

  return (
    <div className="fin-time-fila">
      <div className="medida-grade">
        <Medida
          rotulo="Na fila do time"
          valorCents={fila.totalCents}
          detalhe={`${fila.envios.length} envio(s) aguardando decisão`}
        />
        {fila.saude ? (
          fila.saude.itens > 0 ? (
            <Medida
              rotulo="Reembolso com comprovante"
              valorCents={fila.saude.sem_comprovante_cents}
              detalhe={`${fila.saude.sem_comprovante} de ${fila.saude.itens} itens SEM comprovante`}
              cobertura={(fila.saude.pct_com_comprovante ?? 0) / 100}
              vies="o que falta é justamente o que sustentaria a aprovação"
            />
          ) : (
            <Medida rotulo="Reembolso com comprovante" valorCents={null} motivo="não há item de reembolso na base" />
          )
        ) : null}
      </div>

      <Ressalva>
        Decidir aqui é <strong>triagem</strong>, não autorização de pagamento. Um envio aprovado continua sem tocar o
        caixa: para virar saída, ele precisa de uma solicitação de pagamento, e esse caminho exige alçada
        (<code>fin_approval_rule</code>), que está vazia por desenho — dúvida 27.
      </Ressalva>

      <label className="campo campo-ator">
        <span>Quem está decidindo</span>
        <input value={ator} onChange={(e) => setAtor(e.target.value)} placeholder="seu nome" />
        <small>Fica gravado junto da decisão. Decisão sem autor não é decisão, é um estado que mudou sozinho.</small>
      </label>

      {erro ? <p className="time-erro">{erro}</p> : null}

      {fila.envios.length === 0 ? (
        <p className="time-sub">Nada do time esperando decisão.</p>
      ) : (
        <ul className="fila-time-lista">
          {fila.envios.map((item) => {
            const chave = `${item.origem}-${item.id}`;
            return (
              <li key={chave} className="fila-time-item">
                <div className="fila-time-topo">
                  <span className="time-item-origem">{ORIGEM[item.origem]}</span>
                  <span className="time-item-code">{item.code}</span>
                  <strong>{item.pessoa}</strong>
                  {item.identidade === "declarada" ? (
                    <SeloCamada camada="indeterminado" texto="identidade declarada" />
                  ) : item.identidade === "pin" ? (
                    <SeloCamada camada="firme" texto="identidade conferida" />
                  ) : null}
                  <span className="fila-time-valor">{brl(item.valorCents)}</span>
                </div>

                <div className="fila-time-titulo">{item.titulo}</div>
                {item.detalhe ? <p className="fila-time-detalhe">{item.detalhe}</p> : null}

                <div className="fila-time-meta">
                  {item.data ? <span>{item.data.split("-").reverse().join("/")}</span> : null}
                  {item.origem !== "compra" ? (
                    item.anexos > 0 ? (
                      <span>{item.anexos} anexo(s)</span>
                    ) : (
                      <span className="time-falta">sem comprovante</span>
                    )
                  ) : null}
                </div>

                {item.links.length > 0 ? (
                  <ul className="fila-time-links">
                    {item.links.map((l) => (
                      <li key={l.url}>
                        {/* noopener/noreferrer: o link vem de fora e abre numa
                            aba nova; sem eles a página de destino ganha
                            referência à nossa janela. */}
                        <a href={l.url} target="_blank" rel="noopener noreferrer">
                          {l.titulo ?? l.loja ?? l.url}
                        </a>
                        {l.precoCents !== null ? (
                          <span className="fila-time-preco">{brl(l.precoCents)}</span>
                        ) : (
                          <span className="fila-time-preco indet">preço não informado</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="fila-time-decisao">
                  <input
                    value={motivos[chave] ?? ""}
                    onChange={(e) => setMotivos({ ...motivos, [chave]: e.target.value })}
                    placeholder="motivo — obrigatório para devolver ou recusar"
                  />
                  <button type="button" className="time-botao" onClick={() => decidir(item, "aprovar")}>
                    aprovar
                  </button>
                  <button type="button" className="time-botao secundario" onClick={() => decidir(item, "devolver")}>
                    devolver
                  </button>
                  <button type="button" className="time-botao perigo" onClick={() => decidir(item, "recusar")}>
                    recusar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
