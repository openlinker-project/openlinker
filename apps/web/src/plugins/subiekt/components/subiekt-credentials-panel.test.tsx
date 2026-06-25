/**
 * SubiektCredentialsPanel tests (#759)
 *
 * Pins the security properties of the Bearer bridge-token rotate flow, most
 * importantly the credential KEY (`bridgeToken`, Decision 7) so a drift from
 * the Subiekt BE adapter contract fails loudly.
 *
 * @module plugins/subiekt/components
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import type { Connection } from '../../../features/connections';
import { SubiektCredentialsPanel } from './subiekt-credentials-panel';

const subiektConnection: Connection = {
  ...sampleConnection,
  id: 'subiekt_1',
  name: 'Subiekt GT',
  platformType: 'subiekt',
  config: {},
  adapterKey: 'subiekt.bridge.v1',
};

describe('SubiektCredentialsPanel', () => {
  afterEach(cleanup);

  it('renders the rotate affordance for a credentials-backed connection', () => {
    renderWithProviders(<SubiektCredentialsPanel connection={subiektConnection} />);
    expect(screen.getByText('Rotate bridge token')).toBeInTheDocument();
  });

  it('falls back to the env-var disabled input when credentialsBacked=false', () => {
    const envBacked = { ...subiektConnection, credentialsBacked: false };
    renderWithProviders(<SubiektCredentialsPanel connection={envBacked} />);
    expect(
      screen.getByDisplayValue('Environment variable (not editable via UI)'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rotate/i })).not.toBeInTheDocument();
  });

  it('sends the rotated token under the key `bridgeToken`, NOT `webserviceApiKey`', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ connections: { updateCredentials } });
    renderWithProviders(<SubiektCredentialsPanel connection={subiektConnection} />, {
      apiClient,
    });

    fireEvent.click(screen.getByText('Rotate bridge token'));
    fireEvent.change(screen.getByPlaceholderText('New bridge token'), {
      target: { value: 'secret-bridge-token-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save new token' }));

    await waitFor(() => {
      expect(updateCredentials).toHaveBeenCalledWith(subiektConnection.id, {
        bridgeToken: 'secret-bridge-token-123',
      });
    });
    const [, body] = updateCredentials.mock.calls[0];
    expect(body).not.toHaveProperty('webserviceApiKey');
  });

  it('uses a type=password input with autoComplete=off', () => {
    renderWithProviders(<SubiektCredentialsPanel connection={subiektConnection} />);
    fireEvent.click(screen.getByText('Rotate bridge token'));
    const input = screen.getByPlaceholderText('New bridge token');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
  });

  it('clears the local token state on success and the success toast carries NO secret value', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ connections: { updateCredentials } });
    renderWithProviders(<SubiektCredentialsPanel connection={subiektConnection} />, {
      apiClient,
    });

    fireEvent.click(screen.getByText('Rotate bridge token'));
    fireEvent.change(screen.getByPlaceholderText('New bridge token'), {
      target: { value: 'secret-bridge-token-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save new token' }));

    // Form collapses (token state cleared) on success.
    await waitFor(() => {
      expect(screen.getByText('Rotate bridge token')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('New bridge token')).not.toBeInTheDocument();
    });

    const toast = await findToastTitle('Credentials rotated');
    expect(toast.textContent).not.toContain('secret-bridge-token-123');
  });
});
