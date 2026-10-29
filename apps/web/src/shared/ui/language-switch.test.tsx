/**
 * LanguageSwitch - unit tests
 *
 * Covers switching, the unavailable languages, keyboard use and the
 * no-provider fallback.
 *
 * @module shared/ui
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfigContext } from 'motion/react';
import { useContext, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../i18n/locale-provider';
import { LOCALE_STORAGE_KEY } from '../i18n/resolve-locale';
import { AccessDeniedState } from './feedback-state';
import { BulkActionBar } from './bulk-action-bar';
import { LanguageSwitch } from './language-switch';
import { MotionProvider } from './motion-provider';

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
      </LocaleProvider>,
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

  it('should skip the unavailable languages with the arrow keys', () => {
    renderSwitch();
    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    const list = screen.getByRole('listbox');
    const polski = screen.getByRole('option', { name: /Polski/ });
    const english = screen.getByRole('option', { name: /English/ });
    // Down from English passes the four "Soon" languages and wraps to Polski.
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(list).toHaveAttribute('aria-activedescendant', polski.id);
    // Up from Polski wraps past them back to English.
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(list).toHaveAttribute('aria-activedescendant', english.id);
  });
});

describe('MotionProvider', () => {
  function ReducedMotionProbe(): ReactElement {
    return <span data-testid="reduced">{useContext(MotionConfigContext).reducedMotion}</span>;
  }

  it('should make every animation follow the reduced-motion setting', () => {
    render(
      <MotionProvider>
        <ReducedMotionProbe />
      </MotionProvider>,
    );
    expect(screen.getByTestId('reduced')).toHaveTextContent('user');
  });
});

describe('shared primitives in Polish', () => {
  it('should pluralise the bulk selection label when the locale is pl', () => {
    const { rerender } = render(
      <LocaleProvider locale="pl">
        <BulkActionBar count={2} actions={null} />
      </LocaleProvider>,
    );
    expect(screen.getByText('zaznaczone')).toBeInTheDocument();
    rerender(
      <LocaleProvider locale="pl">
        <BulkActionBar count={5} actions={null} />
      </LocaleProvider>,
    );
    expect(screen.getByText('zaznaczonych')).toBeInTheDocument();
  });

  it('should render the access-denied defaults in Polish when the locale is pl', () => {
    render(
      <LocaleProvider locale="pl">
        <AccessDeniedState />
      </LocaleProvider>,
    );
    expect(screen.getByText('Brak dostępu')).toBeInTheDocument();
  });
});
