import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckboxCell } from './checkbox-cell';

describe('CheckboxCell', () => {
  it('renders checked for the "all" state', () => {
    render(<CheckboxCell state="all" onToggle={() => {}} ariaLabel="Select all" />);
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toBeChecked();
  });

  it('renders the indeterminate DOM property for the "some" state', () => {
    render(<CheckboxCell state="some" onToggle={() => {}} ariaLabel="Some selected" />);
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Some selected' });
    expect(box.indeterminate).toBe(true);
    expect(box.checked).toBe(false);
  });

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<CheckboxCell state="none" onToggle={onToggle} ariaLabel="Select row" />);
    await user.click(screen.getByRole('checkbox', { name: 'Select row' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not fire onToggle when disabled', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<CheckboxCell state="none" disabled onToggle={onToggle} ariaLabel="Disabled row" tooltip="Max reached" />);
    const box = screen.getByRole('checkbox', { name: 'Disabled row' });
    expect(box).toBeDisabled();
    await user.click(box);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
