/**
 * Locale resolution - unit tests
 *
 * Covers the ADR-079 resolution order: ?lang= override, stored choice,
 * deployment default, Polish fallback.
 *
 * @module shared/i18n
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  resolveInitialLocale,
  resolveLocale,
} from './resolve-locale';

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('resolveLocale', () => {
  it('should prefer the ?lang= override over everything else', () => {
    expect(resolveLocale({ search: '?lang=en', stored: 'pl', deploymentDefault: 'pl' })).toBe('en');
  });

  it('should use the stored choice when there is no override', () => {
    expect(resolveLocale({ search: '', stored: 'en', deploymentDefault: 'pl' })).toBe('en');
  });

  it('should use the deployment default when nothing is stored', () => {
    expect(resolveLocale({ search: '', stored: null, deploymentDefault: 'en' })).toBe('en');
  });

  it('should fall back to Polish when the deployment default is unsupported', () => {
    expect(resolveLocale({ search: '', stored: null, deploymentDefault: 'de' })).toBe('pl');
    expect(resolveLocale({ search: '', stored: null, deploymentDefault: undefined })).toBe('pl');
  });

  it('should ignore an unsupported ?lang= value', () => {
    expect(resolveLocale({ search: '?lang=xx', stored: 'en', deploymentDefault: 'pl' })).toBe('en');
  });

  it('should accept ?lang= when written in capitals or with a region', () => {
    expect(resolveLocale({ search: '?lang=PL', stored: 'en', deploymentDefault: 'en' })).toBe('pl');
    expect(resolveLocale({ search: '?lang=pl-PL', stored: 'en', deploymentDefault: 'en' })).toBe(
      'pl',
    );
  });

  it('should accept a deployment default when written with a region', () => {
    expect(resolveLocale({ search: '', stored: null, deploymentDefault: 'en_GB' })).toBe('en');
  });

  it('should fall back to Polish when the deployment default is blank', () => {
    expect(resolveLocale({ search: '', stored: null, deploymentDefault: '' })).toBe('pl');
  });
});

describe('resolveInitialLocale', () => {
  it('should persist a ?lang= override so it survives navigation', () => {
    window.history.replaceState(null, '', '/orders?lang=en');
    expect(resolveInitialLocale('pl')).toBe('en');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('should ignore a stored value that is not a supported locale', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'klingon');
    expect(readStoredLocale()).toBeNull();
    expect(resolveInitialLocale('en')).toBe('en');
  });
});
