/**
 * Mailer Port
 *
 * Framework-neutral outbound-email transport contract. Implementations may
 * log to console (dev), send via SMTP/SES (prod), or push to a queue. The
 * port is deliberately provider-agnostic: no @nestjs and no provider library
 * types leak into core. It is the reusable transport that domain-specific
 * notifiers (password reset, email confirmation, ...) compose to deliver mail.
 *
 * @module libs/core/src/users/domain/ports
 */

export interface EmailMessage {
  /** Recipient address. */
  to: string;
  /** Subject line. */
  subject: string;
  /** Plain-text body (always required so every client can render). */
  text: string;
  /** Optional HTML body. */
  html?: string;
}

export interface MailerPort {
  sendEmail(message: EmailMessage): Promise<void>;
}
