import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
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
  it('should link an unmapped rider to the source connection Delivery mapping tab with the method pre-filtered', () => {
    renderWithProviders(
      <DeliveryRiderAction
        rider={UNMAPPED_RIDER}
        sourceConnectionId="conn-abc"
        sourceDeliveryMethodId="method-xyz"
        sourceDeliveryMethodName="InPost Paczkomat"
      />,
    );

    const link = screen.getByRole('link', { name: 'Add mapping' });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('/connections/conn-abc/mappings');
    expect(href).toContain('tab=carriers');
    expect(href).toContain('method=method-xyz');
    expect(href).toContain('methodName=');
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

  it('should render nothing for a non-actionable rider', () => {
    const { container } = renderWithProviders(
      <DeliveryRiderAction rider={{ rider: 'none' }} sourceConnectionId="conn-abc" />,
    );
    expect(container.querySelector('a')).toBeNull();
  });
});
