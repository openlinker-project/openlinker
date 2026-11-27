/**
 * ThemeSwitch tests (#4029)
 *
 * @module features/appearance/components
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../../../shared/i18n';
import { ThemeProvider } from '../../../shared/theme';
import { ThemeSwitch } from './theme-switch';

function renderSwitch(): void {
  render(
    <LocaleProvider locale="en">
      <ThemeProvider>
        <ThemeSwitch />
      </ThemeProvider>
    </LocaleProvider>
  );
}

describe('ThemeSwitch', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('should render nothing outside a ThemeProvider', () => {
    const { container } = render(
      <LocaleProvider locale="en">
        <ThemeSwitch />
      </LocaleProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('should name the active theme on the trigger', () => {
    renderSwitch();
    expect(screen.getByRole('button', { name: 'Theme: Auto' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('should open a switch of the three themes and apply the chosen one, staying open', () => {
    renderSwitch();
    fireEvent.click(screen.getByRole('button', { name: 'Theme: Auto' }));
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['Light', 'Dark', 'Auto']);
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('should name the three modes only while the switch is pointed at', () => {
    renderSwitch();
    fireEvent.click(screen.getByRole('button', { name: 'Theme: Auto' }));
    expect(document.querySelector('.segmented-switch__caption')).toBeNull();
    fireEvent.pointerEnter(screen.getByRole('radio', { name: 'Dark' }));
    const names = [...document.querySelectorAll('.segmented-switch__name')].map(
      (n) => n.textContent
    );
    expect(names).toEqual(['Light', 'Dark', 'Auto']);
  });

  it('should move the choice with the arrow keys', () => {
    renderSwitch();
    fireEvent.click(screen.getByRole('button', { name: 'Theme: Auto' }));
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
  });

  it('should close on Escape', () => {
    renderSwitch();
    fireEvent.click(screen.getByRole('button', { name: 'Theme: Auto' }));
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Theme: Auto' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });
});
