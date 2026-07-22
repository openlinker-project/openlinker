/**
 * Mailer Settings Service Interface
 *
 * Application-layer contract for reading/writing the DB-backed mailer/SMTP
 * settings and for resolving the fully-effective runtime transport
 * configuration consumed by the mailer adapter. Mirrors
 * `IAiProviderActiveSettingsService`.
 *
 * @module libs/core/src/mailer/application/services
 */
import type {
  MailerSettingsInput,
  MailerSettingsView,
  ResolvedMailerTransportConfig,
} from '../../domain/types/mailer-settings.types';

export interface IMailerSettingsService {
  /**
   * Composite read used by the admin `GET /mailer-settings` endpoint. Never
   * includes the SMTP password — only whether one is currently configured.
   */
  getSettings(): Promise<MailerSettingsView>;

  /** Persist the non-secret settings fields (transport/host/port/secure/from). */
  updateSettings(input: MailerSettingsInput, actorUserId?: string): Promise<void>;

  /** Set or rotate the SMTP password (encrypted at rest). */
  setSmtpPassword(password: string, actorUserId?: string): Promise<void>;

  /** Clear the stored SMTP password. */
  clearSmtpPassword(actorUserId?: string): Promise<void>;

  /**
   * Resolve the fully-effective runtime transport configuration: DB row →
   * env var fallback → console default. Read-through on every call — no
   * in-process cache beyond the singleton-row lookup cost (matches the AI
   * active-provider router's resolution model).
   */
  resolveTransportConfig(): Promise<ResolvedMailerTransportConfig>;
}
