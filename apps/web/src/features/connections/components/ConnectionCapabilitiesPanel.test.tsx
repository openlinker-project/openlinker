import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
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

  it('renders supported capabilities as pills above the toggles', () => {
    const connection: Connection = {
      ...sampleConnection,
      supportedCapabilities: ['ProductMaster', 'InventoryMaster'],
      enabledCapabilities: ['ProductMaster'],
    };
    renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />);

    const pillsRow = screen.getByLabelText('Supported capabilities');
    expect(pillsRow).toBeInTheDocument();
    expect(pillsRow.textContent).toContain('ProductMaster');
    expect(pillsRow.textContent).toContain('InventoryMaster');
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

  it('shows a notice when there are no supported capabilities', () => {
    const connection: Connection = {
      ...sampleConnection,
      supportedCapabilities: [],
      enabledCapabilities: [],
    };
    renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />);

    expect(screen.getByText(/no capabilities available to toggle/)).toBeInTheDocument();
  });

  it('renders a checkbox for an Invoicing-only connection instead of the fallback notice', () => {
    const connection: Connection = {
      ...sampleConnection,
      supportedCapabilities: ['Invoicing'],
      enabledCapabilities: ['Invoicing'],
    };
    renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />);

    expect(screen.getByRole('checkbox', { name: /Invoicing/ })).toBeChecked();
    expect(screen.getByText(/1 of 1 enabled/)).toBeInTheDocument();
    expect(screen.queryByText(/no capabilities available to toggle/)).not.toBeInTheDocument();
  });

  it('disables OfferManager with an explanation while InventoryMaster is enabled', () => {
    const connection: Connection = {
      ...sampleConnection,
      supportedCapabilities: ['ProductMaster', 'InventoryMaster', 'OfferManager'],
      enabledCapabilities: ['ProductMaster', 'InventoryMaster'],
    };
    renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />);

    expect(screen.getByRole('checkbox', { name: /OfferManager/ })).toBeDisabled();
    expect(
      screen.getByText(/Unavailable while InventoryMaster is selected/),
    ).toBeInTheDocument();
    // The non-conflicting checkboxes stay operable.
    expect(screen.getByRole('checkbox', { name: /ProductMaster/ })).toBeEnabled();
  });

  it('disables InventoryMaster with an explanation while OfferManager is enabled', () => {
    const connection: Connection = {
      ...sampleConnection,
      supportedCapabilities: ['InventoryMaster', 'OfferManager'],
      enabledCapabilities: ['OfferManager'],
    };
    renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />);

    expect(screen.getByRole('checkbox', { name: /InventoryMaster/ })).toBeDisabled();
    expect(screen.getByText(/Unavailable while OfferManager is selected/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /OfferManager/ })).toBeEnabled();
  });

  it('keeps both pair members enabled for unchecking when neither is enabled', () => {
    const connection: Connection = {
      ...sampleConnection,
      supportedCapabilities: ['InventoryMaster', 'OfferManager'],
      enabledCapabilities: [],
    };
    renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />);

    expect(screen.getByRole('checkbox', { name: /InventoryMaster/ })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /OfferManager/ })).toBeEnabled();
  });

  it('renders togglable checkboxes for ProductPublisher and CategoryProvisioner (shop-listing caps)', () => {
    const connection: Connection = {
      ...sampleConnection,
      supportedCapabilities: ['ProductPublisher', 'CategoryProvisioner'],
      enabledCapabilities: ['ProductPublisher'],
    };
    renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />);

    expect(screen.getByRole('checkbox', { name: /ProductPublisher/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /CategoryProvisioner/ })).not.toBeChecked();
    expect(screen.getByText(/1 of 2 enabled/)).toBeInTheDocument();
    expect(screen.queryByText(/no capabilities available to toggle/)).not.toBeInTheDocument();
  });

  // These assertions are awaited rather than synchronous because the hint is
  // behind `AccessGate` (#1993), which renders nothing until the session has
  // hydrated -- "not known yet" is deliberately not "denied", so the hint
  // appears one tick after first paint. The negative case waits for the panel
  // to settle first, so it asserts a real absence rather than the pre-hydration
  // state every branch shares.
  describe('MCP tool-staleness hint (#1949)', () => {
    it('should show the reconnect hint when the connection supports an MCP-backing capability', async () => {
      const connection: Connection = {
        ...sampleConnection,
        supportedCapabilities: ['ProductMaster', 'OfferManager'],
        enabledCapabilities: ['ProductMaster'],
      };
      renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />);

      expect(await screen.findByText(/MCP tools follow these capabilities/)).toBeInTheDocument();
    });

    it('should hide the reconnect hint when no supported capability backs an MCP tool', async () => {
      const connection: Connection = {
        ...sampleConnection,
        supportedCapabilities: ['OfferManager', 'CategoryProvisioner'],
        enabledCapabilities: ['OfferManager'],
      };
      renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />);

      // An admin session holds `connections:write`, so anything still missing
      // once the panel has settled is missing because `backsMcpTools` is false.
      expect(await screen.findByText(/1 of 2 enabled/)).toBeInTheDocument();
      expect(screen.queryByText(/MCP tools follow these capabilities/)).not.toBeInTheDocument();
    });

    // The gate is keyed on SUPPORTED, not ENABLED: the hint must survive the
    // toggle that causes the staleness, or it disappears exactly when it matters.
    it('should keep the hint visible when the MCP-backing capability is supported but disabled', async () => {
      const connection: Connection = {
        ...sampleConnection,
        supportedCapabilities: ['ProductMaster', 'OfferManager'],
        enabledCapabilities: ['OfferManager'],
      };
      renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />);

      expect(await screen.findByText(/MCP tools follow these capabilities/)).toBeInTheDocument();
    });

    // The hint explains the consequence of CHANGING capabilities, so it is
    // gated on `connections:write` (#1993). A read-only session — a public-demo
    // viewer holds `connections:read` alone — must not be told to reconnect an
    // agent it cannot have, over a control it cannot operate.
    describe('permission gate', () => {
      const mcpBackingConnection: Connection = {
        ...sampleConnection,
        supportedCapabilities: ['ProductMaster', 'OfferManager'],
        enabledCapabilities: ['ProductMaster'],
      };

      it('should hide the hint from a session without connections:write', async () => {
        renderWithProviders(<ConnectionCapabilitiesPanel connection={mcpBackingConnection} />, {
          sessionAdapter: createAuthenticatedSessionAdapter({
            id: 'demo-viewer',
            username: 'demo-viewer',
            email: null,
            role: 'viewer',
            permissions: ['connections:read'],
          }),
        });

        // The panel itself still renders — only the hint is gated, so this
        // also pins that the gate did not swallow the surrounding read-only
        // content a viewer is entitled to.
        expect(await screen.findByText(/1 of 2 enabled/)).toBeInTheDocument();
        expect(screen.queryByText(/MCP tools follow these capabilities/)).not.toBeInTheDocument();
      });

      // `connections:write` is admin-only in `ROLE_PERMISSIONS`, so the fixture
      // that holds it is an admin — an operator would not see the hint either.
      it('should show the hint to a session holding connections:write', async () => {
        renderWithProviders(<ConnectionCapabilitiesPanel connection={mcpBackingConnection} />, {
          sessionAdapter: createAuthenticatedSessionAdapter({
            id: 'admin-user',
            username: 'admin',
            email: null,
            role: 'admin',
            permissions: ['connections:read', 'connections:write'],
          }),
        });

        expect(await screen.findByText(/MCP tools follow these capabilities/)).toBeInTheDocument();
      });
    });
  });
});
