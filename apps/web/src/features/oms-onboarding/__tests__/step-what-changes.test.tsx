/**
 * StepWhatChanges - component spec (#3457)
 *
 * The acknowledgement gate: nothing changes in how orders are handled until the
 * operator has read step 3 and ticked it, so Continue must stay disabled until then.
 */
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../test/test-utils';
import { StepWhatChanges, type StepWhatChangesProps } from '../components/step-what-changes';

function baseProps(overrides: Partial<StepWhatChangesProps> = {}): StepWhatChangesProps {
  return {
    masterCount: 1,
    masterNames: 'My shop',
    acknowledged: false,
    onAcknowledge: vi.fn(),
    onBack: vi.fn(),
    onContinue: vi.fn(),
    ...overrides,
  };
}

describe('StepWhatChanges', () => {
  it('should keep Continue disabled until the changes are acknowledged', () => {
    renderWithProviders(<StepWhatChanges {...baseProps()} />);

    expect(screen.getByTestId('btn-continue-step-3')).toBeDisabled();
  });

  it('should report the tick and enable Continue once acknowledged', () => {
    const onAcknowledge = vi.fn();
    const onContinue = vi.fn();
    const { rerender } = renderWithProviders(
      <StepWhatChanges {...baseProps({ onAcknowledge, onContinue })} />,
    );

    fireEvent.click(screen.getByTestId('input-ack'));
    expect(onAcknowledge).toHaveBeenCalledWith(true);

    rerender(<StepWhatChanges {...baseProps({ acknowledged: true, onAcknowledge, onContinue })} />);
    fireEvent.click(screen.getByTestId('btn-continue-step-3'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('should explain the order flows and list what changes', () => {
    renderWithProviders(<StepWhatChanges {...baseProps()} />);

    expect(screen.getByTestId('order-flow-diagram')).toBeInTheDocument();
    expect(screen.getByTestId('order-routing-summary')).toBeInTheDocument();
    expect(screen.getByTestId('what-changes-list')).toBeInTheDocument();
  });

  it('should go back to the previous step', () => {
    const onBack = vi.fn();
    renderWithProviders(<StepWhatChanges {...baseProps({ onBack })} />);

    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
