/**
 * System Module
 *
 * Exposes GET /system/config — the server-driven runtime configuration
 * surface. Wires DemoModeService locally (it depends only on ConfigService
 * which is global) so SystemModule has no dependency on AuthModule.
 *
 * Imports core `AnalyticsModule` for `IPosthogSettingsService` (DB-backed
 * PostHog settings resolution, #1685) and binds this module's own
 * `PosthogConfigService` as the concrete `PosthogEnvConfigPort` the core
 * service falls back to when no enabled DB row exists — the app layer
 * supplies this binding because the env reader lives here, not in core.
 *
 * @module apps/api/src/system
 */
import { Module } from '@nestjs/common';
import { AnalyticsModule as CoreAnalyticsModule, POSTHOG_ENV_CONFIG_PORT_TOKEN } from '@openlinker/core/analytics';
import { DemoModeService } from '../auth/demo-mode.service';
import { DEMO_MODE_SERVICE_TOKEN } from '../auth/demo-mode.service.interface';
import { PosthogConfigService } from './posthog-config.service';
import { SystemService } from './system.service';
import { SYSTEM_SERVICE_TOKEN } from './system.service.interface';
import { SystemController } from './system.controller';

@Module({
  imports: [CoreAnalyticsModule],
  controllers: [SystemController],
  providers: [
    DemoModeService,
    { provide: DEMO_MODE_SERVICE_TOKEN, useExisting: DemoModeService },
    PosthogConfigService,
    { provide: POSTHOG_ENV_CONFIG_PORT_TOKEN, useExisting: PosthogConfigService },
    SystemService,
    { provide: SYSTEM_SERVICE_TOKEN, useExisting: SystemService },
  ],
})
export class SystemModule {}
