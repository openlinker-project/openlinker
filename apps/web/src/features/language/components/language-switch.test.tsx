/**
 * LanguageSwitch - unit tests
 *
 * Covers switching, the listed languages, keyboard use, focus after the
 * remount a language change causes, and the no-provider fallback.
 *
 * @module features/language/components
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleKeyed } from '../../../shared/i18n/locale-keyed';
import { LocaleProvider } from '../../../shared/i18n/locale-provider';
import { LOCALE_STORAGE_KEY } from '../../../shared/i18n/resolve-locale';
import { LanguageSwitch } from './language-switch';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.lang = '';
});

function renderSwitch(): void {
  render(
    <LocaleProvider locale="en">
      <LanguageSwitch />
    </LocaleProvider>
  );
}

describe('LanguageSwitch', () => {
  it('should name the current language on the trigger', () => {
    renderSwitch();
    expect(screen.getByRole('button', { name: 'Language: English' })).toBeInTheDocument();
  });

  it('should list every language with its native name and switch on click', () => {
    renderSwitch();
    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    expect(screen.getByRole('option', { name: /Polski/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /English/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    fireEvent.click(screen.getByRole('option', { name: /Polski/ }));
    expect(screen.getByRole('button', { name: 'Język: Polski' })).toBeInTheDocument();
  });

  it('should list only the languages the app ships', () => {
    renderSwitch();
    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('lang'))).toEqual(['pl', 'en']);
  });

  it('should pick with the keyboard and close on Escape', () => {
    renderSwitch();
    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Language: English' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Język: Polski' })).toBeInTheDocument();
  });

  it('should render nothing outside a LocaleProvider', () => {
    const { container } = render(<LanguageSwitch />);
    expect(container).toBeEmptyDOMElement();
  });

  it('should return focus to the trigger when Escape closes the list', () => {
    renderSwitch();
    const trigger = screen.getByRole('button', { name: 'Language: English' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });

  it('should save the choice and update <html lang> when not pinned', () => {
    render(
      <LocaleProvider>
        <LanguageSwitch />
      </LocaleProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    fireEvent.click(screen.getByRole('option', { name: /Polski/ }));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pl');
    expect(document.documentElement.lang).toBe('pl-PL');
  });

  it('should point aria-activedescendant at the current language when the list opens', () => {
    renderSwitch();
    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    const list = screen.getByRole('listbox');
    const english = screen.getByRole('option', { name: /English/ });
    expect(list).toHaveAttribute('aria-activedescendant', english.id);
  });

  it('should wrap around the list with the arrow keys', () => {
    renderSwitch();
    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    const list = screen.getByRole('listbox');
    const polski = screen.getByRole('option', { name: /Polski/ });
    const english = screen.getByRole('option', { name: /English/ });
    // Down from the last language wraps to the first, and up goes back.
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(list).toHaveAttribute('aria-activedescendant', polski.id);
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(list).toHaveAttribute('aria-activedescendant', english.id);
  });

  it('should keep keyboard focus on the switch when the language change remounts the tree', async () => {
    render(
      <LocaleProvider>
        <LocaleKeyed>
          <LanguageSwitch />
        </LocaleKeyed>
      </LocaleProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    fireEvent.click(screen.getByRole('option', { name: /Polski/ }));
    const trigger = await screen.findByRole('button', { name: 'Język: Polski' });
    expect(trigger).toHaveFocus();
  });

  it('should close the list and return focus to the trigger on Tab', () => {
    renderSwitch();
    const trigger = screen.getByRole('button', { name: 'Language: English' });
    fireEvent.click(trigger);
    const notPrevented = fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Tab' });
    expect(notPrevented).toBe(false);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('should not write the choice to storage when the provider is pinned', () => {
    renderSwitch();
    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    fireEvent.click(screen.getByRole('option', { name: /Polski/ }));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });
});
