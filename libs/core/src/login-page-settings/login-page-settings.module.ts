/**
 * Login Page Settings Module
 *
 * Wires the singleton login-page copy row (#4028). A leaf context: it imports
 * no sibling core context.
 *
 * @module libs/core/src/login-page-settings
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoginPageSettingsService } from './application/services/login-page-settings.service';
import { LoginPageSettingsOrmEntity } from './infrastructure/persistence/entities/login-page-settings.orm-entity';
import { LoginPageSettingsRepository } from './infrastructure/persistence/repositories/login-page-settings.repository';
import {
  LOGIN_PAGE_SETTINGS_REPOSITORY_TOKEN,
  LOGIN_PAGE_SETTINGS_SERVICE_TOKEN,
} from './login-page-settings.tokens';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([LoginPageSettingsOrmEntity])],
  providers: [
    LoginPageSettingsRepository,
    { provide: LOGIN_PAGE_SETTINGS_REPOSITORY_TOKEN, useExisting: LoginPageSettingsRepository },
    LoginPageSettingsService,
    { provide: LOGIN_PAGE_SETTINGS_SERVICE_TOKEN, useExisting: LoginPageSettingsService },
  ],
  exports: [LOGIN_PAGE_SETTINGS_REPOSITORY_TOKEN, LOGIN_PAGE_SETTINGS_SERVICE_TOKEN],
})
export class LoginPageSettingsModule {}
