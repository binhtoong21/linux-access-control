import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRequest, IS_PUBLIC, SKIP_CSRF } from '../shared/http/auth.decorators';
import { AppError } from '../shared/http/app-error';
import { AuthService } from './auth.service';

export const SESSION_COOKIE = 'nfc_admin_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Global guard (api.md Authentication): CSRF header on every write, then the admin session unless @Public().
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, targets);
    if (!SAFE_METHODS.has(req.method) && !skipCsrf && req.get('x-requested-with') !== 'dashboard') {
      throw new AppError('CSRF_HEADER_REQUIRED', 'Write requests must send X-Requested-With: dashboard');
    }
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const cookies = req.cookies as Record<string, string> | undefined;
    req.admin = await this.auth.authenticate(cookies?.[SESSION_COOKIE]);
    return true;
  }
}
