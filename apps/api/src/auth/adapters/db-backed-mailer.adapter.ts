/**
 * DB-Backed Mailer Adapter
 *
 * Bound to `MAILER_TOKEN`. On every `sendEmail()` call, reads the
 * effective transport configuration through `IMailerSettingsService`
 * (DB row → env var fallback → console default) and delegates to a
 * freshly-built `ConsoleMailerAdapter` or `SmtpMailerAdapter`.
 *
 * **No cache.** Mirrors `MultiProviderAiCompletionAdapter`'s read-through
 * model: the settings lookup is a singleton-row PK query (plus, for SMTP,
 * one encrypted-credential lookup) — sub-millisecond, dwarfed by the actual
 * SMTP round-trip. Read-through buys instant cross-process visibility of an
 * admin settings change with no TTL window and no invalidator port.
 *
 * @module apps/api/src/auth/adapters
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import {
  MAILER_SETTINGS_SERVICE_TOKEN,
  type IMailerSettingsService,
} from '@openlinker/core/mailer';
import type { EmailMessage, MailerPort } from '@openlinker/core/users';
import { ConsoleMailerAdapter } from './console-mailer.adapter';
import { SmtpMailerAdapter, type SmtpTransport } from './smtp-mailer.adapter';

@Injectable()
export class DbBackedMailerAdapter implements MailerPort {
  private readonly logger = new Logger(DbBackedMailerAdapter.name);

  constructor(
    @Inject(MAILER_SETTINGS_SERVICE_TOKEN)
    private readonly settings: IMailerSettingsService
  ) {}

  async sendEmail(message: EmailMessage): Promise<void> {
    const config = await this.settings.resolveTransportConfig();

    if (config.transport !== 'smtp' || !config.smtpHost) {
      await new ConsoleMailerAdapter().sendEmail(message);
      return;
    }

    const transporter = createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: config.smtpUser
        ? { user: config.smtpUser, pass: config.smtpPassword ?? undefined }
        : undefined,
    });
    const adapter = new SmtpMailerAdapter(
      transporter as unknown as SmtpTransport,
      config.fromAddress
    );

    this.logger.debug(
      `[mail] route host=${config.smtpHost} port=${config.smtpPort} secure=${config.smtpSecure}`
    );
    await adapter.sendEmail(message);
  }
}
