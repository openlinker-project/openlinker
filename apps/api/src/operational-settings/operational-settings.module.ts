/**
 * Operational Settings API Module
 *
 * Mounts the admin HTTP surface for the sweep budgets and deletion-audit
 * cadence (#2651). Owns no providers, only a controller, and imports the core
 * context whose token it injects - the `{Domain}ApiModule` pattern
 * `CurrencyApiModule` / `AnalyticsApiModule` already use.
 *
 * @module apps/api/src/operational-settings
 */
import { Module } from '@nestjs/common';
import { OperationalSettingsModule as CoreOperationalSettingsModule } from '@openlinker/core/operational-settings';
import { OperationalSettingsController } from './http/operational-settings.controller';

@Module({
  imports: [CoreOperationalSettingsModule],
  controllers: [OperationalSettingsController],
})
export class OperationalSettingsApiModule {}
