import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import * as x509 from '@peculiar/x509';
import { sql } from 'kysely';
import { exec } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { promisify } from 'node:util';
import { APP_CONFIG, AppConfig } from '../config';
import { Db, KYSELY } from '../infra/database/database.module';
import { CertificateAuthority, CrlRevocation, RevokedCertificate, writeFileAtomic } from '../shared/crypto/pki';

/** Injection token of the loaded certificate authority. */
export const CERTIFICATE_AUTHORITY = Symbol('CERTIFICATE_AUTHORITY');

const DAY_MS = 86_400_000;
const RESTART_TIMEOUT_MS = 30_000;
const MAX_CRL_FILE_BYTES = 1024 * 1024;
const run = promisify(exec);

type PkiConfig = Pick<AppConfig, 'crlFile' | 'brokerRestartCmd'>;

/**
 * Keeps the CRL file that Mosquitto reads in step with revoked_certificates (D-014.5). The broker does not read the
 * database, so this file plus a broker restart is the only thing that makes a revocation real (spike S9).
 */
@Injectable()
export class PkiService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Pki');
  private timer: NodeJS.Timeout | undefined;
  private nextUpdate: Date | null = null;
  private carried = new Map<string, CrlRevocation>();
  private reportCarried = false;
  private publishChain: Promise<void> = Promise.resolve();

  constructor(
    @Inject(CERTIFICATE_AUTHORITY) readonly ca: CertificateAuthority,
    @Inject(KYSELY) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: PkiConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.loadCarried();
    this.reportCarried = true;
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), DAY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** `nextUpdate` of the CRL written last; null until the first successful write. */
  crlNextUpdate(): Date | null {
    return this.nextUpdate;
  }

  /** Rewrites the CRL from the database plus verified revocations surviving a database restore. */
  async publishCrl(): Promise<Date> {
    const published = this.publishChain.then(() => this.publishCrlNow());
    // Keep each caller's rejection while allowing later publications to proceed.
    this.publishChain = published.then(() => undefined, () => undefined);
    return published;
  }

  private async publishCrlNow(): Promise<Date> {
    const rows = (
      await sql<{ cert_serial: string; reason: RevokedCertificate['reason']; revoked_at: Date }>`
        SELECT cert_serial, reason, revoked_at FROM revoked_certificates ORDER BY revoked_at, cert_serial
      `.execute(this.db)
    ).rows;
    const revoked = new Map(this.carried);
    const dbSerials = new Set<string>();
    for (const row of rows) {
      const serial = row.cert_serial.toLowerCase();
      dbSerials.add(serial);
      revoked.set(serial, { serial, revokedAt: row.revoked_at, reason: row.reason });
    }
    const signed = await this.ca.crl([...revoked.values()]);
    writeFileAtomic(this.config.crlFile, signed.pem);
    this.carried = revoked;
    this.nextUpdate = signed.nextUpdate;
    if (this.reportCarried) {
      const count = [...this.carried.keys()].filter((serial) => !dbSerials.has(serial)).length;
      this.logger.log(`${count} revoked certificate(s) kept from the existing CRL that the database does not know`);
      this.reportCarried = false;
    }
    return signed.nextUpdate;
  }

  private async loadCarried(): Promise<void> {
    try {
      if (statSync(this.config.crlFile).size > MAX_CRL_FILE_BYTES) {
        throw new Error('CRL file exceeds the 1 MiB limit');
      }
      const crl = new x509.X509Crl(readFileSync(this.config.crlFile, 'utf8'));
      const caCert = new x509.X509Certificate(this.ca.certificatePem);
      if (!await crl.verify({ publicKey: caCert.publicKey })) throw new Error('CRL signature does not match our CA');
      this.carried = new Map(crl.entries.map((entry) => {
        const serial = entry.serialNumber.toLowerCase();
        return [serial, { serial, revokedAt: entry.revocationDate, reason: entry.reason }];
      }));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.logger.warn(`Existing CRL ignored: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Call after the transaction that added a revocation has committed. Writes the CRL, then restarts the broker so that
   * connections opened with a revoked certificate are closed. A failing restart is reported, not thrown: the revocation
   * is already stored and the daily refresh plus the next broker start still apply it.
   */
  async revocationChanged(): Promise<{ brokerRestarted: boolean }> {
    await this.publishCrl();
    return { brokerRestarted: await this.restartBroker() };
  }

  private async refresh(): Promise<void> {
    try {
      await this.publishCrl();
    } catch (err) {
      this.logger.error(`CRL was not refreshed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async restartBroker(): Promise<boolean> {
    const command = this.config.brokerRestartCmd.trim();
    if (!command) {
      this.logger.warn('BROKER_RESTART_CMD is empty: the CRL was written but open connections of revoked certificates stay up');
      return false;
    }
    try {
      await run(command, { timeout: RESTART_TIMEOUT_MS });
      return true;
    } catch (err) {
      this.logger.error(`broker restart failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
