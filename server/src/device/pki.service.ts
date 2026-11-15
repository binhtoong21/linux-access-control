import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'kysely';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { APP_CONFIG, AppConfig } from '../config';
import { Db, KYSELY } from '../infra/database/database.module';
import { CertificateAuthority, RevokedCertificate, writeFileAtomic } from '../shared/crypto/pki';

/** Injection token of the loaded certificate authority. */
export const CERTIFICATE_AUTHORITY = Symbol('CERTIFICATE_AUTHORITY');

const DAY_MS = 86_400_000;
const RESTART_TIMEOUT_MS = 30_000;
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

  constructor(
    @Inject(CERTIFICATE_AUTHORITY) readonly ca: CertificateAuthority,
    @Inject(KYSELY) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: PkiConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
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

  /** Rewrites the CRL file from the full list of revoked certificates. */
  async publishCrl(): Promise<Date> {
    const rows = (
      await sql<{ cert_serial: string; reason: RevokedCertificate['reason']; revoked_at: Date }>`
        SELECT cert_serial, reason, revoked_at FROM revoked_certificates ORDER BY revoked_at, cert_serial
      `.execute(this.db)
    ).rows;
    const signed = await this.ca.crl(rows.map((r) => ({ serial: r.cert_serial, revokedAt: r.revoked_at, reason: r.reason })));
    writeFileAtomic(this.config.crlFile, signed.pem);
    this.nextUpdate = signed.nextUpdate;
    return signed.nextUpdate;
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
