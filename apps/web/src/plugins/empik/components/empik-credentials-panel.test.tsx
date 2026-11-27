/**
 * EmpikCredentialsPanel Tests
 *
 * Replacing the Empik shop API key in place. Same flow as the inFakt panel.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { EmpikCredentialsPanel } from './empik-credentials-panel';

const empikConnection = { ...sampleConnection, platformType: 'empik' };

describe('EmpikCredentialsPanel', () => {
  afterEach(cleanup);

  it('should offer to replace the key when the connection stores its credentials', () => {
    renderWithProviders(<EmpikCredentialsPanel connection={empikConnection} />);
    expect(screen.getByRole('button', { name: 'Replace API key' })).toBeInTheDocument();
  });

  it('should show a read-only field when the credentials come from the environment', () => {
    renderWithProviders(
      <EmpikCredentialsPanel connection={{ ...empikConnection, credentialsBacked: false }} />,
    );
    expect(screen.getByDisplayValue('Environment variable (not editable via UI)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replace API key' })).not.toBeInTheDocument();
  });

  it('should save the new key and confirm when submitted', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ connections: { updateCredentials } });
    renderWithProviders(<EmpikCredentialsPanel connection={empikConnection} />, { apiClient });

    fireEvent.click(screen.getByRole('button', { name: 'Replace API key' }));
    fireEvent.change(screen.getByPlaceholderText('New API key'), { target: { value: ' key-2 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new API key' }));

    await waitFor(() => {
      expect(updateCredentials).toHaveBeenCalledWith(empikConnection.id, { apiKey: 'key-2' });
    });
    expect(await findToastTitle('API key replaced')).toBeInTheDocument();
  });

  it('should keep save disabled while the new key is empty', () => {
    renderWithProviders(<EmpikCredentialsPanel connection={empikConnection} />);
    fireEvent.click(screen.getByRole('button', { name: 'Replace API key' }));
    expect(screen.getByRole('button', { name: 'Save new API key' })).toBeDisabled();
  });
});
