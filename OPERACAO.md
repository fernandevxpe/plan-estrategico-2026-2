# Operação da plataforma

Guia curto para manter a plataforma rodando. Contexto e decisões de produto estão em
[CONTEXTO.md](CONTEXTO.md); as análises ficam registradas em `reports/auditorias/` e são
lidas na própria plataforma em `/auditorias`.

---

## Onde a plataforma roda

| | |
|---|---|
| **Produção** | Railway · projeto `xpe-plataforma` · serviço `web` |
| **URL** | https://web-production-ee3c4.up.railway.app |
| **Vercel** | Redireciona (308) para a URL acima — ver abaixo |
| **Acesso** | Basic Auth — usuário `xpe`, senha nas variáveis do Railway (`DASHBOARD_AUTH_PASSWORD`) |
| **Dados** | Volume persistente montado em `/data` |
| **Sync** | Diário às 08:00 BRT, dentro do próprio serviço |

O deploy é automático a cada push na `main`.

### Por que o Vercel só redireciona

O Vercel é serverless: não tem volume persistente nem processo longo, então nunca vai rodar o
sync diário. Se continuasse servindo páginas, mostraria para sempre o snapshot congelado no
momento do build — duas URLs com números diferentes, que é o pior cenário para confiança nos
indicadores.

O middleware detecta o ambiente (`process.env.VERCEL`) e redireciona para `PRIMARY_APP_URL`
antes da autenticação, já que o destino tem a dele. Links antigos continuam funcionando.

Para reverter, basta remover a variável `PRIMARY_APP_URL` do projeto no Vercel.

---

## Como o dado chega na tela

```
APIs (Pipedrive, ClickUp, Meta, Chatwoot)
   ↓  scripts/sync-data.mjs · sync-meta.mjs · sync-chatwoot.mjs
/data/raw/            dados brutos, ~80 MB, nunca versionados
   ↓  scripts/analyze*.mjs
/data/processed/      artefatos que a plataforma lê
   ↓  lib/data/processed-store.ts  (cache invalidado por mtime)
Next.js               revalidate = 300 → tela atualiza em até 5 min
```

O repositório guarda um **snapshot semente** em `data/processed/`. Ele é usado no build e na
primeira subida do volume, e **não** é atualizado diariamente — é isso que impede o git de
crescer.

---

## Credenciais

Todas ficam nas variáveis do serviço `web` no Railway.

```bash
railway link --project xpe-plataforma --service web
railway variables                      # listar
railway variables --set CHAVE=valor    # definir
```

| Variável | Status | Para quê |
|---|---|---|
| `PIPEDRIVE_API_KEY` | configurada | Negócios, atividades, metas |
| `CLICKUP_API_TOKEN` · `CLICKUP_TEAM_ID` | configuradas | Tarefas e projetos |
| `META_AD_ACCOUNT_ID` · `META_BUSINESS_ID` · `META_PAGE_ID` · `META_INSTAGRAM_ACCOUNT_ID` · `META_PIXEL_ID` | configuradas | IDs da conta de anúncios |
| **`META_ACCESS_TOKEN`** | **faltando** | Sem ela, marketing não atualiza |
| `CHATWOOT_BASE_URL` · `CHATWOOT_ACCOUNT_ID` | configuradas | Endereço da instância |
| **`CHATWOOT_API_ACCESS_TOKEN`** | **faltando** | Sem ela, pré-vendas não atualiza |
| `DASHBOARD_AUTH_USER` · `DASHBOARD_AUTH_PASSWORD` | configuradas | Acesso à plataforma |

Enquanto as duas faltarem, o pipeline roda mesmo assim: Pipedrive e ClickUp atualizam
normalmente e o indicador no topo da tela mostra quantas fontes ficaram para trás.

As duas que faltam existem no projeto do Vercel, mas estão marcadas como **sensíveis** — o
Vercel não devolve o valor nem por `env pull` nem pelo painel, por design. Precisam ser
geradas de novo na origem:

- `META_ACCESS_TOKEN` — Meta Business Manager → System User → gerar token com `ads_read`,
  `pages_read_engagement` e `instagram_basic`
- `CHATWOOT_API_ACCESS_TOKEN` — Chatwoot → Perfil → Access Token

---

## Rotina de verificação

```bash
railway logs                    # acompanhar o agendador em tempo real
railway logs | grep scheduler   # só as etapas do pipeline
```

O resultado da última rodada fica em `/data/sync-state.json`:

```json
{ "lastStatus": "ok | parcial | erro", "lastFailures": [...], "lastDurationMs": 64000 }
```

A plataforma lê esse arquivo e mostra o estado no canto superior direito. Verde é dado
fresco; âmbar é sync atrasado ou parcial; vermelho é sync com erro ou dado com mais de 48h.

---

## Rodar o pipeline localmente

Precisa de `.env.local` com as credenciais.

```bash
npm run sync:all               # pipeline inteiro, igual ao que roda em produção
npm run sync                   # só Pipedrive + ClickUp
npm run analyze                # só as análises, sobre o dado já baixado
npm run test:commercial-intel  # trava os números contra a análise do diretor
npm run test:revenue-funnel    # valida o funil 360
```

Para simular o ambiente do Railway, aponte `DATA_DIR` para uma pasta qualquer:

```bash
DATA_DIR=/tmp/xpe-data npm run sync:all
DATA_DIR=/tmp/xpe-data npm run start
```

---

## Registrar uma nova auditoria

1. Crie `reports/auditorias/AAAA-MM-DD-titulo.md` com frontmatter:

```markdown
---
title: Título da rodada
date: 2026-09-15
author: Quem fez
kind: auditoria | infraestrutura
scope: O que foi olhado
summary: Uma frase com o achado principal.
highlights:
  - "Achado curto e específico"
---

## Primeira seção
```

2. `npm run build:audits`
3. Commit e push — aparece em `/auditorias` com seletor de rodada e histórico por data.

---

## Quando algo quebra

**A tela não abre (503).** `DASHBOARD_AUTH_USER` ou `DASHBOARD_AUTH_PASSWORD` sumiram das
variáveis. O middleware recusa subir sem elas de propósito, para a plataforma nunca ficar
exposta por engano.

**A tela abre mas o dado é antigo.** Veja o indicador no topo e depois `railway logs | grep
scheduler`. Se o pipeline falhou numa etapa obrigatória, o volume manteve a versão anterior —
que é o comportamento desejado, melhor um dado velho identificado do que um pela metade.

**O deploy falha no build.** O CI do GitHub roda `tsc --noEmit` e `next build` com
`DATA_DIR=/data` a cada push, justamente para pegar isso antes do Railway. Confira a aba
Actions primeiro.

**Lançamentos da Gestão XPE sumiram.** Não deveriam: gravam em `/data/gestao-xpe/`, que é o
volume. Se sumirem, alguém apontou a escrita de volta para `process.cwd()` — veja a tabela de
armadilhas em CONTEXTO.md.
