import { Kysely, PostgresDialect } from 'kysely';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { Database } from '../infra/database/schema';
import { AppError } from '../shared/http/app-error';
import { createAdmin } from './admin-accounts';

// Creates an admin at install time (FR-080). From server/:
//   read -rs PW; printf '%s' "$PW" | DATABASE_URL=... pnpm admin:create --username root --display-name "Quản trị"
// The password is read from stdin, never from arguments, to keep it out of shell history and `ps`.
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: { username: { type: 'string' }, 'display-name': { type: 'string' } },
  });
  const username = values.username;
  const displayName = values['display-name'];
  if (!username || !displayName) {
    console.error('usage: create-admin-cli --username <name> --display-name <name>  (password on stdin)');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }
  if (process.stdin.isTTY) {
    console.error('pipe the password on stdin');
    process.exit(2);
  }
  const password = await readStdin();
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url }) }) });
  try {
    const admin = await createAdmin(db, { username, displayName, password }, null);
    console.log(`created admin ${admin.username} (${admin.id})`);
  } catch (err) {
    console.error(err instanceof AppError ? `${err.code}: ${err.message}` : (err as Error).message);
    process.exitCode = 1;
  } finally {
    await db.destroy(); // also ends the pool
  }
}

void main();
