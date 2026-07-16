/**
 * Analytics API Module
 *
 * NestJS module owning the HTTP surface for the analytics bounded context.
 * The controller resolves its dependency from core `AnalyticsModule` — the
 * settings service — so this module's only responsibility is mounting the
 * controller and importing the core module.
 *
 * Follows the `{domain}.module.ts` + `{Domain}ApiModule` pattern already
 * used by `MailerApiModule`.
 *
 * @module apps/api/src/analytics
 */
import { Module } from '@nestjs/common';
import { AnalyticsModule as CoreAnalyticsModule } from '@openlinker/core/analytics';
import { PosthogSettingsController } from './http/posthog-settings.controller';

@Module({
  imports: [CoreAnalyticsModule],
  controllers: [PosthogSettingsController],
})
export class AnalyticsApiModule {}
