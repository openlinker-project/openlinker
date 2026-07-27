import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_ANALYTICS_CONSENT_STORAGE_KEY } from '../demo.types';
import {
  getDemoAnalyticsConsent,
  setDemoAnalyticsConsent,
  subscribeToDemoAnalyticsConsent,
} from './demo-analytics-consent';

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

describe('subscribeToDemoAnalyticsConsent (#1882)', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should notify same-tab listeners when consent is written', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToDemoAnalyticsConsent(listener);

    setDemoAnalyticsConsent('accepted');

    expect(listener).toHaveBeenCalledWith('accepted');
    unsubscribe();
  });

  it('should notify on a cross-tab storage event for our key', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToDemoAnalyticsConsent(listener);

    // Simulate another tab: write directly, then fire the native event the
    // browser would emit here (jsdom does not dispatch it for us).
    window.localStorage.setItem(DEMO_ANALYTICS_CONSENT_STORAGE_KEY, 'declined');
    window.dispatchEvent(
      new StorageEvent('storage', { key: DEMO_ANALYTICS_CONSENT_STORAGE_KEY }),
    );

    expect(listener).toHaveBeenCalledWith('declined');
    unsubscribe();
  });

  it('should ignore storage events for unrelated keys', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToDemoAnalyticsConsent(listener);

    window.dispatchEvent(new StorageEvent('storage', { key: 'openlinker.theme' }));

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('should treat a whole-store clear (key === null) as a change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToDemoAnalyticsConsent(listener);

    window.dispatchEvent(new StorageEvent('storage', { key: null }));

    expect(listener).toHaveBeenCalledWith(null);
    unsubscribe();
  });

  it('should stop notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToDemoAnalyticsConsent(listener);
    unsubscribe();

    setDemoAnalyticsConsent('accepted');
    window.dispatchEvent(
      new StorageEvent('storage', { key: DEMO_ANALYTICS_CONSENT_STORAGE_KEY }),
    );

    expect(listener).not.toHaveBeenCalled();
  });

  it('should not notify when the write failed (storage unavailable)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const listener = vi.fn();
    const unsubscribe = subscribeToDemoAnalyticsConsent(listener);

    expect(setDemoAnalyticsConsent('accepted')).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
