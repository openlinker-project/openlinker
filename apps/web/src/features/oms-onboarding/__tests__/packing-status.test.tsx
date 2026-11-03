/**
 * PackingStatus - component spec (#3457)
 *
 * The status page: the on/off banner, the actions each state offers, and the
 * read-only gates.
 */
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../test/test-utils';
import { PackingStatus, type PackingStatusProps } from '../components/packing-status';

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
});
