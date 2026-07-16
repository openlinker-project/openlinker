/**
 * PostHog Config Service
 *
 * Reads OL_POSTHOG_KEY / OL_POSTHOG_HOST from the environment. Returns null
 * when no key is configured, so the demo-only analytics seam is deny-by-
 * default even on a demo-mode instance that hasn't opted into PostHog.
 *
 * Implements the core `PosthogEnvConfigPort` (#1685) so
 * `PosthogSettingsService` (`libs/core/src/analytics`) can fall back to this
 * env-only config without depending on this app-layer class directly — the
 * concrete binding is supplied by `SystemModule`.
 *
 * @module apps/api/src/system
 * @implements {PosthogEnvConfigPort}
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PosthogEnvConfig, PosthogEnvConfigPort } from '@openlinker/core/analytics';

const DEFAULT_POSTHOG_HOST = 'https://eu.posthog.com';

@Injectable()
export class PosthogConfigService implements PosthogEnvConfigPort {
  constructor(private readonly configService: ConfigService) {}

  getConfig(): PosthogEnvConfig | null {
    const key = this.configService.get<string>('OL_POSTHOG_KEY', '').trim();
    if (!key) {
      return null;
    }

    const rawHost = this.configService.get<string>('OL_POSTHOG_HOST', '').trim();
    return {
      key,
      host: rawHost || DEFAULT_POSTHOG_HOST,
      hostWasExplicit: rawHost.length > 0,
    };
  }
}
