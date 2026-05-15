/**
 * Authentication & Authorization Module
 *
 * Provides JWT-based authentication and role-based authorization for the
 * OpenLinker API. Registers JwtAuthGuard and RolesGuard as global APP_GUARDs
 * so all routes are protected by default. Use @Public() to opt out of auth
 * and @Roles() to restrict by role.
 *
 * @module apps/api/src/auth
 */
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PASSWORD_RESET_NOTIFIER_TOKEN, UsersModule } from '@openlinker/core/users';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { BootstrapAdminService } from './bootstrap-admin.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { PasswordResetService } from './password-reset.service';
import { PASSWORD_RESET_SERVICE_TOKEN } from './password-reset.service.interface';
import { ConsolePasswordResetNotifierAdapter } from './adapters/console-password-reset-notifier.adapter';
import { RefreshTokenService } from './refresh-token.service';
import { REFRESH_TOKEN_SERVICE_TOKEN } from './refresh-token.tokens';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          // 15m default — short access-token TTL is the security trade
          // that makes refresh-token rotation (#710) worthwhile. Sites
          // overriding via env should understand the threat model first.
          expiresIn: configService.get<string>('JWT_EXPIRES_IN', '15m'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    BootstrapAdminService,
    JwtStrategy,
    PasswordResetService,
    { provide: PASSWORD_RESET_SERVICE_TOKEN, useExisting: PasswordResetService },
    ConsolePasswordResetNotifierAdapter,
    { provide: PASSWORD_RESET_NOTIFIER_TOKEN, useExisting: ConsolePasswordResetNotifierAdapter },
    RefreshTokenService,
    { provide: REFRESH_TOKEN_SERVICE_TOKEN, useExisting: RefreshTokenService },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
