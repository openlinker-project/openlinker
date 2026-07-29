/**
 * Mailer Settings Service
 *
 * Implements `IMailerSettingsService`. Non-secret settings (transport, host,
 * port, secure, from address) live in the singleton `mailer_settings` table;
 * the SMTP password is stored separately as an encrypted credential (
 * `ref = 'mailer:smtp-password'`) via `ICredentialsService`
 * (`@openlinker/core/integrations`).
 *
 * Read-through model: `resolveTransportConfig()` hits the repository (and,
 * for SMTP, the credentials store) on every call — no in-process cache.
 * The cost is a singleton-row PK lookup plus (for SMTP) one credential
 * lookup, both sub-millisecond, dwarfed by the actual SMTP round-trip. This
 * mirrors `AiProviderActiveSettingsService` / `MultiProviderAiCompletionAdapter`'s
 * resolution model (docs/architecture-overview.md § AI).
 *
 * Resolution order when no DB row exists yet (first boot): fall back to the
 * legacy env vars `MAIL_TRANSPORT` / `MAIL_SMTP_HOST` / `MAIL_SMTP_PORT` /
 * `MAIL_SMTP_SECURE` / `MAIL_SMTP_USER` / `MAIL_SMTP_PASSWORD` / `MAIL_FROM`
 * (#1623), finally defaulting to the console transport so offline dev keeps
 * working with zero configuration. `MAIL_SMTP_USER` is always read from env
 * even once a DB row exists — it isn't yet one of the admin-editable fields
 * (out of scope for #1643; see `ResolvedMailerTransportConfig.smtpUser`).
 *
 * @module libs/core/src/mailer/application/services
 * @implements {IMailerSettingsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@openlinker/shared/logging';
import {
  CREDENTIALS_SERVICE_TOKEN,
  CredentialNotFoundException,
  type ICredentialsService,
} from '@openlinker/core/integrations';
import { MAILER_SETTINGS_REPOSITORY_TOKEN } from '../../mailer.tokens';
import type { MailerSettings } from '../../domain/entities/mailer-settings.entity';
import { MailerSettingsRepositoryPort } from '../../domain/ports/mailer-settings-repository.port';
import { MAILER_SMTP_CREDENTIALS_REF } from '../../domain/types/mailer-credentials.types';
import type {
  MailerSettingsInput,
  MailerSettingsView,
  ResolvedMailerTransportConfig,
} from '../../domain/types/mailer-settings.types';
import type { IMailerSettingsService } from './mailer-settings.service.interface';

const DEFAULT_FROM_ADDRESS = 'no-reply@openlinker.local';
const DEFAULT_SMTP_PORT = 587;

@Injectable()
export class MailerSettingsService implements IMailerSettingsService {
  private readonly logger = new Logger(MailerSettingsService.name);

  constructor(
    @Inject(MAILER_SETTINGS_REPOSITORY_TOKEN)
    private readonly repository: MailerSettingsRepositoryPort,
    @Inject(CREDENTIALS_SERVICE_TOKEN)
    private readonly credentials: ICredentialsService,
    private readonly configService: ConfigService
  ) {}

  async getSettings(): Promise<MailerSettingsView> {
    const row = await this.repository.findSettings();
    const smtpPasswordConfigured = await this.isSmtpPasswordConfigured();

    if (!row) {
      return {
        transport: 'console',
        smtpHost: null,
        smtpPort: null,
        smtpSecure: false,
        fromAddress: null,
        smtpPasswordConfigured,
        updatedAt: null,
        updatedBy: null,
      };
    }

    return {
      transport: row.transport,
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort,
      smtpSecure: row.smtpSecure,
      fromAddress: row.fromAddress,
      smtpPasswordConfigured,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
  }

  async updateSettings(input: MailerSettingsInput, actorUserId?: string): Promise<void> {
    await this.repository.upsertSettings(input, actorUserId ?? null);
    this.logger.log('mailer_settings.update', {
      transport: input.transport,
      actor: actorUserId ?? 'system',
    });
  }

  async setSmtpPassword(password: string, actorUserId?: string): Promise<void> {
    try {
      await this.credentials.update(MAILER_SMTP_CREDENTIALS_REF, {
        credentialsJson: { password },
      });
    } catch (error) {
      if (error instanceof CredentialNotFoundException) {
        await this.credentials.create({
          ref: MAILER_SMTP_CREDENTIALS_REF,
          platformType: 'mailer',
          credentialsJson: { password },
        });
      } else {
        throw error;
      }
    }
    this.logger.log('mailer_settings.set_credentials', { actor: actorUserId ?? 'system' });
  }

  async clearSmtpPassword(actorUserId?: string): Promise<void> {
    await this.credentials.delete(MAILER_SMTP_CREDENTIALS_REF);
    this.logger.log('mailer_settings.clear_credentials', { actor: actorUserId ?? 'system' });
  }

  async resolveTransportConfig(): Promise<ResolvedMailerTransportConfig> {
    const row = await this.repository.findSettings();
    if (row) {
      return this.resolveFromRow(row);
    }
    return this.resolveFromEnv();
  }

  private async resolveFromRow(row: MailerSettings): Promise<ResolvedMailerTransportConfig> {
    const fromAddress = row.fromAddress ?? DEFAULT_FROM_ADDRESS;

    if (row.transport !== 'smtp') {
      return {
        transport: 'console',
        smtpHost: null,
        smtpPort: DEFAULT_SMTP_PORT,
        smtpSecure: false,
        smtpUser: null,
        smtpPassword: null,
        fromAddress,
      };
    }

    const smtpPassword = await this.readSmtpPassword();
    return {
      transport: 'smtp',
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort ?? DEFAULT_SMTP_PORT,
      smtpSecure: row.smtpSecure,
      smtpUser: this.configService.get<string>('MAIL_SMTP_USER') ?? null,
      smtpPassword,
      fromAddress,
    };
  }

  /**
   * First-boot fallback when no DB row exists yet — reproduces the
   * env-var-only resolution `MailerProvider` used before this change (#1623),
   * so operators on env-only configuration keep working unchanged.
   */
  private resolveFromEnv(): ResolvedMailerTransportConfig {
    const transportEnv = this.configService.get<string>('MAIL_TRANSPORT', '').toLowerCase();
    const host = this.configService.get<string>('MAIL_SMTP_HOST');
    const fromAddress = this.configService.get<string>('MAIL_FROM', DEFAULT_FROM_ADDRESS);

    if (transportEnv === 'console' || (!host && transportEnv !== 'smtp')) {
      return {
        transport: 'console',
        smtpHost: null,
        smtpPort: DEFAULT_SMTP_PORT,
        smtpSecure: false,
        smtpUser: null,
        smtpPassword: null,
        fromAddress,
      };
    }

    if (!host) {
      throw new Error('MAIL_TRANSPORT=smtp requires MAIL_SMTP_HOST to be set');
    }

    const smtpPort = Number(
      this.configService.get<string>('MAIL_SMTP_PORT', String(DEFAULT_SMTP_PORT))
    );
    const smtpSecure = this.configService.get<string>('MAIL_SMTP_SECURE', 'false') === 'true';
    const smtpUser = this.configService.get<string>('MAIL_SMTP_USER') ?? null;
    const smtpPassword = this.configService.get<string>('MAIL_SMTP_PASSWORD') ?? null;

    return {
      transport: 'smtp',
      smtpHost: host,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPassword,
      fromAddress,
    };
  }

  private async readSmtpPassword(): Promise<string | null> {
    try {
      const credential = await this.credentials.getByRef(MAILER_SMTP_CREDENTIALS_REF);
      const password = credential.credentialsJson?.password;
      if (typeof password !== 'string') {
        this.logger.error(
          `Mailer credential ${MAILER_SMTP_CREDENTIALS_REF} is missing a password field`
        );
        return null;
      }
      return password;
    } catch (error) {
      if (error instanceof CredentialNotFoundException) {
        return this.configService.get<string>('MAIL_SMTP_PASSWORD') ?? null;
      }
      throw error;
    }
  }

  private async isSmtpPasswordConfigured(): Promise<boolean> {
    try {
      await this.credentials.getByRef(MAILER_SMTP_CREDENTIALS_REF);
      return true;
    } catch (error) {
      if (error instanceof CredentialNotFoundException) {
        return Boolean(this.configService.get<string>('MAIL_SMTP_PASSWORD'));
      }
      throw error;
    }
  }
}
