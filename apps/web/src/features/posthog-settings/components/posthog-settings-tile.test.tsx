/**
 * PostHog Settings Tile — Tests
 *
 * Covers the tile's loading/error/success (disabled + enabled-via-env +
 * enabled-with-DB-override) states. Rendered under an admin session
 * throughout — non-admin visibility is asserted at the page level in
 * `settings-page.test.tsx`, since gating lives there, not in this component.
 *
 * @module apps/web/src/features/posthog-settings/components
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { PosthogSettingsView } from '../api/posthog-settings.types';
import { PosthogSettingsTile } from './posthog-settings-tile';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(cleanup);

const adminSessionAdapter = createAuthenticatedSessionAdapter();

const disabledView: PosthogSettingsView = {
  enabled: false,
  region: 'eu',
  customHost: null,
  autocapture: false,
  sessionRecording: false,
  productEventsEnabled: false,
  enabledEventGroups: [],
  apiKeyConfigured: false,
  wouldOverrideEnv: false,
  overriddenEnvVars: [],
  updatedAt: null,
  updatedBy: null,
};

const envOnlyView: PosthogSettingsView = {
  enabled: true,
  region: 'us',
  customHost: null,
  autocapture: false,
  sessionRecording: true,
  productEventsEnabled: false,
  enabledEventGroups: [],
  apiKeyConfigured: true,
  wouldOverrideEnv: false,
  overriddenEnvVars: [],
  updatedAt: null,
  updatedBy: null,
};

const dbOverrideView: PosthogSettingsView = {
  enabled: true,
  region: 'us',
  customHost: null,
  autocapture: true,
  sessionRecording: true,
  productEventsEnabled: false,
  enabledEventGroups: [],
  apiKeyConfigured: true,
  wouldOverrideEnv: true,
  overriddenEnvVars: ['OL_POSTHOG_KEY'],
  updatedAt: '2026-07-01T00:00:00.000Z',
  updatedBy: 'admin',
};

describe('PosthogSettingsTile', () => {
  it('shows a loading state while the settings query is in flight', async () => {
    const apiClient = createMockApiClient({
      posthogSettings: { get: vi.fn(() => new Promise<PosthogSettingsView>(() => {})) },
    });
    renderWithProviders(<PosthogSettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(await screen.findByText('Loading analytics settings…')).toBeInTheDocument();
  });

  it('shows an error state when the settings query fails', async () => {
    const apiClient = createMockApiClient({
      posthogSettings: { get: vi.fn().mockRejectedValue(new Error('Network down')) },
    });
    renderWithProviders(<PosthogSettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(
      await screen.findByText(/Could not load analytics settings: Network down/),
    ).toBeInTheDocument();
  });

  it('shows the disabled state with no detail fields', async () => {
    const apiClient = createMockApiClient({
      posthogSettings: { get: vi.fn().mockResolvedValue(disabledView) },
    });
    renderWithProviders(<PosthogSettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(await screen.findByText('Disabled')).toBeInTheDocument();
    expect(screen.queryByText('Region')).not.toBeInTheDocument();
    expect(screen.queryByText('Overrides env')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('shows enabled-via-env without the override chip', async () => {
    const apiClient = createMockApiClient({
      posthogSettings: { get: vi.fn().mockResolvedValue(envOnlyView) },
    });
    renderWithProviders(<PosthogSettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(await screen.findByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Environment')).toBeInTheDocument();
    expect(screen.queryByText('Overrides env')).not.toBeInTheDocument();
  });

  it('shows the "Overrides env" chip and saved-settings source when a DB row overrides env', async () => {
    const apiClient = createMockApiClient({
      posthogSettings: { get: vi.fn().mockResolvedValue(dbOverrideView) },
    });
    renderWithProviders(<PosthogSettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(await screen.findByText('Overrides env')).toBeInTheDocument();
    expect(screen.getByText('Saved settings')).toBeInTheDocument();
    expect(screen.getByText('Configured')).toBeInTheDocument();
  });

  it('opens the edit dialog when Edit is clicked', async () => {
    const apiClient = createMockApiClient({
      posthogSettings: { get: vi.fn().mockResolvedValue(dbOverrideView) },
    });
    renderWithProviders(<PosthogSettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    const editButton = await screen.findByRole('button', { name: 'Edit' });
    fireEvent.click(editButton);

    await waitFor(() => {
      expect(screen.getByText('Edit analytics settings')).toBeInTheDocument();
    });
  });
});
