/**
 * AmazonCredentialsPanel tests (#4186)
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Connection } from '../../../features/connections';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { AmazonCredentialsPanel } from './amazon-credentials-panel';

const connection = { ...sampleConnection, platformType: 'amazon', credentialsBacked: true } as Connection;

afterEach(cleanup);

describe('AmazonCredentialsPanel', () => {
  it('should re-authorize with the full LWA set and an optional AWS key pair', async () => {
    const apiClient = createMockApiClient();
    renderWithProviders(<AmazonCredentialsPanel connection={connection} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Re-authorize' }));
    const save = screen.getByRole('button', { name: 'Save credentials' });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText('LWA client id'), { target: { value: 'amzn1.client' } });
    fireEvent.change(screen.getByLabelText('LWA client secret'), { target: { value: 'secret' } });
    fireEvent.change(screen.getByLabelText('Refresh token'), { target: { value: 'Atzr|new' } });
    fireEvent.change(screen.getByLabelText('AWS access key id (optional)'), { target: { value: 'AKIA1' } });
    expect(save).toBeDisabled();
    expect(screen.getByText('Enter both AWS keys, or neither.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('AWS secret access key'), { target: { value: 'aws-secret' } });
    fireEvent.click(save);

    await waitFor(() =>
      expect(apiClient.connections.updateCredentials).toHaveBeenCalledWith(connection.id, {
        clientId: 'amzn1.client',
        clientSecret: 'secret',
        refreshToken: 'Atzr|new',
        awsAccessKeyId: 'AKIA1',
        awsSecretAccessKey: 'aws-secret',
      }),
    );
  });

  it('should show the status without a write control to a read-only session', async () => {
    const viewer = createAuthenticatedSessionAdapter({
      id: 'u-viewer',
      username: 'viewer',
      email: null,
      role: 'viewer',
      permissions: ['connections:read'],
    });
    renderWithProviders(<AmazonCredentialsPanel connection={connection} />, { sessionAdapter: viewer });

    expect(await screen.findByDisplayValue('Stored')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-authorize' })).toBeNull();
  });
});
