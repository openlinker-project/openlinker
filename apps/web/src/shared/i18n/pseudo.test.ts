/**
 * Pseudo-localization - unit tests
 *
 * @module shared/i18n
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { defineCopy } from './define-copy';
import { LocaleProvider } from './locale-provider';
import { pseudoLocalize } from './pseudo';
import { clearPseudoRequested, readPseudoRequested } from './resolve-locale';
import { useCopy } from './use-copy';
import { useLocale } from './use-locale';

afterEach(() => {
  clearPseudoRequested();
  window.history.replaceState({}, '', '/');
});

describe('pseudoLocalize', () => {
  it('should accent letters, lengthen the text and bracket it', () => {
    const out = pseudoLocalize('Save changes');
    expect(out.startsWith('[Šávé çháñgéš')).toBe(true);
    expect(out.endsWith(']')).toBe(true);
    expect(out.length).toBeGreaterThan('Save changes'.length * 1.3);
  });

  it('should leave placeholders and tags intact', () => {
    const out = pseudoLocalize('Read <link>the guide</link> for {name}');
    expect(out).toContain('<link>');
    expect(out).toContain('</link>');
    expect(out).toContain('{name}');
  });
});

describe('readPseudoRequested', () => {
  it('should never turn on in a production build', () => {
    expect(readPseudoRequested('?lang=xx', false)).toBe(false);
  });

  it('should stay on for the session once asked for in development', () => {
    expect(readPseudoRequested('?lang=xx', true)).toBe(true);
    expect(readPseudoRequested('', true)).toBe(true);
  });

  it('should turn off when another language is asked for', () => {
    readPseudoRequested('?lang=xx', true);
    expect(readPseudoRequested('?lang=pl', true)).toBe(false);
    expect(readPseudoRequested('', true)).toBe(false);
  });
});

const probeCopy = defineCopy({ en: { title: 'Orders' }, pl: { title: 'Zamówienia' } });

function Probe(): ReactElement {
  const { setLocale } = useLocale();
  const copy = useCopy(probeCopy);
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'title' }, copy.title),
    createElement('button', { type: 'button', onClick: () => setLocale('en') }, 'pick'),
  );
}

describe('pseudo-language in the provider', () => {
  it('should mark <html> and stretch copy when ?lang=xx is used in development', () => {
    window.history.replaceState({}, '', '/?lang=xx');
    render(createElement(LocaleProvider, null, createElement(Probe)));
    expect(document.documentElement.dataset.pseudoLocale).toBe('true');
    expect(screen.getByTestId('title').textContent).toMatch(/^\[.*\]$/);
  });

  it('should remove the <html> marker when the provider unmounts', () => {
    window.history.replaceState({}, '', '/?lang=xx');
    const { unmount } = render(createElement(LocaleProvider, null, createElement(Probe)));
    expect(document.documentElement.dataset.pseudoLocale).toBe('true');
    unmount();
    expect(document.documentElement.dataset.pseudoLocale).toBeUndefined();
  });

  it('should end the pseudo-language when a real language is picked', () => {
    window.history.replaceState({}, '', '/?lang=xx');
    render(createElement(LocaleProvider, null, createElement(Probe)));
    fireEvent.click(screen.getByRole('button', { name: 'pick' }));
    expect(screen.getByTestId('title')).toHaveTextContent('Orders');
    expect(document.documentElement.dataset.pseudoLocale).toBeUndefined();
    expect(readPseudoRequested('', true)).toBe(false);
  });

  it('should ignore ?lang=xx when the provider is pinned', () => {
    window.history.replaceState({}, '', '/?lang=xx');
    render(createElement(LocaleProvider, { locale: 'en' }, createElement(Probe)));
    expect(screen.getByTestId('title')).toHaveTextContent('Orders');
  });
});
