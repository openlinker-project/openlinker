import type { ConfigService } from '@nestjs/config';
import { PosthogConfigService } from './posthog-config.service';

describe('PosthogConfigService', () => {
  function makeService(env: Record<string, string>): PosthogConfigService {
    const configService = {
      get: <T>(key: string, defaultValue?: T): T => (env[key] as T) ?? (defaultValue as T),
    } as unknown as ConfigService;
    return new PosthogConfigService(configService);
  }

  it('should return null when OL_POSTHOG_KEY is unset', () => {
    expect(makeService({}).getConfig()).toBeNull();
  });

  it('should return null when OL_POSTHOG_KEY is blank', () => {
    expect(makeService({ OL_POSTHOG_KEY: '   ' }).getConfig()).toBeNull();
  });

  it('should default the host to eu.posthog.com when only the key is set', () => {
    expect(makeService({ OL_POSTHOG_KEY: 'phc_abc123' }).getConfig()).toEqual({
      key: 'phc_abc123',
      host: 'https://eu.posthog.com',
      hostWasExplicit: false,
    });
  });

  it('should use the configured host when both key and host are set', () => {
    expect(
      makeService({
        OL_POSTHOG_KEY: 'phc_abc123',
        OL_POSTHOG_HOST: 'https://us.posthog.com',
      }).getConfig(),
    ).toEqual({ key: 'phc_abc123', host: 'https://us.posthog.com', hostWasExplicit: true });
  });
});
