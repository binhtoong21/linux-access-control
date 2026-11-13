import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../config';
import { AdminsController } from './admins.controller';
import { AdminsService } from './admins.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { LoginThrottle } from './login-throttle';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// Identity bounded context (03-domain): admin accounts and sessions, users, groups, cards.
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtSecret,
        signOptions: { algorithm: 'HS256', expiresIn: '8h' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController, AdminsController, UsersController],
  providers: [
    AuthService,
    AdminsService,
    UsersService,
    { provide: LoginThrottle, useValue: new LoginThrottle() },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class IdentityModule {}
