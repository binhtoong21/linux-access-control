import { Global, Module } from '@nestjs/common';

// Server configuration from the environment (11-operations/deployment.md "Configuration Management").
// Invalid or missing values stop the process at startup instead of failing later.
export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const errors: string[] = [];
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) errors.push('DATABASE_URL must be a postgres:// URL');
  const port = Number(env.PORT ?? 8000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) errors.push('PORT must be an integer 0-65535');
  const jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) errors.push('JWT_SECRET must be at least 32 characters');
  if (errors.length) throw new Error(`invalid configuration: ${errors.join('; ')}`);
  return { port, databaseUrl, jwtSecret };
}

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
