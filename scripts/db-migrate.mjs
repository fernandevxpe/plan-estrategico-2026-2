// CLI das migrations.
//
//   npm run db:migrate            aplica o que estiver pendente
//   npm run db:migrate:status     mostra o estado sem tocar em nada
//   node scripts/db-migrate.mjs --dry-run
//   node scripts/db-migrate.mjs --if-configured   (usado pelo predev)
import { databaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { migrationStatus, runMigrations } from './lib/migrate.mjs';

loadEnv();

const args = new Set(process.argv.slice(2));

// `next dev` não passa por scripts/server.mjs, então o predev é o único lugar
// que garante schema atualizado em desenvolvimento. Mas nem todo mundo que roda
// o projeto tem banco — aí ele sai quieto em vez de travar o `npm run dev`.
if (args.has('--if-configured') && !databaseUrl()) {
  console.log('[migrate] sem DATABASE_URL; seguindo sem migrations');
  process.exit(0);
}

try {
  if (args.has('--status')) {
    const { pending, applied, drifted, orphans } = await migrationStatus();
    console.log(`aplicadas: ${applied.length}`);
    console.log(`pendentes: ${pending.length}`);
    pending.forEach((file) => console.log(`  · ${file.id}`));
    if (drifted.length) {
      console.error(`\nALTERADAS DEPOIS DE APLICADAS (${drifted.length}) — o banco e o repositório divergiram:`);
      drifted.forEach((file) => console.error(`  ! ${file.id}`));
    }
    if (orphans.length) {
      console.error(`\nREGISTRADAS MAS AUSENTES DO DISCO (${orphans.length}):`);
      orphans.forEach((id) => console.error(`  ! ${id}`));
    }
    process.exit(drifted.length || orphans.length ? 1 : 0);
  }

  const result = await runMigrations({ dryRun: args.has('--dry-run') });
  if (result.applied.length) console.log(`[migrate] ${result.applied.length} migration(s) aplicada(s)`);
  process.exit(0);
} catch (error) {
  console.error('[migrate]', error.message);
  process.exit(1);
}
