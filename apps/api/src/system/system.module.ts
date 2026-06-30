/**
 * System Module
 *
 * Exposes GET /system/config — the server-driven runtime configuration
 * surface. Wires DemoModeService locally (it depends only on ConfigService
 * which is global) so SystemModule has no dependency on AuthModule.
 *
 * @module apps/api/src/system
 */
import { Module } from '@nestjs/common';
import { DemoModeService } from '../auth/demo-mode.service';
import { DEMO_MODE_SERVICE_TOKEN } from '../auth/demo-mode.service.interface';
import { SystemService } from './system.service';
import { SYSTEM_SERVICE_TOKEN } from './system.service.interface';
import { SystemController } from './system.controller';

@Module({
  controllers: [SystemController],
  providers: [
    DemoModeService,
    { provide: DEMO_MODE_SERVICE_TOKEN, useExisting: DemoModeService },
    SystemService,
    { provide: SYSTEM_SERVICE_TOKEN, useExisting: SystemService },
  ],
})
export class SystemModule {}
