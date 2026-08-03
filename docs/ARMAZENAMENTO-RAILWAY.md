# Armazenamento de dados no Railway

## Arquitetura

- PostgreSQL (`Postgres`): cópia persistente e auditável dos artefatos processados.
- Volume do serviço `web`: cache local rápido para leitura da aplicação e arquivos brutos do sync.
- Git: código, configurações pequenas e documentação; `data/raw/` e `data/processed/` são ignorados.

Os artefatos são comprimidos com gzip, validados por SHA-256 e gravados em uma transação. Na inicialização, o serviço hidrata o volume a partir do PostgreSQL antes de iniciar o Next.js.

## Automação

O pipeline diário termina com `npm run storage:push`. Os comandos operacionais são:

```bash
npm run storage:push
npm run storage:hydrate
npm run storage:status
```

`DATABASE_URL` é uma referência privada ao serviço `Postgres` no Railway. Nunca deve ser versionada.

## Evolução prevista

Dados normalizados de conversas, mensagens, eventos comerciais e embeddings devem usar tabelas próprias. Os artefatos compactados existem para snapshots e recuperação, não para substituir o modelo analítico futuro.
