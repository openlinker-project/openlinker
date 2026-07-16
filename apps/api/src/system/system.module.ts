/**
 * System Module
 *
 * Exposes GET /system/config — the server-driven runtime configuration
 * surface. Wires DemoModeService locally (it depends only on ConfigService
 * which is global) so SystemModule has no dependency on AuthModule.
 *
 * Imports core `AnalyticsModule` for `IPosthogSettingsService` (DB-backed
 * PostHog settings resolution, #1685) — that service reads its own env
 * fallback directly via the globally-registered `ConfigService`, so no
 * app-layer env-reader binding is needed here.
 *
 * @module apps/api/src/system
 */
import { Module } from '@nestjs/common';
import { AnalyticsModule as CoreAnalyticsModule } from '@openlinker/core/analytics';
import { DemoModeService } from '../auth/demo-mode.service';
import { DEMO_MODE_SERVICE_TOKEN } from '../auth/demo-mode.service.interface';
import { SystemService } from './system.service';
import { SYSTEM_SERVICE_TOKEN } from './system.service.interface';
import { SystemController } from './system.controller';

@Module({
  imports: [CoreAnalyticsModule],
  controllers: [SystemController],
  providers: [
    DemoModeService,
    { provide: DEMO_MODE_SERVICE_TOKEN, useExisting: DemoModeService },
    SystemService,
    { provide: SYSTEM_SERVICE_TOKEN, useExisting: SystemService },
  ],
})
export class SystemModule {}
