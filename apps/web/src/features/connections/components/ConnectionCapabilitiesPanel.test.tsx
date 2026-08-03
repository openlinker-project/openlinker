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

  // The hint is behind `AccessGate` on `connections:write` (#1993), so these
  // tests must supply a session that holds it: `renderWithProviders` defaults to
  // `createNoopSessionAdapter()`, i.e. an ANONYMOUS session with no permissions
  // at all, under which the hint is correctly never rendered. Assertions are
  // awaited because the gate renders nothing until the session has hydrated --
  // "not known yet" is deliberately not "denied".
  describe('MCP tool-staleness hint (#1949)', () => {
    const writeSession = createAuthenticatedSessionAdapter({
      id: 'admin-user',
      username: 'admin',
      email: null,
      role: 'admin',
      permissions: ['connections:read', 'connections:write'],
    });

    it('should show the reconnect hint when the connection supports an MCP-backing capability', async () => {
      const connection: Connection = {
        ...sampleConnection,
        supportedCapabilities: ['ProductMaster', 'OfferManager'],
        enabledCapabilities: ['ProductMaster'],
      };
      renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />, {
        sessionAdapter: writeSession,
      });

      expect(await screen.findByText(/MCP tools follow these capabilities/)).toBeInTheDocument();
    });

    it('should hide the reconnect hint when no supported capability backs an MCP tool', async () => {
      const connection: Connection = {
        ...sampleConnection,
        supportedCapabilities: ['OfferManager', 'CategoryProvisioner'],
        enabledCapabilities: ['OfferManager'],
      };
      renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />, {
        sessionAdapter: writeSession,
      });

      // Permitted session + settled panel, so the absence can only be
      // `backsMcpTools` being false -- not a missing permission and not the
      // pre-hydration state that every branch shares.
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
      renderWithProviders(<ConnectionCapabilitiesPanel connection={connection} />, {
        sessionAdapter: writeSession,
      });

      expect(await screen.findByText(/MCP tools follow these capabilities/)).toBeInTheDocument();
    });

    // The hint explains the consequence of CHANGING capabilities, so it is
    // gated on `connections:write` (#1993). A read-only session -- a public-demo
    // viewer holds `connections:read` alone -- must not be told to reconnect an
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

        // The panel itself still renders -- only the hint is gated, so this
        // also pins that the gate did not swallow the surrounding read-only
        // content a viewer is entitled to.
        expect(await screen.findByText(/1 of 2 enabled/)).toBeInTheDocument();
        expect(screen.queryByText(/MCP tools follow these capabilities/)).not.toBeInTheDocument();
      });

      it('should hide the hint from an anonymous session', async () => {
        // `renderWithProviders`' default adapter. Called out explicitly so the
        // three tests above cannot silently revert to it and pass for the wrong
        // reason -- an absent hint would then prove nothing about the gate.
        renderWithProviders(<ConnectionCapabilitiesPanel connection={mcpBackingConnection} />);

        expect(await screen.findByText(/1 of 2 enabled/)).toBeInTheDocument();
        expect(screen.queryByText(/MCP tools follow these capabilities/)).not.toBeInTheDocument();
      });
    });
  });
});
