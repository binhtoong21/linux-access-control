import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { CookieOptions, Request, Response } from 'express';
import { AuthenticatedAdmin, CurrentAdmin, Public } from '../shared/http/auth.decorators';
import { SESSION_COOKIE } from './auth.guard';
import { AuthService } from './auth.service';

class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}

const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // deployment.md: JWT Admin 8h, no refresh token
const COOKIE: CookieOptions = { httpOnly: true, secure: true, sameSite: 'strict', path: '/api' };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(204)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = await this.auth.login(dto.username, dto.password, req.ip ?? 'unknown');
    res.cookie(SESSION_COOKIE, token, { ...COOKIE, maxAge: SESSION_MAX_AGE_MS });
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, COOKIE);
  }

  @Get('me')
  me(@CurrentAdmin() admin: AuthenticatedAdmin): AuthenticatedAdmin {
    return admin;
  }
}
