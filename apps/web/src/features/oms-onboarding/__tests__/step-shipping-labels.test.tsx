/**
 * StepShippingLabels - component spec (#3572)
 */
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import {
  StepShippingLabels,
  type StepShippingLabelsProps,
} from '../components/step-shipping-labels';
import { WIZARD_STEPS } from '../lib/onboarding-state';

const OMS_ID = 'conn-oms';

function connection(config: Record<string, unknown> = {}) {
  return {
    id: OMS_ID,
    name: 'OpenLinker OMS',
    platformType: 'openlinker',
    status: 'active',
    config,
    enabledCapabilities: ['FulfillmentExecutor'],
    credentialsBacked: false,
  };
}

function baseProps(overrides: Partial<StepShippingLabelsProps> = {}): StepShippingLabelsProps {
  return {
    packingConnectionId: OMS_ID,
    state: 'pending',
    last: false,
    canWrite: true,
    writeVisible: true,
    demoReadOnly: false,
    onBack: vi.fn(),
    onContinue: vi.fn(),
    ...overrides,
  };
}

function render(props: StepShippingLabelsProps, config: Record<string, unknown> = {}) {
  return renderWithProviders(<StepShippingLabels {...props} />, {
    apiClient: createMockApiClient({
      connections: { getById: vi.fn().mockResolvedValue(connection(config)) },
    }),
  });
}

describe('StepShippingLabels', () => {
  it('should be the step right before "Turn it on"', () => {
    expect(WIZARD_STEPS.shippingLabels).toBe(WIZARD_STEPS.turnOn - 1);
  });

  it('should embed the label settings form inside the step panel', async () => {
    render(baseProps());

    expect(await screen.findByLabelText('Buy labels automatically')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-step-panel')).toHaveAttribute(
      'data-step',
      String(WIZARD_STEPS.shippingLabels)
    );
    // Embedded: the step owns the panel and title, and there is no refusal list yet.
    expect(screen.queryByTestId('auto-dispatch-refusals')).not.toBeInTheDocument();
  });

  it('should read "not set up yet" as "None yet", never as something missing', async () => {
    render(baseProps({ state: 'pending' }));

    expect(await screen.findByTestId('setup-step-shippingLabels-state')).toHaveTextContent('None yet');
  });

  it('should show done once automatic labels are on', async () => {
    render(baseProps({ state: 'done' }), { autoDispatch: { enabled: true } });

    expect(await screen.findByTestId('setup-step-shippingLabels-state')).toHaveTextContent(
      'Already set up'
    );
  });

  it('should offer no "Not needed": buying labels by hand is a complete setup', async () => {
    render(baseProps());
    await screen.findByLabelText('Buy labels automatically');

    expect(screen.queryByTestId('btn-step-shippingLabels-skip')).not.toBeInTheDocument();
    expect(screen.queryByText('Not needed')).not.toBeInTheDocument();
  });

  it('should only move on with Continue, saving nothing by itself', async () => {
    const onContinue = vi.fn();
    const apiClient = createMockApiClient({
      connections: {
        getById: vi.fn().mockResolvedValue(connection()),
        update: vi.fn(),
      },
    });
    renderWithProviders(<StepShippingLabels {...baseProps({ onContinue })} />, { apiClient });
    await screen.findByLabelText('Buy labels automatically');

    fireEvent.click(screen.getByTestId(`btn-continue-step-${String(WIZARD_STEPS.shippingLabels)}`));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(apiClient.connections.update).not.toHaveBeenCalled();
  });

  it('should say Finish instead of Continue when the setup was already live', async () => {
    render(baseProps({ last: true }));

    expect(await screen.findByText('Finish')).toBeInTheDocument();
  });

  it('should go back through the wizard', async () => {
    const onBack = vi.fn();
    render(baseProps({ onBack }));

    fireEvent.click(await screen.findByTestId('btn-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('should say packing is not set up when there is no packing connection, with no form', () => {
    render(baseProps({ packingConnectionId: null }));

    expect(screen.getByText('Packing is not set up yet')).toBeInTheDocument();
    expect(screen.queryByLabelText('Buy labels automatically')).not.toBeInTheDocument();
  });
});
