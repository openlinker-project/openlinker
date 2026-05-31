/**
 * Shipment Action Buttons — payment-gate tests (#928)
 *
 * Focused on the dispatch gate the payment-status feature adds: Generate-label
 * is blocked iff payment status is awaiting/refunded (block-list polarity);
 * paid / cod / undefined / unknown all permit dispatch. The component's shipment
 * mutation/query hooks resolve against `renderWithProviders`' QueryClient +
 * mock API client (same pattern as order-shipment-panel.test.tsx) — no manual
 * hook mocking needed.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/test-utils';
import { ShipmentActionButtons } from './shipment-action-buttons';
import type { PaymentStatus } from '../api/order-snapshot.schema';

function renderGate(paymentStatus?: PaymentStatus): void {
  // No shipment row → synthetic 'none' status, which CAN_GENERATE allows, so the
  // only thing that can disable Generate here is the payment gate.
  renderWithProviders(
    <ShipmentActionButtons
      shipment={null}
      paymentStatus={paymentStatus}
      onGenerateLabelClick={vi.fn()}
    />,
  );
}

// When payment blocks, the Generate button's accessible name switches to the
// awaiting caption; otherwise it's the normal generate label.
const blockedButton = (): HTMLElement => screen.getByRole('button', { name: /awaiting payment/i });
const generateButton = (): HTMLElement =>
  screen.getByRole('button', { name: /generate shipping label/i });

describe('ShipmentActionButtons payment gate (#928)', () => {
  it('disables Generate when payment is awaiting', () => {
    renderGate('awaiting');
    expect(blockedButton()).toBeDisabled();
  });

  it('disables Generate when the order is refunded', () => {
    renderGate('refunded');
    expect(blockedButton()).toBeDisabled();
  });

  it('enables Generate when the order is paid', () => {
    renderGate('paid');
    expect(generateButton()).toBeEnabled();
  });

  it('enables Generate for cash on delivery', () => {
    renderGate('cod');
    expect(generateButton()).toBeEnabled();
  });

  it('enables Generate when payment status is unknown (undefined)', () => {
    // PrestaShop / legacy orders carry no payment status — must not block.
    renderGate(undefined);
    expect(generateButton()).toBeEnabled();
  });
});
