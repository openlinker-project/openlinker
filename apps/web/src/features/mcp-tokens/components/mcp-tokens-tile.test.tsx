/**
 * MCP Tokens Tile — Tests
 *
 * Covers the tile's loading/success/degraded-shape states. Rendered under an
 * admin session throughout — non-admin visibility is asserted at the page
 * level in `settings-page.test.tsx`, since gating lives there, not in this
 * component.
 *
 * @module apps/web/src/features/mcp-tokens/components
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { McpToken } from '../api/mcp-tokens.types';
import { McpTokensTile } from './mcp-tokens-tile';

afterEach(cleanup);

const adminSessionAdapter = createAuthenticatedSessionAdapter();

const tokens: McpToken[] = [
  { id: 'tok-1', name: 'agent-1', isActive: true } as McpToken,
  { id: 'tok-2', name: 'agent-2', isActive: false } as McpToken,
];

describe('McpTokensTile', () => {
  it('shows a loading placeholder while the tokens query is in flight', async () => {
    const apiClient = createMockApiClient({
      mcpTokens: { list: vi.fn(() => new Promise<McpToken[]>(() => {})) },
    });
    renderWithProviders(<McpTokensTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(await screen.findByText('MCP tokens')).toBeInTheDocument();
    expect(screen.getByText('…')).toBeInTheDocument();
  });

  it('counts only active tokens once the list resolves', async () => {
    const apiClient = createMockApiClient({ mcpTokens: { list: vi.fn().mockResolvedValue(tokens) } });
    renderWithProviders(<McpTokensTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(await screen.findByText('1')).toBeInTheDocument();
  });

  it('degrades to "—" rather than throwing when the tokens query resolves to a non-array shape (#2926)', async () => {
    // A degraded API response (a 500 handled into an empty object, a
    // partial payload, a field dropped by version skew) can arrive as a
    // resolved query whose `data` is truthy but not an array — `?? null`
    // alone only guards `undefined`, and `.filter` on a plain object
    // throws. This must render the same "unknown" dash a failed/pending
    // read renders, never crash.
    const degraded = { data: [], total: 0 } as unknown as McpToken[];
    const apiClient = createMockApiClient({ mcpTokens: { list: vi.fn().mockResolvedValue(degraded) } });

    renderWithProviders(<McpTokensTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(await screen.findByText('MCP tokens')).toBeInTheDocument();
    expect(await screen.findByText('—')).toBeInTheDocument();
  });
});
