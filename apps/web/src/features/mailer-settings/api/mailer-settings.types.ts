/**
 * Mailer Settings — Frontend Types
 *
 * Hand-written wire types mirroring the backend DTOs in
 * `apps/api/src/mailer/http/dto/*.ts`. Kept FE-local so the web bundle stays
 * independent of NestJS / core imports.
 *
 * @module apps/web/src/features/mailer-settings/api
 */

export const MailerTransportValues = ['console', 'smtp'] as const;
export type MailerTransport = (typeof MailerTransportValues)[number];

/**
 * Response shape for `GET /mailer-settings`. Never includes the SMTP
 * password — only whether one is currently configured (DB or env).
 */
export interface MailerSettingsView {
  transport: MailerTransport;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  fromAddress: string | null;
  smtpPasswordConfigured: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Body for `PUT /mailer-settings`. The SMTP password is written separately. */
export interface UpdateMailerSettingsInput {
  transport: MailerTransport;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  fromAddress: string | null;
}

/** Body for `PUT /mailer-settings/credentials`. Server trims `password`. */
export interface SetMailerCredentialsInput {
  password: string;
}
