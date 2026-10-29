/**
 * Mailer Transport Module
 *
 * Binds `MAILER_TOKEN` (the `MailerPort` in `users`) to `DbBackedMailerAdapter`,
 * which resolves the effective transport (console vs SMTP) through
 * `IMailerSettingsService` on every send: DB row -> env var fallback -> console
 * default (#1643).
 *
 * Shared by BOTH hosts (#3552). It lived in `apps/api` alone, so an automation
 * `send-email` step fired from the worker (the deadline sweeps) could not
 * resolve a mailer and always ended `failed`. `MailerPort` itself stays a core
 * port in `users`; only the adapter wiring is shared.
 *
 * @module libs/core/src/mailer
 */
import { Module } from '@nestjs/common';
import { MAILER_TOKEN } from '@openlinker/core/users';
import { DbBackedMailerAdapter } from './infrastructure/adapters/db-backed-mailer.adapter';
import { MailerModule } from './mailer.module';

@Module({
  imports: [MailerModule],
  providers: [{ provide: MAILER_TOKEN, useClass: DbBackedMailerAdapter }],
  exports: [MAILER_TOKEN],
})
export class MailerTransportModule {}
