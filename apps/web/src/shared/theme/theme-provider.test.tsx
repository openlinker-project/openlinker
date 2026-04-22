import { cleanup, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './theme-provider';
import { useTheme } from './use-theme';
import { THEME_STORAGE_KEY } from './theme.types';

function Probe(): React.ReactElement {
  const { theme, effectiveTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="effective">{effectiveTheme}</span>
      <button type="button" onClick={() => setTheme('dark')}>
        set-dark
      </button>
      <button type="button" onClick={() => setTheme('light')}>
        set-light
      </button>
      <button type="button" onClick={() => setTheme('system')}>
        set-system
      </button>
    </div>
  );
}

interface MatchMediaStub {
  matches: boolean;
  listeners: Array<(event: MediaQueryListEvent) => void>;
}

function stubMatchMedia(darkPreferred: boolean): {
  stub: MatchMediaStub;
  restore: () => void;
} {
  const stub: MatchMediaStub = { matches: darkPreferred, listeners: [] };
  const spy = vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: stub.matches,
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: (ev: MediaQueryListEvent) => void) => {
          stub.listeners.push(listener);
        },
        removeEventListener: (_type: string, listener: (ev: MediaQueryListEvent) => void) => {
          stub.listeners = stub.listeners.filter((l) => l !== listener);
        },
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
  return { stub, restore: () => spy.mockRestore() };
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('defaults to system theme and resolves to light when prefers-color-scheme is light', () => {
    const { restore } = stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme').textContent).toBe('system');
    expect(screen.getByTestId('effective').textContent).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    restore();
  });

  it('persists explicit choices to localStorage and applies them on the root element', () => {
    const { restore } = stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    act(() => {
      screen.getByText('set-dark').click();
    });

    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(screen.getByTestId('effective').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    act(() => {
      screen.getByText('set-system').click();
    });

    expect(screen.getByTestId('theme').textContent).toBe('system');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();

    restore();
  });

  it('follows system preference changes when theme is system', () => {
    const { stub, restore } = stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('effective').textContent).toBe('light');

    act(() => {
      stub.matches = true;
      stub.listeners.forEach((listener) =>
        listener({ matches: true, media: '(prefers-color-scheme: dark)' } as MediaQueryListEvent),
      );
    });

    expect(screen.getByTestId('effective').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    restore();
  });
});
