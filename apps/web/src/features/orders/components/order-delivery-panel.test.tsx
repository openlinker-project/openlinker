import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { OrderDeliveryPanel } from './order-delivery-panel';

describe('OrderDeliveryPanel', () => {
  it('renders nothing when there is no delivery data', () => {
    renderWithProviders(<OrderDeliveryPanel />);
    expect(screen.queryByRole('region', { name: 'Delivery' })).toBeNull();
  });

  it('renders the address, method and pickup code when present', () => {
    renderWithProviders(
      <OrderDeliveryPanel
        shippingAddress={{ address1: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' }}
        shipping={{ methodId: 'm1', methodName: 'InPost Paczkomat' }}
        pickupPoint={{ id: 'POP-WAW-04412' }}
        sourcePlatformType="allegro"
      />,
    );
    expect(screen.getByText('POP-WAW-04412')).toBeInTheDocument();
    expect(screen.getByText('InPost Paczkomat')).toBeInTheDocument();
    expect(screen.getByText(/operator-selected|buyer-selected/)).toBeInTheDocument();
  });

  it('prefixes the pickup code with the point kind when pointType is present (#1433)', () => {
    renderWithProviders(
      <OrderDeliveryPanel
        pickupPoint={{ id: 'POP-OLS19', pointType: 'pop' }}
        sourcePlatformType="allegro"
      />,
    );
    expect(screen.getByText(/PaczkoPunkt\s+POP-OLS19/)).toBeInTheDocument();
  });

  it('labels an apm point as Paczkomat (#1433)', () => {
    renderWithProviders(
      <OrderDeliveryPanel
        pickupPoint={{ id: 'OLS06A', pointType: 'apm' }}
        sourcePlatformType="allegro"
      />,
    );
    expect(screen.getByText(/Paczkomat\s+OLS06A/)).toBeInTheDocument();
  });
});
