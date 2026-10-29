/**
 * LanguageSwitch - unit tests
 *
 * Covers switching, the unavailable languages, keyboard use and the
 * no-provider fallback.
 *
 * @module shared/ui
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../i18n/locale-provider';
import { LanguageSwitch } from './language-switch';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderSwitch(): void {
  render(
    <LocaleProvider locale="en">
      <LanguageSwitch />
    </LocaleProvider>,
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
    expect(screen.getByRole('option', { name: /English/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('option', { name: /Polski/ }));
    expect(screen.getByRole('button', { name: 'Język: Polski' })).toBeInTheDocument();
  });

  it('should not switch to a language that has no catalog yet', () => {
    renderSwitch();
    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    const deutsch = screen.getByRole('option', { name: /Deutsch/ });
    expect(deutsch).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(deutsch);
    expect(screen.getByRole('button', { name: 'Language: English' })).toBeInTheDocument();
  });

  it('should pick with the keyboard and close on Escape', () => {
    renderSwitch();
    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Language: English' })).toHaveAttribute(
      'aria-expanded',
      'false',
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
});
