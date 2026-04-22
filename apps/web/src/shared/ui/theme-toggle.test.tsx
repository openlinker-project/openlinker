import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../theme/theme-provider';
import { THEME_STORAGE_KEY } from '../theme/theme.types';
import { ThemeToggle } from './theme-toggle';

function stubLightPreferred(): { restore: () => void } {
  const spy = vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
  return { restore: () => spy.mockRestore() };
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders three radios with System selected by default', () => {
    const { restore } = stubLightPreferred();
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    const selected = radios.find((r) => r.getAttribute('aria-checked') === 'true');
    expect(selected?.textContent).toBe('System');

    restore();
  });

  it('selecting Dark persists to localStorage and updates the selected radio', () => {
    const { restore } = stubLightPreferred();
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    act(() => {
      screen.getByRole('radio', { name: 'Dark' }).click();
    });

    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    restore();
  });
});
