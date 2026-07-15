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
import { MAILER_TOKEN, PASSWORD_RESET_NOTIFIER_TOKEN, UsersModule } from '@openlinker/core/users';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthService } from './auth.service';
import { AUTH_SERVICE_TOKEN } from './auth.service.interface';
import { AuthController } from './auth.controller';
import { BootstrapAdminService } from './bootstrap-admin.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { PasswordResetService } from './password-reset.service';
import { PASSWORD_RESET_SERVICE_TOKEN } from './password-reset.service.interface';
import { MailerPasswordResetNotifierAdapter } from './adapters/mailer-password-reset-notifier.adapter';
import { MAILER_PROVIDER } from './adapters/mailer.provider';
import { RefreshTokenService } from './refresh-token.service';
import { REFRESH_TOKEN_SERVICE_TOKEN } from './refresh-token.tokens';
import { RegistrationService } from './registration.service';
import { REGISTRATION_SERVICE_TOKEN } from './registration.service.interface';
import { DemoModeService } from './demo-mode.service';
import { DEMO_MODE_SERVICE_TOKEN } from './demo-mode.service.interface';
import { DemoAccountCleanupService } from './demo-account-cleanup.service';
import { EmailConfirmationService } from './email-confirmation.service';
import { EMAIL_CONFIRMATION_SERVICE_TOKEN } from './email-confirmation.service.interface';
import { UsersApiModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    UsersApiModule,
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
    { provide: AUTH_SERVICE_TOKEN, useExisting: AuthService },
    BootstrapAdminService,
    JwtStrategy,
    PasswordResetService,
    { provide: PASSWORD_RESET_SERVICE_TOKEN, useExisting: PasswordResetService },
    MAILER_PROVIDER,
    MailerPasswordResetNotifierAdapter,
    { provide: PASSWORD_RESET_NOTIFIER_TOKEN, useExisting: MailerPasswordResetNotifierAdapter },
    RefreshTokenService,
    { provide: REFRESH_TOKEN_SERVICE_TOKEN, useExisting: RefreshTokenService },
    RegistrationService,
    { provide: REGISTRATION_SERVICE_TOKEN, useExisting: RegistrationService },
    DemoModeService,
    { provide: DEMO_MODE_SERVICE_TOKEN, useExisting: DemoModeService },
    DemoAccountCleanupService,
    EmailConfirmationService,
    { provide: EMAIL_CONFIRMATION_SERVICE_TOKEN, useExisting: EmailConfirmationService },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  // MAILER_TOKEN is exported so sibling modules (#1626 forgot-password
  // delivery) can inject MailerPort without duplicating the provider
  // registration. EmailConfirmationService (#1624) is this module's own
  // consumer of MAILER_TOKEN, wired above. JwtModule is re-exported so
  // modules that import AuthModule (e.g. AppModule for AppController,
  // #1619) can inject JwtService to verify a bearer token without
  // enforcing auth on a @Public() route.
  exports: [AuthService, MAILER_TOKEN, JwtModule],
})
export class AuthModule {}
