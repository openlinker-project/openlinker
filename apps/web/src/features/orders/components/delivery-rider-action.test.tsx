import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createAuthenticatedSessionAdapter, renderWithProviders } from '../../../test/test-utils';
import { DeliveryRiderAction } from './delivery-rider-action';
import type { OrderDeliveryRider } from '../api/orders.types';

const UNMAPPED_RIDER: OrderDeliveryRider = {
  rider: 'unmapped',
  candidateCarrier: { platformType: 'inpost', displayName: 'InPost' },
};

const NOT_CONNECTED_RIDER: OrderDeliveryRider = {
  rider: 'not-connected',
  candidateCarrier: { platformType: 'inpost', displayName: 'InPost' },
};

describe('DeliveryRiderAction (#1794)', () => {
  it('should open the routing dialog for the source connection instead of linking to the carriers tab (#3958)', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DeliveryRiderAction
        rider={UNMAPPED_RIDER}
        sourceConnectionId="conn_1"
        sourceDeliveryMethodId="method-xyz"
        sourceDeliveryMethodName="InPost Paczkomat"
      />,
      { sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    const action = await screen.findByRole('button', { name: 'Add mapping' });
    // The carriers tab maps a shop carrier and never buys a label, so the
    // rider must not send the operator there any more.
    expect(screen.queryByRole('link', { name: 'Add mapping' })).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="tab=carriers"]')).toBeNull();

    await user.click(action);
    const dialog = await screen.findByRole('dialog');
    expect(await screen.findByText('Who ships Main PrestaShop Store orders')).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/delivery method this order uses is first and marked/);
  });

  it('should render no Add-mapping action for a role that cannot change routing (#3958)', () => {
    renderWithProviders(
      <DeliveryRiderAction rider={UNMAPPED_RIDER} sourceConnectionId="conn_1" />,
    );
    expect(screen.queryByRole('button', { name: 'Add mapping' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add mapping' })).not.toBeInTheDocument();
  });

  it('should link a not-connected rider to the candidate carrier guided setup wizard', () => {
    renderWithProviders(
      <DeliveryRiderAction rider={NOT_CONNECTED_RIDER} sourceConnectionId="conn-abc" />,
    );

    const link = screen.getByRole('link', { name: 'Connect InPost' });
    expect(link.getAttribute('href')).toBe('/connections/new/inpost');
  });

  it('should fall back to the platform picker when the candidate carrier ships no setup wizard', () => {
    renderWithProviders(
      <DeliveryRiderAction
        rider={{ rider: 'not-connected', candidateCarrier: { platformType: 'unknown-carrier', displayName: 'Unknown' } }}
        sourceConnectionId="conn-abc"
      />,
    );

    const link = screen.getByRole('link', { name: 'Connect Unknown' });
    expect(link.getAttribute('href')).toBe('/connections/new');
  });

  it('should link a disabled-carrier rider to the connections list to re-enable it (#1799)', () => {
    renderWithProviders(
      <DeliveryRiderAction
        rider={{ rider: 'disabled', candidateCarrier: { platformType: 'inpost', displayName: 'InPost' } }}
        sourceConnectionId="conn-abc"
      />,
    );

    const link = screen.getByRole('link', { name: 'Enable InPost' });
    expect(link.getAttribute('href')).toBe('/connections?platformType=inpost&status=disabled');
  });

  it('should render nothing for a non-actionable rider', () => {
    const { container } = renderWithProviders(
      <DeliveryRiderAction rider={{ rider: 'none' }} sourceConnectionId="conn-abc" />,
    );
    expect(container.querySelector('a')).toBeNull();
  });
});
