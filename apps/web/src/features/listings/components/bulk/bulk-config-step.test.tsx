/**
 * BulkConfigStep tests (#792 PR 3)
 *
 * The Config step builds the batch-wide `BulkWizardConfig` — connection,
 * delivery policy, currency, and the pricing/stock policy objects — and gates
 * "Proceed" on per-mode validation.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';
import { BulkConfigStep } from './bulk-config-step';
import type { BulkWizardConfig } from './bulk-wizard.types';
import type { Connection } from '../../../connections';

function makeClient() {
  const connection = {
    id: 'conn-1',
    name: 'My Allegro',
    status: 'active',
    platformType: 'allegro',
    supportedCapabilities: ['OfferManager'],
  } as unknown as Connection;
  return createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue([connection]) },
    listings: {
      getSellerPolicies: vi.fn().mockResolvedValue({
        deliveryPolicies: [{ id: 'dp1', name: 'Courier 24h' }],
      }),
    },
  });
}

async function renderAndSelectPolicy() {
  const onProceed = vi.fn<(c: BulkWizardConfig) => void>();
  renderWithProviders(
    <BulkConfigStep initial={{}} onProceed={onProceed} onCancel={() => undefined} />,
    { apiClient: makeClient() },
  );
  // Wait for the delivery option to render — that only happens after a 3-hop
  // async chain: connections query → auto-select effect → seller-policies query
  // resolves (the select renders empty before then, since a disabled query
  // isn't "loading"). The generous timeout rides out a starved event loop under
  // heavy parallel CI load, where the default 1000ms can lapse mid-chain.
  await screen.findByRole('option', { name: 'Courier 24h' }, { timeout: 5000 });
  fireEvent.change(screen.getByRole('combobox', { name: 'Shipping rate package' }), {
    target: { value: 'dp1' },
  });
  return { onProceed };
}

async function clickProceed(): Promise<void> {
  const proceed = screen.getByRole('button', { name: /Proceed/ });
  await waitFor(() => { expect(proceed).toBeEnabled(); }, { timeout: 5000 });
  fireEvent.click(proceed);
}

describe('BulkConfigStep', () => {
  it('proceeds with use-master pricing/stock by default', async () => {
    const { onProceed } = await renderAndSelectPolicy();

    await clickProceed();

    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(onProceed.mock.calls[0][0]).toEqual({
      connectionId: 'conn-1',
      deliveryPolicyId: 'dp1',
      currency: 'PLN',
      pricingPolicy: { mode: 'use-master' },
      stockPolicy: { mode: 'use-master' },
      publishImmediately: true,
      generateDescription: false,
    });
  }, 15000);

  it('builds markup + cap policy objects from the selected modes and values', async () => {
    const { onProceed } = await renderAndSelectPolicy();

    fireEvent.click(screen.getByRole('radio', { name: /Markup on master price/ }));
    fireEvent.change(screen.getByLabelText('Markup %'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('radio', { name: /Cap master stock/ }));
    fireEvent.change(screen.getByLabelText('Cap at'), { target: { value: '8' } });

    await clickProceed();

    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(onProceed.mock.calls[0][0]).toMatchObject({
      pricingPolicy: { mode: 'markup', percent: 15 },
      stockPolicy: { mode: 'cap', value: 8 },
    });
  }, 15000);

  it('disables Proceed when the markup percent is out of range', async () => {
    await renderAndSelectPolicy();

    fireEvent.click(screen.getByRole('radio', { name: /Markup on master price/ }));
    fireEvent.change(screen.getByLabelText('Markup %'), { target: { value: '999' } });

    expect(screen.getByRole('button', { name: /Proceed/ })).toBeDisabled();
  }, 15000);
});
