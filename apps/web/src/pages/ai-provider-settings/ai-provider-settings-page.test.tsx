/**
 * AI Provider Settings Page — Unit Tests
 *
 * Covers loading / error / non-admin / admin happy-path / no-key warning
 * branches under the multi-provider contract. Verifies the query is gated
 * on `isAdmin` (no API call when the session role is not admin) and that
 * the table renders one row per provider with the active marker.
 *
 * @module apps/web/src/pages/ai-provider-settings
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import type { AiProviderSettingsView } from '../../features/ai-provider-settings/api/ai-provider-settings.types';
import { AiProviderSettingsPage } from './ai-provider-settings-page';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(cleanup);

const adminAdapter = createAuthenticatedSessionAdapter({
  id: 'u1',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: [],
  analyticsConsent: true,
});

const viewerAdapter = createAuthenticatedSessionAdapter({
  id: 'u2',
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  permissions: [],
  analyticsConsent: true,
});

const baseView: AiProviderSettingsView = {
  activeProvider: 'anthropic',
  activeUpdatedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
  activeUpdatedBy: 'alice',
  providers: [
    { provider: 'anthropic', configured: true, source: 'db' },
    { provider: 'openai', configured: false, source: 'none' },
    { provider: 'fake', configured: false, source: 'none' },
  ],
};

describe('AiProviderSettingsPage', () => {
  it('renders the admin-required ErrorState for non-admin sessions and never calls the API', async () => {
    const getAll = vi.fn();
    const apiClient = createMockApiClient({ aiProviderSettings: { getAll } });

    renderWithProviders(<AiProviderSettingsPage />, {
      apiClient,
      sessionAdapter: viewerAdapter,
    });

    expect(await screen.findByText('Admin role required')).toBeInTheDocument();
    expect(getAll).not.toHaveBeenCalled();
  });

  it('shows the LoadingState while the query is in flight', () => {
    const getAll = vi.fn<() => Promise<AiProviderSettingsView>>(
      () => new Promise<AiProviderSettingsView>(() => undefined),
    );
    const apiClient = createMockApiClient({ aiProviderSettings: { getAll } });

    renderWithProviders(<AiProviderSettingsPage />, {
      apiClient,
      sessionAdapter: adminAdapter,
    });

    expect(screen.getByText('Loading provider settings')).toBeInTheDocument();
  });

  it('renders one row per provider with the active marker on the active row', async () => {
    const getAll = vi.fn().mockResolvedValue(baseView);
    const apiClient = createMockApiClient({ aiProviderSettings: { getAll } });

    renderWithProviders(<AiProviderSettingsPage />, {
      apiClient,
      sessionAdapter: adminAdapter,
    });

    expect(await screen.findByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText(/Fake \(offline stub\)/)).toBeInTheDocument();

    // Active badge appears on the active (anthropic) row only.
    const anthropicRow = screen.getByText('Anthropic').closest('tr');
    expect(anthropicRow).not.toBeNull();
    expect(within(anthropicRow as HTMLElement).getByText('Active')).toBeInTheDocument();
    const openaiRow = screen.getByText('OpenAI').closest('tr');
    expect(openaiRow).not.toBeNull();
    expect(within(openaiRow as HTMLElement).queryByText('Active')).not.toBeInTheDocument();
  });

  it('shows the no-provider warning when no real provider has a key', async () => {
    const getAll = vi.fn().mockResolvedValue({
      ...baseView,
      activeProvider: 'fake',
      providers: [
        { provider: 'anthropic', configured: false, source: 'none' },
        { provider: 'openai', configured: false, source: 'none' },
        { provider: 'fake', configured: false, source: 'none' },
      ],
    });
    const apiClient = createMockApiClient({ aiProviderSettings: { getAll } });

    renderWithProviders(<AiProviderSettingsPage />, {
      apiClient,
      sessionAdapter: adminAdapter,
    });

    expect(await screen.findByText('No AI provider configured')).toBeInTheDocument();
  });

  it('disables Make active when the target provider has no key configured', async () => {
    const getAll = vi.fn().mockResolvedValue(baseView);
    const apiClient = createMockApiClient({ aiProviderSettings: { getAll } });

    renderWithProviders(<AiProviderSettingsPage />, {
      apiClient,
      sessionAdapter: adminAdapter,
    });

    // Wait for table to render.
    await screen.findByText('OpenAI');

    // OpenAI has no key — its Make active button must be disabled.
    const openaiRow = screen.getByText('OpenAI').closest('tr');
    expect(openaiRow).not.toBeNull();
    const openaiActivate = within(openaiRow as HTMLElement).getByRole('button', {
      name: /make active/i,
    });
    expect(openaiActivate).toBeDisabled();
  });

  it('renders the ErrorState with retry when the query fails', async () => {
    const getAll = vi.fn().mockRejectedValue(new Error('Network down'));
    const apiClient = createMockApiClient({ aiProviderSettings: { getAll } });

    renderWithProviders(<AiProviderSettingsPage />, {
      apiClient,
      sessionAdapter: adminAdapter,
    });

    expect(
      await screen.findByText('Unable to load provider settings'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
