/**
 * FontSizeToggle tests (#4261)
 *
 * @module shared/ui
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { FontSizeToggle } from './font-size-toggle';

const STORAGE_KEY = 'openlinker-font-size';

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.fontSize;
});

afterEach(cleanup);

const checkedName = (): string | null =>
  screen
    .getAllByRole('radio')
    .find((radio) => radio.getAttribute('aria-checked') === 'true')
    ?.getAttribute('aria-label') ?? null;

describe('FontSizeToggle', () => {
  it('should be a radio group of four sizes with Default chosen when nothing is stored', () => {
    renderWithProviders(<FontSizeToggle />);
    expect(screen.getByRole('radiogroup', { name: 'Text size' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(checkedName()).toBe('Default');
    expect(document.documentElement.dataset.fontSize).toBe('m');
  });

  it('should apply, persist and re-read the chosen size', () => {
    const first = renderWithProviders(<FontSizeToggle />);
    fireEvent.click(screen.getByRole('radio', { name: 'Large' }));
    expect(document.documentElement.dataset.fontSize).toBe('l');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('l');
    first.unmount();

    renderWithProviders(<FontSizeToggle />);
    expect(checkedName()).toBe('Large');
  });

  it('should fall back to Default when the stored value is not a known size', () => {
    window.localStorage.setItem(STORAGE_KEY, 'huge');
    renderWithProviders(<FontSizeToggle />);
    expect(checkedName()).toBe('Default');
    expect(document.documentElement.dataset.fontSize).toBe('m');
  });

  it('should keep a single tab stop on the chosen size', () => {
    renderWithProviders(<FontSizeToggle />);
    const stops = screen.getAllByRole('radio').filter((radio) => radio.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAttribute('aria-label', 'Default');
  });

  it('should move the selection with arrows (wrapping) and Home/End', () => {
    renderWithProviders(<FontSizeToggle />);
    const group = screen.getByRole('radiogroup');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(checkedName()).toBe('Large');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(checkedName()).toBe('Largest');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(checkedName()).toBe('Small');
    fireEvent.keyDown(group, { key: 'End' });
    expect(checkedName()).toBe('Largest');
    fireEvent.keyDown(group, { key: 'Home' });
    expect(checkedName()).toBe('Small');
    expect(document.documentElement.dataset.fontSize).toBe('s');
  });

  it('should slide the thumb by option index instead of measuring', () => {
    const { container } = renderWithProviders(<FontSizeToggle />);
    const thumb = container.querySelector<HTMLElement>('.segmented-switch__thumb--slide');
    expect(thumb).not.toBeNull();
    expect(thumb?.style.getPropertyValue('--seg-index')).toBe('1');
    expect(thumb?.style.getPropertyValue('--seg-count')).toBe('4');
    fireEvent.click(screen.getByRole('radio', { name: 'Largest' }));
    expect(thumb?.style.getPropertyValue('--seg-index')).toBe('3');
  });
});
