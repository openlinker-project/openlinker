/**
 * Combobox Tests
 *
 * Covers single + multi selection, custom-value passthrough, filter-first
 * gating, keyboard navigation, and ARIA combobox semantics.
 *
 * @module shared/ui
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Combobox, type ComboboxOption, type ComboboxValue } from './combobox';

const SHORT_OPTIONS: ComboboxOption[] = [
  { id: 'a1', label: 'Adidas', hint: '#a1' },
  { id: 'a2', label: 'Apple', hint: '#a2' },
  { id: 'n1', label: 'Nike', hint: '#n1' },
  { id: 'p1', label: 'Puma', hint: '#p1' },
];

const LARGE_OPTIONS: ComboboxOption[] = Array.from({ length: 60 }, (_, i) => ({
  id: `id-${i}`,
  label: `Brand ${i.toString().padStart(2, '0')}`,
}));

function ControlledCombobox(props: {
  initial?: ComboboxValue | null;
  options?: ComboboxOption[];
  mode?: 'single' | 'multi';
  allowCustomValues?: boolean;
  onChangeSpy?: (next: ComboboxValue | null) => void;
}): React.ReactElement {
  const [value, setValue] = React.useState<ComboboxValue | null>(props.initial ?? null);
  return (
    <Combobox
      options={props.options ?? SHORT_OPTIONS}
      value={value}
      onChange={(next) => {
        setValue(next);
        props.onChangeSpy?.(next);
      }}
      mode={props.mode}
      allowCustomValues={props.allowCustomValues}
      ariaLabel="Brand"
      placeholder="Select brand"
    />
  );
}

describe('Combobox', () => {
  afterEach(cleanup);

  it('renders trigger with role=combobox and ARIA wiring', () => {
    render(<ControlledCombobox />);
    const trigger = screen.getByRole('combobox', { name: 'Brand' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-autocomplete', 'list');
  });

  it('opens listbox on trigger click and renders all options below the filter-first threshold', async () => {
    const user = userEvent.setup();
    render(<ControlledCombobox />);
    await user.click(screen.getByRole('combobox', { name: 'Brand' }));

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    for (const opt of SHORT_OPTIONS) {
      expect(screen.getByText(opt.label)).toBeInTheDocument();
    }
  });

  it('commits a single dictionary selection and closes the panel', async () => {
    const onChangeSpy = vi.fn();
    const user = userEvent.setup();
    render(<ControlledCombobox onChangeSpy={onChangeSpy} />);

    await user.click(screen.getByRole('combobox', { name: 'Brand' }));
    await user.click(screen.getByText('Adidas'));

    expect(onChangeSpy).toHaveBeenLastCalledWith({ kind: 'dictionary', ids: ['a1'] });
  });

  it('toggles multi selection without closing the panel', async () => {
    const onChangeSpy = vi.fn();
    const user = userEvent.setup();
    render(<ControlledCombobox mode="multi" onChangeSpy={onChangeSpy} />);

    await user.click(screen.getByRole('combobox', { name: 'Brand' }));
    await user.click(screen.getByText('Adidas'));
    await user.click(screen.getByText('Nike'));

    expect(onChangeSpy.mock.calls.at(-1)?.[0]).toEqual({ kind: 'dictionary', ids: ['a1', 'n1'] });
    // Listbox stays open in multi mode
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('shows the filter-first prompt and no options until the user types when over the threshold', async () => {
    const user = userEvent.setup();
    render(<ControlledCombobox options={LARGE_OPTIONS} />);
    await user.click(screen.getByRole('combobox', { name: 'Brand' }));

    expect(screen.getByText(/Type to search 60 options\./)).toBeInTheDocument();
    expect(screen.queryByText('Brand 00')).toBeNull();

    await user.type(screen.getByPlaceholderText(/Type to search/i), 'Brand 03');
    expect(screen.getByText('Brand 03')).toBeInTheDocument();
  });

  it('emits a custom-value commit when allowCustomValues=true and the typed text has no exact match', async () => {
    const onChangeSpy = vi.fn();
    const user = userEvent.setup();
    render(<ControlledCombobox allowCustomValues onChangeSpy={onChangeSpy} />);

    await user.click(screen.getByRole('combobox', { name: 'Brand' }));
    await user.type(
      screen.getByPlaceholderText(/Type to search or enter a custom value/i),
      'AcmeCorp',
    );

    // Custom row appears and is selectable
    const customRow = screen.getByText('AcmeCorp');
    await user.click(customRow);

    expect(onChangeSpy).toHaveBeenLastCalledWith({ kind: 'custom', text: 'AcmeCorp' });
  });

  it('renders the trigger summary for a dictionary selection', () => {
    render(<ControlledCombobox initial={{ kind: 'dictionary', ids: ['a1'] }} />);
    expect(screen.getByRole('combobox', { name: 'Brand' })).toHaveTextContent('Adidas');
  });

  it('renders custom-value chip differentiation in the trigger', () => {
    render(<ControlledCombobox initial={{ kind: 'custom', text: 'AcmeCorp' }} />);
    const trigger = screen.getByRole('combobox', { name: 'Brand' });
    expect(trigger).toHaveTextContent('AcmeCorp');
    expect(trigger.querySelector('.combobox__custom-value')).not.toBeNull();
  });

  it('supports keyboard navigation and Enter to commit', async () => {
    const onChangeSpy = vi.fn();
    const user = userEvent.setup();
    render(<ControlledCombobox onChangeSpy={onChangeSpy} />);

    await user.click(screen.getByRole('combobox', { name: 'Brand' }));
    const search = screen.getByPlaceholderText(/Type to filter/i);
    await user.click(search);
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onChangeSpy).toHaveBeenLastCalledWith({ kind: 'dictionary', ids: ['n1'] });
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<ControlledCombobox />);
    await user.click(screen.getByRole('combobox', { name: 'Brand' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('forwards ref to the trigger button', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(
      <Combobox
        ref={ref}
        options={SHORT_OPTIONS}
        value={null}
        onChange={() => undefined}
        ariaLabel="Brand"
      />,
    );
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('marks the trigger as aria-invalid when invalid prop is set', () => {
    render(
      <Combobox
        options={SHORT_OPTIONS}
        value={null}
        onChange={() => undefined}
        ariaLabel="Brand"
        invalid
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Brand' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('renders disabled options with line-through and skips commit', async () => {
    const onChangeSpy = vi.fn();
    const user = userEvent.setup();
    render(
      <Combobox
        options={[
          { id: 'a1', label: 'Adidas' },
          { id: 'n1', label: 'Nike', disabled: true, disabledReason: 'Filtered out' },
        ]}
        value={null}
        onChange={onChangeSpy}
        ariaLabel="Brand"
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Brand' }));
    const disabledRow = screen.getByText('Nike').closest('[role="option"]');
    expect(disabledRow).toHaveAttribute('aria-disabled', 'true');

    await user.click(screen.getByText('Nike'));
    expect(onChangeSpy).not.toHaveBeenCalled();
  });
});
