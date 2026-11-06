/**
 * Login Page Settings Service
 *
 * Resolves login-page copy through row -> env -> default and applies admin
 * writes onto the singleton row (#4028).
 *
 * @module libs/core/src/login-page-settings/application/services
 * @implements {ILoginPageSettingsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginPageSettingsRepositoryPort } from '../../domain/ports/login-page-settings-repository.port';
import {
  LOGIN_PAGE_COPY_MAX_LENGTH,
  applyLoginPageCopyInput,
  emptyLoginPageCopy,
  resolveRegistration,
  resolveLoginPageCopy,
  toPublicLoginPageCopy,
  type LoginPageCopyByLocale,
  type LoginPageSettingsInput,
  type LoginPageSettingsView,
} from '../../domain/types/login-page-settings.types';
import { LOGIN_PAGE_SETTINGS_REPOSITORY_TOKEN } from '../../login-page-settings.tokens';
import type { ILoginPageSettingsService } from './login-page-settings.service.interface';

@Injectable()
export class LoginPageSettingsService implements ILoginPageSettingsService {
  constructor(
    @Inject(LOGIN_PAGE_SETTINGS_REPOSITORY_TOKEN)
    private readonly repository: LoginPageSettingsRepositoryPort,
    private readonly config: ConfigService
  ) {}

  async resolve(): Promise<LoginPageSettingsView> {
    const row = await this.repository.findSettings();
    return {
      copy: resolveLoginPageCopy(row?.copy ?? emptyLoginPageCopy(), (name) =>
        this.config.get<string>(name)
      ),
      registration: resolveRegistration(row?.registrationEnabled ?? null, (name) =>
        this.config.get<string>(name)
      ),
      maxLength: { ...LOGIN_PAGE_COPY_MAX_LENGTH },
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  async resolvePublicCopy(): Promise<LoginPageCopyByLocale> {
    return toPublicLoginPageCopy((await this.resolve()).copy);
  }

  async isRegistrationEnabled(): Promise<boolean> {
    const row = await this.repository.findSettings();
    return resolveRegistration(row?.registrationEnabled ?? null, (name) =>
      this.config.get<string>(name)
    ).value;
  }

  async updateSettings(input: LoginPageSettingsInput, updatedBy: string | null): Promise<void> {
    const row = await this.repository.findSettings();
    const copy = applyLoginPageCopyInput(row?.copy ?? emptyLoginPageCopy(), input);
    const registrationEnabled =
      input.registrationEnabled === undefined
        ? row?.registrationEnabled ?? null
        : input.registrationEnabled;
    await this.repository.saveSettings({ copy, registrationEnabled }, updatedBy);
  }
}
