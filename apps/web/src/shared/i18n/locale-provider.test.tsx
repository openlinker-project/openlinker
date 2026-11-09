/**
 * Locale Provider — unit tests
 *
 * Covers the default locale, the hook-outside-provider error, a smoke test on
 * `useNumberFormat()`, switching, persistence and the active-locale side
 * effects. The legacy `t(key, fallback)` seam was removed in #3891.
 *
 * @module shared/i18n
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from './locale-provider';
import { useNumberFormat } from './use-number-format';
import { useLocale } from './use-locale';
import { definePluginMessages } from './define-plugin-messages';
import { loadMessages } from './messages';
import { getLocale, setActiveLocale } from './active-locale';
import { LOCALE_STORAGE_KEY } from './resolve-locale';
import type { SupportedLocale } from './i18n.types';

function LocaleProbe(): React.ReactElement {
  const { locale } = useLocale();
  return <span data-testid="locale">{locale}</span>;
}

function NumberFormatProbe({ value }: { value: number }): React.ReactElement {
  const formatter = useNumberFormat();
  return <span data-testid="formatted">{formatter.format(value)}</span>;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
  setActiveLocale('en');
  document.documentElement.lang = '';
});

const probe = definePluginMessages('test-provider-probe', {
  messages: { title: 'Orders', subtitle: 'Every channel' },
  loaders: { pl: () => Promise.resolve({ title: 'Zamówienia' }) },
});

// Registered after the test setup loaded Polish, so load it for this probe too.
beforeAll(() => loadMessages('pl'));

function SwitchProbe(): React.ReactElement {
  const { locale, setLocale, bcp47 } = useLocale();
  const copy = probe.useMessages();
  return (
    <div>
      <span data-testid="current">{locale}</span>
      <span data-testid="bcp47">{bcp47}</span>
      <span data-testid="title">{copy.title}</span>
      <span data-testid="subtitle">{copy.subtitle}</span>
      <button type="button" onClick={() => setLocale(locale === 'pl' ? 'en' : 'pl')}>
        switch
      </button>
    </div>
  );
}

describe('LocaleProvider', () => {
  it('defaults to en locale when no prop is provided', () => {
    render(
      <LocaleProvider>
        <LocaleProbe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('locale')).toHaveTextContent('en');
  });

  it('throws when useLocale is used outside the provider', () => {
    // Swallow the React error boundary noise that React logs.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    expect(() => render(<LocaleProbe />)).toThrow(/LocaleProvider/);
    consoleError.mockRestore();
  });

  it('useNumberFormat produces an Intl.NumberFormat for the current locale', () => {
    render(
      <LocaleProvider>
        <NumberFormatProbe value={1234567} />
      </LocaleProvider>,
    );
    // BCP 47 en-US uses commas as thousand separators.
    expect(screen.getByTestId('formatted')).toHaveTextContent('1,234,567');
  });

  it('should switch language without a reload and persist the choice when not pinned', () => {
    render(
      <LocaleProvider>
        <SwitchProbe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('title')).toHaveTextContent('Orders');
    fireEvent.click(screen.getByRole('button', { name: 'switch' }));
    expect(screen.getByTestId('current')).toHaveTextContent('pl');
    expect(screen.getByTestId('title')).toHaveTextContent('Zamówienia');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pl');
  });

  it('should fall back to English per key when Polish is missing', () => {
    render(
      <LocaleProvider locale="pl">
        <SwitchProbe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('subtitle')).toHaveTextContent('Every channel');
  });

  it('should set <html lang> and expose the active locale outside React', () => {
    render(
      <LocaleProvider locale="pl">
        <SwitchProbe />
      </LocaleProvider>,
    );
    expect(document.documentElement.lang).toBe('pl-PL');
    expect(screen.getByTestId('bcp47')).toHaveTextContent('pl-PL');
    expect(getLocale()).toBe('pl');
  });

  it('should treat an unsupported pinned locale as English when a JavaScript caller passes one', () => {
    render(
      // @ts-expect-error - the prop only admits supported locales
      <LocaleProvider locale="xx">
        <SwitchProbe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('current')).toHaveTextContent('en');
  });

  it('should not save the choice when the provider is pinned', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    render(
      <LocaleProvider locale="en">
        <SwitchProbe />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'switch' }));
    expect(screen.getByTestId('current')).toHaveTextContent('pl');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('should open in the stored language on the first render when not pinned', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'pl');
    render(
      <LocaleProvider>
        <SwitchProbe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('title')).toHaveTextContent('Zamówienia');
  });

  it('should let ?lang= win over the stored language when not pinned', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'pl');
    window.history.replaceState({}, '', '/?lang=en');
    render(
      <LocaleProvider>
        <SwitchProbe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('title')).toHaveTextContent('Orders');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('should still switch when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(
      <LocaleProvider>
        <SwitchProbe />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'switch' }));
    expect(screen.getByTestId('title')).toHaveTextContent('Zamówienia');
  });

  it('should follow a new pinned locale when the prop changes', () => {
    const { rerender } = render(
      <LocaleProvider locale="en">
        <SwitchProbe />
      </LocaleProvider>,
    );
    const next: SupportedLocale = 'pl';
    rerender(
      <LocaleProvider locale={next}>
        <SwitchProbe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('title')).toHaveTextContent('Zamówienia');
  });
});
