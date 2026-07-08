/**
 * PostHog Config Service
 *
 * Reads OL_POSTHOG_KEY / OL_POSTHOG_HOST from the environment. Returns null
 * when no key is configured, so the demo-only analytics seam is deny-by-
 * default even on a demo-mode instance that hasn't opted into PostHog.
 *
 * @module apps/api/src/system
 * @implements {IPosthogConfigService}
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IPosthogConfigService } from './posthog-config.service.interface';
import type { PosthogConfig } from './posthog-config.types';

const DEFAULT_POSTHOG_HOST = 'https://eu.posthog.com';

@Injectable()
export class PosthogConfigService implements IPosthogConfigService {
  constructor(private readonly configService: ConfigService) {}

  getConfig(): PosthogConfig | null {
    const key = this.configService.get<string>('OL_POSTHOG_KEY', '').trim();
    if (!key) {
      return null;
    }

    const host = this.configService.get<string>('OL_POSTHOG_HOST', DEFAULT_POSTHOG_HOST).trim();
    return { key, host: host || DEFAULT_POSTHOG_HOST };
  }
}
