/**
 * Mailer Provider
 *
 * Selects the MailerPort implementation at boot from configuration. When
 * MAIL_SMTP_HOST is set (and MAIL_TRANSPORT is not forced to "console"), a
 * real nodemailer SMTP transport is used; otherwise the console adapter is
 * the default so offline development works without a mail server.
 *
 * @module apps/api/src/auth/adapters
 */
import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { MAILER_TOKEN, type MailerPort } from '@openlinker/core/users';
import { ConsoleMailerAdapter } from './console-mailer.adapter';
import { SmtpMailerAdapter } from './smtp-mailer.adapter';

const logger = new Logger('MailerProvider');

export function createMailer(configService: ConfigService): MailerPort {
  const transport = configService.get<string>('MAIL_TRANSPORT', '').toLowerCase();
  const host = configService.get<string>('MAIL_SMTP_HOST');

  if (transport === 'console' || (!host && transport !== 'smtp')) {
    logger.log('Using console mailer transport (dev default)');
    return new ConsoleMailerAdapter();
  }

  if (!host) {
    throw new Error('MAIL_TRANSPORT=smtp requires MAIL_SMTP_HOST to be set');
  }

  const port = Number(configService.get<string>('MAIL_SMTP_PORT', '587'));
  const secure = configService.get<string>('MAIL_SMTP_SECURE', 'false') === 'true';
  const user = configService.get<string>('MAIL_SMTP_USER');
  const pass = configService.get<string>('MAIL_SMTP_PASSWORD');

  const transporter = createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });

  logger.log(`Using SMTP mailer transport host=${host} port=${port} secure=${secure}`);
  return SmtpMailerAdapter.fromConfig(configService, transporter);
}

export const MAILER_PROVIDER: Provider = {
  provide: MAILER_TOKEN,
  useFactory: createMailer,
  inject: [ConfigService],
};
