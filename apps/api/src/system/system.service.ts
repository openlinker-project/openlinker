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
import { POSTHOG_SETTINGS_SERVICE_TOKEN, type IPosthogSettingsService } from '@openlinker/core/analytics';
import { getEnvBoolean } from '@openlinker/shared/config';
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
    @Inject(POSTHOG_SETTINGS_SERVICE_TOKEN)
    private readonly posthogSettingsService: IPosthogSettingsService,
  ) {}

  async getConfig(): Promise<SystemConfigDto> {
    const demoMode = this.demoModeService.isDemoModeEnabled();
    // #3507 G03-14 — the browser cannot read the install's env, and the orders
    // search placeholder must not promise buyer-name/email matches the index no
    // longer holds. `getEnvBoolean`, not `getPiiConfig()`: the same flag and
    // default, without the latter's unrelated throw on an unset
    // `OL_PII_HASH_SALT`, which would take this PUBLIC startup read down with it.
    const storesPersonalData = getEnvBoolean('OL_STORE_PII', true);
    if (!demoMode) {
      return { demoMode, storesPersonalData };
    }

    const posthog = await this.posthogSettingsService.resolveConfig();
    if (!posthog) {
      return { demoMode, storesPersonalData };
    }

    return { demoMode, storesPersonalData, demoIntegrations: { posthog } };
  }
}
