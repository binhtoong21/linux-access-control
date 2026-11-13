import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Db, KYSELY } from '../infra/database/database.module';
import { AuthenticatedAdmin } from '../shared/http/auth.decorators';
import { AppError } from '../shared/http/app-error';
import { LoginThrottle } from './login-throttle';
import { verifyPassword } from './password';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthService {
  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly throttle: LoginThrottle,
  ) {}

  /** FR-080. Returns a signed session token; throws RATE_LIMITED or INVALID_CREDENTIALS. */
  async login(username: string, password: string, ip: string): Promise<string> {
    const key = LoginThrottle.key(username, ip);
    if (this.throttle.isLocked(key)) {
      throw new AppError('RATE_LIMITED', 'Too many failed logins, try again later');
    }
    const admin = await this.db
      .selectFrom('admin_accounts')
      .select(['id', 'password_hash', 'status'])
      .where((eb) => eb(eb.fn('lower', [eb.fn('btrim', ['username'])]), '=', username.trim().toLowerCase()))
      .executeTakeFirst();
    // A disabled account is treated like an unknown one: same error, same timing (INV-016).
    const usable = admin !== undefined && admin.status === 'active';
    const ok = await verifyPassword(usable ? admin.password_hash : null, password);
    if (!ok || !admin) {
      this.throttle.recordFailure(key);
      throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password');
    }
    this.throttle.reset(key);
    return this.jwt.signAsync({ sub: admin.id });
  }

  /** Runs on every protected request: valid token AND account still active, so disabling is immediate (INV-016). */
  async authenticate(token: string | undefined): Promise<AuthenticatedAdmin> {
    if (!token) throw new AppError('UNAUTHORIZED', 'Not signed in');
    let sub: unknown;
    try {
      ({ sub } = await this.jwt.verifyAsync<{ sub: string }>(token));
    } catch {
      throw new AppError('UNAUTHORIZED', 'Session expired or invalid');
    }
    if (typeof sub !== 'string' || !UUID_RE.test(sub)) throw new AppError('UNAUTHORIZED', 'Session expired or invalid');
    const admin = await this.db
      .selectFrom('admin_accounts')
      .select(['id', 'username', 'display_name', 'status'])
      .where('id', '=', sub)
      .executeTakeFirst();
    if (!admin || admin.status !== 'active') throw new AppError('UNAUTHORIZED', 'Session expired or invalid');
    return { id: admin.id, username: admin.username, display_name: admin.display_name };
  }
}
