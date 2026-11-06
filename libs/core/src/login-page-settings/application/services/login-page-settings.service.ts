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
import { sanitizeStoredHtml } from '@openlinker/shared/html';
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

/**
 * The support line is the one rich-text field (the editor lets an admin link
 * their help page), so it is sanitized before it is stored. An editor that was
 * emptied sends markup with no text (`<p></p>`), which clears the field.
 */
function sanitizeSupport(input: LoginPageSettingsInput): LoginPageSettingsInput {
  const next: LoginPageSettingsInput = { ...input };
  for (const locale of ['pl', 'en'] as const) {
    const fields = input[locale];
    const support = fields?.support;
    if (!fields || typeof support !== 'string') continue;
    const clean = sanitizeStoredHtml(support);
    const text = clean
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim();
    next[locale] = { ...fields, support: text === '' ? null : clean };
  }
  return next;
}

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
    const copy = applyLoginPageCopyInput(row?.copy ?? emptyLoginPageCopy(), sanitizeSupport(input));
    const registrationEnabled =
      input.registrationEnabled === undefined
        ? row?.registrationEnabled ?? null
        : input.registrationEnabled;
    await this.repository.saveSettings({ copy, registrationEnabled }, updatedBy);
  }
}
