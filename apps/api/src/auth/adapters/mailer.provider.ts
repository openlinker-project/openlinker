/**
 * Mailer Provider
 *
 * Binds `MAILER_TOKEN` to `DbBackedMailerAdapter`, which resolves the
 * effective transport (console vs SMTP) through `IMailerSettingsService` on
 * every send: DB row → env var fallback → console default (#1643). This
 * closes the loop on #1623's env-var-only mailer infrastructure by making
 * the transport operator-editable at runtime via `PUT /mailer-settings`,
 * without a redeploy.
 *
 * @module apps/api/src/auth/adapters
 */
import type { Provider } from '@nestjs/common';
import { MAILER_TOKEN } from '@openlinker/core/users';
import { DbBackedMailerAdapter } from './db-backed-mailer.adapter';

export const MAILER_PROVIDER: Provider = {
  provide: MAILER_TOKEN,
  useClass: DbBackedMailerAdapter,
};
