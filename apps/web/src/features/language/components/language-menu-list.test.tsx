/**
 * LanguageMenuList - unit tests
 *
 * The language list the account menu renders (#4021): the same rows as the
 * popover, switching by click and by keyboard, the no-op click, the
 * no-provider fallback and focus after the remount a change causes.
 *
 * @module features/language/components
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleKeyed } from '../../../shared/i18n/locale-keyed';
import { LocaleProvider } from '../../../shared/i18n/locale-provider';
import { LOCALE_STORAGE_KEY } from '../../../shared/i18n/resolve-locale';
import { LanguageMenuList, restoreFocusAfterLanguageChange } from './language-switch';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.lang = '';
});

describe('LanguageMenuList (#4021)', () => {
  function renderList(): void {
    render(
      <LocaleProvider>
        <LanguageMenuList />
      </LocaleProvider>,
    );
  }

  it('should list every language with the current one selected', () => {
    renderList();
    const list = screen.getByRole('listbox', { name: 'Language' });
    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.getAttribute('lang'))).toEqual(['pl', 'en']);
    expect(screen.getByRole('option', { name: /English/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /Polski/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('should show the language code and the Beta badge like the popover', () => {
    renderList();
    const polish = screen.getByRole('option', { name: /Polski/ });
    expect(within(polish).getByText('PL')).toBeInTheDocument();
    expect(within(polish).getByText('Beta')).toBeInTheDocument();
  });

  it('should switch and save the language on click', () => {
    renderList();
    fireEvent.click(screen.getByRole('option', { name: /Polski/ }));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pl');
    expect(document.documentElement.lang).toBe('pl-PL');
  });

  it('should switch with the keyboard and keep the keys from the surrounding menu', () => {
    let bubbled = 0;
    render(
      <LocaleProvider>
        <div onKeyDown={() => (bubbled += 1)}>
          <LanguageMenuList />
        </div>
      </LocaleProvider>,
    );
    const list = screen.getByRole('listbox', { name: 'Language' });
    fireEvent.keyDown(list, { key: 'Home' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pl');
    expect(bubbled).toBe(0);
  });

  it('should not store anything when the current language is clicked', () => {
    renderList();
    fireEvent.click(screen.getByRole('option', { name: /English/ }));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('should render nothing outside a LocaleProvider', () => {
    const { container } = render(<LanguageMenuList />);
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
          <LanguageMenuList />
        </LocaleKeyed>
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole('option', { name: /Polski/ }));
    await screen.findByRole('listbox', { name: 'Język' });
    expect(screen.getByRole('button', { name: 'account' })).toHaveFocus();
  });
});
