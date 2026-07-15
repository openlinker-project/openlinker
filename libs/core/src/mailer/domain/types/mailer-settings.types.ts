/**
 * Mailer Settings Types
 *
 * Value types for the DB-backed mailer/SMTP settings. `transport` mirrors
 * the two transports `MailerProvider` already supported via env vars
 * (`MAIL_TRANSPORT=console|smtp`, #1623) — the DB row makes the choice
 * operator-editable at runtime instead of requiring a redeploy.
 *
 * @module libs/core/src/mailer/domain/types
 */

export const MailerTransportValues = ['console', 'smtp'] as const;
export type MailerTransport = (typeof MailerTransportValues)[number];

/**
 * Non-secret settings fields, as written by `PUT /mailer-settings`. The SMTP
 * password is deliberately absent — it is written separately via
 * `PUT /mailer-settings/credentials` into the encrypted credentials store.
 */
export interface MailerSettingsInput {
  transport: MailerTransport;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  fromAddress: string | null;
}

/**
 * Read view returned by `GET /mailer-settings`. Never carries the SMTP
 * password — only whether one is currently configured.
 */
export interface MailerSettingsView {
  transport: MailerTransport;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  fromAddress: string | null;
  smtpPasswordConfigured: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/**
 * Fully-resolved runtime transport configuration consumed by the mailer
 * adapter to actually send an email. Resolution order: DB row → env var
 * fallback → console default (see `IMailerSettingsService.resolveTransportConfig`).
 */
export interface ResolvedMailerTransportConfig {
  transport: MailerTransport;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  /**
   * SMTP auth username. Not yet an admin-editable field (out of scope for
   * #1643, which only covers transport/host/port/secure/from as non-secret
   * fields plus the password as the one secret) — always sourced from the
   * legacy `MAIL_SMTP_USER` env var. A future issue can promote it to a
   * DB-backed field alongside the password.
   */
  smtpUser: string | null;
  smtpPassword: string | null;
  fromAddress: string;
}
