/**
 * BulkConfigStep tests (#792 PR 3)
 *
 * The Config step builds the batch-wide `BulkWizardConfig` - connection,
 * delivery policy, currency, and the pricing/stock policy objects - and gates
 * "Proceed" on per-mode validation. The AI-generation toggle is gated on the
 * `listings:write` permission via the `useWriteAccess` + `ReadOnlyLock`
 * pattern (#1668): visible-but-disabled for a demo viewer, hidden for a
 * genuinely unauthorized non-demo session, enabled for anyone holding
 * `listings:write` (admin + operator) regardless of demo mode.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createAuthenticatedSessionAdapter,
  renderWithProviders,
  createMockApiClient,
} from '../../../../test/test-utils';
import { BulkConfigStep } from './bulk-config-step';
import type { BulkWizardConfig } from './bulk-wizard.types';
import type { Connection } from '../../../connections';
import type { SessionUser } from '../../../../shared/auth/session.types';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../../shared/config/demo-mode';

const viewerUser: SessionUser = {
  id: 'user_viewer',
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  permissions: [
    'connections:read',
    'sync:read',
    'integrations:read',
    'adapters:read',
    'orders:read',
    'products:read',
    'inventory:read',
    'listings:read',
  ],
};

function makeConnectionClient() {
  const connection = {
    id: 'conn-1',
    name: 'My Allegro',
    status: 'active',
    platformType: 'allegro',
    supportedCapabilities: ['OfferManager', 'OfferCreator'],
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
    { apiClient: makeConnectionClient(), sessionAdapter: createAuthenticatedSessionAdapter() },
  );
  // Wait for the delivery option to render - that only happens after a 3-hop
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
      // #1096 - delivery policy now lives under the generic platformParams slot,
      // written by Allegro's contributed bulk-config section.
      platformParams: { deliveryPolicyId: 'dp1' },
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

  describe('AI-generation toggle permission gating (listings:write, useWriteAccess + ReadOnlyLock, #1668)', () => {
    it('hides the toggle entirely for a genuinely unauthorized non-demo session (viewer)', async () => {
      renderWithProviders(
        <BulkConfigStep
          initial={{ generateDescription: true }}
          onProceed={vi.fn()}
          onCancel={() => undefined}
        />,
        {
          apiClient: makeConnectionClient(),
          sessionAdapter: createAuthenticatedSessionAdapter(viewerUser),
        },
      );

      await screen.findByText('Configure batch');
      await waitFor(() => {
        expect(
          screen.queryByRole('checkbox', { name: /Generate AI descriptions by default/ }),
        ).not.toBeInTheDocument();
      });
    }, 15000);

    it('renders the toggle visible-but-disabled with the demo read-only tooltip for a demo viewer', async () => {
      const apiClient = createMockApiClient({
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
        connections: { list: vi.fn().mockResolvedValue([
          {
            id: 'conn-1',
            name: 'My Allegro',
            status: 'active',
            platformType: 'allegro',
            supportedCapabilities: ['OfferManager', 'OfferCreator'],
          } as unknown as Connection,
        ]) },
        listings: {
          getSellerPolicies: vi
            .fn()
            .mockResolvedValue({ deliveryPolicies: [{ id: 'dp1', name: 'Courier 24h' }] }),
        },
      });
      renderWithProviders(
        <BulkConfigStep
          initial={{ generateDescription: true }}
          onProceed={vi.fn()}
          onCancel={() => undefined}
        />,
        { apiClient, sessionAdapter: createAuthenticatedSessionAdapter(viewerUser) },
      );

      const toggle = await screen.findByRole('checkbox', {
        name: /Generate AI descriptions by default/,
      });
      await waitFor(() => { expect(toggle).toBeDisabled(); }, { timeout: 5000 });
      // Forced off even though `initial.generateDescription` was true.
      expect(toggle).not.toBeChecked();

      const user = userEvent.setup();
      await user.hover(toggle.closest('.read-only-lock') as HTMLElement);
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toHaveTextContent(DEMO_READ_ONLY_ACTION_MESSAGE);
    }, 15000);

    it('keeps the toggle enabled for an operator session even when the deployment is in demo mode', async () => {
      const apiClient = createMockApiClient({
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
        connections: {
          list: vi.fn().mockResolvedValue([
            {
              id: 'conn-1',
              name: 'My Allegro',
              status: 'active',
              platformType: 'allegro',
              supportedCapabilities: ['OfferManager', 'OfferCreator'],
            } as unknown as Connection,
          ]),
        },
        listings: {
          getSellerPolicies: vi
            .fn()
            .mockResolvedValue({ deliveryPolicies: [{ id: 'dp1', name: 'Courier 24h' }] }),
        },
      });
      renderWithProviders(
        <BulkConfigStep initial={{}} onProceed={vi.fn()} onCancel={() => undefined} />,
        { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
      );

      const toggle = await screen.findByRole('checkbox', {
        name: /Generate AI descriptions by default/,
      });
      await waitFor(() => { expect(toggle).toBeEnabled(); }, { timeout: 5000 });
    }, 15000);
  });
});
