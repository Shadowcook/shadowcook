import { Pool } from 'pg';
import { pruneAdministrativeAudit, setAuditRetentionDays } from './admin/audit-retention.js';

async function main(): Promise<void> {
  const argumentsList: string[] = process.argv.slice(2);
  const databaseUrl: string | undefined = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL must be configured explicitly.');
  const command: string | undefined = argumentsList[0];
  if (!(
    (command === 'prune' && argumentsList.length === 1) ||
    (command === 'set-retention-days' &&
      argumentsList.length === 2 &&
      /^\d+$/.test(argumentsList[1]!))
  )) {
    throw new Error('Usage: admin-audit-maintenance prune | set-retention-days <1..3650>');
  }
  const pool: Pool = new Pool({ connectionString: databaseUrl });
  try {
    if (command === 'set-retention-days')
      await setAuditRetentionDays(pool, Number(argumentsList[1]));
    else await pruneAdministrativeAudit(pool);
    console.info(
      JSON.stringify({ time: new Date().toISOString(), operation: command, outcome: 'SUCCEEDED' }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((): void => {
  console.error(
    JSON.stringify({
      time: new Date().toISOString(),
      outcome: 'FAILED',
      error: 'Audit maintenance failed; check arguments and database configuration.',
    }),
  );
  process.exitCode = 1;
});
