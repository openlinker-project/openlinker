/**
 * System Service
 *
 * Assembles the server-driven runtime configuration that the frontend
 * reads at startup to adapt its UI (e.g. demo banner, demo entry flow).
 *
 * @module apps/api/src/system
 * @implements {ISystemService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  DEMO_MODE_SERVICE_TOKEN,
  type IDemoModeService,
} from '../auth/demo-mode.service.interface';
import type { ISystemService } from './system.service.interface';
import type { SystemConfigDto } from './dto/system-config.dto';

@Injectable()
export class SystemService implements ISystemService {
  constructor(
    @Inject(DEMO_MODE_SERVICE_TOKEN)
    private readonly demoModeService: IDemoModeService,
  ) {}

  getConfig(): SystemConfigDto {
    return { demoMode: this.demoModeService.isDemoModeEnabled() };
  }
}
