import path from 'node:path';
import { Pool } from 'pg';
import { migrateDown, migrateUp, migrationStatus } from './migrator';

// Usage (from server/): node dist/infra/database/migrate-cli.js up | down [steps] | status
async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }
  const dir = path.resolve(process.cwd(), 'migrations');
  const pool = new Pool({ connectionString: url });
  try {
    if (cmd === 'up') {
      const applied = await migrateUp(pool, dir);
      console.log(applied.length ? `applied: ${applied.join(', ')}` : 'nothing to apply');
    } else if (cmd === 'down') {
      const steps = arg ? Number(arg) : 1;
      if (!Number.isInteger(steps) || steps < 1) throw new Error(`invalid steps: ${arg}`);
      const reverted = await migrateDown(pool, dir, steps);
      console.log(reverted.length ? `rolled back: ${reverted.join(', ')}` : 'nothing to roll back');
    } else if (cmd === 'status') {
      const s = await migrationStatus(pool, dir);
      console.log(`applied: ${s.applied.join(', ') || '-'}`);
      console.log(`pending: ${s.pending.join(', ') || '-'}`);
    } else {
      console.error('usage: migrate-cli up | down [steps] | status');
      process.exit(2);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
