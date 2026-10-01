/**
 * CommandPaletteProvider Tests
 *
 * Covers the non-trivial behaviors of the global ⌘K command palette provider:
 * keyboard shortcut, context open() method, and recents push/dedup/load.
 *
 * @module app
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../test/test-utils';
import type { SessionUser } from '../shared/auth/session.types';
import { CommandPaletteProvider, useCommandPalette } from './command-palette-provider';

const captureDemoEvent = vi.fn();
vi.mock('../features/demo', () => ({
  captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args),
}));

const RECENTS_KEY = 'ol:palette:recent';

function OpenButton() {
  const { open } = useCommandPalette();
  return (
    <button type="button" onClick={open}>
      open palette
    </button>
  );
}

function renderPalette() {
  return renderWithProviders(
    <CommandPaletteProvider>
      <OpenButton />
    </CommandPaletteProvider>,
    { sessionAdapter: createAuthenticatedSessionAdapter() },
  );
}

describe('CommandPaletteProvider', () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem(RECENTS_KEY);
    captureDemoEvent.mockClear();
  });

  describe('keyboard shortcut', () => {
    it('should open the palette when ⌘K is pressed', () => {
      renderPalette();
      expect(screen.queryByRole('combobox')).toBeNull();
      fireEvent.keyDown(document, { key: 'k', metaKey: true });
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('should open the palette when Ctrl+K is pressed', () => {
      renderPalette();
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('should close the palette when ⌘K is pressed while open', () => {
      renderPalette();
      fireEvent.keyDown(document, { key: 'k', metaKey: true });
      expect(screen.getByRole('combobox')).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'k', metaKey: true });
      expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('fires demo_command_palette_opened with trigger="keyboard" on open, but not on the closing toggle (#1790)', () => {
      renderPalette();
      fireEvent.keyDown(document, { key: 'k', metaKey: true });
      expect(captureDemoEvent).toHaveBeenCalledWith('demo_command_palette_opened', {
        trigger: 'keyboard',
      });
      expect(captureDemoEvent).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(document, { key: 'k', metaKey: true });
      expect(captureDemoEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('context open()', () => {
    it('should open the palette when open() is called via context', async () => {
      const user = userEvent.setup();
      renderPalette();
      await user.click(screen.getByRole('button', { name: 'open palette' }));
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('fires demo_command_palette_opened with trigger="click" (#1790)', async () => {
      const user = userEvent.setup();
      renderPalette();
      await user.click(screen.getByRole('button', { name: 'open palette' }));
      expect(captureDemoEvent).toHaveBeenCalledWith('demo_command_palette_opened', {
        trigger: 'click',
      });
    });
  });

  describe('recents', () => {
    it('should show items loaded from localStorage when the palette opens', () => {
      // Use a synthetic label that won't collide with nav group items.
      const stored = [
        { id: 'conn:c_fixture', label: 'Fixture Connection', to: '/connections/c_fixture' },
      ];
      localStorage.setItem(RECENTS_KEY, JSON.stringify(stored));

      renderPalette();
      fireEvent.keyDown(document, { key: 'k', metaKey: true });

      expect(screen.getByText('Recent')).toBeInTheDocument();
      expect(screen.getByText('Fixture Connection')).toBeInTheDocument();
    });

    it('should persist a selected item to localStorage', async () => {
      const user = userEvent.setup();
      renderPalette();

      fireEvent.keyDown(document, { key: 'k', metaKey: true });

      // The default mock resolves connections.list to [sampleConnection]; wait for it.
      const item = await screen.findByText(sampleConnection.name);
      await user.click(item);

      const raw = localStorage.getItem(RECENTS_KEY);
      expect(raw).not.toBeNull();
      const recents = JSON.parse(raw!) as Array<{ id: string; label: string; to: string }>;
      expect(recents).toHaveLength(1);
      expect(recents[0].label).toBe(sampleConnection.name);
      expect(recents[0].to).toBe('/connections/' + sampleConnection.id);
    });

    it('should deduplicate when the same item is already in recents', async () => {
      // Pre-seed localStorage with the same connection the mock API returns.
      // Opening the palette will show the name in both "Recent" and "Connections" groups.
      const preSeeded = {
        id: 'conn:' + sampleConnection.id,
        label: sampleConnection.name,
        to: '/connections/' + sampleConnection.id,
        description: sampleConnection.platformType,
      };
      localStorage.setItem(RECENTS_KEY, JSON.stringify([preSeeded]));

      const user = userEvent.setup();
      renderPalette();

      fireEvent.keyDown(document, { key: 'k', metaKey: true });

      // The connection name appears in both "Recent" and "Connections" groups.
      // Click the Connections group entry (last occurrence) to trigger pushRecent.
      const all = await screen.findAllByText(sampleConnection.name);
      await user.click(all[all.length - 1]);

      const recents = JSON.parse(localStorage.getItem(RECENTS_KEY)!) as Array<{ id: string }>;
      const copies = recents.filter((r) => r.id === 'conn:' + sampleConnection.id);
      expect(copies).toHaveLength(1);
    });

    it('should not re-push an item when it is selected from the Recent group', async () => {
      // Pre-seed one recent; clicking it (isRecentClick = true) must not push again.
      const stored = [
        { id: 'conn:c_fixture', label: 'Fixture Connection', to: '/connections/c_fixture' },
      ];
      localStorage.setItem(RECENTS_KEY, JSON.stringify(stored));

      const user = userEvent.setup();
      renderPalette();

      fireEvent.keyDown(document, { key: 'k', metaKey: true });
      await user.click(await screen.findByText('Fixture Connection'));

      const recents = JSON.parse(localStorage.getItem(RECENTS_KEY)!) as unknown[];
      expect(recents).toHaveLength(1);
    });

    it('fires demo_command_palette_result_selected with source derived from the entry id prefix (#1790)', async () => {
      const user = userEvent.setup();
      renderPalette();

      fireEvent.keyDown(document, { key: 'k', metaKey: true });
      const item = await screen.findByText(sampleConnection.name);
      await user.click(item);

      expect(captureDemoEvent).toHaveBeenCalledWith('demo_command_palette_result_selected', {
        source: 'connections',
      });
    });

    it('attributes a Recent-group click to its original source, not a flat "recent" bucket (#1790)', async () => {
      // A recent entry's id still carries its original source prefix (e.g.
      // 'conn:...') — clicking it from the Recent group re-navigates via that
      // same id, so the richer original-source attribution is expected here.
      const stored = [
        { id: 'conn:c_fixture', label: 'Fixture Connection', to: '/connections/c_fixture' },
      ];
      localStorage.setItem(RECENTS_KEY, JSON.stringify(stored));

      const user = userEvent.setup();
      renderPalette();

      fireEvent.keyDown(document, { key: 'k', metaKey: true });
      await user.click(await screen.findByText('Fixture Connection'));

      expect(captureDemoEvent).toHaveBeenCalledWith('demo_command_palette_result_selected', {
        source: 'connections',
      });
    });
  });

  // #3505 — ⌘K must not surface the routing-only entries the sidebar hides.
  describe('routing-gated navigation', () => {
    const OPERATOR: SessionUser = {
      id: 'user_op',
      username: 'operator',
      email: 'operator@example.com',
      role: 'operator',
      permissions: ['orders:read', 'orders:write'],
    };

    function renderWithRouting(getStatus: ReturnType<typeof vi.fn>): void {
      renderWithProviders(
        <CommandPaletteProvider>
          <OpenButton />
        </CommandPaletteProvider>,
        {
          apiClient: createMockApiClient({ fulfillmentAuthority: { getStatus } as never }),
          sessionAdapter: createAuthenticatedSessionAdapter(OPERATOR),
        },
      );
    }

    function sourcingStatus(state: 'default' | 'resolved'): unknown {
      return {
        rows: [
          {
            question: 'sourcing',
            state,
            answer: { kind: 'nobody-to-route' },
            why: { kind: 'default', code: 'a2-single-origin-nothing-to-choose' },
            source: state === 'default' ? 'default' : 'operator-config',
            inactiveClaimantConnectionIds: [],
          },
        ],
        attention: { counted: [], routine: [], affectedOrderCount: 0 },
        presets: [],
        applied: null,
      };
    }

    it('should hide Fulfilment and Pack bench when routing is off', async () => {
      const getStatus = vi.fn().mockResolvedValue(sourcingStatus('default'));
      renderWithRouting(getStatus);

      fireEvent.keyDown(document, { key: 'k', metaKey: true });
      await waitFor(() => {
        expect(getStatus).toHaveBeenCalled();
      });
      expect((await screen.findAllByText('Shipments')).length).toBeGreaterThan(0);
      expect(screen.queryByText('Fulfilment')).toBeNull();
      expect(screen.queryByText('Pack bench')).toBeNull();
    });

    it('should list Fulfilment and Pack bench when routing is on', async () => {
      renderWithRouting(vi.fn().mockResolvedValue(sourcingStatus('resolved')));

      fireEvent.keyDown(document, { key: 'k', metaKey: true });

      expect(await screen.findByText('Fulfilment')).toBeInTheDocument();
      expect(screen.getByText('Pack bench')).toBeInTheDocument();
    });

    it('should list them when the routing state cannot be read', async () => {
      renderWithRouting(vi.fn().mockRejectedValue(new Error('status down')));

      fireEvent.keyDown(document, { key: 'k', metaKey: true });

      expect(await screen.findByText('Fulfilment')).toBeInTheDocument();
    });
  });
});
