/**
 * Console Mailer Adapter
 *
 * Dev-time implementation of MailerPort that logs the email instead of
 * sending it. Selected as the default transport when no SMTP config is
 * present, so offline development works without a mail server.
 *
 * It is also what a deployment WITHOUT SMTP sends through, buyer document
 * emails included (#3550), so the log never carries a mailbox: the recipient is
 * reduced to its domain and any address inside the subject or body is scrubbed.
 *
 * @module libs/core/src/mailer/infrastructure/adapters
 */
import { Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { scrubEmailAddresses } from '@openlinker/core/sales-documents';
import type { EmailMessage, MailerPort } from '@openlinker/core/users';
import { redactRecipient } from './mail-log-redaction';

@Injectable()
export class ConsoleMailerAdapter implements MailerPort {
  private readonly logger = new Logger(ConsoleMailerAdapter.name);

  async sendEmail(message: EmailMessage): Promise<void> {
    this.logger.log(
      `[mail] to=${redactRecipient(message.to)} subject=${JSON.stringify(
        scrubEmailAddresses(message.subject),
      )} text=${JSON.stringify(scrubEmailAddresses(message.text))}` +
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
