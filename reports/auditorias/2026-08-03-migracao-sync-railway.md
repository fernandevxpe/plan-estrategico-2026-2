---
title: Migração do sync diário para o Railway
date: 2026-08-03
author: Claude Opus 5
kind: infraestrutura
scope: Sync diário · Hospedagem · Persistência de dados
summary: O sync automático saiu do GitHub Actions, onde nunca funcionou e engordaria o repositório, para um volume persistente no Railway com agendador interno. A plataforma inteira passou a rodar lá.
highlights:
  - "GitHub Actions falhava 100% das execuções e commitaria ~8 MB por dia no git"
  - "Sync agora roda dentro do serviço e grava num volume persistente"
  - "Dados saíram do bundle JavaScript: 4,5 MB a menos e atualização sem redeploy"
  - "Arquivos que a plataforma escreve foram para o volume — antes sumiam a cada deploy"
  - "Indicador de frescor mostra quando uma fonte específica para de atualizar"
---

## Por que mudar

A rodada anterior encontrou o sync diário quebrado: o workflow do GitHub Actions falhava em
todas as execuções porque `PIPEDRIVE_API_KEY` nunca foi cadastrada. Consertar os secrets
resolveria a falha, mas manteria um problema de fundo: o workflow commitava os artefatos
processados a cada execução — cerca de 8 MB por dia, quase 3 GB por ano de blobs no
repositório.

A decisão foi tirar dado do controle de versão e usar infraestrutura que já existia.

## Arquitetura escolhida

```
Railway · projeto xpe-plataforma · serviço web
├── volume persistente em /data                  ← DATA_DIR=/data
│   ├── raw/         dados brutos das APIs (~80 MB, nunca versionados)
│   ├── processed/   artefatos que a plataforma lê
│   ├── gestao-xpe/  lançamentos semanais (a plataforma escreve aqui)
│   └── sync-state.json  resultado da última rodada
├── scripts/server.mjs      sobe o Next e o agendador no mesmo processo
└── scripts/scheduler.mjs   pipeline diário às 08:00 BRT
```

O volume do Railway só pode ser montado em um serviço, então servidor e agendador dividem o
mesmo processo. Enquanto o pipeline leva cerca de um minuto por dia, separar em dois serviços
com um bucket S3 no meio adicionaria complexidade sem ganho.

## O que precisou mudar no código

### Dados saíram do bundle

Onze módulos faziam `import x from "@/data/processed/x.json"`. Isso congela o conteúdo no
momento do build: mesmo com o sync gravando arquivos novos, a plataforma continuaria servindo
o dado antigo até um redeploy. E `marketing.json` sozinho colocava 4,5 MB dentro do
JavaScript enviado ao navegador.

Todos passaram por `lib/data/processed-store.ts`, que lê do disco com cache invalidado pelo
`mtime` do arquivo. As rotas ganharam `revalidate = 300`, então o dado novo aparece em até
cinco minutos.

### Escrita passou a sobreviver ao deploy

Os lançamentos semanais da Gestão XPE e os overrides de obras eram gravados em
`process.cwd()`. No container isso significa disco efêmero: **todo lançamento seria perdido no
próximo deploy**. Passaram a gravar no volume.

A leitura tem reserva: `resolveDataFile()` tenta o volume e cai na cópia versionada. Sem isso
o `next build` quebrava, porque `DATA_DIR` já existe durante o build mas o volume só é montado
em tempo de execução.

### Falhas parciais deixaram de ser silenciosas

O pipeline distingue etapas obrigatórias de opcionais. Se as credenciais da Meta faltarem, o
Pipedrive continua atualizando e o resultado fica registrado em `sync-state.json`. O indicador
no topo da plataforma lê esse arquivo e mostra quantas fontes pararam de atualizar — antes,
um sync que rodava pela metade renovava o carimbo de data e escondia o dado velho.

## Percalços do deploy

Dois deploys falharam antes de subir:

1. `tsconfig.tsbuildinfo` tinha entrado em um commit anterior. O Nixpacks monta um cache
   nesse caminho e falha ao encontrar um arquivo ali.
2. A pré-renderização quebrou procurando `/data/gestao-xpe/gestao-dashboard.json` — o volume
   ainda não existe durante o build.

O workflow do GitHub Actions foi reaproveitado como CI: roda typecheck e build com
`DATA_DIR=/data` apontando para um volume inexistente, que é exatamente a condição em que os
dois deploys quebraram.

## Estado final

- Plataforma em produção no Railway, 16 rotas verificadas respondendo 200
- Autenticação básica ativa (401 sem credencial)
- Sync agendado para 08:00 BRT, com execução automática na subida quando a última rodada
  tem mais de 20 horas
- Repositório deixa de crescer com dado

## Pendências

- `META_ACCESS_TOKEN` e as credenciais do Chatwoot precisam ser coladas nas variáveis do
  Railway. Os IDs da Meta foram migrados do Vercel, mas o token vem redigido na exportação.
  Sem eles, marketing e pré-vendas continuam servindo o último dado conhecido — sinalizado no
  indicador de frescor.
- O projeto no Vercel continua publicando a cada push e servirá o snapshot semente, cada vez
  mais defasado. Vale desligar para não existirem duas URLs com números diferentes.
