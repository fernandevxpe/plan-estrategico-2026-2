---
title: Auditoria da plataforma e validação da análise do diretor
date: 2026-08-03
author: Claude Opus 5
kind: auditoria
scope: Plataforma · Pipedrive · Meta Ads · Chatwoot · Projeções 2026
summary: Sync diário nunca funcionou, 77% dos dados de atividade estavam invisíveis e as projeções estavam congeladas em jan-mai. A análise do diretor comercial confere em 26 de 26 verificações.
highlights:
  - "Sync diário falhou em 100% das execuções: PIPEDRIVE_API_KEY nunca foi cadastrada"
  - "Atividades subiram de 2.467 para 10.812 ao corrigir user_id=0 no Pipedrive"
  - "Run rate corrigido de R$ 177.429 para R$ 219.006/mês (+R$ 499k na projeção do ano)"
  - "Meta do ano exige +30% sobre o ritmo atual"
  - "92% do funil aberto travado na etapa Negociação"
  - "Zero campanhas ativas na Meta em agosto"
---

## Sumário

Auditoria completa da plataforma de gestão XPE: integridade das integrações, validação
dos números contra o CRM, revisão das projeções de 2026 e leitura estratégica dos
indicadores. Quatro defeitos críticos foram encontrados e corrigidos; a análise mensal do
diretor comercial foi validada linha a linha contra o Pipedrive.

---

## 1. O achado mais grave: não existe atualização diária

O workflow `Daily sync` falhou **em 100% das execuções** — todos os dias, há pelo menos
11 dias, sempre em cerca de 25 segundos:

```
Error: PIPEDRIVE_API_KEY ausente em .env.local
```

Os secrets da Meta e do Chatwoot foram cadastrados em 03/08/2026 de madrugada. Os do
Pipedrive e do ClickUp nunca foram. Toda a base que estava em produção veio de execuções
manuais na máquina local.

**Ação pendente (requer acesso humano ao GitHub):**

```bash
gh secret set PIPEDRIVE_API_KEY
gh secret set CLICKUP_API_TOKEN
gh secret set CLICKUP_TEAM_ID
gh workflow run "Daily sync" && gh run watch
```

O workflow foi preparado com Node 22, os novos passos de análise e dois testes de
validação que quebram o build se os números divergirem.

---

## 2. 77% dos dados de atividade estavam invisíveis

O endpoint `/v1/activities` do Pipedrive devolve **apenas a agenda do dono do token**
quando `user_id` não é informado.

| Métrica | Antes | Depois |
| --- | ---: | ---: |
| Atividades sincronizadas | 2.467 | 10.812 |
| Usuários representados | 1 | 2 |
| Reuniões na base | 142 | 1.576 |
| Reuniões em julho/2026 | 0 | 78 |

A plataforma acreditava que o time comercial não realizava reuniões desde março. O número
de 17 reuniões por semana que o diretor reportava era real — a plataforma é que estava cega.

**Correção:** `scripts/sync-data.mjs` passa `user_id: '0'` na coleta de atividades.

---

## 3. As projeções estavam congeladas em jan–mai

O motor de projeção (`analyze.mjs` e seis builders de área) tinha a janela de análise fixa,
com junho tratado como mês parcial. Junho (R$ 333.210) e julho (R$ 312.686) — os dois
melhores meses do ano — ficavam fora do cálculo.

| Métrica | Antes | Depois |
| --- | ---: | ---: |
| Run rate mensal | R$ 177.429 | R$ 219.006 |
| Projeção do ano (ritmo atual) | R$ 2.129.152 | R$ 2.628.073 |
| Fechamentos/mês | 15,4 | 18,7 |

A plataforma subestimava o negócio em **R$ 499 mil**. A janela agora deriva do calendário e
avança sozinha a cada virada de mês.

---

## 4. O módulo Gestão XPE quebrava em produção

`crm-deals-server.ts` e `crm-activities-server.ts` liam `data/raw/` em tempo de execução.
Como `data/raw/` é gitignored (mais de 70 MB), esses arquivos nunca chegaram à Vercel: o
módulo funcionava apenas na máquina local.

**Correção:** recorte versionado em `data/processed/crm-snapshot.json`, gerado por
`scripts/build-crm-snapshot.mjs` a cada sync. As nove rotas foram testadas e respondem 200
com dados reais.

---

## 5. Validação da análise do diretor comercial

Cada afirmação da análise de 31/07/2026 foi conferida contra o Pipedrive. **O diretor está
correto.**

| Afirmação | Diretor | Apurado |
| --- | ---: | ---: |
| Ganhos consultoria 2026 | 102 | 102 |
| Perdidos 2026 | 202 | 202 |
| Pós-venda (ganhos) | 24% | 23,5% |
| Tráfego pago (ganhos) | 20% | 19,6% |
| Síndico da base (ganhos) | 15% | 14,7% |
| Relacionamento XPE | 76% | 76,5% |
| Caiu de prioridade | 40% | 39,6% |
| Tentativas esgotadas | 23% | 22,8% |
| Barrado em assembleia | 12% | 12,4% |
| Concorrente | 12% | 11,9% |
| Perdas por tráfego pago | 48% | 47,5% |
| Reuniões por semana (julho) | 17 | 17,6 |
| Abaixo da meta de consultoria | 18% | 18,3% |

### Três divergências encontradas

1. **"41 dias no funil"** é a mediana (39,6 dias), não a média — que é 72,8 dias. A
   distância entre as duas revela uma cauda de negócios muito antigos parados. A métrica
   escolhida está certa; vale explicitar qual é.

2. **"Sem tracking" foi omitido das perdas.** São 24 negócios (11,9%), o terceiro maior
   "canal" de perda do ano. É o buraco dos 17% que faltavam para fechar a lista.

3. **A conta dos 52% de relacionamento não fecha sozinha.** Síndicos, administradoras e
   sucesso do cliente somam 47,9%; chega-se a 52% apenas incluindo pós-venda. Em uma
   mensagem as indicações avulsas são contadas junto com o tráfego, em outra junto com o
   relacionamento.

---

## 6. Leitura estratégica de 2026

### O gap real

Realizado de janeiro a julho: **R$ 1.533.043**, equivalente a 123% da meta acumulada. O
número consolidado parece confortável, mas:

- Meta do ano: R$ 2.952.211
- Faltam R$ 1.419.168 em 5 meses, ou R$ 283.834 por mês
- Ritmo atual: R$ 219.006 por mês
- **Necessário: +30% sobre o ritmo atual**

### Gargalo 1 — Consultoria abaixo da meta há 5 meses seguidos

Atingimento mensal: 94%, 82%, 85%, 83%, 82%. Obras está a 161,7% da meta e compensa o
resultado consolidado. O motor principal desacelera enquanto o número agregado sorri.

### Gargalo 2 — 92% do funil aberto travado em uma única etapa

| Etapa | Negócios | Valor |
| --- | ---: | ---: |
| Negociação | 170 | R$ 1.785.200 |
| Elaboração de Proposta | 28 | R$ 115.600 |
| Fechamento | 3 | R$ 26.500 |
| Visita de Diagnóstico | 11 | R$ 16.470 |
| Aguardando Agendamento | 16 | R$ 0 |
| Relacionamento | 34 | R$ 0 |

Três negócios em Fechamento contra 170 em Negociação. Ou a etapa é pulada na prática, ou a
negociação virou depósito de oportunidades sem desfecho.

### Gargalo 3 — 62% das perdas são falha de follow-up

"Caiu de prioridade" (80 negócios) e "Tentativas esgotadas" (46) somam 126 negócios e
**R$ 1.295.950**. Apenas 24 perdas foram para concorrente. A empresa não perde para o
mercado — perde para o silêncio. A metodologia BANT proposta pelo diretor ataca exatamente
essa fatia.

### Gargalo 4 — A mídia parou e o efeito ainda não apareceu

| Mês | Investimento | Conversas |
| --- | ---: | ---: |
| Abril | R$ 2.535 | 178 |
| Maio | R$ 2.525 | 253 |
| Junho | R$ 2.594 | 209 |
| Julho | R$ 1.005 | 55 |
| Agosto | R$ 0 | 0 |

Zero campanhas ativas. O potencial criado caiu de 202% para 79% da meta em julho. Com ciclo
mediano de 40 dias, isso vira queda de fechamento em setembro e outubro — exatamente quando
seriam necessários R$ 283 mil por mês. Saldo da conta de anúncios: R$ 274,16.

### Gargalo 5 — 29% do funil aberto sem valor preenchido

77 de 262 negócios abertos estão com R$ 0. O potencial real é maior que os R$ 1,94 milhão
apurados, mas não é possível dizer quanto.

### A oportunidade

Eficiência por canal em 2026:

| Canal | Win rate | Ganhos/Perdas | Receita |
| --- | ---: | ---: | ---: |
| Pós-Venda base XPE | 73% | 24/9 | R$ 247.186 |
| Indicação Avulsa | 73% | 8/3 | R$ 70.750 |
| Síndico Profissional Base | 65% | 15/8 | R$ 115.420 |
| Indicação de Cliente XPE | 57% | 12/9 | R$ 102.750 |
| Sucesso do Cliente | 38% | 6/10 | R$ 47.500 |
| Administradora Cond. | 24% | 9/28 | R$ 82.500 |
| Tráfego Pago | 17% | 20/96 | R$ 183.550 |

Pós-venda converte 4,3 vezes melhor que tráfego pago e já é o maior gerador de receita. Mas
a cobertura de CNPJ está em 259 de 1.655 organizações (15,6%) — não há como operar pós-venda
sistematicamente sem saber quem é quem.

> **Recomendação:** não cortar o tráfego, que alimenta o topo e sustenta autoridade no
> segmento. Corrigir a qualificação **antes** da proposta: 96 perdas vindas de tráfego
> consomem capacidade comercial que renderia mais aplicada na base. E resolver o cadastro de
> CNPJ, que é o desbloqueio do canal que converte a 73%.

---

## 7. UX e navegação

**Corrigido:** quatro rotas (`/comercial`, `/metas`, `/pos-venda`, `/plano-pro`) existiam e
eram compiladas, mas não tinham link em lugar nenhum — cerca de 30% da plataforma só era
acessível digitando a URL. O menu passou a agrupar por pergunta: *Como estamos*, *Para onde
vamos*, *Onde agir*.

**Corrigido:** o Resumo abria com o forecast. Agora abre com "Precisa de decisão agora",
listando os achados críticos antes que o gestor precise procurá-los.

**Pendente de investigação:** o Chatwoot tem 19 dias de lacuna suspeita em 89, e 396 de 569
conversas seguem abertas (70%). A plataforma marca as lacunas corretamente, mas vale
investigar a estabilidade da conexão antes de tirar conclusões sobre conversão de pré-vendas.

---

## 8. O que ficou automatizado

- Nova área **Diretor Comercial** (`/areas/diretor-comercial`) com canais de origem, motivos
  de perda, ciclo de vendas, reuniões contra meta e metas do Pipedrive, mês a mês.
- **Diagnóstico executivo** gerado a partir dos números, ordenado por urgência, exibido na
  área e com os itens críticos abrindo o Resumo.
- `npm run test:commercial-intel` trava 26 verificações contra esta análise. Se o pipeline
  divergir, o build falha.
