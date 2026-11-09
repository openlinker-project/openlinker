/**
 * OptionList tests (#4029)
 *
 * @module shared/ui
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptionList, type OptionListItem } from './option-list';

afterEach(cleanup);

const OPTIONS: OptionListItem<'a' | 'b' | 'c'>[] = [
  { value: 'a', label: 'Alpha', meta: 'A' },
  { value: 'b', label: 'Beta', badge: <span>New</span> },
  { value: 'c', label: 'Gamma' },
];

function renderList(
  onSelect = vi.fn(),
  onDismiss = vi.fn()
): { onSelect: typeof onSelect; onDismiss: typeof onDismiss } {
  render(
    <OptionList
      options={OPTIONS}
      value="b"
      onSelect={onSelect}
      onDismiss={onDismiss}
      aria-label="Pick"
      autoFocus={false}
    />
  );
  return { onSelect, onDismiss };
}

describe('OptionList', () => {
  it('should mark the chosen option and start the highlight on it', () => {
    renderList();
    const list = screen.getByRole('listbox', { name: 'Pick' });
    const beta = screen.getByRole('option', { name: /Beta/ });
    expect(beta).toHaveAttribute('aria-selected', 'true');
    expect(list).toHaveAttribute('aria-activedescendant', beta.id);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('should move with arrows (wrapping) and Home/End, and choose with Enter', () => {
    const { onSelect } = renderList();
    const list = screen.getByRole('listbox');
    const id = (name: RegExp): string => screen.getByRole('option', { name }).id;
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(list).toHaveAttribute('aria-activedescendant', id(/Gamma/));
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(list).toHaveAttribute('aria-activedescendant', id(/Alpha/));
    fireEvent.keyDown(list, { key: 'End' });
    expect(list).toHaveAttribute('aria-activedescendant', id(/Gamma/));
    fireEvent.keyDown(list, { key: 'Home' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('should choose on click and dismiss on Escape and Tab', () => {
    const { onSelect, onDismiss } = renderList();
    fireEvent.click(screen.getByRole('option', { name: /Gamma/ }));
    expect(onSelect).toHaveBeenCalledWith('c');
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(fireEvent.keyDown(list, { key: 'Tab' })).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
