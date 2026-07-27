/**
 * Mailer API Module
 *
 * NestJS module owning the HTTP surface for the mailer bounded context.
 * The controller resolves its dependency from core `MailerModule` — the
 * settings service — so this module's only responsibility is mounting the
 * controller and importing the core module.
 *
 * Follows the `{domain}.module.ts` + `{Domain}ApiModule` pattern already
 * used by `AiApiModule`.
 *
 * @module apps/api/src/mailer
 */
import { Module } from '@nestjs/common';
import { MailerModule as CoreMailerModule } from '@openlinker/core/mailer';
import { MailerSettingsController } from './http/mailer-settings.controller';

@Module({
  imports: [CoreMailerModule],
  controllers: [MailerSettingsController],
})
export class MailerApiModule {}
