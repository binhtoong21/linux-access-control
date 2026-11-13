import { Global, Module } from '@nestjs/common';

// Server configuration from the environment (11-operations/deployment.md "Configuration Management").
// Invalid or missing values stop the process at startup instead of failing later.
export interface KeyConfig {
  keysDir: string;
  uidEncKeyId: string;
}

export interface AppConfig extends KeyConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
export const DEFAULT_KEYS_DIR = '/etc/nfc-server/keys';
export const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

function readKeyConfig(env: NodeJS.ProcessEnv, errors: string[]): KeyConfig {
  const keysDir = env.KEYS_DIR || DEFAULT_KEYS_DIR;
  const uidEncKeyId = env.UID_ENC_KEY_ID || 'k1';
  if (!KEY_ID_PATTERN.test(uidEncKeyId)) errors.push('UID_ENC_KEY_ID must match ^[A-Za-z0-9_-]{1,32}$');
  return { keysDir, uidEncKeyId };
}

/** KEYS_DIR and UID_ENC_KEY_ID only; used by the keys:init CLI, which needs no database or JWT settings. */
export function loadKeyConfig(env: NodeJS.ProcessEnv = process.env): KeyConfig {
  const errors: string[] = [];
  const keys = readKeyConfig(env, errors);
  if (errors.length) throw new Error(`invalid configuration: ${errors.join('; ')}`);
  return keys;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const errors: string[] = [];
  const keys = readKeyConfig(env, errors);
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) errors.push('DATABASE_URL must be a postgres:// URL');
  const port = Number(env.PORT ?? 8000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) errors.push('PORT must be an integer 0-65535');
  const jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) errors.push('JWT_SECRET must be at least 32 characters');
  if (errors.length) throw new Error(`invalid configuration: ${errors.join('; ')}`);
  return { port, databaseUrl, jwtSecret, ...keys };
}

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
