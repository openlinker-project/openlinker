import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemConfig } from '../../system';
import {
  captureMarketingLanding,
  hasMarketingUtmParams,
  isMarketingLandingTrackable,
} from './capture-marketing-landing';

const configuredPosthog: SystemConfig = {
  demoMode: true,
  demoIntegrations: {
    posthog: {
      key: 'phc_abc',
      host: 'https://eu.i.posthog.com',
      autocapture: true,
      sessionRecording: true,
    },
  },
};

function setLocation(search: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(`https://app.demo.openlinker.io/${search}`),
    writable: true,
  });
}

describe('hasMarketingUtmParams', () => {
  it('should return true when the search string carries a utm param', () => {
    expect(hasMarketingUtmParams('?utm_campaign=demo_invite_2026_07')).toBe(true);
  });

  it('should return false when the search string carries no utm param', () => {
    expect(hasMarketingUtmParams('?ref=whatever')).toBe(false);
  });

  it('should return false for an empty search string', () => {
    expect(hasMarketingUtmParams('')).toBe(false);
  });
});

describe('isMarketingLandingTrackable', () => {
  it('should return true when demo mode, posthog key, and a utm param are all present', () => {
    expect(isMarketingLandingTrackable(configuredPosthog, '?utm_source=email')).toBe(true);
  });

  it('should return false when demo mode is off', () => {
    expect(
      isMarketingLandingTrackable({ ...configuredPosthog, demoMode: false }, '?utm_source=email')
    ).toBe(false);
  });

  it('should return false when no posthog key is configured', () => {
    expect(isMarketingLandingTrackable({ demoMode: true }, '?utm_source=email')).toBe(false);
  });

  it('should return false when config is undefined', () => {
    expect(isMarketingLandingTrackable(undefined, '?utm_source=email')).toBe(false);
  });

  it('should return false when the URL carries no utm params', () => {
    expect(isMarketingLandingTrackable(configuredPosthog, '?ref=whatever')).toBe(false);
  });

  it('should return false once the tab has already captured a landing', () => {
    const originalLocation = window.location;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    window.sessionStorage.clear();
    setLocation('?utm_source=email');

    captureMarketingLanding(configuredPosthog);

    expect(isMarketingLandingTrackable(configuredPosthog, '?utm_source=email')).toBe(false);

    window.sessionStorage.clear();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
  });
});

describe('captureMarketingLanding', () => {
  const originalLocation = window.location;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    window.sessionStorage.clear();
    setLocation('?utm_source=email&utm_medium=email&utm_campaign=demo_invite_2026_07');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
  });

  it('should not capture when demoMode is false', () => {
    captureMarketingLanding({ ...configuredPosthog, demoMode: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should not capture when no posthog key is configured', () => {
    captureMarketingLanding({ demoMode: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should not capture when config is undefined', () => {
    captureMarketingLanding(undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should not capture when the URL carries no utm params', () => {
    setLocation('?ref=whatever');
    captureMarketingLanding(configuredPosthog);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should POST a de-identified event to the resolved capture host when utm params are present', () => {
    captureMarketingLanding(configuredPosthog);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://eu.i.posthog.com/capture/');
    expect(init.keepalive).toBe(true);

    const body = JSON.parse(init.body as string) as {
      api_key: string;
      event: string;
      distinct_id: string;
      properties: Record<string, unknown>;
    };
    expect(body.api_key).toBe('phc_abc');
    expect(body.event).toBe('demo_marketing_landing');
    expect(body.distinct_id).toEqual(expect.any(String));
    expect(body.properties).toMatchObject({
      utm_source: 'email',
      utm_medium: 'email',
      utm_campaign: 'demo_invite_2026_07',
      $process_person_profile: false,
    });
  });

  it('should only capture once per tab', () => {
    captureMarketingLanding(configuredPosthog);
    captureMarketingLanding(configuredPosthog);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should still capture when sessionStorage.getItem throws (private browsing)', () => {
    const getItemSpy = vi
      .spyOn(window.sessionStorage.__proto__ as Storage, 'getItem')
      .mockImplementation(() => {
        throw new DOMException('blocked');
      });

    captureMarketingLanding(configuredPosthog);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    getItemSpy.mockRestore();
  });

  it('should not throw when sessionStorage.setItem throws (private browsing)', () => {
    const setItemSpy = vi
      .spyOn(window.sessionStorage.__proto__ as Storage, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('blocked');
      });

    expect(() => captureMarketingLanding(configuredPosthog)).not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setItemSpy.mockRestore();
  });
});
