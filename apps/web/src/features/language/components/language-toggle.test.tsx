/**
 * LanguageToggle - unit tests
 *
 * The inline radio group the account menu renders (#4021): the listed
 * languages, the tab order, switching by click and arrow keys, the no-op click,
 * the no-provider fallback and focus after the remount a change causes.
 *
 * @module features/language/components
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleKeyed } from '../../../shared/i18n/locale-keyed';
import { LocaleProvider } from '../../../shared/i18n/locale-provider';
import { LOCALE_STORAGE_KEY } from '../../../shared/i18n/resolve-locale';
import { LanguageToggle, restoreFocusAfterLanguageChange } from './language-switch';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.lang = '';
});

describe('LanguageToggle (#4021)', () => {
  function renderToggle(): void {
    render(
      <LocaleProvider>
        <LanguageToggle />
      </LocaleProvider>,
    );
  }

  it('should list every language as a radio with the current one checked', () => {
    renderToggle();
    const group = screen.getByRole('radiogroup', { name: 'Language' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('lang'))).toEqual(['pl', 'en']);
    expect(screen.getByRole('radio', { name: /English/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Polski/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('should keep only the checked language in the tab order', () => {
    renderToggle();
    expect(screen.getByRole('radio', { name: /English/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: /Polski/ })).toHaveAttribute('tabindex', '-1');
  });

  it('should switch and save the language on click', () => {
    renderToggle();
    fireEvent.click(screen.getByRole('radio', { name: /Polski/ }));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pl');
    expect(document.documentElement.lang).toBe('pl-PL');
  });

  it('should switch with the arrow keys', () => {
    renderToggle();
    fireEvent.keyDown(screen.getByRole('radio', { name: /English/ }), { key: 'ArrowLeft' });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pl');
  });

  it('should not store anything when the current language is clicked', () => {
    renderToggle();
    fireEvent.click(screen.getByRole('radio', { name: /English/ }));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('should render nothing outside a LocaleProvider', () => {
    const { container } = render(<LanguageToggle />);
    expect(container).toBeEmptyDOMElement();
  });

  it('should hand focus to the menu trigger when the language change remounts the tree', async () => {
    function MenuTrigger(): ReactElement {
      const ref = useRef<HTMLButtonElement>(null);
      useEffect(() => {
        restoreFocusAfterLanguageChange(ref.current);
      }, []);
      return (
        <button ref={ref} type="button">
          account
        </button>
      );
    }
    render(
      <LocaleProvider>
        <LocaleKeyed>
          <MenuTrigger />
          <LanguageToggle />
        </LocaleKeyed>
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Polski/ }));
    await screen.findByRole('radiogroup', { name: 'Język' });
    expect(screen.getByRole('button', { name: 'account' })).toHaveFocus();
  });
});
