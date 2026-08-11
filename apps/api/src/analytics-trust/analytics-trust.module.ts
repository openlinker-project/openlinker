/**
 * Analytics Trust API Module
 *
 * REST surface for the analytics data-trust read (#1982). Distinct from
 * apps/api/src/analytics/ (AnalyticsApiModule), which is the PostHog
 * telemetry-consent settings surface (#1685) — an unrelated domain despite
 * the similar folder name; kept separate to avoid conflating the two.
 *
 * @module apps/api/src/analytics-trust
 */
import { Module } from '@nestjs/common';
import { AnalyticsTrustModule as CoreAnalyticsTrustModule } from '@openlinker/core/analytics-trust';
import { AnalyticsTrustController } from './http/analytics-trust.controller';

@Module({
  imports: [CoreAnalyticsTrustModule],
  controllers: [AnalyticsTrustController],
})
export class AnalyticsTrustApiModule {}
