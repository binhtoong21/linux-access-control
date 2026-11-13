import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from './app-error';

export const IS_PUBLIC = 'nfc:isPublic';
export const SKIP_CSRF = 'nfc:skipCsrf';

/** No admin session needed (login, logout, health, agent enrollment). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Exempt from the X-Requested-With check. Only for the two agent enrollment endpoints (api.md §6). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

export interface AuthenticatedAdmin {
  id: string;
  username: string;
  display_name: string;
}

export type AdminRequest = Request & { admin?: AuthenticatedAdmin };

/** The admin the guard authenticated for this request. */
export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedAdmin => {
  const admin = ctx.switchToHttp().getRequest<AdminRequest>().admin;
  if (!admin) throw new AppError('UNAUTHORIZED', 'Not signed in');
  return admin;
});
