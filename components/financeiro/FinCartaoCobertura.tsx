"use client";

import { useMemo, useState, type ReactNode } from "react";

import { corDoCartao } from "@/components/financeiro/FinCartaoPainelTopo";
import { brl, brlPrecise } from "@/lib/financeiro/format";
import type { CoberturaDeRegistro, FaturaDaLinha } from "@/lib/financeiro/contratos/cartao-painel";

/**
 * BANCO × TIME — de cada fatura, quanto já tem descrição de gente.
 *
 * ---------------------------------------------------------------------------
 * ESTA TELA NASCE QUASE TODA VAZIA, E ISSO É O ASSUNTO DELA
 * ---------------------------------------------------------------------------
 * No acervo inteiro existe UMA linha com registro: agosto/2026 na linha do
 * Inter, R$ 1.254,99 explicados de R$ 6.219,33 cobrados. Todo o resto tem
 * `registradoCents = 0`.
 *
 * Um desenho que tratasse cada zero como falha devolveria uma parede de
 * alarme, e parede de alarme não se lê — se ignora. Então o vão aqui não é
 * pintado de erro: ele é pintado de VAGA. Textura, não vermelho; a lista é
 * ordenada pelo maior vão para dizer onde começar; e o número que ganha brilho
 * é o que foi registrado, porque é ele que a tela quer ver crescer.
 *
 * ---------------------------------------------------------------------------
 * DOIS VÃOS DE NATUREZAS DIFERENTES — E É `escopo` QUEM OS SEPARA
 * ---------------------------------------------------------------------------
 * O contrato (`CoberturaDeRegistro`) é explícito: "falta registrar" significa
 * coisas diferentes conforme o emissor, e por isso `escopo` viaja junto.
 *
 *   escopo = 'linha'  (Inter — o emissor NÃO itemiza)
 *       A fatura é uma só para os três plásticos e o banco nunca diz o que foi
 *       comprado. Registrar é a ÚNICA fonte. O que não foi registrado é gasto
 *       sem descrição em lugar nenhum: CEGUEIRA.
 *
 *   escopo = 'cartao' (Nubank — o emissor itemiza)
 *       O banco já diz o quê, compra a compra, e diz de qual plástico saiu. O
 *       registro acrescenta o que ele não tem: nota fiscal, área, quem pediu.
 *       O que falta é COMPROVAÇÃO, não informação.
 *
 * Os dois nunca viram um indicador só — no placar são dois números, com dois
 * rótulos e dois pesos. E nunca se confundem no desenho, porque cada um tem
 * sua textura (abaixo).
 *
 * ---------------------------------------------------------------------------
 * TRÊS TEXTURAS, O MESMO VOCABULÁRIO DO RESTO DA TELA DE CARTÕES
 * ---------------------------------------------------------------------------
 *   SÓLIDO ......... dado classificado — o que o time registrou. Na cor do
 *                    cartão (`corDoCartao`), a mesma do gráfico lá em cima.
 *   HACHURA ........ falta preencher e dá para resolver — o vão do Nubank. O
 *                    banco descreve; o que falta é papel, e papel se junta.
 *   PONTILHADO ..... a fonte não conta — o vão do Inter. Nenhuma fila, nenhum
 *                    sync e nenhuma importação resolvem isto: ou alguém
 *                    registra, ou o gasto fica sem descrição para sempre.
 *
 * É o mesmo par que `FinCartaoAnalise` já usa (hachura roxa para a lacuna
 * resolvível, pontilhado grafite para o que o emissor não entrega). Quem
 * aprendeu a diferença lá em cima não reaprende aqui.
 *
 * ---------------------------------------------------------------------------
 * PASSADO E AGENDA SÃO DOIS BLOCOS, NÃO UMA LISTA SÓ
 * ---------------------------------------------------------------------------
 * Existem parcelas já lançadas até abril/2027. "Falta registrar" um mês que
 * ainda não aconteceu não é dívida — é agenda, e cobrar por ela seria mentir
 * sobre o tamanho do atraso. Os meses futuros ficam num bloco próprio, em
 * ordem crescente (o próximo primeiro, como uma agenda se lê), com as mesmas
 * texturas em intensidade baixa. Baixar a intensidade não inventa uma quarta
 * textura: diz que aquele vão ainda não venceu.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO HÁ GRÁFICO DE RECHARTS AQUI
 * ---------------------------------------------------------------------------
 * A barra do cabeçalho de cada mês, empilhada na vertical mês após mês, JÁ é o
 * gráfico: mesma escala, mesmas texturas, alinhada com as linhas que a
 * compõem. Um `<BarChart>` ao lado seria uma segunda leitura do mesmo número
 * em outra escala — e duas escalas do mesmo total é como se começa a
 * desconfiar da página inteira.
 */

/* ===========================================================================
   TIPOS E PREPARO
   =========================================================================== */

/** A natureza do vão. Deriva de `escopo`, e é o eixo do desenho inteiro. */
type Natureza = "cegueira" | "comprovacao";

type LinhaPreparada = {
  chave: string;
  origem: CoberturaDeRegistro;
  natureza: Natureza;
  /** A tinta da série — a MESMA do gráfico do topo. */
  cor: string;
  /** `min(banco, registrado)`: o pedaço que os dois lados confirmam. */
  cobertoCents: number;
  /** `max(0, banco − registrado)`: o vão de verdade, nunca negativo. */
  vaoCents: number;
  /** Registrou mais do que o banco cobrou. Existe no contrato, então existe aqui. */
  excedenteCents: number;
  bancoCents: number;
  registradoCents: number;
  /** Base da barra: `max(banco, registrado)`. */
  baseCents: number;
  /** `null` quando o banco ainda não cobrou nada — dividir por zero é inventar. */
  coberturaPct: number | null;
};

type GrupoDeMes = {
  mes: string;
  corrente: boolean;
  /** Depois do mês corrente: parcela já lançada, não atraso. */
  futuro: boolean;
  linhas: LinhaPreparada[];
  bancoCents: number;
  registradoCents: number;
  cobertoCents: number;
  cegueiraCents: number;
  comprovacaoCents: number;
  excedenteCents: number;
  registros: number;
  cartoes: number;
  linhasDeCredito: number;
  coberturaPct: number | null;
};

type MesDeFatura = {
  chave: string;
  contaId: number;
  emissor: string | null;
  mes: string;
  faturas: FaturaDaLinha[];
  totalCents: number;
  pagoCents: number;
  /** A cobertura daquele mês naquela linha. `null` = nada casou. */
  cobertura: LinhaPreparada | null;
};

type Filtro = "tudo" | "linha" | "cartao";

const NOME_DO_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];

/** `2026-08` → `agosto de 2026`. Cabeçalho de grupo tem espaço para o nome. */
const rotuloLongo = (mes: string) => {
  const [ano, m] = mes.split("-");
  return `${NOME_DO_MES[Number(m) - 1] ?? mes} de ${ano}`;
};

/** `2026-08` → `08/26`. Onde o espaço é de tabela. */
const rotuloCurto = (mes: string) => {
  const [ano, m] = mes.split("-");
  return `${m}/${ano.slice(2)}`;
};

/** `2026-08-15` → `15/08`. Vencimento não precisa repetir o ano do grupo. */
const diaMes = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
};

/** Centavos → manchete de KPI, sem centavos. Tabela usa `brlPrecise`. */
const reais = (cents: number) => brl.format(cents / 100);

const plural = (n: number, um: string, muitos: string) => (n === 1 ? um : muitos);

function prepararLinha(c: CoberturaDeRegistro): LinhaPreparada {
  /*
   * Estorno pode deixar um mês com cobrança negativa. A GEOMETRIA usa os
   * valores travados em zero (barra de largura negativa não existe), mas os
   * números impressos continuam vindo do contrato — a tela não corrige o dado,
   * só desenha o que dá para desenhar.
   */
  const banco = Math.max(0, c.bancoCents);
  const registrado = Math.max(0, c.registradoCents);
  const coberto = Math.min(banco, registrado);

  return {
    chave: `${c.mes}|${c.escopo}|${c.cardId ?? "-"}|${c.contaId ?? "-"}`,
    origem: c,
    natureza: c.escopo === "linha" ? "cegueira" : "comprovacao",
    /*
     * A COR DA LINHA DE CRÉDITO VEM DE `contaId`, e isso é deliberado.
     *
     * `corDoCartao(null)` devolve a tinta de indeterminado da casa — certa
     * para "não sei qual plástico", e ERRADA aqui: a linha do Inter é a única
     * do acervo com registro, e pintar o pedaço registrado dela com a tinta do
     * "não sei" diria justamente o contrário do que ele é. A linha é uma
     * entidade com identidade própria (é uma conta), então ela indexa a mesma
     * paleta pelo id que tem.
     *
     * Um plástico e uma linha podem cair no mesmo slot (a paleta tem nove e a
     * repetição a partir do décimo já é assumida lá). Empate de tinta não
     * confunde porque os dois nunca se disputam sozinhos: cada linha carrega
     * nome, emissor e o selo de escopo ao lado da cor.
     */
    cor: c.escopo === "cartao" ? corDoCartao(c.cardId, null) : corDoCartao(c.contaId, null),
    cobertoCents: coberto,
    vaoCents: Math.max(0, banco - registrado),
    excedenteCents: Math.max(0, registrado - banco),
    bancoCents: c.bancoCents,
    registradoCents: c.registradoCents,
    baseCents: Math.max(banco, registrado),
    // Sem cobrança não há percentual: "0% de nada" é uma medida que não houve.
    coberturaPct: banco > 0 ? Math.round((coberto / banco) * 1000) / 10 : null
  };
}

function agrupar(linhas: LinhaPreparada[], mesCorrente: string): GrupoDeMes[] {
  const mapa = new Map<string, GrupoDeMes>();

  for (const l of linhas) {
    const mes = l.origem.mes;
    let g = mapa.get(mes);
    if (!g) {
      g = {
        mes,
        corrente: mes === mesCorrente,
        futuro: mes > mesCorrente,
        linhas: [],
        bancoCents: 0,
        registradoCents: 0,
        cobertoCents: 0,
        cegueiraCents: 0,
        comprovacaoCents: 0,
        excedenteCents: 0,
        registros: 0,
        cartoes: 0,
        linhasDeCredito: 0,
        coberturaPct: null
      };
      mapa.set(mes, g);
    }
    g.linhas.push(l);
    g.bancoCents += l.bancoCents;
    g.registradoCents += l.registradoCents;
    g.cobertoCents += l.cobertoCents;
    g.excedenteCents += l.excedenteCents;
    g.registros += l.origem.registros;
    if (l.natureza === "cegueira") {
      g.cegueiraCents += l.vaoCents;
      g.linhasDeCredito += 1;
    } else {
      g.comprovacaoCents += l.vaoCents;
      g.cartoes += 1;
    }
  }

  for (const g of mapa.values()) {
    // Maior vão primeiro: a lista responde "por onde começo" sem que ninguém
    // precise varrer a coluna com o olho.
    g.linhas.sort((a, b) => b.vaoCents - a.vaoCents || b.bancoCents - a.bancoCents);
    g.coberturaPct =
      g.bancoCents > 0 ? Math.round((g.cobertoCents / g.bancoCents) * 1000) / 10 : null;
  }

  return [...mapa.values()];
}

function agruparFaturas(
  faturas: FaturaDaLinha[],
  porLinha: Map<string, LinhaPreparada>
): MesDeFatura[] {
  /*
   * AGRUPADO POR (conta, mês) PORQUE JULHO TEM DUAS FATURAS.
   *
   * Julho/2026 fechou com R$ 5.590,05 e R$ 53,05 na mesma linha. Uma lista de
   * "uma fatura por mês" ou esconderia a segunda ou compararia a cobertura do
   * mês inteiro (R$ 5.643,10 do lado do banco) contra a maior das duas — e daí
   * sairia um "falta" R$ 53,05 menor do que é.
   *
   * O contrato soma as faturas por mês do lado do banco (`sum(total_amount_
   * cents)` agrupado por `reference_month`), então agrupar aqui do mesmo jeito
   * é o que faz os dois lados falarem do mesmo número.
   */
  const mapa = new Map<string, MesDeFatura>();

  for (const f of faturas) {
    const chave = `${f.contaId}|${f.mes}`;
    let m = mapa.get(chave);
    if (!m) {
      m = {
        chave,
        contaId: f.contaId,
        emissor: f.emissor,
        mes: f.mes,
        faturas: [],
        totalCents: 0,
        pagoCents: 0,
        cobertura: porLinha.get(chave) ?? null
      };
      mapa.set(chave, m);
    }
    m.faturas.push(f);
    m.totalCents += f.totalCents;
    m.pagoCents += f.pagoCents;
  }

  for (const m of mapa.values()) {
    m.faturas.sort((a, b) => a.vencimentoEm.localeCompare(b.vencimentoEm));
  }

  return [...mapa.values()].sort((a, b) => b.mes.localeCompare(a.mes));
}

/* ===========================================================================
   COMPONENTE
   =========================================================================== */

export function FinCartaoCobertura({
  cobertura,
  faturasDeLinha,
  mesCorrente,
  ano
}: {
  cobertura: CoberturaDeRegistro[];
  faturasDeLinha: FaturaDaLinha[];
  mesCorrente: string;
  ano: number;
}) {
  const [filtro, setFiltro] = useState<Filtro>("tudo");
  // O mês corrente já abre; o resto fica recolhido. Dezesseis meses abertos de
  // uma vez seriam uma parede — e a barra de cada cabeçalho já conta o mês.
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set([mesCorrente]));

  const preparadas = useMemo(
    () =>
      cobertura
        .map(prepararLinha)
        // Linha sem cobrança E sem registro não é um vão nem um acerto: é uma
        // linha que não deveria ter vindo. Ela ocuparia espaço afirmando nada.
        .filter((l) => l.bancoCents !== 0 || l.registradoCents !== 0),
    [cobertura]
  );

  // O PLACAR IGNORA O FILTRO de propósito: ele é o mês inteiro, e um filtro que
  // mexesse na manchete faria o mesmo agosto ter três tamanhos diferentes.
  const doMes = useMemo(
    () => agrupar(preparadas, mesCorrente).find((g) => g.mes === mesCorrente) ?? null,
    [preparadas, mesCorrente]
  );

  const visiveis = useMemo(() => {
    const filtradas =
      filtro === "tudo" ? preparadas : preparadas.filter((l) => l.origem.escopo === filtro);
    return agrupar(filtradas, mesCorrente);
  }, [preparadas, filtro, mesCorrente]);

  const passado = useMemo(
    () => visiveis.filter((g) => !g.futuro).sort((a, b) => b.mes.localeCompare(a.mes)),
    [visiveis]
  );
  // Agenda em ordem CRESCENTE: o próximo primeiro, que é como se lê uma agenda.
  const adiante = useMemo(
    () => visiveis.filter((g) => g.futuro).sort((a, b) => a.mes.localeCompare(b.mes)),
    [visiveis]
  );

  const mesesDeFatura = useMemo(() => {
    const porLinha = new Map<string, LinhaPreparada>();
    for (const l of preparadas) {
      if (l.origem.escopo === "linha" && l.origem.contaId !== null) {
        porLinha.set(`${l.origem.contaId}|${l.origem.mes}`, l);
      }
    }
    return agruparFaturas(faturasDeLinha, porLinha);
  }, [preparadas, faturasDeLinha]);

  const temLinha = preparadas.some((l) => l.origem.escopo === "linha");
  const temCartao = preparadas.some((l) => l.origem.escopo === "cartao");

  function definirBloco(meses: string[], abrir: boolean) {
    setAbertos((atual) => {
      const proximo = new Set(atual);
      for (const m of meses) {
        if (abrir) proximo.add(m);
        else proximo.delete(m);
      }
      return proximo;
    });
  }

  function alternarMes(mes: string, aberto: boolean) {
    setAbertos((atual) => {
      if (atual.has(mes) === aberto) return atual;
      const proximo = new Set(atual);
      if (aberto) proximo.add(mes);
      else proximo.delete(mes);
      return proximo;
    });
  }

  if (!preparadas.length && !mesesDeFatura.length) {
    return (
      <section className="fin-card fin-cartao-cob">
        <div className="fin-card-head">
          <h2>Cobrado × registrado</h2>
        </div>
        <p className="fin-card-hint">
          Nada a comparar a partir de janeiro de {ano}: nem cobrança do banco, nem registro do time.
        </p>
      </section>
    );
  }

  const adianteTotal = adiante.reduce((s, g) => s + g.bancoCents, 0);

  return (
    <section className="fin-card fin-cartao-cob">
      <div className="fin-card-head">
        <h2>Cobrado × registrado</h2>
        <span className="fin-cartao-cob-escopo">a partir de janeiro de {ano}</span>
      </div>
      <p className="fin-card-hint">
        De cada fatura, quanto já tem descrição de gente — mês a mês, cartão a cartão, incluindo as
        parcelas já lançadas para a frente.
      </p>

      <Placar grupo={doMes} mes={mesCorrente} />

      <Legenda temLinha={temLinha} temCartao={temCartao} />

      <div className="fin-cartao-cob-filtros" role="group" aria-label="Recortar por natureza do vão">
        <Chip atual={filtro} valor="tudo" onEscolher={setFiltro} texto="tudo" />
        {temLinha && (
          <Chip
            atual={filtro}
            valor="linha"
            onEscolher={setFiltro}
            texto="só o registro conta"
            textura="pontilhado"
          />
        )}
        {temCartao && (
          <Chip
            atual={filtro}
            valor="cartao"
            onEscolher={setFiltro}
            texto="o banco já descreve"
            textura="hachura"
          />
        )}
      </div>

      <Bloco
        titulo="Já aconteceu"
        nota="o mês fechou (ou está fechando) e o vão é de agora"
        grupos={passado}
        abertos={abertos}
        onAlternar={alternarMes}
        onDefinirBloco={definirBloco}
        vazio="Nenhum mês fechado neste recorte."
      />

      <Bloco
        titulo="Agenda — parcelas já lançadas"
        nota={
          adianteTotal > 0
            ? `${reais(adianteTotal)} que o emissor já confirmou e ninguém precisa registrar hoje`
            : "nada lançado para os meses à frente neste recorte"
        }
        grupos={adiante}
        abertos={abertos}
        onAlternar={alternarMes}
        onDefinirBloco={definirBloco}
        vazio="Nenhuma parcela lançada à frente neste recorte."
        adiante
      />

      <Faturas meses={mesesDeFatura} />
    </section>
  );
}

/* ===========================================================================
   O PLACAR DO MÊS CORRENTE
   =========================================================================== */

/**
 * Quatro números, e nenhum deles junta as duas naturezas do vão.
 *
 * O brilho fica no REGISTRADO, não no que falta. É o número que a tela quer ver
 * crescer, e destacar o buraco em vez do progresso transforma um mapa de vagas
 * num boletim de falta.
 */
function Placar({ grupo, mes }: { grupo: GrupoDeMes | null; mes: string }) {
  if (!grupo) {
    return (
      <div className="fin-cartao-cob-placar-vazio">
        <strong>{rotuloLongo(mes)}</strong>
        <span>nem cobrança nem registro neste mês ainda</span>
      </div>
    );
  }

  const pct = grupo.coberturaPct;

  return (
    <div className="fin-cartao-cob-placar">
      <p className="fin-cartao-cob-placar-cab">
        <strong>{rotuloLongo(mes)}</strong>
        <span className="fin-cartao-cob-corrente">o mês ainda corre</span>
      </p>

      <div className="fin-cartao-cob-kpis">
        <KpiSimples
          rotulo="O banco cobrou"
          valor={reais(grupo.bancoCents)}
          detalhe={
            <>
              {grupo.linhasDeCredito > 0 && (
                <span className="fin-cartao-cob-detalhe-linha">
                  {grupo.linhasDeCredito}{" "}
                  {plural(grupo.linhasDeCredito, "linha de crédito", "linhas de crédito")}
                </span>
              )}
              {grupo.cartoes > 0 && (
                <span className="fin-cartao-cob-detalhe-linha">
                  {grupo.cartoes} {plural(grupo.cartoes, "cartão", "cartões")}
                </span>
              )}
            </>
          }
        />

        <KpiSimples
          rotulo="O time registrou"
          valor={reais(grupo.registradoCents)}
          acento="purple"
          brilho
          detalhe={
            <>
              <span className="fin-cartao-cob-detalhe-linha">
                {grupo.registros > 0
                  ? `${grupo.registros} ${plural(grupo.registros, "registro", "registros")}`
                  : "nenhum registro ainda"}
              </span>
              {pct === null ? (
                <span className="fin-cartao-cob-detalhe-linha">o banco ainda não cobrou nada</span>
              ) : (
                <>
                  <span
                    className="fin-cartao-cob-medidor"
                    role="img"
                    aria-label={`cobertura de ${pct.toLocaleString("pt-BR")}%`}
                  >
                    <i style={{ width: `${Math.min(100, pct)}%` }} />
                  </span>
                  <span className="fin-cartao-cob-detalhe-linha">
                    {pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da cobrança
                  </span>
                </>
              )}
            </>
          }
        />

        {/* A CEGUEIRA VEM ANTES E VEM ACENTUADA. Não é o maior número
            necessariamente — é o único que nenhuma outra fonte cobre. */}
        <KpiSimples
          rotulo="Só o registro pode contar"
          valor={reais(grupo.cegueiraCents)}
          acento="pink"
          detalhe={
            <>
              <span className="fin-cartao-cob-detalhe-linha">
                <i className="fin-cartao-cob-amostra fin-cartao-cob-amostra-pontilhado" aria-hidden />
                o emissor não manda os itens
              </span>
              <span className="fin-cartao-cob-detalhe-linha">
                sem registro, não há descrição em lugar nenhum
              </span>
            </>
          }
        />

        <KpiSimples
          rotulo="Falta a comprovação"
          valor={reais(grupo.comprovacaoCents)}
          detalhe={
            <>
              <span className="fin-cartao-cob-detalhe-linha">
                <i className="fin-cartao-cob-amostra fin-cartao-cob-amostra-hachura" aria-hidden />
                o banco já diz o quê
              </span>
              <span className="fin-cartao-cob-detalhe-linha">falta nota, área e quem pediu</span>
            </>
          }
        />
      </div>
    </div>
  );
}

/**
 * O `KpiCard` da casa, com o detalhe empilhado que esta tela usa em toda parte.
 * Envolver aqui evita repetir a mesma casca de `<span>` quatro vezes.
 */
function KpiSimples({
  rotulo,
  valor,
  detalhe,
  acento = "neutro",
  brilho = false
}: {
  rotulo: string;
  valor: string;
  detalhe: ReactNode;
  acento?: "neutro" | "purple" | "pink";
  brilho?: boolean;
}) {
  return (
    <div className={`kpi-card kpi-acento-${acento}`}>
      <span className="kpi-rotulo">{rotulo}</span>
      <span className={`kpi-valor${brilho ? " kpi-brilho" : ""}`}>{valor}</span>
      <span className="kpi-detalhe">
        <span className="fin-cartao-cob-detalhe">{detalhe}</span>
      </span>
    </div>
  );
}

/* ===========================================================================
   LEGENDA E FILTRO — onde a diferença se ensina UMA vez
   =========================================================================== */

function Legenda({ temLinha, temCartao }: { temLinha: boolean; temCartao: boolean }) {
  return (
    <ul className="fin-cartao-cob-legenda">
      <li className="fin-cartao-cob-legenda-item">
        <i className="fin-cartao-cob-amostra fin-cartao-cob-amostra-solido" aria-hidden />
        <span>
          <b>registrado</b> — alguém contou o que foi
        </span>
      </li>
      {temCartao && (
        <li className="fin-cartao-cob-legenda-item">
          <i className="fin-cartao-cob-amostra fin-cartao-cob-amostra-hachura" aria-hidden />
          <span>
            <b>falta comprovar</b> — o banco descreve; falta a nota
          </span>
        </li>
      )}
      {temLinha && (
        <li className="fin-cartao-cob-legenda-item fin-cartao-cob-legenda-forte">
          <i className="fin-cartao-cob-amostra fin-cartao-cob-amostra-pontilhado" aria-hidden />
          <span>
            <b>sem descrição</b> — o emissor não conta; só o registro conta
          </span>
        </li>
      )}
    </ul>
  );
}

function Chip({
  atual,
  valor,
  onEscolher,
  texto,
  textura
}: {
  atual: Filtro;
  valor: Filtro;
  onEscolher: (f: Filtro) => void;
  texto: string;
  textura?: "hachura" | "pontilhado";
}) {
  return (
    <button
      type="button"
      className="fin-cartao-cob-chip"
      aria-pressed={atual === valor}
      onClick={() => onEscolher(valor)}
    >
      {textura && (
        <i className={`fin-cartao-cob-amostra fin-cartao-cob-amostra-${textura}`} aria-hidden />
      )}
      {texto}
    </button>
  );
}

/* ===========================================================================
   BLOCOS DE MÊS
   =========================================================================== */

function Bloco({
  titulo,
  nota,
  grupos,
  abertos,
  onAlternar,
  onDefinirBloco,
  vazio,
  adiante = false
}: {
  titulo: string;
  nota: string;
  grupos: GrupoDeMes[];
  abertos: Set<string>;
  onAlternar: (mes: string, aberto: boolean) => void;
  onDefinirBloco: (meses: string[], abrir: boolean) => void;
  vazio: string;
  adiante?: boolean;
}) {
  const meses = grupos.map((g) => g.mes);
  const todosAbertos = meses.length > 0 && meses.every((m) => abertos.has(m));
  const nenhumAberto = meses.every((m) => !abertos.has(m));

  return (
    <div className={`fin-cartao-cob-bloco${adiante ? " fin-cartao-cob-adiante" : ""}`}>
      <div className="fin-cartao-cob-bloco-cab">
        <div className="fin-cartao-cob-bloco-titulo">
          <strong>{titulo}</strong>
          <span>{nota}</span>
        </div>
        {meses.length > 1 && (
          <span className="fin-cartao-cob-acoes">
            <button
              type="button"
              className="fin-cartao-cob-acao"
              onClick={() => onDefinirBloco(meses, true)}
              disabled={todosAbertos}
            >
              abrir
            </button>
            <button
              type="button"
              className="fin-cartao-cob-acao"
              onClick={() => onDefinirBloco(meses, false)}
              disabled={nenhumAberto}
            >
              fechar
            </button>
          </span>
        )}
      </div>

      {grupos.length === 0 ? (
        <p className="fin-cartao-cob-vazio">{vazio}</p>
      ) : (
        grupos.map((g) => (
          <Mes key={g.mes} grupo={g} aberto={abertos.has(g.mes)} onAlternar={onAlternar} />
        ))
      )}
    </div>
  );
}

function Mes({
  grupo,
  aberto,
  onAlternar
}: {
  grupo: GrupoDeMes;
  aberto: boolean;
  onAlternar: (mes: string, aberto: boolean) => void;
}) {
  return (
    <details
      className={`fin-cartao-cob-mes${grupo.corrente ? " fin-cartao-cob-mes-corrente" : ""}`}
      open={aberto}
      onToggle={(e) => onAlternar(grupo.mes, e.currentTarget.open)}
    >
      <summary className="fin-cartao-cob-mes-cab">
        <span className="fin-cartao-cob-mes-nome">
          <strong>{rotuloLongo(grupo.mes)}</strong>
          {grupo.corrente && <span className="fin-cartao-cob-corrente">em curso</span>}
          {/* O escopo do total, colado no total: um mês pode somar uma linha de
              crédito inteira com plásticos avulsos, e o que cada pedaço mede
              não é a mesma coisa. */}
          <span className="fin-cartao-cob-mes-escopos">
            {[
              grupo.linhasDeCredito > 0
                ? `${grupo.linhasDeCredito} ${plural(grupo.linhasDeCredito, "linha", "linhas")} de crédito`
                : null,
              grupo.cartoes > 0
                ? `${grupo.cartoes} ${plural(grupo.cartoes, "cartão", "cartões")}`
                : null
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>

        <Barra
          cobertoCents={grupo.cobertoCents}
          cegueiraCents={grupo.cegueiraCents}
          comprovacaoCents={grupo.comprovacaoCents}
          excedenteCents={grupo.excedenteCents}
          rotulo={`${rotuloCurto(grupo.mes)}: ${brlPrecise(grupo.cobertoCents)} registrados de ${brlPrecise(grupo.bancoCents)} cobrados`}
        />

        <span className="fin-cartao-cob-mes-nums">
          <span className="fin-cartao-cob-num">
            <b>{brlPrecise(grupo.bancoCents)}</b>
            <small>cobrado</small>
          </span>
          <span className="fin-cartao-cob-num">
            <b>{brlPrecise(grupo.registradoCents)}</b>
            <small>registrado</small>
          </span>
          <span className="fin-cartao-cob-pct">
            {grupo.coberturaPct === null
              ? "—"
              : `${grupo.coberturaPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
          </span>
        </span>
      </summary>

      <ul className="fin-cartao-cob-linhas">
        {grupo.linhas.map((l) => (
          <LinhaDoCartao key={l.chave} linha={l} adiante={grupo.futuro} />
        ))}
      </ul>
    </details>
  );
}

/* ===========================================================================
   A LINHA — um cartão (ou uma linha de crédito) num mês
   =========================================================================== */

function LinhaDoCartao({ linha, adiante }: { linha: LinhaPreparada; adiante: boolean }) {
  const { origem } = linha;
  const cega = linha.natureza === "cegueira";

  return (
    <li className="fin-cartao-cob-linha">
      <span className="fin-cartao-cob-linha-quem">
        <i className="fin-cartao-cob-ponto" style={{ background: linha.cor }} aria-hidden />
        <span className="fin-cartao-cob-linha-nome">
          <strong>{origem.rotulo}</strong>
          <span className="fin-cartao-cob-linha-meta">
            {origem.emissor ?? "emissor não identificado"}
          </span>
        </span>
        {/* O selo é a segunda via do escopo, para quem não lê textura: `linha`
            quer dizer que aquela fatura é de vários plásticos e não se divide. */}
        <span className="fin-cartao-cob-selo" data-escopo={origem.escopo}>
          {cega ? "linha" : "cartão"}
        </span>
      </span>

      <Barra
        cobertoCents={linha.cobertoCents}
        cegueiraCents={cega ? linha.vaoCents : 0}
        comprovacaoCents={cega ? 0 : linha.vaoCents}
        excedenteCents={linha.excedenteCents}
        cor={linha.cor}
        rotulo={`${origem.rotulo}: ${brlPrecise(linha.registradoCents)} registrados de ${brlPrecise(linha.bancoCents)} cobrados`}
      />

      <span className="fin-cartao-cob-linha-nums">
        <span className="fin-cartao-cob-num">
          <b>{brlPrecise(linha.bancoCents)}</b>
          <small>cobrado</small>
        </span>
        <span className="fin-cartao-cob-num">
          <b>{brlPrecise(linha.registradoCents)}</b>
          <small>
            {origem.registros > 0
              ? `${origem.registros} ${plural(origem.registros, "registro", "registros")}`
              : "sem registro"}
          </small>
        </span>
        <Vao linha={linha} adiante={adiante} />
      </span>
    </li>
  );
}

/**
 * A célula do vão — a única da tela que muda de palavra conforme a natureza.
 *
 * Cinco estados, e nenhum deles é uma célula em branco: zero medido, o vão
 * cego, o vão de papel, o que ainda não venceu, e o caso em que o banco nem
 * cobrou. "Não gastou" e "não sei" nunca dividem o mesmo desenho.
 */
function Vao({ linha, adiante }: { linha: LinhaPreparada; adiante: boolean }) {
  if (linha.bancoCents === 0) {
    return (
      <span className="fin-cartao-cob-num fin-cartao-cob-adiantado">
        <b>{brlPrecise(linha.registradoCents)}</b>
        <small>registrado antes de o banco cobrar</small>
      </span>
    );
  }

  if (linha.vaoCents === 0) {
    return (
      <span className="fin-cartao-cob-num fin-cartao-cob-fechado">
        <b>
          <i aria-hidden />
          nada falta
        </b>
        <small>
          {linha.excedenteCents > 0
            ? `${brlPrecise(linha.excedenteCents)} além do cobrado`
            : "a fatura inteira tem descrição"}
        </small>
      </span>
    );
  }

  if (adiante) {
    return (
      <span className="fin-cartao-cob-num fin-cartao-cob-agenda">
        <b>{brlPrecise(linha.vaoCents)}</b>
        <small>a registrar quando chegar</small>
      </span>
    );
  }

  const cega = linha.natureza === "cegueira";
  return (
    <span
      className={`fin-cartao-cob-num ${cega ? "fin-cartao-cob-cego" : "fin-cartao-cob-papel"}`}
    >
      <b>{brlPrecise(linha.vaoCents)}</b>
      <small>{cega ? "sem descrição em lugar nenhum" : "sem comprovação"}</small>
    </span>
  );
}

/* ===========================================================================
   A BARRA — três texturas, uma escala
   =========================================================================== */

/**
 * `cor` só é passada nas linhas individuais. No cabeçalho de mês o sólido é
 * uma SOMA de vários cartões, e pintá-la com a tinta de um deles diria que
 * aquele mês inteiro é daquele plástico.
 */
function Barra({
  cobertoCents,
  cegueiraCents,
  comprovacaoCents,
  excedenteCents,
  cor,
  rotulo
}: {
  cobertoCents: number;
  cegueiraCents: number;
  comprovacaoCents: number;
  excedenteCents: number;
  cor?: string;
  rotulo: string;
}) {
  const total = cobertoCents + cegueiraCents + comprovacaoCents + excedenteCents;
  if (total <= 0) {
    return <span className="fin-cartao-cob-trilho fin-cartao-cob-trilho-nulo" aria-hidden />;
  }

  const larg = (c: number) => `${(c / total) * 100}%`;
  const tinta = cor ? { background: cor } : undefined;

  return (
    <span className="fin-cartao-cob-trilho" role="img" aria-label={rotulo}>
      {cobertoCents > 0 && (
        <i
          className="fin-cartao-cob-seg fin-cartao-cob-seg-solido"
          style={{ width: larg(cobertoCents), ...tinta }}
        />
      )}
      {excedenteCents > 0 && (
        <i
          className="fin-cartao-cob-seg fin-cartao-cob-seg-excedente"
          style={{ width: larg(excedenteCents), ...tinta }}
        />
      )}
      {comprovacaoCents > 0 && (
        <i
          className="fin-cartao-cob-seg fin-cartao-cob-seg-hachura"
          style={{ width: larg(comprovacaoCents) }}
        />
      )}
      {cegueiraCents > 0 && (
        <i
          className="fin-cartao-cob-seg fin-cartao-cob-seg-pontilhado"
          style={{ width: larg(cegueiraCents) }}
        />
      )}
    </span>
  );
}

/* ===========================================================================
   AS FATURAS DA LINHA, LADO A LADO COM O REGISTRADO
   =========================================================================== */

/**
 * A pergunta literal do dono: "desta fatura de R$ 5.590,05, quanto já tem
 * descrição?".
 *
 * Só linhas que o emissor não itemiza chegam aqui (é o recorte do contrato), e
 * é por isso que a resposta é sempre a mesma forma: o que o time registrou, e o
 * resto pontilhado. Onde a fatura é a única coisa que o banco manda, o vão é a
 * medida exata do que ninguém sabe.
 */
function Faturas({ meses }: { meses: MesDeFatura[] }) {
  if (!meses.length) return null;

  return (
    <div className="fin-cartao-cob-faturas">
      <div className="fin-cartao-cob-bloco-cab">
        <div className="fin-cartao-cob-bloco-titulo">
          <strong>As faturas da linha, fatura a fatura</strong>
          <span>onde o emissor manda o total e nunca as compras</span>
        </div>
      </div>

      {meses.map((m) => {
        const cob = m.cobertura;
        const registrado = cob?.registradoCents ?? 0;
        const vao = cob ? cob.vaoCents : m.totalCents;
        const pct = cob?.coberturaPct ?? null;

        return (
          <article key={m.chave} className="fin-cartao-cob-fatura">
            <header className="fin-cartao-cob-fatura-cab">
              <span className="fin-cartao-cob-fatura-mes">
                <strong>{rotuloLongo(m.mes)}</strong>
                <span className="fin-cartao-cob-linha-meta">
                  {m.emissor ?? "linha de crédito"}
                  {m.faturas.length > 1 && (
                    // DUAS FATURAS NO MESMO MÊS existem (julho/2026). Somar sem
                    // dizer faria o total parecer uma fatura que ninguém recebeu.
                    <span className="fin-cartao-cob-fatura-multi">
                      {m.faturas.length} faturas somadas
                    </span>
                  )}
                </span>
              </span>
              <span className="fin-cartao-cob-fatura-total">{brlPrecise(m.totalCents)}</span>
            </header>

            <ul className="fin-cartao-cob-fatura-itens">
              {m.faturas.map((f) => (
                <li key={`${f.contaId}-${f.vencimentoEm}-${f.totalCents}`}>
                  <span>vence {diaMes(f.vencimentoEm)}</span>
                  <span className="fin-cartao-cob-fatura-valor">{brlPrecise(f.totalCents)}</span>
                  <span className="fin-cartao-cob-fatura-pago">
                    {f.pagoEm ? `pago em ${diaMes(f.pagoEm)}` : "pagamento não conciliado"}
                  </span>
                </li>
              ))}
            </ul>

            <Barra
              cobertoCents={cob?.cobertoCents ?? 0}
              cegueiraCents={vao}
              comprovacaoCents={0}
              excedenteCents={cob?.excedenteCents ?? 0}
              cor={cob?.cor}
              rotulo={`${rotuloCurto(m.mes)}: ${brlPrecise(registrado)} com descrição de ${brlPrecise(m.totalCents)} cobrados`}
            />

            <p className="fin-cartao-cob-fatura-conta">
              <span className="fin-cartao-cob-fatura-tem">
                {brlPrecise(registrado)} com descrição
                {cob && cob.origem.registros > 0
                  ? ` (${cob.origem.registros} ${plural(cob.origem.registros, "registro", "registros")})`
                  : ""}
              </span>
              <span className="fin-cartao-cob-fatura-falta">
                {vao > 0 ? `${brlPrecise(vao)} sem descrição em lugar nenhum` : "a fatura inteira tem descrição"}
              </span>
              {pct !== null && (
                <span className="fin-cartao-cob-fatura-pct">
                  {pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                </span>
              )}
            </p>

            {m.faturas.length > 0 && m.pagoCents !== m.totalCents && (
              <p className="fin-cartao-cob-fatura-nota">
                pago {brlPrecise(m.pagoCents)} dos {brlPrecise(m.totalCents)} cobrados
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
