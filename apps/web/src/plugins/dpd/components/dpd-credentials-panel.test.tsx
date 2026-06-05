/**
 * DpdCredentialsPanel — component tests (#966)
 *
 * Covers the collapsed → expanded rotate flow and the both-fields-required
 * gate. The mutation itself is not fired (local state only), so no
 * updateCredentials mock is needed.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import type { Connection } from '../../../features/connections';
import { DpdCredentialsPanel } from './dpd-credentials-panel';

afterEach(cleanup);

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-dpd',
    platformType: 'dpd',
    name: 'DPD Polska',
    status: 'active',
    config: {},
    credentialsBacked: true,
    adapterKey: 'dpd.polska.rest.v1',
    supportedCapabilities: ['ShippingProviderManager'],
    enabledCapabilities: ['ShippingProviderManager'],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('DpdCredentialsPanel', () => {
  it('reveals login + password inputs on Rotate, with Save disabled until both are filled', () => {
    renderWithProviders(<DpdCredentialsPanel connection={makeConnection()} />);

    // The button sits inside a FormField whose <label> wins the accessible-name
    // computation, so query by visible text rather than role+name.
    fireEvent.click(screen.getByText('Rotate credentials'));

    const login = screen.getByPlaceholderText('New login');
    const password = screen.getByPlaceholderText('New password');
    const save = screen.getByText('Save credentials').closest('button');
    expect(save).not.toBeNull();
    expect(save).toBeDisabled();

    fireEvent.change(login, { target: { value: 'ol_99' } });
    expect(save).toBeDisabled(); // password still empty
    fireEvent.change(password, { target: { value: 'new-pass' } });
    expect(save).toBeEnabled();
  });

  it('renders a read-only affordance when credentials are not db-backed', () => {
    renderWithProviders(<DpdCredentialsPanel connection={makeConnection({ credentialsBacked: false })} />);
    expect(screen.getByDisplayValue(/Environment variable/i)).toBeInTheDocument();
    expect(screen.queryByText('Rotate credentials')).toBeNull();
  });
});
