import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { GuestLayout } from './guest-layout';
import {
  createAuthenticatedSessionAdapter,
  type createMockApiClient,
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

  it('should put the language switch on the guest card, not in the page corner (#4021)', async () => {
    renderLayout();

    const trigger = await screen.findByRole('button', { name: /^Language:/ });
    expect(trigger.closest('.guest-card')).not.toBeNull();
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
});
