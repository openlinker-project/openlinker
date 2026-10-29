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

/**
 * A file sent with the message (#3550). Optional on {@link EmailMessage}, so an
 * implementer that ignores attachments still compiles and every existing caller
 * is untouched. Bytes are carried as `Uint8Array`: no Node `Buffer` type leaks
 * into core.
 */
export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
  /** MIME type, e.g. `application/pdf`. */
  contentType: string;
}

export interface EmailMessage {
  /** Recipient address. */
  to: string;
  /** Subject line. */
  subject: string;
  /** Plain-text body (always required so every client can render). */
  text: string;
  /** Optional HTML body. */
  html?: string;
  /** Files to attach (#3550). Absent means none. */
  attachments?: readonly EmailAttachment[];
}

export interface MailerPort {
  sendEmail(message: EmailMessage): Promise<void>;
}
