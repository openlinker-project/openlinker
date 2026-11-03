import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { GuestLayout } from './guest-layout';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';

function TestChild(): React.ReactElement {
  return <div>Guest content</div>;
}

function DashboardSentinel(): React.ReactElement {
  return <div>Dashboard page</div>;
}

function OrderSentinel(): React.ReactElement {
  return <div>Order page</div>;
}

function BenchSentinel(): React.ReactElement {
  return <div>Bench page</div>;
}

function renderLayout(
  sessionAdapter?: ReturnType<typeof createAuthenticatedSessionAdapter>,
  options?: { apiClient?: ReturnType<typeof createMockApiClient>; route?: string }
): void {
  renderWithProviders(
    <Routes>
      <Route path="/login" element={<GuestLayout />}>
        <Route index element={<TestChild />} />
      </Route>
      <Route path="/register" element={<GuestLayout />}>
        <Route index element={<TestChild />} />
      </Route>
      <Route path="/forgot-password" element={<GuestLayout />}>
        <Route index element={<TestChild />} />
      </Route>
      <Route path="/" element={<DashboardSentinel />} />
      <Route path="/orders/:id" element={<OrderSentinel />} />
      <Route path="/bench" element={<BenchSentinel />} />
    </Routes>,
    { route: options?.route ?? '/login', sessionAdapter, apiClient: options?.apiClient }
  );
}

describe('GuestLayout', () => {
  it('should render children when session is anonymous', async () => {
    renderLayout();

    expect(await screen.findByText('Guest content')).toBeInTheDocument();
    expect(screen.getByText('OpenLinker')).toBeInTheDocument();
  });

  it('should redirect to / when session is authenticated', async () => {
    renderLayout(createAuthenticatedSessionAdapter());

    expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
  });

  it('should send a signed-in packer to the bench, ignoring next (#3096)', async () => {
    renderLayout(
      createAuthenticatedSessionAdapter({
        id: 'user_9',
        username: 'packer',
        email: null,
        role: 'packer',
        permissions: ['bench:write'],
      }),
      { route: '/login?next=%2Forders%2Fabc' }
    );

    expect(await screen.findByText('Bench page')).toBeInTheDocument();
  });

  it('should return a signed-in operator to the deep link in next (#3096)', async () => {
    renderLayout(createAuthenticatedSessionAdapter(), { route: '/login?next=%2Forders%2Fabc' });

    expect(await screen.findByText('Order page')).toBeInTheDocument();
  });

  it('should refuse an off-site next and fall back to the root (#3096)', async () => {
    renderLayout(createAuthenticatedSessionAdapter(), {
      route: `/login?next=${encodeURIComponent('//evil.example')}`,
    });

    expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
  });

  describe('marketing UTM capture (captureMarketingLanding)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      window.sessionStorage.clear();
    });

    it('should capture the landing when demo mode, posthog, and a utm param are all present', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      const apiClient = createMockApiClient({
        system: {
          getConfig: vi.fn().mockResolvedValue({
            demoMode: true,
            demoIntegrations: {
              posthog: {
                key: 'phc_abc',
                host: 'https://eu.i.posthog.com',
                autocapture: true,
                sessionRecording: true,
              },
            },
          }),
        },
      });

      renderLayout(undefined, {
        apiClient,
        route: '/login?utm_source=email&utm_campaign=demo_invite_2026_07',
      });

      await screen.findByText('Guest content');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe('https://eu.i.posthog.com/capture/');
    });

    it('should not capture when the URL carries no utm params', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      const apiClient = createMockApiClient({
        system: {
          getConfig: vi.fn().mockResolvedValue({
            demoMode: true,
            demoIntegrations: {
              posthog: {
                key: 'phc_abc',
                host: 'https://eu.i.posthog.com',
                autocapture: true,
                sessionRecording: true,
              },
            },
          }),
        },
      });

      renderLayout(undefined, { apiClient, route: '/login' });

      await screen.findByText('Guest content');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should not capture on /forgot-password even when a utm param is present', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      const apiClient = createMockApiClient({
        system: {
          getConfig: vi.fn().mockResolvedValue({
            demoMode: true,
            demoIntegrations: {
              posthog: {
                key: 'phc_abc',
                host: 'https://eu.i.posthog.com',
                autocapture: true,
                sessionRecording: true,
              },
            },
          }),
        },
      });

      renderLayout(undefined, {
        apiClient,
        route: '/forgot-password?utm_source=email&utm_campaign=demo_invite_2026_07',
      });

      await screen.findByText('Guest content');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should not capture when the session is already authenticated even with a utm param present', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      const apiClient = createMockApiClient({
        system: {
          getConfig: vi.fn().mockResolvedValue({
            demoMode: true,
            demoIntegrations: {
              posthog: {
                key: 'phc_abc',
                host: 'https://eu.i.posthog.com',
                autocapture: true,
                sessionRecording: true,
              },
            },
          }),
        },
      });

      renderLayout(createAuthenticatedSessionAdapter(), {
        apiClient,
        route: '/login?utm_source=email&utm_campaign=demo_invite_2026_07',
      });

      await screen.findByText('Dashboard page');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
