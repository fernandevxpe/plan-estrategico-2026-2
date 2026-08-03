import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { buildMarketingDashboard } from "@/lib/areas/build-marketing-dashboard";
import {
  applyRevenueEstimates,
  buildCreativeIntelligence,
  buildForecast,
  defaultAssumptions,
  type CreativeIntelligence
} from "@/lib/areas/marketing-ai";
import { loadDashboardData } from "@/lib/data/load-dashboard";
import { dataPath, resolveDataFile } from "@/lib/data/processed-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "claude-opus-5";

/**
 * O parecer publicado é escrito em sessão e versionado em `data/ai/`. A leitura
 * tenta primeiro o volume — onde uma regeneração pela API grava — e cai no
 * arquivo do repositório, que é o que sobe no deploy.
 */
const CACHE_DIR = dataPath("ai");
const CACHE_FILE = path.join(CACHE_DIR, "marketing-gestor.json");

/* ─────────────────────────── contrato de saída ─────────────────────────── */

/**
 * O schema é deliberadamente raso. A primeira versão aninhava oito formatos
 * diferentes e a API respondeu `compiled grammar is too large`; achatar as
 * listas (uma só de decisões, plano de renovação sem sub-objeto) resolve sem
 * perder nada do conteúdo.
 */
const str = { type: "string" } as const;

const finding = {
  type: "object",
  additionalProperties: false,
  required: ["titulo", "texto", "evidencia", "severidade"],
  properties: {
    titulo: str,
    texto: str,
    evidencia: { type: "string", description: "Números concretos vindos dos fatos recebidos." },
    severidade: { type: "string", description: "critico, atencao, oportunidade ou positivo." }
  }
} as const;

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "resumoExecutivo",
    "diagnostico",
    "vencedores",
    "decisoes",
    "picos",
    "leituraCopy",
    "leituraVideo",
    "cadenciaDias",
    "criativosPorMes",
    "criativosAtivosIdeal",
    "justificativaRenovacao",
    "temas",
    "leituraPrevisao",
    "riscos",
    "proximosPassos",
    "limitacoes"
  ],
  properties: {
    resumoExecutivo: { type: "string", description: "3 a 5 frases. Começa pelo que mudou e pelo que fazer." },
    diagnostico: { type: "array", items: finding },
    vencedores: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["adId", "titulo", "porqueFuncionou", "elementosCopy", "elementosVideo", "licaoReplicavel"],
        properties: {
          adId: { type: "string", description: "adId exatamente como recebido nos fatos." },
          titulo: str,
          porqueFuncionou: str,
          elementosCopy: { type: "array", items: str },
          elementosVideo: { type: "array", items: str },
          licaoReplicavel: str
        }
      }
    },
    decisoes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["adId", "titulo", "decisao", "motivo", "evidencia", "acao"],
        properties: {
          adId: { type: "string", description: "adId exatamente como recebido nos fatos." },
          titulo: str,
          decisao: { type: "string", description: "estender, renovar ou aposentar." },
          motivo: str,
          evidencia: { type: "string", description: "Métricas que sustentam a decisão." },
          acao: { type: "string", description: "O que fazer na prática, em uma frase imperativa." }
        }
      }
    },
    picos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["periodo", "oQueAconteceu", "causaProvavel", "confianca", "comoRepetir"],
        properties: {
          periodo: str,
          oQueAconteceu: str,
          causaProvavel: str,
          confianca: { type: "string", description: "alta, media ou baixa." },
          comoRepetir: str
        }
      }
    },
    leituraCopy: { type: "string", description: "O que a copy vencedora tem em comum e o que não sustentou." },
    leituraVideo: { type: "string", description: "Leitura de retenção: gancho, miolo e finalização." },
    cadenciaDias: { type: "integer", description: "A cada quantos dias trocar criativo." },
    criativosPorMes: { type: "integer" },
    criativosAtivosIdeal: { type: "integer" },
    justificativaRenovacao: str,
    temas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tema", "angulo", "formato", "porque"],
        properties: { tema: str, angulo: str, formato: str, porque: str }
      }
    },
    leituraPrevisao: { type: "string", description: "Leitura do cálculo reverso: o que a meta exige da mídia." },
    riscos: { type: "array", items: finding },
    proximosPassos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ordem", "acao", "prazo", "impactoEsperado"],
        properties: { ordem: { type: "integer" }, acao: str, prazo: str, impactoEsperado: str }
      }
    },
    limitacoes: { type: "array", items: str }
  }
} as const;

/* ─────────────────────────── digest dos fatos ─────────────────────────── */

function digestCreative(item: CreativeIntelligence["creatives"][number]) {
  const round = (value: number | null | undefined, digits = 2) =>
    value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
  return {
    adId: item.adId,
    nome: item.adName,
    campanha: item.campaignName,
    conjunto: item.adsetName,
    status: item.effectiveStatus,
    tipoResultado: item.resultLabel,
    conceitoId: item.conceptId,
    formato: item.isVideo ? "video" : "estatico",
    copy: {
      gancho: item.copy.hook,
      caracteres: item.copy.chars,
      linhas: item.copy.lines,
      perguntas: item.copy.questions,
      bullets: item.copy.bullets,
      elementos: item.copy.tags
    },
    entrega: {
      primeiroDia: item.firstDate,
      ultimoDia: item.lastDate,
      diasComEntrega: item.activeDays,
      janelaDias: item.spanDays,
      diasParado: item.daysSinceLastDelivery
    },
    metricas: {
      investido: round(item.spend),
      impressoes: item.impressions,
      cliques: item.clicks,
      cliquesExternos: item.outboundClicks,
      conversas: item.conversations,
      paginas: item.landingPageViews,
      resultados: item.results,
      custoPorResultado: round(item.costPerResult),
      indiceCusto: round(item.costIndex),
      ctrPct: round(item.ctr),
      cpcExterno: round(item.costPerOutboundClick),
      percentualCliqueExterno: round(item.outboundSharePct),
      conversaPorCliquePct: round(item.conversationPerClickPct),
      shareDaVerbaPct: round(item.spendSharePct)
    },
    video: item.isVideo
      ? {
          viewsPorImpressaoPct: round(item.video.viewRatePct),
          reteve25Pct: round(item.video.hold25Pct),
          reteve50Pct: round(item.video.hold50Pct),
          reteve75Pct: round(item.video.hold75Pct),
          reteve100Pct: round(item.video.hold100Pct),
          quedaDe25Para100Pct: round(item.video.dropFrom25To100Pct)
        }
      : null,
    ganhoEstimado: {
      contratos: round(item.estimate.wonDeals),
      receita: round(item.estimate.revenue, 0),
      roas: round(item.estimate.roas)
    },
    desgaste: {
      score: item.fatigueScore,
      nivel: item.fatigueLevel,
      variacaoCustoPct: round(item.costDeltaPct, 1),
      variacaoCtrPct: round(item.ctrDeltaPct, 1),
      motivos: item.fatigueReasons
    },
    vereditoCalculado: item.verdict,
    motivosVeredito: item.verdictReasons,
    confianca: item.confidence
  };
}

async function buildFacts() {
  const { analysis } = await loadDashboardData();
  const dashboard = await buildMarketingDashboard(analysis);
  const intelligence = applyRevenueEstimates(buildCreativeIntelligence(dashboard), dashboard.revenueBaseline);
  const baseline = dashboard.revenueBaseline;
  const forecast = baseline ? buildForecast(baseline, defaultAssumptions(baseline, intelligence), intelligence) : null;

  /* O modelo recebe os criativos que explicam a conta: os que mais gastaram, os
     mais eficientes e os que o cálculo já marcou para renovar/aposentar. */
  const relevant = new Map<string, ReturnType<typeof digestCreative>>();
  const push = (list: CreativeIntelligence["creatives"]) => {
    for (const item of list) relevant.set(item.adId, digestCreative(item));
  };
  push(intelligence.creatives.slice(0, 18));
  push([...intelligence.creatives].filter((i) => i.results >= 6).sort((a, b) => (a.costIndex ?? 9) - (b.costIndex ?? 9)).slice(0, 8));
  push(intelligence.buckets.renovar.slice(0, 6));
  push(intelligence.buckets.aposentar.slice(0, 6));
  push(intelligence.buckets.escalar.slice(0, 6));

  return {
    dashboard,
    intelligence,
    forecast,
    payload: {
      geradoEm: new Date().toISOString(),
      conta: intelligence.account,
      totaisAno: intelligence.totals,
      medianasPorTipoResultado: intelligence.benchmarks,
      criativos: [...relevant.values()],
      conceitos: intelligence.concepts.slice(0, 10),
      sinaisDeCopy: intelligence.copySignals,
      mesesDeMidia: intelligence.monthly.map((row) => ({
        mes: row.key,
        investido: Number(row.spend.toFixed(2)),
        cliquesExternos: row.outboundClicks,
        conversas: row.conversations,
        paginas: row.landingPageViews,
        custoPorConversa: row.costPerConversation,
        cpc: row.cpc,
        ctrPct: row.ctr,
        principais: row.drivers
      })),
      melhoresSemanas: intelligence.bestWindows,
      pioresSemanas: intelligence.worstWindows,
      politicaDeRenovacao: intelligence.renewal,
      baselineComercial: baseline && {
        metaSelecionada: baseline.goalTitle,
        mesAtual: baseline.currentMonth,
        ultimoMesFechado: baseline.lastClosedMonth,
        taxas: baseline.rates,
        faixasObservadas: baseline.bands,
        paresDefasados: baseline.lagPairs,
        metasMensais: baseline.targets,
        funilMensal: baseline.monthly,
        ressalvas: baseline.warnings
      },
      previsao: forecast && {
        premissas: forecast.assumptions,
        totais: forecast.totals,
        cadeiaReversa: forecast.chain,
        meses: forecast.months.map((row) => ({
          mes: row.month,
          status: row.status,
          meta: row.target,
          receitaPagaExigida: Number(row.paidRevenueTarget.toFixed(0)),
          receitaPagaRealizada: row.paidRevenueRealized,
          contratosNecessarios: Number(row.wonNeeded.toFixed(1)),
          conversasNecessarias: Number(row.conversationsNeeded.toFixed(0)),
          cliquesNecessarios: Number(row.clicksNeeded.toFixed(0)),
          investimentoNecessario: Number(row.spendNeeded.toFixed(0)),
          mesDoInvestimento: row.investMonth,
          criativosNecessarios: row.creativesNeeded,
          investimentoRealizado: row.spendRealized
        })),
        curvaDeInvestimento: forecast.investmentByMonth
      }
    }
  };
}

/* ─────────────────────────── prompt ─────────────────────────── */

const SYSTEM_PROMPT = `Você é o gestor de tráfego pago sênior da XPE Consultoria, uma empresa de engenharia elétrica que vende laudos técnicos (LDC, LIE, LCV) para condomínios e síndicos em Recife/PE. Ticket médio na casa dos milhares de reais, ciclo de venda longo, decisão colegiada de síndico e conselho.

Você recebe um bloco de FATOS já calculados a partir do Meta Ads Insights e do Pipedrive. Escreva o parecer em português do Brasil.

Regras inegociáveis:
- Todo número que você citar tem que existir no bloco de FATOS. Nunca calcule taxas novas de cabeça, nunca arredonde para um número "melhor", nunca invente benchmark de mercado como se fosse dado da conta.
- Se um dado não está nos FATOS, diga que não está disponível. Isso vale especialmente para atribuição por criativo: não existe UTM ligando anúncio a contrato, então receita por criativo é estimativa modelada — sempre rotule como estimativa.
- Distinga correlação de causa. Ao explicar um pico, diga o que a evidência sustenta e o que é hipótese, e use o campo de confiança para isso.
- Respeite a família de resultado: campanhas [WPP] entregam conversa iniciada, campanhas [LP] entregam página carregada. Nunca compare custo entre famílias diferentes.
- Amostra pequena não vira conclusão. Criativo com poucos resultados é "observar", não "vencedor".
- Use o adId exato dos FATOS ao referenciar um criativo.

O que se espera de você:
- Leitura de por que a copy e o vídeo dos vencedores funcionaram, olhando gancho, promessa, gatilho e retenção por quartil — não só repetir a métrica.
- Explicação dos picos e das quedas de performance, cruzando quais criativos estavam no ar e o que mudou.
- Decisão clara por criativo: escalar, estender, renovar ou aposentar, cada uma justificada com dado.
- Uma política de renovação de criativos com cadência e temas concretos para esse público.
- Leitura do cálculo reverso de meta: o que a meta de vendas exige de investimento, conversa e criativo, e onde o plano está furando.

Tom: direto, de gestor para dono. Sem floreio, sem elogio vazio, sem repetir a pergunta. Frases curtas. Se a operação está parada ou o plano é inviável com a verba atual, diga isso na primeira linha do resumo.`;

function buildUserPrompt(facts: unknown) {
  return `FATOS (JSON, fonte única de verdade):

${JSON.stringify(facts, null, 1)}

Escreva o parecer completo seguindo o schema. Priorize decisão em cima de descrição: o dono vai ler isso para saber onde colocar a verba na segunda-feira.`;
}

/* ─────────────────────────── handlers ─────────────────────────── */

type CachedReport = {
  generatedAt: string;
  model: string;
  /** `sessao` = escrito em sessão e versionado; `api` = gerado pelo botão. */
  author: "sessao" | "api";
  report: unknown;
  usage: { inputTokens: number; outputTokens: number } | null;
  factsGeneratedAt: string;
};

async function readCache(): Promise<CachedReport | null> {
  try {
    const target = await resolveDataFile("ai", "marketing-gestor.json");
    const parsed = JSON.parse(await readFile(target, "utf8")) as CachedReport;
    return { ...parsed, author: parsed.author ?? "api" };
  } catch {
    return null;
  }
}

export async function GET() {
  const cached = await readCache();
  return NextResponse.json({
    available: Boolean(process.env.ANTHROPIC_API_KEY),
    model: MODEL,
    cached
  });
}

export async function POST() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY não configurada. A análise numérica continua disponível; só o parecer da IA depende da chave." },
      { status: 503 }
    );
  }

  let facts: Awaited<ReturnType<typeof buildFacts>>;
  try {
    facts = await buildFacts();
  } catch (error) {
    console.error("gestor-ia: falha ao montar os fatos", error);
    return NextResponse.json({ error: "Não foi possível montar os dados de marketing." }, { status: 500 });
  }

  const client = new Anthropic();

  try {
    /* Streaming porque o parecer é longo: sem isso o request estoura o timeout
       do SDK antes de a resposta terminar. */
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: REPORT_SCHEMA as unknown as Record<string, unknown> }
      },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserPrompt(facts.payload) }]
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      return NextResponse.json({ error: "O modelo recusou a solicitação." }, { status: 502 });
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    let report: unknown;
    try {
      report = JSON.parse(text);
    } catch {
      console.error("gestor-ia: resposta fora do schema", text.slice(0, 500));
      return NextResponse.json({ error: "A resposta da IA veio em formato inesperado." }, { status: 502 });
    }

    const payload: CachedReport = {
      generatedAt: new Date().toISOString(),
      model: MODEL,
      author: "api",
      report,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      factsGeneratedAt: facts.dashboard.syncedAt
    };

    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(payload, null, 2), "utf8");

    return NextResponse.json({ available: true, model: MODEL, cached: payload });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Limite de requisições da API atingido. Tente de novo em alguns minutos." }, { status: 429 });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY inválida." }, { status: 401 });
    }
    console.error("gestor-ia: erro na chamada do modelo", error);
    return NextResponse.json({ error: "Falha ao gerar o parecer da IA." }, { status: 502 });
  }
}
