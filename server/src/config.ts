import { Global, Module } from '@nestjs/common';
import path from 'node:path';

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
  /** SNAPSHOT_WORKER=off stops the timers of the Distribution worker (tests, maintenance); default on. */
  snapshotWorkerEnabled: boolean;
  /** CA that signs workstation certificates (ADR-002 §7); defaults ca.crt / ca.key in KEYS_DIR. */
  caCertFile: string;
  caKeyFile: string;
  /** CRL file read by Mosquitto (`crlfile`); default crl.pem in KEYS_DIR. */
  crlFile: string;
  /** Shell command that restarts the broker after a revocation (D-014, S9); empty = only write the CRL. */
  brokerRestartCmd: string;
  /** Broker address handed to a workstation when its enrollment is approved. */
  brokerHost: string;
  brokerPort: number;
  /** Broker the server itself connects to (mqtts://host:8883); empty = no MQTT connection (tests, CI). */
  mqttUrl: string;
  /** mTLS files of the server's MQTT client: broker CA, certificate with CN nfc-server and its key. */
  mqttCaFile: string;
  mqttCertFile: string;
  mqttKeyFile: string;
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
  const snapshotWorker = env.SNAPSHOT_WORKER || 'on';
  if (snapshotWorker !== 'on' && snapshotWorker !== 'off') errors.push('SNAPSHOT_WORKER must be on or off');
  const brokerPort = Number(env.BROKER_PORT ?? 8883);
  if (!Number.isInteger(brokerPort) || brokerPort < 1 || brokerPort > 65535) errors.push('BROKER_PORT must be an integer 1-65535');
  const mqttUrl = env.MQTT_URL ?? '';
  if (mqttUrl !== '' && !/^mqtts?:\/\//.test(mqttUrl)) errors.push('MQTT_URL must be empty or an mqtt(s):// URL');
  if (errors.length) throw new Error(`invalid configuration: ${errors.join('; ')}`);
  return {
    port,
    databaseUrl,
    jwtSecret,
    snapshotWorkerEnabled: snapshotWorker === 'on',
    caCertFile: env.CA_CERT_FILE || path.join(keys.keysDir, 'ca.crt'),
    caKeyFile: env.CA_KEY_FILE || path.join(keys.keysDir, 'ca.key'),
    crlFile: env.CRL_FILE || path.join(keys.keysDir, 'crl.pem'),
    brokerRestartCmd: env.BROKER_RESTART_CMD ?? '',
    brokerHost: env.BROKER_HOST || 'localhost',
    brokerPort,
    mqttUrl,
    mqttCaFile: env.MQTT_CA || env.CA_CERT_FILE || path.join(keys.keysDir, 'ca.crt'),
    mqttCertFile: env.MQTT_CERT || path.join(keys.keysDir, 'nfc-server.crt'),
    mqttKeyFile: env.MQTT_KEY || path.join(keys.keysDir, 'nfc-server.key'),
    ...keys,
  };
}

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
