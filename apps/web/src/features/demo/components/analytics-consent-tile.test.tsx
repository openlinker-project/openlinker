import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  findToastDescription,
  renderWithProviders,
  stubUnavailableLocalStorage,
} from '../../../test/test-utils';
import { DEMO_ANALYTICS_CONSENT_STORAGE_KEY } from '../demo.types';
import { AnalyticsConsentTile } from './analytics-consent-tile';

const enableDemoAnalytics = vi.fn();
const disableDemoAnalytics = vi.fn();
vi.mock('../lib/init-demo-integrations', () => ({
  enableDemoAnalytics: (): void => enableDemoAnalytics(),
  disableDemoAnalytics: (): void => disableDemoAnalytics(),
}));

const viewer = {
  id: 'user_2',
  username: 'demo_user',
  email: 'demo@example.com',
  role: 'viewer' as const,
  permissions: [],
  analyticsConsent: false,
};

const demoConfig = { demoMode: true };

describe('AnalyticsConsentTile (#1882)', () => {
  let restoreLocalStorage: (() => void) | null = null;

  beforeEach(() => {
    enableDemoAnalytics.mockClear();
    disableDemoAnalytics.mockClear();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    restoreLocalStorage?.();
    restoreLocalStorage = null;
    vi.restoreAllMocks();
  });

  it('should render nothing when the deployment is not in demo mode', async () => {
    const apiClient = createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
    });

    renderWithProviders(<AnalyticsConsentTile />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(viewer),
    });

    await waitFor(() => expect(apiClient.system.getConfig).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Analytics' })).not.toBeInTheDocument();
  });

  it('should render nothing for an anonymous visitor even in demo mode', async () => {
    const apiClient = createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue(demoConfig) },
    });

    renderWithProviders(<AnalyticsConsentTile />, { apiClient });

    await waitFor(() => expect(apiClient.system.getConfig).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Analytics' })).not.toBeInTheDocument();
  });

  it('should render the toggle in demo mode for an authenticated user', async () => {
    const apiClient = createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue(demoConfig) },
    });

    renderWithProviders(<AnalyticsConsentTile />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(viewer),
    });

    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument();
    expect(await screen.findByRole('checkbox')).not.toBeChecked();
  });

  it('should reflect a session that already granted consent', async () => {
    const apiClient = createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue(demoConfig) },
    });

    renderWithProviders(<AnalyticsConsentTile />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter({ ...viewer, analyticsConsent: true }),
    });

    expect(await screen.findByRole('checkbox')).toBeChecked();
  });

  it('should not claim that all inputs are masked — only passwords are (#1878)', async () => {
    const apiClient = createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue(demoConfig) },
    });

    renderWithProviders(<AnalyticsConsentTile />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(viewer),
    });

    expect(await screen.findByText(/Passwords are never recorded/)).toBeInTheDocument();
    expect(screen.queryByText(/all inputs masked/i)).not.toBeInTheDocument();
  });

  it('should persist consent, mirror it to localStorage, and opt PostHog back in', async () => {
    const updateAnalyticsConsent = vi
      .fn()
      .mockResolvedValue({ ...viewer, analyticsConsent: true });
    const apiClient = createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue(demoConfig) },
      auth: { updateAnalyticsConsent },
    });

    renderWithProviders(<AnalyticsConsentTile />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(viewer),
    });

    await userEvent.click(await screen.findByRole('checkbox'));

    await waitFor(() =>
      expect(updateAnalyticsConsent).toHaveBeenCalledWith({ analyticsConsent: true }),
    );
    expect(window.localStorage.getItem(DEMO_ANALYTICS_CONSENT_STORAGE_KEY)).toBe('accepted');
    expect(enableDemoAnalytics).toHaveBeenCalledTimes(1);
    expect(disableDemoAnalytics).not.toHaveBeenCalled();
    expect(await findToastDescription('Analytics sharing enabled.')).toBeInTheDocument();
  });

  it('should opt PostHog out immediately when consent is withdrawn', async () => {
    const updateAnalyticsConsent = vi
      .fn()
      .mockResolvedValue({ ...viewer, analyticsConsent: false });
    const apiClient = createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue(demoConfig) },
      auth: { updateAnalyticsConsent },
    });

    renderWithProviders(<AnalyticsConsentTile />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter({ ...viewer, analyticsConsent: true }),
    });

    await userEvent.click(await screen.findByRole('checkbox'));

    await waitFor(() =>
      expect(updateAnalyticsConsent).toHaveBeenCalledWith({ analyticsConsent: false }),
    );
    expect(window.localStorage.getItem(DEMO_ANALYTICS_CONSENT_STORAGE_KEY)).toBe('declined');
    expect(disableDemoAnalytics).toHaveBeenCalledTimes(1);
    expect(enableDemoAnalytics).not.toHaveBeenCalled();
  });

  it('should warn instead of claiming a clean save when the localStorage mirror fails', async () => {
    restoreLocalStorage = stubUnavailableLocalStorage();
    const updateAnalyticsConsent = vi.fn().mockResolvedValue({ ...viewer, analyticsConsent: true });
    const apiClient = createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue(demoConfig) },
      auth: { updateAnalyticsConsent },
    });

    renderWithProviders(<AnalyticsConsentTile />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(viewer),
    });

    await userEvent.click(await screen.findByRole('checkbox'));

    await waitFor(() =>
      expect(updateAnalyticsConsent).toHaveBeenCalledWith({ analyticsConsent: true }),
    );
    expect(
      await findToastDescription(
        'This browser blocks local storage, so you may be asked again on the next page load.',
      ),
    ).toBeInTheDocument();
    // The DB write still happened, so the live opt-in must still take effect.
    expect(enableDemoAnalytics).toHaveBeenCalledTimes(1);
  });

  it('should surface an error toast and leave PostHog + storage untouched when the call fails', async () => {
    const apiClient = createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue(demoConfig) },
      auth: { updateAnalyticsConsent: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    renderWithProviders(<AnalyticsConsentTile />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(viewer),
    });

    await userEvent.click(await screen.findByRole('checkbox'));

    expect(
      await findToastDescription('Could not update your analytics preference.'),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(DEMO_ANALYTICS_CONSENT_STORAGE_KEY)).toBeNull();
    expect(enableDemoAnalytics).not.toHaveBeenCalled();
    expect(disableDemoAnalytics).not.toHaveBeenCalled();
  });
});
