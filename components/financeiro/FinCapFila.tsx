"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  CalendarClock,
  FileText,
  Paperclip,
  Star,
  X
} from "lucide-react";

import type { ContaAPagar } from "@/lib/financeiro/contas-a-pagar";
import {
  chaveFavorito,
  estadoDoCiclo,
  faixaPrazo,
  metodoDaLinha,
  rotuloPrazo,
  type FaixaPrazo,
  type KindCobranca
} from "@/lib/financeiro/contas-a-pagar-eixos";
import { rotuloSubparte } from "@/lib/financeiro/custo-empresa-partes";
import { brlPrecise, dateLabel, shortDateLabel } from "@/lib/financeiro/format";

/**
 * A FILA DOS PREVISTOS — aluguel, conta de luz, DAS, o que se paga com boleto.
 *
 * A tabela de sete colunas era o vocabulário da matriz. Esta tela é de CAIXA:
 * quem, quanto, quando vence, o que falta pegar, como se paga. Favorito é o
 * fornecedor (Ancora continua estrela no mês que vem); o anexo é do mês.
 */

type Linha = ContaAPagar & { id: string };

const FAIXAS: { slug: FaixaPrazo; nome: string }[] = [
  { slug: "atrasada", nome: "Atrasadas" },
  { slug: "hoje", nome: "Vencem hoje" },
  { slug: "semana", nome: "Esta semana" },
  { slug: "mes", nome: "Neste mês" },
  { slug: "depois", nome: "Depois" }
];

const ROTULO_METODO: Record<string, string> = {
  pix: "PIX",
  boleto: "Boleto",
  cartao: "Cartão",
  indefinido: "A definir"
};

function podeProgramar(l: ContaAPagar): boolean {
  return l.impedimento === null && l.ordem === null;
}

function urlDoAnexo(storageKey: string): string {
  return `/api/financeiro/contas-a-pagar/cobranca/anexo/${storageKey
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export function FinCapFila({
  linhas,
  hoje,
  selecionadas,
  onAlternar,
  onAtualizar
}: {
  linhas: Linha[];
  hoje: string;
  selecionadas: Set<string>;
  onAlternar: (id: string) => void;
  onAtualizar: () => void;
}) {
  const [aberta, setAberta] = useState<Linha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [soFavoritos, setSoFavoritos] = useState(false);

  const visiveis = useMemo(() => {
    const base = soFavoritos ? linhas.filter((l) => l.favorito) : linhas;
    return [...base].sort((a, b) => {
      if (a.favorito !== b.favorito) return a.favorito ? -1 : 1;
      return a.dia.localeCompare(b.dia) || b.valorCents - a.valorCents;
    });
  }, [linhas, soFavoritos]);

  const porFaixa = useMemo(() => {
    const mapa = new Map<FaixaPrazo, Linha[]>();
    for (const l of visiveis) {
      const f = faixaPrazo(l.dia, hoje, l.vencido);
      const lista = mapa.get(f) ?? [];
      lista.push(l);
      mapa.set(f, lista);
    }
    return mapa;
  }, [visiveis, hoje]);

  const nFavoritos = linhas.filter((l) => l.favorito).length;
  const favoritosCents = linhas.filter((l) => l.favorito).reduce((s, l) => s + l.valorCents, 0);

  return (
    <div className="fin-cap-fila">
      <div className="fin-cap-fila-toolbar">
        <button
          type="button"
          className={soFavoritos ? "fin-cap-chip ativo" : "fin-cap-chip"}
          aria-pressed={soFavoritos}
          disabled={nFavoritos === 0}
          onClick={() => setSoFavoritos((v) => !v)}
        >
          <Star size={12} strokeWidth={2.2} aria-hidden />
          <b>Favoritos</b>
          <span className="fin-cap-chip-n">({nFavoritos})</span>
          {nFavoritos > 0 ? <span className="fin-cap-chip-total">{brlPrecise(favoritosCents)}</span> : null}
        </button>
        <p className="fin-cap-fila-dica">
          Anexe o boleto e a NF-e de cada conta. A tela lê, guarda e mostra o
          prazo — é a lista do que pegar, um por um.
        </p>
      </div>

      {erro ? (
        <p className="fin-cap-erro" role="alert">
          {erro}
        </p>
      ) : null}

      {visiveis.length === 0 ? (
        <p className="fin-cap-fila-vazia">Nenhuma conta nesta fatia.</p>
      ) : (
        FAIXAS.map((faixa) => {
          const grupo = porFaixa.get(faixa.slug) ?? [];
          if (!grupo.length) return null;
          const cents = grupo.reduce((s, l) => s + l.valorCents, 0);
          return (
            <section key={faixa.slug} className={`fin-cap-faixa fin-cap-faixa-${faixa.slug}`}>
              <header className="fin-cap-faixa-cab">
                <h3>{faixa.nome}</h3>
                <span>
                  {grupo.length} · {brlPrecise(cents)}
                </span>
              </header>
              <ul className="fin-cap-cards">
                {grupo.map((l) => (
                  <li key={l.id}>
                    <CartaoConta
                      linha={l}
                      hoje={hoje}
                      marcada={selecionadas.has(l.id)}
                      aberta={aberta?.id === l.id}
                      onMarcar={() => onAlternar(l.id)}
                      onAbrir={() => setAberta(l)}
                      onFavorito={async (prox) => {
                        setErro(null);
                        const chave = chaveFavorito(l);
                        if (!chave) return;
                        const r = await fetch("/api/financeiro/contas-a-pagar/cobranca", {
                          method: "PATCH",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ chaveFavorito: chave, favorito: prox })
                        });
                        const j = (await r.json().catch(() => null)) as { error?: string } | null;
                        if (!r.ok) {
                          setErro(j?.error ?? "não marcou o favorito");
                          return;
                        }
                        onAtualizar();
                      }}
                      onAnexar={async (kind, file) => {
                        setErro(null);
                        const fd = new FormData();
                        fd.set("chaveDedupe", l.chaveDedupe);
                        fd.set("kind", kind);
                        fd.set("arquivo", file);
                        const r = await fetch("/api/financeiro/contas-a-pagar/cobranca", {
                          method: "POST",
                          body: fd
                        });
                        const j = (await r.json().catch(() => null)) as {
                          error?: string;
                          leitura?: { aviso?: string | null };
                        } | null;
                        if (!r.ok) {
                          setErro(j?.error ?? "não anexou");
                          return;
                        }
                        if (j?.leitura?.aviso) setErro(j.leitura.aviso);
                        onAtualizar();
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      {aberta ? (
        <FichaConta
          linha={linhas.find((l) => l.id === aberta.id) ?? aberta}
          hoje={hoje}
          onFechar={() => setAberta(null)}
          onAnexar={async (kind, file) => {
            setErro(null);
            const fd = new FormData();
            fd.set("chaveDedupe", aberta.chaveDedupe);
            fd.set("kind", kind);
            fd.set("arquivo", file);
            const r = await fetch("/api/financeiro/contas-a-pagar/cobranca", {
              method: "POST",
              body: fd
            });
            const j = (await r.json().catch(() => null)) as { error?: string } | null;
            if (!r.ok) {
              setErro(j?.error ?? "não anexou");
              return;
            }
            onAtualizar();
          }}
          onApagar={async (kind) => {
            setErro(null);
            const r = await fetch("/api/financeiro/contas-a-pagar/cobranca", {
              method: "DELETE",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ chaveDedupe: aberta.chaveDedupe, kind })
            });
            if (!r.ok) {
              const j = (await r.json().catch(() => null)) as { error?: string } | null;
              setErro(j?.error ?? "não removeu o anexo");
              return;
            }
            onAtualizar();
          }}
        />
      ) : null}
    </div>
  );
}

function CartaoConta({
  linha,
  hoje,
  marcada,
  aberta,
  onMarcar,
  onAbrir,
  onFavorito,
  onAnexar
}: {
  linha: Linha;
  hoje: string;
  marcada: boolean;
  aberta: boolean;
  onMarcar: () => void;
  onAbrir: () => void;
  onFavorito: (prox: boolean) => void;
  onAnexar: (kind: KindCobranca, file: File) => void;
}) {
  const estado = estadoDoCiclo(linha);
  const metodo = metodoDaLinha(linha);
  const prazo = rotuloPrazo(linha.dia, hoje, linha.vencido);
  const faixa = faixaPrazo(linha.dia, hoje, linha.vencido);
  const elegivel = podeProgramar(linha);
  const anexos = linha.anexos ?? [];
  const boleto = anexos.find((a) => a.kind === "boleto");
  const nfe = anexos.find((a) => a.kind === "nota_fiscal");
  const parte = linha.subparte ? rotuloSubparte(linha.subparte) : null;

  return (
    <article
      className={[
        "fin-cap-card",
        marcada ? "marcada" : "",
        faixa === "atrasada" && estado !== "paga" ? "atrasada" : "",
        linha.naoConfirmada && estado !== "paga" ? "aconfirmar" : "",
        aberta ? "aberta" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="fin-cap-card-sel">
        {elegivel ? (
          <input
            type="checkbox"
            checked={marcada}
            aria-label={`Selecionar ${linha.contraparte ?? linha.descricao}`}
            onChange={onMarcar}
          />
        ) : (
          <i
            className={`fin-cap-marca ${estado === "paga" ? "pago" : "enviado"}`}
            aria-hidden
          />
        )}
      </div>

      <button
        type="button"
        className={linha.favorito ? "fin-cap-star on" : "fin-cap-star"}
        aria-pressed={linha.favorito}
        aria-label={linha.favorito ? "Tirar dos favoritos" : "Marcar como favorito"}
        title="favorito — vale para os próximos meses deste fornecedor"
        onClick={() => onFavorito(!linha.favorito)}
      >
        <Star size={15} strokeWidth={2.1} fill={linha.favorito ? "currentColor" : "none"} />
      </button>

      <button type="button" className="fin-cap-card-corpo" onClick={onAbrir}>
        <span className="fin-cap-card-topo">
          <span className="fin-cap-nome">{linha.contraparte ?? "sem favorecido"}</span>
          <span className="fin-cap-card-valor">{brlPrecise(linha.valorCents)}</span>
        </span>
        <span className="fin-cap-sub">
          {linha.descricao === linha.contraparte ? null : linha.descricao}
          {parte && parte !== linha.descricao ? ` · ${parte}` : ""}
        </span>
        <span className="fin-cap-card-meta">
          <span className={`fin-cap-prazo fin-cap-prazo-${faixa}`}>
            <CalendarClock size={12} strokeWidth={2.2} aria-hidden />
            {shortDateLabel(linha.dia)} · {prazo}
          </span>
          <span className={`fin-cap-metodo fin-cap-metodo-${metodo}`}>
            {ROTULO_METODO[metodo]}
            {metodo === "pix" && linha.pixMascarado ? ` ${linha.pixMascarado}` : ""}
          </span>
          {boleto ? (
            <span className="fin-cap-doc ok">Boleto</span>
          ) : (
            <span className="fin-cap-doc falta">Falta boleto</span>
          )}
          {nfe ? (
            <span className="fin-cap-doc ok">NF-e</span>
          ) : (
            <span className="fin-cap-doc falta">Falta NF-e</span>
          )}
          {linha.naoConfirmada && estado !== "paga" ? (
            <span className="fin-cap-selo-confirmar">a confirmar</span>
          ) : null}
        </span>
      </button>

      <div className="fin-cap-card-acoes">
        <BotaoAnexo kind="boleto" rotulo="Boleto" onEscolher={(f) => onAnexar("boleto", f)} />
        <BotaoAnexo kind="nota_fiscal" rotulo="NF-e" onEscolher={(f) => onAnexar("nota_fiscal", f)} />
      </div>
    </article>
  );
}

function BotaoAnexo({
  kind,
  rotulo,
  onEscolher
}: {
  kind: KindCobranca;
  rotulo: string;
  onEscolher: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  function escolher(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onEscolher(file);
  }
  return (
    <>
      <input
        ref={ref}
        type="file"
        className="sr-only"
        accept={kind === "nota_fiscal" ? ".xml,application/xml,text/xml,.pdf,image/*" : ".pdf,image/*,.xml"}
        onChange={escolher}
      />
      <button
        type="button"
        className="fin-cap-anexar"
        title={`Anexar ${rotulo.toLowerCase()}`}
        onClick={() => ref.current?.click()}
      >
        <Paperclip size={13} strokeWidth={2.2} aria-hidden />
        {rotulo}
      </button>
    </>
  );
}

function FichaConta({
  linha,
  hoje,
  onFechar,
  onAnexar,
  onApagar
}: {
  linha: Linha;
  hoje: string;
  onFechar: () => void;
  onAnexar: (kind: KindCobranca, file: File) => void;
  onApagar: (kind: KindCobranca) => void;
}) {
  const metodo = metodoDaLinha(linha);
  const prazo = rotuloPrazo(linha.dia, hoje, linha.vencido);
  const boleto = (linha.anexos ?? []).find((a) => a.kind === "boleto");
  const nfe = (linha.anexos ?? []).find((a) => a.kind === "nota_fiscal");

  return (
    <aside className="fin-cap-ficha" role="dialog" aria-label={`Pagamento de ${linha.contraparte ?? linha.descricao}`}>
      <header className="fin-cap-ficha-cab">
        <div>
          <p className="fin-cap-ficha-kicker">Conta a pagar</p>
          <h3>{linha.contraparte ?? "sem favorecido"}</h3>
        </div>
        <button type="button" className="fin-btn-ghost" onClick={onFechar} aria-label="Fechar">
          <X size={16} strokeWidth={2.2} />
        </button>
      </header>

      <p className="fin-cap-ficha-valor">{brlPrecise(linha.valorCents)}</p>
      <p className="fin-cap-ficha-prazo">
        vence {dateLabel(linha.dia)} · <b>{prazo}</b>
      </p>
      <p className="fin-cap-sub">{linha.descricao}</p>

      <dl className="fin-cap-ficha-dl">
        <div>
          <dt>Como pagar</dt>
          <dd>
            {ROTULO_METODO[metodo]}
            {linha.pixMascarado ? ` · ${linha.pixTipo?.toLowerCase() ?? "chave"} ${linha.pixMascarado}` : ""}
          </dd>
        </div>
        {linha.categoriaNome ? (
          <div>
            <dt>Categoria</dt>
            <dd>
              {linha.categoriaCode ? `${linha.categoriaCode} ` : ""}
              {linha.categoriaNome}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="fin-cap-ficha-docs">
        <DocSlot
          titulo="Boleto"
          anexo={boleto}
          onAnexar={(f) => onAnexar("boleto", f)}
          onApagar={() => onApagar("boleto")}
          kind="boleto"
        />
        <DocSlot
          titulo="NF-e"
          anexo={nfe}
          onAnexar={(f) => onAnexar("nota_fiscal", f)}
          onApagar={() => onApagar("nota_fiscal")}
          kind="nota_fiscal"
        />
      </div>
    </aside>
  );
}

function DocSlot({
  titulo,
  anexo,
  kind,
  onAnexar,
  onApagar
}: {
  titulo: string;
  kind: KindCobranca;
  anexo: ContaAPagar["anexos"][number] | undefined;
  onAnexar: (file: File) => void;
  onApagar: () => void;
}) {
  if (!anexo) {
    return (
      <div className="fin-cap-slot vazio">
        <FileText size={16} strokeWidth={2} aria-hidden />
        <div>
          <b>{titulo}</b>
          <span>ainda não anexado</span>
        </div>
        <BotaoAnexo kind={kind} rotulo="Anexar" onEscolher={onAnexar} />
      </div>
    );
  }

  return (
    <div className="fin-cap-slot">
      <FileText size={16} strokeWidth={2} aria-hidden />
      <div>
        <b>{titulo}</b>
        <a className="pp-link" href={urlDoAnexo(anexo.storageKey)} target="_blank" rel="noreferrer">
          {anexo.fileName ?? "abrir arquivo"}
        </a>
        {anexo.valorLidoCents != null ? (
          <span>
            lido {brlPrecise(anexo.valorLidoCents)}
            {anexo.vencimentoLido ? ` · vence ${shortDateLabel(anexo.vencimentoLido)}` : ""}
            {anexo.emitenteLido ? ` · ${anexo.emitenteLido}` : ""}
          </span>
        ) : (
          <span>arquivo guardado — a leitura não tirou valor</span>
        )}
      </div>
      <button type="button" className="fin-btn-ghost" onClick={onApagar}>
        tirar
      </button>
    </div>
  );
}
