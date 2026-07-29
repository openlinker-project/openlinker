import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { OrderDeliveryPanel } from './order-delivery-panel';

describe('OrderDeliveryPanel', () => {
  it('should always render the panel with Method and Carrier fields, "-" when there is no delivery data (#1617/#1776)', () => {
    renderWithProviders(<OrderDeliveryPanel />);
    expect(screen.getByRole('region', { name: 'Delivery' })).toBeInTheDocument();
    expect(screen.getByText('Method')).toBeInTheDocument();
    expect(screen.getByText('Carrier')).toBeInTheDocument();
    // Both value cells fall back to "-" when nothing is resolvable.
    expect(screen.getAllByText('-')).toHaveLength(2);
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

  describe('method field fallback chain (#1776)', () => {
    it('should prefer the snapshot method name over every fallback', () => {
      renderWithProviders(
        <OrderDeliveryPanel
          shipping={{ methodId: 'm1', methodName: 'InPost Paczkomat' }}
          methodFallback="Kurier"
        />,
      );
      expect(screen.getByText('InPost Paczkomat')).toBeInTheDocument();
      expect(screen.queryByText('Kurier')).not.toBeInTheDocument();
    });

    it('should fall back to the method id when the method name is absent', () => {
      renderWithProviders(
        <OrderDeliveryPanel shipping={{ methodId: 'MID-42' }} methodFallback="Kurier" />,
      );
      expect(screen.getByText('MID-42')).toBeInTheDocument();
      expect(screen.queryByText('Kurier')).not.toBeInTheDocument();
    });

    it('should fall back to the caller-supplied methodFallback when the snapshot has no shipping', () => {
      renderWithProviders(<OrderDeliveryPanel methodFallback="Paczkomat" />);
      expect(screen.getByText('Method')).toBeInTheDocument();
      expect(screen.getByText('Paczkomat')).toBeInTheDocument();
    });

    it('should fall back to the pickup-point name when no method or fallback resolves (#1793)', () => {
      renderWithProviders(
        <OrderDeliveryPanel pickupPoint={{ id: 'OLS06A', name: 'Paczkomat OLS06A' }} />,
      );
      expect(screen.getByText('Method')).toBeInTheDocument();
      expect(screen.getByText('Paczkomat OLS06A')).toBeInTheDocument();
    });

    it('should render "-" for Method when neither snapshot nor fallback resolves', () => {
      renderWithProviders(<OrderDeliveryPanel carrier="InPost" />);
      expect(screen.getByText('Method')).toBeInTheDocument();
      // Only the Method value falls back to "-"; Carrier shows InPost.
      expect(screen.getByText('-')).toBeInTheDocument();
    });
  });

  describe('mapping-aware delivery outcome + rider (#1793)', () => {
    it('should render the delivery outcome chip in the Carrier row', () => {
      renderWithProviders(<OrderDeliveryPanel carrier="InPost" deliveryOutcome="resolved" />);
      expect(screen.getByText('InPost')).toBeInTheDocument();
      expect(screen.getByText('Labelled')).toBeInTheDocument();
    });

    it('should render the rider banner with a fix-it slot when a rider is actionable', () => {
      renderWithProviders(
        <OrderDeliveryPanel
          deliveryOutcome="shop-fulfilled"
          deliveryRider={{
            rider: 'unmapped',
            candidateCarrier: { platformType: 'inpost', displayName: 'InPost' },
          }}
        />,
      );
      expect(screen.getByText('Not via OpenLinker')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add mapping' })).toBeDisabled();
    });

    it('should not render a rider banner when the rider is "none"', () => {
      renderWithProviders(
        <OrderDeliveryPanel deliveryOutcome="shop-fulfilled" deliveryRider={{ rider: 'none' }} />,
      );
      expect(screen.getByText('Not via OpenLinker')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Add mapping|Connect/ })).not.toBeInTheDocument();
    });
  });

  describe('fix-it deep-link wiring (#1794)', () => {
    it('should render the real Add-mapping deep link when sourceConnectionId is provided', () => {
      renderWithProviders(
        <OrderDeliveryPanel
          deliveryOutcome="shop-fulfilled"
          deliveryRider={{
            rider: 'unmapped',
            candidateCarrier: { platformType: 'inpost', displayName: 'InPost' },
          }}
          sourceConnectionId="conn-abc"
          sourceDeliveryMethodId="method-xyz"
          sourceDeliveryMethodName="InPost Paczkomat"
        />,
      );
      const link = screen.getByRole('link', { name: 'Add mapping' });
      expect(link.getAttribute('href')).toContain('/connections/conn-abc/mappings');
      expect(link.getAttribute('href')).toContain('method=method-xyz');
      expect(screen.queryByRole('button', { name: 'Add mapping' })).not.toBeInTheDocument();
    });

    it('should fall back to the disabled placeholder when sourceConnectionId is absent', () => {
      renderWithProviders(
        <OrderDeliveryPanel
          deliveryOutcome="shop-fulfilled"
          deliveryRider={{
            rider: 'unmapped',
            candidateCarrier: { platformType: 'inpost', displayName: 'InPost' },
          }}
        />,
      );
      expect(screen.getByRole('button', { name: 'Add mapping' })).toBeDisabled();
      expect(screen.queryByRole('link', { name: 'Add mapping' })).not.toBeInTheDocument();
    });
  });
});
