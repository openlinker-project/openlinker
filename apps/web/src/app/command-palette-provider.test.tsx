/**
 * CommandPaletteProvider Tests
 *
 * Covers the non-trivial behaviors of the global ⌘K command palette provider:
 * keyboard shortcut, context open() method, and recents push/dedup/load.
 *
 * @module app
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  renderWithProviders,
  sampleConnection,
} from '../test/test-utils';
import { CommandPaletteProvider, useCommandPalette } from './command-palette-provider';

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
  });

  describe('context open()', () => {
    it('should open the palette when open() is called via context', async () => {
      const user = userEvent.setup();
      renderPalette();
      await user.click(screen.getByRole('button', { name: 'open palette' }));
      expect(screen.getByRole('combobox')).toBeInTheDocument();
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
  });
});
