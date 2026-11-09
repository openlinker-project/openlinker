/**
 * PackingStatus - component spec (#3457)
 *
 * The status page: the on/off banner, the actions each state offers, and the
 * read-only gates.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../test/test-utils';
import {
  PackingStatus,
  type PackingStatusProps,
  type PackingStatusShipping,
} from '../components/packing-status';
import { shippingStatusCopyIn } from '../hooks/use-shipping-setup-copy';

const SHIPPING = shippingStatusCopyIn('en');

function shipping(overrides: Partial<PackingStatusShipping> = {}): PackingStatusShipping {
  return {
    totals: { withCarrier: 4, total: 6, settled: true, unknown: false },
    autoDispatchOn: true,
    busy: false,
    error: null,
    onChange: vi.fn(),
    onStop: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function baseProps(overrides: Partial<PackingStatusProps> = {}): PackingStatusProps {
  return {
    live: true,
    bannerDetail: '3 parcels waiting',
    offMasterNames: 'My shop',
    masterCount: 1,
    masterNames: 'My shop',
    firstMasterId: 'conn-1',
    stockDetail: '100 of 100 products',
    stockComplete: true,
    packerNames: 'anna',
    setup: null,
    canWrite: true,
    writeVisible: true,
    demoReadOnly: false,
    toggling: false,
    toggleError: null,
    onAskStop: vi.fn(),
    onStartAgain: vi.fn(),
    ...overrides,
  } as PackingStatusProps;
}

describe('PackingStatus', () => {
  it('should show the live banner with a link to the fulfilment screen and a stop action', () => {
    const onAskStop = vi.fn();
    renderWithProviders(<PackingStatus {...baseProps({ onAskStop })} />);

    expect(screen.getByTestId('packing-status-banner')).toBeInTheDocument();
    expect(screen.getByTestId('link-open-fulfilment')).toHaveAttribute('href', '/fulfillment');
    fireEvent.click(screen.getByTestId('btn-ask-stop'));
    expect(onAskStop).toHaveBeenCalledTimes(1);
  });

  it('should offer to start again, not to stop, when packing is off', () => {
    const onStartAgain = vi.fn();
    renderWithProviders(<PackingStatus {...baseProps({ live: false, onStartAgain })} />);

    expect(screen.queryByTestId('btn-ask-stop')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('btn-turn-on'));
    expect(onStartAgain).toHaveBeenCalledTimes(1);
  });

  it('should disable the action for a non-admin', () => {
    renderWithProviders(<PackingStatus {...baseProps({ canWrite: false })} />);

    expect(screen.getByTestId('btn-ask-stop')).toBeDisabled();
  });

  it('should list the setup rows with their links', () => {
    renderWithProviders(<PackingStatus {...baseProps()} />);

    expect(screen.getByTestId('setup-status')).toBeInTheDocument();
  });

  it('should show the Shipping row with its coverage, and stop buying labels after confirming', async () => {
    const onStop = vi.fn(() => Promise.resolve());
    renderWithProviders(<PackingStatus {...baseProps({ shipping: shipping({ onStop }) })} />);

    expect(screen.getByTestId('setup-status-list')).toHaveTextContent(SHIPPING.on(4, 6));
    fireEvent.click(screen.getByTestId('btn-shipping-stop'));
    expect(onStop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: SHIPPING.stop }));
    expect(onStop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText(SHIPPING.stopTitle)).not.toBeInTheDocument());
  });

  it('should offer to buy labels automatically when it is off', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <PackingStatus {...baseProps({ shipping: shipping({ autoDispatchOn: false, onChange }) })} />
    );

    expect(screen.getByTestId('setup-status-list')).toHaveTextContent(SHIPPING.off(4, 6));
    expect(screen.queryByTestId('btn-shipping-stop')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('btn-shipping-start'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
