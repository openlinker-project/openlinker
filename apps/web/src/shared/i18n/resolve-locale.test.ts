/**
 * Locale resolution - unit tests
 *
 * Covers the ADR-081 resolution order: ?lang= override, stored choice, the
 * browser's first supported language (#3890), deployment default, English
 * fallback. Every case states the browser languages it assumes: happy-dom
 * reports `en-US`, which would otherwise decide the result silently.
 *
 * @module shared/i18n
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOCALE_STORAGE_KEY,
  readBrowserLocale,
  readNavigatorLanguages,
  readStoredLocale,
  resolveInitialLocale,
  resolveLocale,
  type ResolveLocaleInput,
} from './resolve-locale';

/** No override, nothing stored, a browser that asks for nothing the app ships. */
const NOTHING: ResolveLocaleInput = {
  search: '',
  stored: null,
  browserLanguages: [],
  deploymentDefault: undefined,
};

function stubBrowser(languages: readonly string[], language = languages[0] ?? ''): void {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages);
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(language);
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('resolveLocale', () => {
  it('should prefer the ?lang= override over everything else', () => {
    expect(
      resolveLocale({
        search: '?lang=en',
        stored: 'pl',
        browserLanguages: [],
        deploymentDefault: 'pl',
      })
    ).toBe('en');
  });

  it('should use the stored choice when there is no override', () => {
    expect(
      resolveLocale({ search: '', stored: 'en', browserLanguages: [], deploymentDefault: 'pl' })
    ).toBe('en');
  });

  it('should use the deployment default when nothing is stored', () => {
    expect(
      resolveLocale({ search: '', stored: null, browserLanguages: [], deploymentDefault: 'en' })
    ).toBe('en');
  });

  it('should give an unsupported default the same result as an unset one', () => {
    const unset = resolveLocale({
      search: '',
      stored: null,
      browserLanguages: [],
      deploymentDefault: undefined,
    });
    expect(
      resolveLocale({ search: '', stored: null, browserLanguages: [], deploymentDefault: 'de' })
    ).toBe(unset);
    expect(
      resolveLocale({
        search: '',
        stored: null,
        browserLanguages: [],
        deploymentDefault: 'english',
      })
    ).toBe(unset);
    expect(unset).toBe('en');
  });

  it('should ignore an unsupported ?lang= value', () => {
    expect(
      resolveLocale({
        search: '?lang=xx',
        stored: 'en',
        browserLanguages: [],
        deploymentDefault: 'pl',
      })
    ).toBe('en');
  });

  it('should accept ?lang= when written in capitals or with a region', () => {
    expect(
      resolveLocale({
        search: '?lang=PL',
        stored: 'en',
        browserLanguages: [],
        deploymentDefault: 'en',
      })
    ).toBe('pl');
    expect(
      resolveLocale({
        search: '?lang=pl-PL',
        stored: 'en',
        browserLanguages: [],
        deploymentDefault: 'en',
      })
    ).toBe('pl');
  });

  it('should accept a deployment default when written with a region', () => {
    expect(
      resolveLocale({ search: '', stored: null, browserLanguages: [], deploymentDefault: 'en_GB' })
    ).toBe('en');
  });

  it('should fall back to the unset default when the deployment default is blank', () => {
    expect(
      resolveLocale({ search: '', stored: null, browserLanguages: [], deploymentDefault: '' })
    ).toBe('en');
  });

  it('should open in Polish when the browser asks for Polish and nothing is stored', () => {
    expect(resolveLocale({ ...NOTHING, browserLanguages: ['pl-PL', 'pl'] })).toBe('pl');
  });

  it('should open in English when the browser asks for English, whatever the region', () => {
    expect(
      resolveLocale({ ...NOTHING, browserLanguages: ['en-US'], deploymentDefault: 'pl' })
    ).toBe('en');
    expect(
      resolveLocale({ ...NOTHING, browserLanguages: ['en-GB'], deploymentDefault: 'pl' })
    ).toBe('en');
  });

  it('should take the first browser language the app ships', () => {
    expect(resolveLocale({ ...NOTHING, browserLanguages: ['de-DE', 'en-US', 'pl'] })).toBe('en');
    expect(resolveLocale({ ...NOTHING, browserLanguages: ['de-DE', 'pl-PL', 'en'] })).toBe('pl');
  });

  it('should use the deployment default when the browser asks for no shipped language', () => {
    expect(
      resolveLocale({ ...NOTHING, browserLanguages: ['de-DE', 'fr'], deploymentDefault: 'pl' })
    ).toBe('pl');
  });

  it('should fall back to English when neither the browser nor the deployment names a shipped language', () => {
    expect(resolveLocale({ ...NOTHING, browserLanguages: ['de-DE'] })).toBe('en');
    expect(
      resolveLocale({ ...NOTHING, browserLanguages: ['de-DE'], deploymentDefault: 'de' })
    ).toBe('en');
  });

  it('should let the stored choice and ?lang= win over the browser', () => {
    expect(resolveLocale({ ...NOTHING, stored: 'en', browserLanguages: ['pl-PL'] })).toBe('en');
    expect(resolveLocale({ ...NOTHING, search: '?lang=en', browserLanguages: ['pl-PL'] })).toBe(
      'en'
    );
  });
});

describe('readBrowserLocale', () => {
  it('should match on the primary subtag and skip languages the app does not ship', () => {
    expect(readBrowserLocale(['de-DE', 'PL_pl'])).toBe('pl');
    expect(readBrowserLocale(['de', 'fr-FR', ''])).toBeNull();
    expect(readBrowserLocale([])).toBeNull();
  });
});

describe('readNavigatorLanguages', () => {
  it('should read the full preference list, most preferred first', () => {
    stubBrowser(['pl-PL', 'en-US']);
    expect(readNavigatorLanguages()).toEqual(['pl-PL', 'en-US']);
  });

  it('should fall back to navigator.language when the list is empty', () => {
    stubBrowser([], 'pl-PL');
    expect(readNavigatorLanguages()).toEqual(['pl-PL']);
  });

  it('should give no languages when the navigator throws', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readNavigatorLanguages()).toEqual([]);
  });
});

describe('resolveInitialLocale', () => {
  it('should persist a ?lang= override so it survives navigation', () => {
    window.history.replaceState(null, '', '/orders?lang=en');
    expect(resolveInitialLocale('pl')).toBe('en');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('should remove ?lang= from the address bar after saving it, keeping the rest', () => {
    window.history.replaceState(null, '', '/orders?status=open&lang=pl#top');
    resolveInitialLocale('en');
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/orders?status=open#top'
    );
  });

  it('should ignore a stored value that is not a supported locale', () => {
    stubBrowser(['de-DE']);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'klingon');
    expect(readStoredLocale()).toBeNull();
    expect(resolveInitialLocale('en')).toBe('en');
  });

  it('should open in the browser language without storing it', () => {
    stubBrowser(['pl-PL', 'en-US']);
    expect(resolveInitialLocale('en')).toBe('pl');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('should keep a stored choice over the browser language', () => {
    stubBrowser(['pl-PL']);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    expect(resolveInitialLocale('pl')).toBe('en');
  });

  it('should use the deployment default when the browser gives no shipped language', () => {
    stubBrowser(['de-DE']);
    expect(resolveInitialLocale('pl')).toBe('pl');
    expect(resolveInitialLocale(undefined)).toBe('en');
  });
});
