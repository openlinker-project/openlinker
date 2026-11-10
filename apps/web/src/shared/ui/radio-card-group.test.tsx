/**
 * RadioCardGroup tests (#3935)
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RadioCardGroup } from './radio-card-group';

afterEach(cleanup);

describe('RadioCardGroup', () => {
  const options = [
    { value: 'a', title: 'Alpha', description: 'First', preview: <span>preview-a</span> },
    { value: 'b', title: 'Beta', description: 'Second', panel: <span>beta-panel</span> },
    { value: 'c', title: 'Gamma', description: 'Third', disabled: true, disabledReason: 'Not offered here' },
  ] as const;

  it('should select the card whose radio is chosen and report the change', () => {
    const onChange = vi.fn();
    render(<RadioCardGroup name="g" aria-label="Choice" value="a" onChange={onChange} options={options} />);

    expect(screen.getByRole('radio', { name: /Alpha/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Beta/ }));

    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('should open a card panel only for the selected card', () => {
    render(<RadioCardGroup name="g" aria-label="Choice" value="b" onChange={vi.fn()} options={options} />);

    expect(screen.getByText('beta-panel').closest('.pm-doccard__amt')).toHaveClass('is-open');
  });

  it('should disable every card when the group is read-only', () => {
    render(<RadioCardGroup name="g" aria-label="Choice" value="a" onChange={vi.fn()} options={options} disabled />);

    expect(screen.getByRole('radio', { name: /Alpha/ })).toBeDisabled();
  });

  it('should not report a disabled card as chosen', () => {
    const onChange = vi.fn();
    render(<RadioCardGroup name="g" aria-label="Choice" value="a" onChange={onChange} options={options} />);

    fireEvent.click(screen.getByText('Gamma'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should say why a card is disabled instead of hiding it', () => {
    render(<RadioCardGroup name="g" aria-label="Choice" value="a" onChange={vi.fn()} options={options} />);

    expect(screen.getByRole('radio', { name: /Gamma/ })).toBeDisabled();
    expect(screen.getByText('Not offered here')).toBeInTheDocument();
  });
});
