import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { ConnectionCapabilitiesPanel } from './ConnectionCapabilitiesPanel';
import type { Connection } from '../api/connections.types';

describe('ConnectionCapabilitiesPanel', () => {
  afterEach(cleanup);

  it('renders one checkbox per supported capability, checked when enabled', () => {
    const connection: Connection = {
      ...sampleConnection,
      supportedCapabilities: ['ProductMaster', 'OrderSource'],
      enabledCapabilities: ['ProductMaster'],
    };
    renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />);

    expect(screen.getByRole('checkbox', { name: /ProductMaster/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /OrderSource/ })).not.toBeChecked();
    expect(screen.getByText(/1 of 2 enabled/)).toBeInTheDocument();
  });

  it('calls update mutation with new set when a capability is toggled', async () => {
    const update = vi.fn().mockResolvedValue({ ...sampleConnection });
    const apiClient = createMockApiClient({ connections: { update } });

    const connection: Connection = {
      ...sampleConnection,
      supportedCapabilities: ['ProductMaster', 'OrderSource'],
      enabledCapabilities: ['ProductMaster'],
    };
    renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />, {
      apiClient,
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /OrderSource/ }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        connection.id,
        expect.objectContaining({
          enabledCapabilities: expect.arrayContaining(['ProductMaster', 'OrderSource']),
        }),
      ),
    );
  });

  it('shows a warning when no capabilities are enabled', () => {
    const connection: Connection = {
      ...sampleConnection,
      supportedCapabilities: ['ProductMaster'],
      enabledCapabilities: [],
    };
    renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />);

    expect(screen.getByText(/No capabilities enabled/)).toBeInTheDocument();
  });

  it('renders the mutation error in an Alert when update fails', async () => {
    const update = vi.fn().mockRejectedValue(new Error('API update failed'));
    const apiClient = createMockApiClient({ connections: { update } });

    const connection: Connection = {
      ...sampleConnection,
      supportedCapabilities: ['ProductMaster', 'OrderSource'],
      enabledCapabilities: ['ProductMaster'],
    };
    renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />, {
      apiClient,
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /OrderSource/ }));

    expect(await screen.findByText(/Unable to update capabilities/)).toBeInTheDocument();
    expect(screen.getByText('API update failed')).toBeInTheDocument();
  });

  it('shows a notice when adapter is unknown (no supported capabilities)', () => {
    const connection: Connection = {
      ...sampleConnection,
      supportedCapabilities: [],
      enabledCapabilities: [],
    };
    renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />);

    expect(screen.getByText(/adapter is not recognized/)).toBeInTheDocument();
  });
});
