import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_ANALYTICS_CONSENT_STORAGE_KEY } from '../demo.types';
import { getDemoAnalyticsConsent, setDemoAnalyticsConsent } from './demo-analytics-consent';

describe('demo-analytics-consent', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should return null when no consent is stored', () => {
    expect(getDemoAnalyticsConsent()).toBeNull();
  });

  it('should round-trip an accepted consent', () => {
    setDemoAnalyticsConsent('accepted');
    expect(getDemoAnalyticsConsent()).toBe('accepted');
  });

  it('should round-trip a declined consent', () => {
    setDemoAnalyticsConsent('declined');
    expect(getDemoAnalyticsConsent()).toBe('declined');
  });

  it('should return null for an invalid stored value', () => {
    window.localStorage.setItem(DEMO_ANALYTICS_CONSENT_STORAGE_KEY, 'not-a-real-value');
    expect(getDemoAnalyticsConsent()).toBeNull();
  });

  it('should not throw and should return null when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => getDemoAnalyticsConsent()).not.toThrow();
    expect(getDemoAnalyticsConsent()).toBeNull();
  });

  it('should not throw when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => setDemoAnalyticsConsent('accepted')).not.toThrow();
  });
});
