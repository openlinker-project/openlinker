/**
 * MCP Tokens Panel Tests
 *
 * Covers the four async UX states plus the security-critical behaviours:
 * the raw token is revealed exactly once and never re-rendered afterwards.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import { McpTokensPanel } from './mcp-tokens-panel';

const TOKEN = {
  id: 'token-1',
  userId: 'user-1',
  name: 'Claude Desktop',
  scopes: ['mcp:read'] as const,
  resource: 'https://ol.example.com/mcp',
  resourceMatchesCurrent: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2026-10-01T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  isActive: true,
};

describe('McpTokensPanel', () => {
  it('should render the token list when data loads', async () => {
    const apiClient = createMockApiClient({
      mcpTokens: { list: vi.fn().mockResolvedValue([TOKEN]) },
    });

    renderWithProviders(<McpTokensPanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText('Claude Desktop')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('should render an empty state when there are no tokens', async () => {
    const apiClient = createMockApiClient({
      mcpTokens: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<McpTokensPanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText('No MCP tokens')).toBeInTheDocument();
  });

  it('should render an error state when the list fails', async () => {
    const apiClient = createMockApiClient({
      mcpTokens: { list: vi.fn().mockRejectedValue(new Error('Network down')) },
    });

    renderWithProviders(<McpTokensPanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText('Could not load tokens')).toBeInTheDocument();
  });

  it('should reveal the raw token exactly once after creating', async () => {
    const user = userEvent.setup();
    const apiClient = createMockApiClient({
      mcpTokens: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ ...TOKEN, rawToken: 'olmcp_secret-value' }),
      },
    });

    renderWithProviders(<McpTokensPanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await user.type(await screen.findByLabelText(/name/i), 'Claude Desktop');
    await user.click(screen.getByRole('button', { name: /create token/i }));

    const revealed = await screen.findByTestId('mcp-token-raw-value');
    expect(revealed).toHaveTextContent('olmcp_secret-value');

    // Dismissing drops the value — it is held in component state only and
    // is never re-fetchable.
    await user.click(screen.getByRole('button', { name: /done/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('mcp-token-raw-value')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('olmcp_secret-value')).not.toBeInTheDocument();
  });

  it('should require confirmation before revoking', async () => {
    const user = userEvent.setup();
    const revoke = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      mcpTokens: { list: vi.fn().mockResolvedValue([TOKEN]), revoke },
    });

    renderWithProviders(<McpTokensPanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await user.click(await screen.findByRole('button', { name: /revoke/i }));
    expect(revoke).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: /^revoke$/i }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('token-1'));
  });
});
