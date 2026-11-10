/**
 * StepTurnOn — component spec (#3457)
 */
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { getMessages } from '../../../shared/i18n';
import { WIZARD_STEPS } from '../lib/onboarding-state';
import { StepTurnOn, type StepTurnOnProps } from '../components/step-turn-on';

function baseProps(overrides: Partial<StepTurnOnProps> = {}): StepTurnOnProps {
  return {
    masterCount: 1,
    masterNames: 'My shop',
    stockDetail: '100 of 100 products',
    stockComplete: true,
    packerNames: 'anna',
    setup: null,
    otherSystemDecides: false,
    canWrite: true,
    demoReadOnly: false,
    turningOn: false,
    turnOnError: null,
    onGoToStep: vi.fn(),
    onTurnOn: vi.fn(),
    ...overrides,
  };
}

describe('StepTurnOn', () => {
  it('should summarise the setup and turn packing on', () => {
    const onTurnOn = vi.fn();
    renderWithProviders(<StepTurnOn {...baseProps({ onTurnOn })} />);

    expect(screen.getByTestId('setup-summary')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('btn-turn-on'));
    expect(onTurnOn).toHaveBeenCalledTimes(1);
  });

  it('should send the operator back to the step a row belongs to', () => {
    const onGoToStep = vi.fn();
    renderWithProviders(<StepTurnOn {...baseProps({ onGoToStep })} />);

    fireEvent.click(screen.getByTestId('btn-go-step-2'));
    expect(onGoToStep).toHaveBeenCalledWith(WIZARD_STEPS.packers);
  });

  it('should disable turning on when another system already decides', () => {
    renderWithProviders(<StepTurnOn {...baseProps({ otherSystemDecides: true })} />);

    expect(screen.getByTestId('alert-other-system-decides')).toBeInTheDocument();
    expect(screen.getByTestId('btn-turn-on')).toBeDisabled();
  });

  it('should disable turning on for a non-admin and while in flight', () => {
    const { rerender } = renderWithProviders(<StepTurnOn {...baseProps({ canWrite: false })} />);
    expect(screen.getByTestId('btn-turn-on')).toBeDisabled();

    rerender(<StepTurnOn {...baseProps({ turningOn: true })} />);
    expect(screen.getByTestId('btn-turn-on')).toBeDisabled();
  });

  it('should render a generic failure in the copy for its status, not the server message', () => {
    renderWithProviders(
      <StepTurnOn {...baseProps({ turnOnError: new ApiError('Nope', 500, {}) })} />
    );

    expect(screen.getByText(getMessages('errors').status['5xx'])).toBeInTheDocument();
    expect(screen.queryByText('Nope')).not.toBeInTheDocument();
    expect(screen.queryByTestId('alert-turn-on-no-location')).not.toBeInTheDocument();
  });
});
