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
  - "Sync travava sem erro no 429: retry-after sem teto, sem timeout e sem watchdog"
  - "Cota diária do Pipedrive é limite rígido: sync caiu de ~1.020 para ~180 requisições"
  - "Vercel redireciona para a produção real — uma única fonte de verdade"
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

## O sync que "travou" — e não estava travado

A primeira execução em produção ficou 25 minutos no primeiro estágio. Os sinais eram
contraditórios: processo vivo, memória estável, **CPU em zero**, nenhum log novo, nenhum erro.

A causa foi uma combinação de três omissões que só apareceram juntas:

1. `getJson` usava `fetch` sem `AbortSignal`. Uma conexão pendurada esperava indefinidamente.
2. No 429, o código obedecia ao `retry-after` da API sem teto. O Pipedrive devolve valores
   que passam de uma hora — o processo dormia vivo, o que explica a CPU zerada.
3. O agendador não tinha limite por etapa. Como a trava `running` só volta a `false` no fim
   do pipeline, **nenhuma rodada seguinte aconteceria** enquanto aquela estivesse dormindo.

O gatilho foi o próprio processo de deploy: cada push reiniciava o container e disparava um
novo sync na subida, e as tentativas acumuladas estouraram o limite de requisições da conta.
Um `GET /v1/users` isolado confirmou o diagnóstico devolvendo 429.

**Correções aplicadas:**

- `retry-after` limitado a 30 segundos — falhar rápido e tentar na próxima rodada é melhor
  que segurar o pipeline
- timeout de 60 segundos por requisição
- watchdog de 20 minutos por etapa, que mata o processo e libera o pipeline
- log por estágio, porque a ausência de qualquer log foi o que tornou o diagnóstico lento

### O limite é diário, não de rajada

Ler o corpo da resposta esclareceu a natureza do bloqueio:

```json
{"success":false,"error":"daily request budget exceeded","errorCode":429}
```

Com `retry-after: 3939` — 66 minutos. Era exatamente esse valor que o código estava
dormindo. **A cota diária de requisições é um limite rígido da conta**, então o número de
chamadas por rodada passa a ser uma restrição de projeto, não um detalhe.

Contagem por sync antes das correções:

| Etapa | Requisições |
| --- | ---: |
| Coleções paginadas | ~38 |
| Progresso das metas | ~118 |
| Produtos por negócio | 47 |
| Histórico de etapas | 816 |
| **Total** | **~1.020** |

Duas reduções foram aplicadas:

- **Histórico incremental**: só busca o flow de negócios cujo `update_time` mudou desde a
  última coleta. Em regime normal cai de 816 para algumas dezenas.
- **Intervalos futuros de meta não são consultados**: sempre devolvem zero, e a meta semanal
  tem 52 intervalos no ano. Economiza cerca de 40 requisições por rodada.

O sync passa a custar em torno de 150 a 200 requisições por dia, contra as 1.020 anteriores.

A lição se aplica além deste caso: **um processo dormindo é indistinguível de um processo
trabalhando se nada for registrado.** O indicador de frescor na plataforma cobre o sintoma
visível, mas o log por estágio é o que permite achar a causa.

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
## Consolidação em uma única produção

O projeto no Vercel continuava publicando a cada push. Como é serverless — sem volume
persistente e sem processo longo —, ele nunca rodaria o sync diário e serviria para sempre o
snapshot congelado no build. Duas URLs com números diferentes é o pior cenário possível para
confiança em indicador.

O middleware passou a detectar o ambiente Vercel e redirecionar (308) para a produção real,
antes da autenticação, já que o destino tem a dele. Links e favoritos antigos continuam
funcionando e passam a cair no dado vivo. Reversível removendo a variável `PRIMARY_APP_URL`.

Verificado: o caminho é preservado no redirecionamento, o Vercel não entrega conteúdo sem
autenticação, e o Railway não define `VERCEL`, então não existe risco de laço.
