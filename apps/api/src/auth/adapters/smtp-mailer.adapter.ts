/**
 * SMTP Mailer Adapter
 *
 * Production implementation of MailerPort backed by nodemailer over SMTP.
 * All transport configuration comes from environment variables (no secrets
 * committed). Suitable for any SMTP-compatible provider, including Amazon SES
 * via its SMTP interface.
 *
 * Env:
 *   MAIL_SMTP_HOST      - SMTP server host (required to select this transport)
 *   MAIL_SMTP_PORT      - SMTP server port (default 587)
 *   MAIL_SMTP_SECURE    - "true" for implicit TLS (default false; STARTTLS on 587)
 *   MAIL_SMTP_USER      - SMTP username (optional; enables auth when set)
 *   MAIL_SMTP_PASSWORD  - SMTP password (optional)
 *   MAIL_FROM           - default From address (default "no-reply@openlinker.local")
 *
 * @module apps/api/src/auth/adapters
 */
import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Transporter } from 'nodemailer';
import type { EmailMessage, MailerPort } from '@openlinker/core/users';

export interface SmtpTransport {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<unknown>;
}

@Injectable()
export class SmtpMailerAdapter implements MailerPort {
  private readonly logger = new Logger(SmtpMailerAdapter.name);
  private readonly from: string;

  constructor(
    private readonly transport: SmtpTransport,
    from: string,
  ) {
    this.from = from;
  }

  async sendEmail(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    this.logger.log(`[mail] sent to=${message.to} subject=${JSON.stringify(message.subject)}`);
  }

  static fromConfig(configService: ConfigService, transporter: Transporter): SmtpMailerAdapter {
    const from = configService.get<string>('MAIL_FROM', 'no-reply@openlinker.local');
    return new SmtpMailerAdapter(transporter as unknown as SmtpTransport, from);
  }
}
