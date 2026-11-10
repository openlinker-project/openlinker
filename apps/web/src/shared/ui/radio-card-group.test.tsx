import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RadioCardGroup } from './radio-card-group';

const options = [
  { value: 'a', title: 'Alpha', description: 'First one' },
  { value: 'b', title: 'Beta', disabled: true, reason: 'Not here' },
] as const;

describe('RadioCardGroup', () => {
  afterEach(cleanup);

  it('should select a card and report it', async () => {
    const onChange = vi.fn();
    render(<RadioCardGroup name="x" value={null} onChange={onChange} options={options} aria-label="Pick" />);
    await userEvent.click(screen.getByRole('radio', { name: /Alpha/ }));
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('should keep a disabled card visible with its reason and refuse it', async () => {
    const onChange = vi.fn();
    render(<RadioCardGroup name="x" value="a" onChange={onChange} options={options} aria-label="Pick" />);
    expect(screen.getByText('Not here')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Beta/ })).toBeDisabled();
    await userEvent.click(screen.getByText('Beta'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('should disable every card when the group is read-only', () => {
    render(<RadioCardGroup name="x" value="a" onChange={vi.fn()} options={options} aria-label="Pick" disabled />);
    expect(screen.getByRole('radio', { name: /Alpha/ })).toBeDisabled();
  });
});
