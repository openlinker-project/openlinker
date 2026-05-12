/**
 * Locale Provider — unit tests
 *
 * Covers the no-op i18n seam (#612): default locale, fallback behaviour of
 * `t()`, catalog-hit behaviour, hook-outside-provider error, and a smoke
 * test on `useNumberFormat()`.
 *
 * @module shared/i18n
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from './locale-provider';
import { useTranslation } from './use-translation';
import { useNumberFormat } from './use-number-format';
import type { TranslationCatalog } from './i18n.types';

function TranslationProbe(): React.ReactElement {
  const { t, locale } = useTranslation();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="known-key">{t('greeting', 'Hello')}</span>
      <span data-testid="missing-key">{t('definitely.not.in.catalog', 'fallback-value')}</span>
    </div>
  );
}

function NumberFormatProbe({ value }: { value: number }): React.ReactElement {
  const formatter = useNumberFormat();
  return <span data-testid="formatted">{formatter.format(value)}</span>;
}

afterEach(() => cleanup());

describe('LocaleProvider', () => {
  it('defaults to en locale when no prop is provided', () => {
    render(
      <LocaleProvider>
        <TranslationProbe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('locale')).toHaveTextContent('en');
  });

  it('returns the fallback when the key is missing from an empty catalog', () => {
    render(
      <LocaleProvider>
        <TranslationProbe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('known-key')).toHaveTextContent('Hello');
    expect(screen.getByTestId('missing-key')).toHaveTextContent('fallback-value');
  });

  it('returns the catalog value when the key is present', () => {
    const catalog: TranslationCatalog = { greeting: 'Cześć' };
    render(
      <LocaleProvider locale="pl" catalog={catalog}>
        <TranslationProbe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('locale')).toHaveTextContent('pl');
    expect(screen.getByTestId('known-key')).toHaveTextContent('Cześć');
    // Missing key still falls back even with a non-empty catalog.
    expect(screen.getByTestId('missing-key')).toHaveTextContent('fallback-value');
  });

  it('throws when useTranslation is used outside the provider', () => {
    // Swallow the React error boundary noise that React logs.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    expect(() => render(<TranslationProbe />)).toThrow(/LocaleProvider/);
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
});
