import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { OrderDeliveryPanel } from './order-delivery-panel';

describe('OrderDeliveryPanel', () => {
  it('should always render the panel with a Carrier field, "-" when there is no delivery data (#1617)', () => {
    renderWithProviders(<OrderDeliveryPanel />);
    expect(screen.getByRole('region', { name: 'Delivery' })).toBeInTheDocument();
    expect(screen.getByText('Carrier')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('should render the address, method and pickup code when they are present', () => {
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

  it('should prefix the pickup code with the point kind when pointType is present (#1433)', () => {
    renderWithProviders(
      <OrderDeliveryPanel
        pickupPoint={{ id: 'POP-OLS19', pointType: 'pop' }}
        sourcePlatformType="allegro"
      />,
    );
    expect(screen.getByText(/PaczkoPunkt\s+POP-OLS19/)).toBeInTheDocument();
  });

  it('should label the pickup code as Paczkomat when pointType is apm (#1433)', () => {
    renderWithProviders(
      <OrderDeliveryPanel
        pickupPoint={{ id: 'OLS06A', pointType: 'apm' }}
        sourcePlatformType="allegro"
      />,
    );
    expect(screen.getByText(/Paczkomat\s+OLS06A/)).toBeInTheDocument();
  });

  describe('carrier field (#1617)', () => {
    it('should render the resolved carrier when the caller supplies one', () => {
      renderWithProviders(
        <OrderDeliveryPanel
          shipping={{ methodId: 'm1', methodName: 'InPost Paczkomat' }}
          carrier="InPost"
        />,
      );
      expect(screen.getByText('Carrier')).toBeInTheDocument();
      expect(screen.getByText('InPost')).toBeInTheDocument();
    });

    it('should render "-" for carrier when the caller resolved nothing, even with other delivery data present', () => {
      renderWithProviders(
        <OrderDeliveryPanel shipping={{ methodId: 'm1', methodName: 'InPost Paczkomat' }} carrier={null} />,
      );
      expect(screen.getByText('Carrier')).toBeInTheDocument();
      expect(screen.getByText('-')).toBeInTheDocument();
      // Method still renders independently — carrier and method aren't the same field.
      expect(screen.getByText('InPost Paczkomat')).toBeInTheDocument();
    });

    it('should render the panel for the carrier alone when no other delivery data is present', () => {
      renderWithProviders(<OrderDeliveryPanel carrier="InPost" />);
      expect(screen.getByRole('region', { name: 'Delivery' })).toBeInTheDocument();
      expect(screen.getByText('InPost')).toBeInTheDocument();
    });
  });
});
