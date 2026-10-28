/**
 * Console Mailer Adapter
 *
 * Dev-time implementation of MailerPort that logs the email instead of
 * sending it. Selected as the default transport when no SMTP config is
 * present, so offline development works without a mail server.
 *
 * @module apps/api/src/auth/adapters
 */
import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, MailerPort } from '@openlinker/core/users';

@Injectable()
export class ConsoleMailerAdapter implements MailerPort {
  private readonly logger = new Logger(ConsoleMailerAdapter.name);

  async sendEmail(message: EmailMessage): Promise<void> {
    this.logger.log(
      `[mail] to=${message.to} subject=${JSON.stringify(message.subject)} text=${JSON.stringify(
        message.text,
      )}` +
        // Names and sizes only: the bytes of a buyer's invoice do not belong in a log.
        (message.attachments?.length
          ? ` attachments=${JSON.stringify(
              message.attachments.map((a) => `${a.filename} (${String(a.content.byteLength)} B)`),
            )}`
          : ''),
    );
    return Promise.resolve();
  }
}
