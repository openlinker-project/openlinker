import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
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

function renderToggle(): void {
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

function keyDown(element: HTMLElement, key: string): void {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
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
    renderToggle();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    const selected = radios.find((r) => r.getAttribute('aria-checked') === 'true');
    expect(selected?.textContent).toBe('System');

    restore();
  });

  it('exposes a roving tabindex — only the selected radio is in the tab order', () => {
    const { restore } = stubLightPreferred();
    renderToggle();

    const radios = screen.getAllByRole('radio');
    const tabIndices = radios.map((r) => r.getAttribute('tabindex'));
    expect(tabIndices.filter((t) => t === '0')).toHaveLength(1);
    expect(tabIndices.filter((t) => t === '-1')).toHaveLength(2);

    const selected = radios.find((r) => r.getAttribute('aria-checked') === 'true');
    expect(selected?.getAttribute('tabindex')).toBe('0');

    restore();
  });

  it('selecting Dark persists to localStorage and updates the selected radio', () => {
    const { restore } = stubLightPreferred();
    renderToggle();

    act(() => {
      screen.getByRole('radio', { name: 'Dark' }).click();
    });

    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    restore();
  });

  it('ArrowRight on the selected radio moves selection to the next option and focuses it', () => {
    const { restore } = stubLightPreferred();
    renderToggle();

    const system = screen.getByRole('radio', { name: 'System' });
    system.focus();
    act(() => keyDown(system, 'ArrowRight'));

    const light = screen.getByRole('radio', { name: 'Light' });
    expect(light.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(light);

    restore();
  });

  it('ArrowLeft wraps around to the last option', () => {
    const { restore } = stubLightPreferred();
    renderToggle();

    const system = screen.getByRole('radio', { name: 'System' });
    system.focus();
    act(() => keyDown(system, 'ArrowLeft'));

    const dark = screen.getByRole('radio', { name: 'Dark' });
    expect(dark.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(dark);

    restore();
  });

  it('Home jumps to the first option, End jumps to the last', () => {
    const { restore } = stubLightPreferred();
    renderToggle();

    const system = screen.getByRole('radio', { name: 'System' });
    system.focus();
    act(() => keyDown(system, 'Home'));
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true');

    const light = screen.getByRole('radio', { name: 'Light' });
    light.focus();
    act(() => keyDown(light, 'End'));
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true');

    restore();
  });

  it('survives a re-render under StrictMode + router ancestry (forward-guard for #461)', () => {
    // Forward-guard against the class of bug fixed in #461: the inline
    // `ref={(el) => { ... }}` pattern produces a fresh callback identity on
    // every render, which under React 19's stricter ref-cleanup contract
    // combined with merged-ref machinery (react-router-dom Link refs, Radix
    // DropdownMenu slots) repeatedly tears down and reattaches the ref —
    // dispatching state updates that trigger re-renders → infinite loop.
    //
    // The literal production crash requires the full Radix DropdownMenu
    // provider tree (where AppShell mounts ThemeToggle), which is too heavy
    // to reconstruct here — even with StrictMode + MemoryRouter + Link the
    // bug doesn't reproduce in jsdom. This test instead exercises the
    // broader path so any future refactor that re-introduces an unstable
    // per-option ref identity has at least one tripwire. The real
    // correctness guarantee comes from the useMemo-built stable callback
    // array in theme-toggle.tsx itself.
    const { restore } = stubLightPreferred();

    function Harness(): React.ReactElement {
      return (
        <StrictMode>
          <MemoryRouter>
            <ThemeProvider>
              <Link to="/">
                <ThemeToggle />
              </Link>
            </ThemeProvider>
          </MemoryRouter>
        </StrictMode>
      );
    }

    const { rerender } = render(<Harness />);
    expect(() => rerender(<Harness />)).not.toThrow();
    expect(screen.getAllByRole('radio')).toHaveLength(3);

    restore();
  });
});
