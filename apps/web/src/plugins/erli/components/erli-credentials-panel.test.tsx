/**
 * ErliCredentialsPanel Tests
 *
 * Coverage for the rotate-API-key flow for Erli connections, plus (#1384)
 * the "Browse Allegro categories" checkbox: reveal/hide behaviour, the
 * client-side "both or neither" validation for the Client ID/Secret pair,
 * and the sequenced credentials-then-config atomicity write for
 * `allegroCategoryAccessEnabled` (both the enable and disable directions).
 * Also covers (#1387) the reuse-vs-manual Allegro credential source choice.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../../features/connections';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { ErliCredentialsPanel } from './erli-credentials-panel';

const erliConnection = { ...sampleConnection, platformType: 'erli' };
const erliConnectionWithAllegroAccess = {
  ...erliConnection,
  config: { ...erliConnection.config, allegroCategoryAccessEnabled: true },
};

const allegroConnection: Connection = {
  ...sampleConnection,
  id: 'conn_allegro_1',
  name: 'Main Allegro Store',
  platformType: 'allegro',
  adapterKey: 'allegro.publicapi.v1',
  enabledCapabilities: ['OrderSource', 'OfferManager'],
  supportedCapabilities: ['OrderSource', 'OfferManager'],
};

describe('ErliCredentialsPanel', () => {
  afterEach(cleanup);

  it('renders the rotate affordance for a credentials-backed connection', () => {
    renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />);
    expect(screen.getByText('Rotate API key')).toBeInTheDocument();
  });

  it('falls back to the env-var disabled input when credentialsBacked=false', () => {
    const envBacked = { ...erliConnection, credentialsBacked: false };
    renderWithProviders(<ErliCredentialsPanel connection={envBacked} />);
    expect(
      screen.getByDisplayValue('Environment variable (not editable via UI)')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rotate/i })).not.toBeInTheDocument();
  });

  it('sends the new apiKey and surfaces a success toast', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ connections: { updateCredentials } });
    renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />, { apiClient });

    fireEvent.click(screen.getByText('Rotate API key'));
    fireEvent.change(screen.getByPlaceholderText('New API key'), {
      target: { value: 'sk_new_456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));

    await waitFor(() => {
      expect(updateCredentials).toHaveBeenCalledWith(erliConnection.id, { apiKey: 'sk_new_456' });
    });
    expect(await findToastTitle('Credentials saved')).toBeInTheDocument();
  });

  it('disables save while every field is empty and the checkbox is unchanged', () => {
    renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />);
    fireEvent.click(screen.getByText('Rotate API key'));
    expect(screen.getByRole('button', { name: 'Save credentials' })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('New API key'), {
      target: { value: 'sk_new_456' },
    });
    expect(screen.getByRole('button', { name: 'Save credentials' })).toBeEnabled();
  });

  it('collapses the form after a successful save', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ connections: { updateCredentials } });
    renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />, { apiClient });

    fireEvent.click(screen.getByText('Rotate API key'));
    fireEvent.change(screen.getByPlaceholderText('New API key'), {
      target: { value: 'sk_new_456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));

    await waitFor(() => {
      expect(screen.getByText('Rotate API key')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('New API key')).not.toBeInTheDocument();
    });
  });

  it('reveals the Allegro Client ID/Secret fields only when the checkbox is checked', () => {
    renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />);
    fireEvent.click(screen.getByText('Rotate API key'));

    expect(screen.queryByPlaceholderText('Allegro Client ID')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));
    expect(screen.getByPlaceholderText('Allegro Client ID')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Allegro Client Secret')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));
    expect(screen.queryByPlaceholderText('Allegro Client ID')).not.toBeInTheDocument();
  });

  it('blocks submit client-side when only one of Client ID / Client Secret is filled', () => {
    renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />);
    fireEvent.click(screen.getByText('Rotate API key'));
    fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));
    fireEvent.change(screen.getByPlaceholderText('Allegro Client ID'), {
      target: { value: 'client-123' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));

    expect(
      screen.getByText(/enter both the allegro client id and client secret/i)
    ).toBeInTheDocument();
  });

  it('toggles the secret field between masked and plain text', () => {
    renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />);
    fireEvent.click(screen.getByText('Rotate API key'));
    fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));

    const secretInput = screen.getByPlaceholderText<HTMLInputElement>('Allegro Client Secret');
    expect(secretInput.type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: /show client secret/i }));
    expect(secretInput.type).toBe('text');
  });

  it('saves apiKey + Allegro credentials in one call, then patches allegroCategoryAccessEnabled=true', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(erliConnectionWithAllegroAccess);
    const apiClient = createMockApiClient({ connections: { updateCredentials, update } });
    renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />, { apiClient });

    fireEvent.click(screen.getByText('Rotate API key'));
    fireEvent.change(screen.getByPlaceholderText('New API key'), {
      target: { value: 'sk_new_456' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));
    fireEvent.change(screen.getByPlaceholderText('Allegro Client ID'), {
      target: { value: 'client-123' },
    });
    fireEvent.change(screen.getByPlaceholderText('Allegro Client Secret'), {
      target: { value: 'secret-456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));

    await waitFor(() => {
      expect(updateCredentials).toHaveBeenCalledWith(erliConnection.id, {
        apiKey: 'sk_new_456',
        allegroClientId: 'client-123',
        allegroClientSecret: 'secret-456',
      });
    });
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(erliConnection.id, {
        config: { ...erliConnection.config, allegroCategoryAccessEnabled: true },
      });
    });
    // Ordering: credentials write resolves strictly before the config patch fires.
    const credentialsOrder = updateCredentials.mock.invocationCallOrder[0];
    const configOrder = update.mock.invocationCallOrder[0];
    expect(credentialsOrder).toBeLessThan(configOrder);
  });

  it('unchecking a previously-enabled connection patches allegroCategoryAccessEnabled=false without resending credentials', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(erliConnection);
    const apiClient = createMockApiClient({ connections: { updateCredentials, update } });
    renderWithProviders(<ErliCredentialsPanel connection={erliConnectionWithAllegroAccess} />, {
      apiClient,
    });

    fireEvent.click(screen.getByText('Rotate API key'));
    fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(erliConnectionWithAllegroAccess.id, {
        config: { ...erliConnectionWithAllegroAccess.config, allegroCategoryAccessEnabled: false },
      });
    });
    expect(updateCredentials).not.toHaveBeenCalled();
  });

  it('disables save after typing a Client ID then unchecking the box (no discarded-input false success)', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(erliConnection);
    const apiClient = createMockApiClient({ connections: { updateCredentials, update } });
    renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />, { apiClient });

    fireEvent.click(screen.getByText('Rotate API key'));
    fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));
    fireEvent.change(screen.getByPlaceholderText('Allegro Client ID'), {
      target: { value: 'client-123' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));

    expect(screen.getByRole('button', { name: 'Save credentials' })).toBeDisabled();
    expect(updateCredentials).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('blocks submit when enabling the checkbox without ever entering credentials', () => {
    renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />);
    fireEvent.click(screen.getByText('Rotate API key'));
    fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));

    expect(
      screen.getByText(/enter the allegro client id and client secret to enable/i)
    ).toBeInTheDocument();
  });

  it('never fires the config patch when the credentials write rejects', async () => {
    const updateCredentials = vi.fn().mockRejectedValue(new Error('Invalid Allegro credentials'));
    const update = vi.fn().mockResolvedValue(erliConnectionWithAllegroAccess);
    const apiClient = createMockApiClient({ connections: { updateCredentials, update } });
    renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />, { apiClient });

    fireEvent.click(screen.getByText('Rotate API key'));
    fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));
    fireEvent.change(screen.getByPlaceholderText('Allegro Client ID'), {
      target: { value: 'client-123' },
    });
    fireEvent.change(screen.getByPlaceholderText('Allegro Client Secret'), {
      target: { value: 'secret-456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));

    await waitFor(() => {
      expect(updateCredentials).toHaveBeenCalledTimes(1);
    });
    expect(update).not.toHaveBeenCalled();
    expect(await screen.findByText('Invalid Allegro credentials')).toBeInTheDocument();
    // Panel stays open with the entered fields intact so a retry can resend them.
    expect(screen.getByPlaceholderText('Allegro Client ID')).toHaveValue('client-123');
  });

  it('keeps allegroCategoryAccessEnabled at its prior value and shows an inline error when the config patch rejects after credentials succeeded', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockRejectedValue(new Error('Connection update failed'));
    const apiClient = createMockApiClient({ connections: { updateCredentials, update } });
    renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />, { apiClient });

    fireEvent.click(screen.getByText('Rotate API key'));
    fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));
    fireEvent.change(screen.getByPlaceholderText('Allegro Client ID'), {
      target: { value: 'client-123' },
    });
    fireEvent.change(screen.getByPlaceholderText('Allegro Client Secret'), {
      target: { value: 'secret-456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText(/category-browsing setting failed to save/i)
    ).toBeInTheDocument();
    // Panel stays open (flag write failed, so it never got a chance to reflect the
    // new value anywhere the operator can see) and the fields aren't discarded.
    expect(screen.getByPlaceholderText('Allegro Client ID')).toHaveValue('client-123');
    expect(screen.queryByText('Credentials saved')).not.toBeInTheDocument();
  });

  describe('reuse an existing Allegro connection (#1387)', () => {
    it('shows only the manual fields plus a "no connection found" notice when there are zero Allegro connections', async () => {
      const list = vi.fn().mockResolvedValue([]);
      const apiClient = createMockApiClient({ connections: { list } });
      renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />, { apiClient });

      fireEvent.click(screen.getByText('Rotate API key'));
      fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));

      expect(
        await screen.findByText(/no allegro connection found on this account/i)
      ).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Allegro Client ID')).toBeInTheDocument();
      expect(
        screen.queryByText(/reuse credentials from an existing allegro connection/i)
      ).not.toBeInTheDocument();
    });

    it('defaults to the reuse radio with a connection picker when an Allegro connection exists', async () => {
      const list = vi.fn().mockResolvedValue([allegroConnection]);
      const apiClient = createMockApiClient({ connections: { list } });
      renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />, { apiClient });

      fireEvent.click(screen.getByText('Rotate API key'));
      fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));

      expect(
        await screen.findByText(/reuse credentials from an existing allegro connection/i)
      ).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /reuse credentials/i })).toBeChecked();
      expect(screen.getByRole('option', { name: allegroConnection.name })).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Allegro Client ID')).not.toBeInTheDocument();
    });

    it('sends reuseAllegroConnectionId (not raw credentials) and patches allegroCategoryAccessEnabled=true', async () => {
      const list = vi.fn().mockResolvedValue([allegroConnection]);
      const updateCredentials = vi.fn().mockResolvedValue(undefined);
      const update = vi.fn().mockResolvedValue(erliConnectionWithAllegroAccess);
      const apiClient = createMockApiClient({
        connections: { list, updateCredentials, update },
      });
      renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />, { apiClient });

      fireEvent.click(screen.getByText('Rotate API key'));
      fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));
      await screen.findByRole('combobox', { name: /allegro connection to reuse/i });
      fireEvent.change(screen.getByRole('combobox', { name: /allegro connection to reuse/i }), {
        target: { value: allegroConnection.id },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));

      await waitFor(() => {
        expect(updateCredentials).toHaveBeenCalledWith(erliConnection.id, {
          reuseAllegroConnectionId: allegroConnection.id,
        });
      });
      await waitFor(() => {
        expect(update).toHaveBeenCalledWith(erliConnection.id, {
          config: { ...erliConnection.config, allegroCategoryAccessEnabled: true },
        });
      });
      // The raw Allegro secret is never present anywhere in this flow's payloads.
      expect(updateCredentials.mock.calls[0][1]).not.toHaveProperty('allegroClientSecret');
    });

    it('switches to manual fields when "Enter Allegro app credentials manually" is chosen, unaffected by available connections', async () => {
      const list = vi.fn().mockResolvedValue([allegroConnection]);
      const updateCredentials = vi.fn().mockResolvedValue(undefined);
      const update = vi.fn().mockResolvedValue(erliConnectionWithAllegroAccess);
      const apiClient = createMockApiClient({
        connections: { list, updateCredentials, update },
      });
      renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />, { apiClient });

      fireEvent.click(screen.getByText('Rotate API key'));
      fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));
      await screen.findByRole('radio', { name: /enter allegro app credentials manually/i });
      fireEvent.click(
        screen.getByRole('radio', { name: /enter allegro app credentials manually/i })
      );

      expect(screen.getByPlaceholderText('Allegro Client ID')).toBeInTheDocument();
      fireEvent.change(screen.getByPlaceholderText('Allegro Client ID'), {
        target: { value: 'client-123' },
      });
      fireEvent.change(screen.getByPlaceholderText('Allegro Client Secret'), {
        target: { value: 'secret-456' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));

      await waitFor(() => {
        expect(updateCredentials).toHaveBeenCalledWith(erliConnection.id, {
          allegroClientId: 'client-123',
          allegroClientSecret: 'secret-456',
        });
      });
    });

    it('blocks submit when enabling via reuse without selecting a connection', async () => {
      const list = vi.fn().mockResolvedValue([allegroConnection]);
      const apiClient = createMockApiClient({ connections: { list } });
      renderWithProviders(<ErliCredentialsPanel connection={erliConnection} />, { apiClient });

      fireEvent.click(screen.getByText('Rotate API key'));
      fireEvent.click(screen.getByRole('checkbox', { name: /browse allegro categories/i }));
      await screen.findByRole('combobox', { name: /allegro connection to reuse/i });
      fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));

      expect(
        screen.getByText(/select an allegro connection to reuse its credentials/i)
      ).toBeInTheDocument();
    });
  });
});
