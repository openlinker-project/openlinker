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
import type { ApiClient } from './api/api-client';
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

function OpenAndPrefetchButtons() {
  const { open, prefetch } = useCommandPalette();
  return (
    <>
      <button type="button" onClick={open}>
        open palette
      </button>
      <button type="button" onMouseEnter={prefetch}>
        search trigger
      </button>
    </>
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

/**
 * Renders with an explicit mock ApiClient so a test can assert on the
 * palette's underlying `list` calls directly (#2936) — the four data
 * sources' network activity, not just what the DOM ends up showing.
 */
function renderPaletteWithApiClient(): { apiClient: ApiClient } {
  const apiClient = createMockApiClient();
  renderWithProviders(
    <CommandPaletteProvider>
      <OpenAndPrefetchButtons />
    </CommandPaletteProvider>,
    { sessionAdapter: createAuthenticatedSessionAdapter(), apiClient },
  );
  return { apiClient };
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

  describe('data query gating (#2936)', () => {
    it('fires none of the four palette data queries before the palette is ever touched', () => {
      const { apiClient } = renderPaletteWithApiClient();

      expect(apiClient.connections.list).not.toHaveBeenCalled();
      expect(apiClient.orders.list).not.toHaveBeenCalled();
      expect(apiClient.products.list).not.toHaveBeenCalled();
      expect(apiClient.syncJobs.list).not.toHaveBeenCalled();
    });

    it('fires the data queries once the palette opens via the keyboard shortcut', async () => {
      const { apiClient } = renderPaletteWithApiClient();

      fireEvent.keyDown(document, { key: 'k', metaKey: true });

      await waitFor(() => {
        expect(apiClient.connections.list).toHaveBeenCalled();
        expect(apiClient.orders.list).toHaveBeenCalled();
        expect(apiClient.syncJobs.list).toHaveBeenCalled();
      });
    });

    it('warms the queries on prefetch() without opening the palette', async () => {
      const user = userEvent.setup();
      const { apiClient } = renderPaletteWithApiClient();

      await user.hover(screen.getByRole('button', { name: 'search trigger' }));

      await waitFor(() => {
        expect(apiClient.connections.list).toHaveBeenCalled();
      });
      // Warming is not opening: the palette combobox must still be absent.
      expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('does not re-fire a query that a prior open already warmed', async () => {
      const { apiClient } = renderPaletteWithApiClient();

      fireEvent.keyDown(document, { key: 'k', metaKey: true }); // open
      await waitFor(() => expect(apiClient.connections.list).toHaveBeenCalledTimes(1));

      fireEvent.keyDown(document, { key: 'k', metaKey: true }); // close
      fireEvent.keyDown(document, { key: 'k', metaKey: true }); // reopen

      // TanStack's own staleTime/cache behaviour governs refetching from
      // here — the provider's gating flag itself must not force a second
      // fetch on every subsequent open.
      expect(apiClient.connections.list).toHaveBeenCalledTimes(1);
    });
  });
});
