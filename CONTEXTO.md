# 🧠 Contexto Completo — Plataforma de Gestão Inteligente

> **Como usar este arquivo:**
> Cole o conteúdo completo no início de qualquer conversa com qualquer IA.
> Ele resume quem eu sou, o que quero construir, as decisões já tomadas e o estado atual do projeto.
> Última revisão rápida: 2026-04-30.

---

## 👤 Perfil

- **Perfil técnico:** Vibe coder — desenvolvo com forte auxílio de IA (Claude Code, Cursor)
- **Ferramenta atual de gestão:** ClickUp (projetos, clientes, tarefas, tempo)
- **Hospedagem futura:** Vercel (frontend) + Supabase (banco)
- **Fase atual:** Desenvolvimento local — estudar a base, estruturar, depois escalar

---

## 🎯 Objetivo Principal

Construir uma **plataforma própria de gestão de projetos e clientes** que:

1. **Espelha o ClickUp** — copia toda a base de dados local para estudo e evolução
2. **Analisa e reestrutura** — identifica inconsistências, campos subutilizados, padrões, correlações
3. **Tem um AI Chat inteligente** — conversa com todos os dados em tempo real
4. **Evolui para substituir o ClickUp** — plataforma customizada pro meu fluxo específico
5. **Escala para produção** — Vercel + Supabase sem reescrever nada

---

## 🏗️ Arquitetura Definida

### Stack
```
Frontend:     Next.js 14 (App Router) + Tailwind CSS
Backend:      API Routes do Next.js
LLM:          Claude API (claude-sonnet) — tool use + streaming
Embeddings:   Voyage AI (voyage-3-lite) ou OpenAI text-embedding-3-small
Vector DB:    pgvector via Supabase
Banco:        PostgreSQL (Supabase local com Docker)
Sync:         Webhooks do ClickUp + Cron job diário de segurança
Fila:         Tabela de jobs no próprio Postgres (sem Redis)
Dev:          Claude Code (extensão Cursor) + Cursor
```

### Hierarquia de dados do ClickUp
```
Workspace (Team)
└── Spaces
    └── Folders
        └── Lists
            └── Tasks
                ├── Subtasks
                ├── Custom Fields
                ├── Comments
                ├── Time Entries
                ├── Attachments
                └── Checklists
```

### Arquitetura do AI Chat
```
Pergunta do usuário
       ↓
[Busca Vetorial RAG] → chunks relevantes do pgvector
       ↓
[Claude API] com tool use habilitado
       ↓
Claude decide: responde direto OU chama uma tool
       ↓
Tools disponíveis:
  - search_tasks(query, filtros)
  - get_project_summary(id)
  - get_time_entries(periodo)
  - get_overdue_tasks()
  - get_client_overview(nome)
  - get_workload_by_member()
  - semantic_search(query)
       ↓
Resposta em streaming para o usuário
```

### Fluxo de Sync em Tempo Real
```
TEMPO REAL:   ClickUp → Webhook → Tabela de fila → Worker → Banco + Embedding
SEGURANÇA:    Cron diário → Sync completo → Re-embeda só o que mudou
DOCUMENTOS:   Upload/anexo → Extração de texto → Chunks → Embeddings
```

### Como os embeddings funcionam
- Cada task vira um **documento rico**: título + descrição + comentários + status + responsável + tags + tempo
- Embedding gerado via Voyage AI ou OpenAI
- Armazenado no pgvector com hash do conteúdo
- Só re-embeda se o conteúdo mudou (compara hash)
- Custo estimado: ~$0.30 para indexar 10.000 tasks

---

## 📁 Estrutura de Pastas do Projeto

```
/
├── app/
│   ├── api/
│   │   ├── chat/route.ts
│   │   ├── webhook/clickup/route.ts
│   │   ├── sync/route.ts
│   │   └── dashboard/route.ts
│   ├── chat/page.tsx
│   ├── dashboard/page.tsx
│   └── layout.tsx
├── lib/
│   ├── clickup/          # client.ts, sync.ts, types.ts
│   ├── ai/               # embeddings.ts, tools.ts, rag.ts, chat.ts
│   ├── db/               # schema.ts, queries.ts, client.ts
│   └── queue/            # worker.ts
├── components/
│   ├── chat/
│   ├── dashboard/
│   └── ui/
├── scripts/
│   ├── full-sync.ts
│   ├── seed-embeddings.ts
│   └── analyze-structure.ts
└── supabase/migrations/
```

---

## 🗄️ Schema do Banco de Dados

Tabelas principais:
- `spaces` — spaces do ClickUp
- `folders` — folders dentro dos spaces
- `lists` — listas dentro dos folders
- `tasks` — tarefas (com custom_fields e assignees em JSONB)
- `time_entries` — registros de tempo
- `comments` — comentários das tasks
- `embeddings` — vetores para busca semântica (pgvector, 1024 dims)
- `sync_jobs` — fila de processamento de webhooks
- `sync_log` — histórico de sincronizações

---

## 🔑 Variáveis de Ambiente

```env
CLICKUP_API_TOKEN=
CLICKUP_TEAM_ID=
CLICKUP_WEBHOOK_SECRET=
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres
ANTHROPIC_API_KEY=
VOYAGE_API_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## 📋 Etapas de Desenvolvimento (estado atual)

- [ ] **Etapa 1** — Setup Next.js + Supabase local + schema + migrations
- [ ] **Etapa 2** — ClickUp API client + script de sync completo inicial
- [ ] **Etapa 3** — Script de análise de estrutura → gera `analysis-report.md`
- [ ] **Etapa 4** — Pipeline de embeddings + busca semântica (RAG)
- [ ] **Etapa 5** — Webhook endpoint + worker de processamento da fila
- [ ] **Etapa 6** — AI Chat API (Claude + tools + RAG integrado)
- [ ] **Etapa 7** — UI do chat (streaming, badges de task, tool indicators)
- [ ] **Etapa 8** — Dashboard com visualizações (Recharts, dados reais)
- [ ] **Etapa 9** — Análise de estrutura UI + sistema de templates
- [ ] **Etapa 10** — Preparação para deploy (Vercel + Supabase cloud)

### Sync diário — Railway (resolvido em 03/08/2026)

O GitHub Actions rodava um sync que **nunca funcionou** (secrets do Pipedrive nunca
cadastradas) e que, se funcionasse, commitaria ~8 MB de artefato por dia no repositório.
Foi substituído.

**Arquitetura atual:**

```
Railway · projeto xpe-plataforma · serviço web (Nixpacks)
├── volume persistente montado em /data          ← DATA_DIR=/data
│   ├── raw/         dados brutos das APIs (não versionado, ~80 MB)
│   ├── processed/   artefatos que a plataforma lê
│   ├── gestao-xpe/  lançamentos semanais (a plataforma ESCREVE aqui)
│   └── sync-state.json  resultado da última rodada
├── scripts/server.mjs      sobe o Next e o agendador no mesmo processo
└── scripts/scheduler.mjs   pipeline diário às 08:00 BRT (11:00 UTC)
```

- `lib/data/processed-store.ts` lê do volume em runtime, com cache invalidado por mtime.
  Nada de `import x from "@/data/processed/*.json"`: isso congelava o dado no build.
- As rotas têm `revalidate = 300`, então o dado novo aparece em até 5 minutos.
- O repositório guarda um snapshot semente, usado no build e na primeira subida do volume.
  Ele **não** é atualizado diariamente — o git não cresce.
- Etapas opcionais (Meta, Chatwoot) podem falhar sem derrubar o resto; o indicador de
  frescor no topo da plataforma mostra quais fontes pararam de atualizar.

**Comandos úteis:**

```bash
railway link --project xpe-plataforma --service web
railway logs                       # acompanhar o agendador
railway variables                  # conferir credenciais
npm run sync:all                   # rodar o pipeline inteiro localmente
```

### Armadilhas já corrigidas (não reintroduzir)

| Armadilha | Correção |
|---|---|
| `/v1/activities` sem `user_id=0` devolve só a agenda do dono do token | `scripts/sync-data.mjs` passa `user_id: '0'` — 2.467 → 10.812 atividades |
| Janela de análise fixa em jan-mai/2026 | `scripts/analyze.mjs` deriva a janela do calendário (`CURRENT_MONTH`, `LAST_CLOSED_MONTH`) |
| Runtime lendo `data/raw/` (gitignored, ausente no deploy) | `data/processed/crm-snapshot.json` via `scripts/build-crm-snapshot.mjs` |
| `import` estático de JSON congela o dado no build | `lib/data/processed-store.ts` + `revalidate = 300` |
| Escrita em `process.cwd()` some no redeploy | `dataPath()` aponta para o volume; `resolveDataFile()` lê com reserva no repositório |
| Rotas sem link no menu | `components/layout/AppNav.tsx` agrupa e expõe todas |
| `tsconfig.tsbuildinfo` versionado | Gitignorado — colidia com o cache do Nixpacks e derrubava o build |
| `retry-after` do 429 obedecido sem teto | Limitado a 30s + timeout de 60s por requisição + watchdog de 20 min por etapa |

`npm run test:commercial-intel` trava os números contra a análise do diretor de 31/07/2026.

---

## 💡 Decisões Já Tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Banco local | Supabase + Docker | Mesma stack local e produção |
| ORM | Drizzle ORM | Leve, TypeScript nativo, bom com Supabase |
| Embeddings | Voyage AI voyage-3-lite | Boa relação custo/qualidade |
| Fila de jobs | Tabela no Postgres | Evita dependência de Redis no início |
| Sync | Webhook + cron diário | Tempo real + segurança contra perdas |
| LLM | Claude (Anthropic) | Melhor para tool use e contexto longo |
| Deploy | Vercel + Supabase cloud | Zero reescrita do código local |

---

## 🔮 Visão de Futuro (pós MVP)

- **Dashboard de cliente** — cliente acessa e vê só o status do projeto dele
- **Substituição total do ClickUp** — plataforma própria com os módulos que uso
- **Templates de projeto** — criar estruturas padronizadas e aplicar via API
- **Automações** — triggers baseados em eventos (task atrasada → notificação)
- **Relatórios automáticos** — gerados pela IA semanalmente
- **Multi-workspace** — suporte a mais de um ClickUp workspace

---

## 🧩 Contexto Técnico Relevante

### ClickUp API
- Base URL: `https://api.clickup.com/api/v2/`
- Auth: header `Authorization: TOKEN`
- Paginação: 100 items por página, parâmetro `page=N`
- Rate limit: implementar retry automático em 429
- Webhooks: registrar em `POST /team/{teamId}/webhook`

### Eventos de Webhook disponíveis
```
taskCreated, taskUpdated, taskDeleted,
taskCommentPosted, taskStatusUpdated,
taskAssigneeUpdated, taskTimeTracked,
listCreated, folderCreated
```

### Texto base de um embedding de task
```
Projeto: [list] | Space: [space]
Tarefa: [nome]
Status: [status] | Prioridade: [priority]
Responsável: [assignees]
Descrição: [description]
Comentários: [últimos 5 com autor e data]
Tags: [tags]
Tempo estimado: X | Tempo logado: Y
```

---

## 📌 Instruções para a IA que receber este contexto

1. **Não repita o planejamento** — ele já está feito. Pule direto para a implementação.
2. **Siga a stack definida** — não sugira trocar Next.js, Drizzle, Supabase ou Claude.
3. **Respeite as etapas** — pergunte em qual etapa estamos antes de começar.
4. **Foco em código funcional** — o perfil é vibe coder, então código completo e pronto para rodar.
5. **Português** — toda comunicação em português.
6. **Local first** — tudo deve funcionar localmente antes de pensar em produção.

---

*Contexto gerado em sessão de planejamento completa.*
*Atualizar este arquivo conforme etapas forem concluídas.*
