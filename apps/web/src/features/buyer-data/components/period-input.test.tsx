/**
 * PeriodInput tests (#4289)
 *
 * "Never" clears the figure but leaves the fields editable: typing a number
 * turns "never" off and reports the period, rather than the operator having to
 * untick the box first.
 */
import { useState, type ReactElement } from 'react';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { PeriodInput } from './period-input';

function Harness({ initial, spy }: { initial: number; spy: (days: number) => void }): ReactElement {
  const [days, setDays] = useState(initial);
  return (
    <PeriodInput
      name="hide"
      label="Ukryj po"
      neverLabel="Nigdy"
      days={days}
      onChange={(next) => {
        spy(next);
        setDays(next);
      }}
    />
  );
}

describe('PeriodInput', () => {
  afterEach(cleanup);

  it('should keep the fields editable and empty when never is ticked', () => {
    renderWithProviders(<Harness initial={0} spy={vi.fn()} />);

    const amount = screen.getByRole('spinbutton');
    expect(amount).toBeEnabled();
    expect(amount).toHaveValue(null);
    expect(screen.getByTestId('period-never-hide')).toBeChecked();
  });

  it('should turn never off and report the period when a number is typed', async () => {
    const spy = vi.fn();
    renderWithProviders(<Harness initial={0} spy={spy} />);

    await userEvent.type(screen.getByRole('spinbutton'), '5');

    expect(spy).toHaveBeenLastCalledWith(1825);
    expect(screen.getByTestId('period-never-hide')).not.toBeChecked();
  });

  it('should clear the number and switch to never when the box is ticked', async () => {
    const spy = vi.fn();
    renderWithProviders(<Harness initial={365} spy={spy} />);

    await userEvent.click(screen.getByTestId('period-never-hide'));

    expect(spy).toHaveBeenLastCalledWith(0);
    expect(screen.getByRole('spinbutton')).toHaveValue(null);
  });
});
