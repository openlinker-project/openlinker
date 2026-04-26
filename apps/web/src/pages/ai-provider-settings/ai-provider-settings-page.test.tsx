/**
 * AI Provider Settings Page — Unit Tests
 *
 * Covers loading / error / non-admin / admin happy-path / fake-provider
 * branches. Verifies the query is gated on `isAdmin` (no API call when the
 * session role is not admin).
 *
 * @module apps/web/src/pages/ai-provider-settings
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
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
});

const viewerAdapter = createAuthenticatedSessionAdapter({
  id: 'u2',
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  permissions: [],
});

describe('AiProviderSettingsPage', () => {
  it('renders the admin-required ErrorState for non-admin sessions and never calls the API', async () => {
    const get = vi.fn();
    const apiClient = createMockApiClient({ aiProviderSettings: { get } });

    renderWithProviders(<AiProviderSettingsPage />, {
      apiClient,
      sessionAdapter: viewerAdapter,
    });

    expect(await screen.findByText('Admin role required')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('shows the LoadingState while the query is in flight', () => {
    const get = vi.fn<() => Promise<AiProviderSettingsView>>(
      () => new Promise<AiProviderSettingsView>(() => undefined),
    );
    const apiClient = createMockApiClient({ aiProviderSettings: { get } });

    renderWithProviders(<AiProviderSettingsPage />, {
      apiClient,
      sessionAdapter: adminAdapter,
    });

    expect(screen.getByText('Loading provider settings')).toBeInTheDocument();
  });

  it('renders the status card and form for an admin when source=db', async () => {
    const get = vi.fn().mockResolvedValue({
      provider: 'anthropic',
      configured: true,
      source: 'db',
    });
    const apiClient = createMockApiClient({ aiProviderSettings: { get } });

    renderWithProviders(<AiProviderSettingsPage />, {
      apiClient,
      sessionAdapter: adminAdapter,
    });

    expect(await screen.findByText('Stored encrypted')).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear stored key/i })).toBeInTheDocument();
  });

  it('hides the form and shows an info alert when provider=fake', async () => {
    const get = vi.fn().mockResolvedValue({
      provider: 'fake',
      configured: false,
      source: 'none',
    });
    const apiClient = createMockApiClient({ aiProviderSettings: { get } });

    renderWithProviders(<AiProviderSettingsPage />, {
      apiClient,
      sessionAdapter: adminAdapter,
    });

    expect(await screen.findByText('Fake provider active')).toBeInTheDocument();
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
  });

  it('renders the ErrorState with retry when the query fails', async () => {
    const get = vi.fn().mockRejectedValue(new Error('Network down'));
    const apiClient = createMockApiClient({ aiProviderSettings: { get } });

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
