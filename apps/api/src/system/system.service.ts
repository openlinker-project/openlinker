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
  POSTHOG_SETTINGS_SERVICE_TOKEN,
  type IPosthogSettingsService,
} from '@openlinker/core/analytics';
import {
  LOGIN_PAGE_SETTINGS_SERVICE_TOKEN,
  type ILoginPageSettingsService,
} from '@openlinker/core/login-page-settings';
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
    @Inject(LOGIN_PAGE_SETTINGS_SERVICE_TOKEN)
    private readonly loginPageSettingsService: ILoginPageSettingsService
  ) {}

  async getConfig(): Promise<SystemConfigDto> {
    const demoMode = this.demoModeService.isDemoModeEnabled();
    // #3507 G03-14 — the browser cannot read the install's env, and the orders
    // search placeholder must not promise buyer-name/email matches the index no
    // longer holds. `getEnvBoolean`, not `getPiiConfig()`: the same flag and
    // default, without the latter's unrelated throw on an unset
    // `OL_PII_HASH_SALT`, which would take this PUBLIC startup read down with it.
    const storesPersonalData = getEnvBoolean('OL_STORE_PII', true);
    const registrationEnabled = await this.loginPageSettingsService.isRegistrationEnabled();
    if (!demoMode) {
      // #4028 - a real install's login copy is admin-editable; the demo's is
      // fixed in the frontend, so the demo carries no `loginPage` at all.
      const loginPage = await this.loginPageSettingsService.resolvePublicCopy();
      return { demoMode, storesPersonalData, registrationEnabled, loginPage };
    }

    const posthog = await this.posthogSettingsService.resolveConfig();
    if (!posthog) {
      return { demoMode, storesPersonalData, registrationEnabled };
    }

    return { demoMode, storesPersonalData, registrationEnabled, demoIntegrations: { posthog } };
  }
}
