import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../../test/test-utils';
import type { OrderDeliveryRider } from '../api/orders.types';
import {
  DeliveryChip,
  DeliveryOutcomeChip,
  DeliveryRiderBanner,
  DeliveryRiderChip,
} from './delivery-chip';

describe('DeliveryOutcomeChip', () => {
  it('should render the "Resolved" label for the resolved outcome', () => {
    renderWithProviders(<DeliveryOutcomeChip outcome="resolved" />);
    expect(screen.getByText('Resolved')).toBeInTheDocument();
  });

  it('should render the "Awaiting label" label for the awaiting-label outcome', () => {
    renderWithProviders(<DeliveryOutcomeChip outcome="awaiting-label" />);
    expect(screen.getByText('Awaiting label')).toBeInTheDocument();
  });

  it('should render the "Shop-fulfilled" label for the shop-fulfilled outcome', () => {
    renderWithProviders(<DeliveryOutcomeChip outcome="shop-fulfilled" />);
    expect(screen.getByText('Shop-fulfilled')).toBeInTheDocument();
  });

  it('should render the "No method" label with the dashed modifier for the no-method outcome', () => {
    const { container } = renderWithProviders(<DeliveryOutcomeChip outcome="no-method" />);
    expect(screen.getByText('No method')).toBeInTheDocument();
    expect(container.querySelector('.delivery-outcome-chip--dashed')).not.toBeNull();
  });
});

describe('DeliveryRiderChip', () => {
  it('should render the "Unmapped" rider', () => {
    renderWithProviders(<DeliveryRiderChip rider={{ rider: 'unmapped' }} />);
    expect(screen.getByText('Unmapped')).toBeInTheDocument();
  });

  it('should render the "Not connected" rider with the accent modifier', () => {
    const { container } = renderWithProviders(
      <DeliveryRiderChip rider={{ rider: 'not-connected' }} />,
    );
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(container.querySelector('.delivery-rider-chip--not-connected')).not.toBeNull();
  });

  it('should render the "Carrier disabled" rider with the accent modifier (#1799)', () => {
    const { container } = renderWithProviders(
      <DeliveryRiderChip rider={{ rider: 'disabled' }} />,
    );
    expect(screen.getByText('Carrier disabled')).toBeInTheDocument();
    expect(container.querySelector('.delivery-rider-chip--not-connected')).not.toBeNull();
  });

  it('should render nothing for the "none" rider', () => {
    renderWithProviders(<DeliveryRiderChip rider={{ rider: 'none' }} />);
    expect(screen.queryByText('Unmapped')).not.toBeInTheDocument();
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
  });
});

describe('DeliveryChip', () => {
  it('should stack the outcome chip and the actionable rider chip', () => {
    const rider: OrderDeliveryRider = {
      rider: 'unmapped',
      candidateCarrier: { platformType: 'inpost', displayName: 'InPost' },
    };
    renderWithProviders(<DeliveryChip outcome="shop-fulfilled" rider={rider} />);
    expect(screen.getByText('Shop-fulfilled')).toBeInTheDocument();
    expect(screen.getByText('Unmapped')).toBeInTheDocument();
  });

  it('should render only the outcome chip when the rider is "none"', () => {
    renderWithProviders(<DeliveryChip outcome="shop-fulfilled" rider={{ rider: 'none' }} />);
    expect(screen.getByText('Shop-fulfilled')).toBeInTheDocument();
    expect(screen.queryByText('Unmapped')).not.toBeInTheDocument();
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
  });

  it('should render only the outcome chip when no rider is supplied', () => {
    renderWithProviders(<DeliveryChip outcome="resolved" />);
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.queryByText('Unmapped')).not.toBeInTheDocument();
  });
});

describe('DeliveryRiderBanner', () => {
  it('should render the unmapped explanation naming the candidate carrier + an "Add mapping" slot button', () => {
    renderWithProviders(
      <DeliveryRiderBanner
        rider={{ rider: 'unmapped', candidateCarrier: { platformType: 'inpost', displayName: 'InPost' } }}
      />,
    );
    expect(screen.getByText(/isn't mapped to a carrier/i)).toBeInTheDocument();
    expect(screen.getByText(/InPost/)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Add mapping' });
    // Slot only — navigation is #1794, so the button is non-functional here.
    expect(button).toBeDisabled();
  });

  it('should render the not-connected explanation + a "Connect {carrier}" slot button', () => {
    renderWithProviders(
      <DeliveryRiderBanner
        rider={{ rider: 'not-connected', candidateCarrier: { platformType: 'dpd', displayName: 'DPD' } }}
      />,
    );
    expect(screen.getByText(/no DPD connection is set up/i)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Connect DPD' });
    expect(button).toBeDisabled();
  });

  it('should render the disabled-carrier explanation + an "Enable {carrier}" slot button (#1799)', () => {
    renderWithProviders(
      <DeliveryRiderBanner
        rider={{ rider: 'disabled', candidateCarrier: { platformType: 'inpost', displayName: 'InPost' } }}
      />,
    );
    expect(screen.getByText(/the InPost connection is disabled/i)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Enable InPost' });
    expect(button).toBeDisabled();
  });

  it('should prefer a caller-supplied action slot over the placeholder button', () => {
    renderWithProviders(
      <DeliveryRiderBanner
        rider={{ rider: 'unmapped', candidateCarrier: { platformType: 'inpost', displayName: 'InPost' } }}
        actionSlot={<a href="/mappings">Go map it</a>}
      />,
    );
    expect(screen.getByRole('link', { name: 'Go map it' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add mapping' })).not.toBeInTheDocument();
  });

  it('should render nothing for the "none" rider', () => {
    renderWithProviders(<DeliveryRiderBanner rider={{ rider: 'none' }} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('should fall back to "a carrier" when no candidate carrier is present', () => {
    renderWithProviders(<DeliveryRiderBanner rider={{ rider: 'unmapped' }} />);
    expect(screen.getByText(/map it to a carrier/i)).toBeInTheDocument();
  });
});
