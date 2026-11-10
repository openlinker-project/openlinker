import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DescribedSelect, type DescribedSelectOption } from './described-select';

const OPTIONS: DescribedSelectOption<string>[] = [
  { value: 'a', title: 'As in settings: 0.01', description: 'Uses the default form.' },
  { value: 'b', title: 'Shown as 0.00', description: 'Needs a provider.', disabled: true, disabledReason: 'No provider accepts a zero line.' },
  { value: 'c', title: 'Omitted', description: 'Not on the document.' },
];

describe('DescribedSelect', () => {
  it('should show the chosen option in full on the trigger, title and description', () => {
    render(<DescribedSelect options={OPTIONS} value="a" onChange={vi.fn()} aria-label="Form" />);
    const trigger = screen.getByRole('button', { name: 'Form' });
    expect(trigger).toHaveTextContent('As in settings: 0.01');
    expect(trigger).toHaveTextContent('Uses the default form.');
  });

  it('should list every option with its description and report the chosen one', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DescribedSelect options={OPTIONS} value="a" onChange={onChange} aria-label="Form" />);
    await user.click(screen.getByRole('button', { name: 'Form' }));
    const list = await screen.findByRole('listbox');
    expect(list).toHaveTextContent('Not on the document.');
    await user.click(screen.getByRole('option', { name: /Omitted/ }));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('should explain a disabled option in place of its description and not choose it', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DescribedSelect options={OPTIONS} value="a" onChange={onChange} aria-label="Form" />);
    await user.click(screen.getByRole('button', { name: 'Form' }));
    const disabled = await screen.findByRole('option', { name: /Shown as 0.00/ });
    expect(disabled).toHaveTextContent('No provider accepts a zero line.');
    await user.click(disabled);
    expect(onChange).not.toHaveBeenCalled();
  });
});
