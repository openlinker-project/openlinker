import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { GuestLayout } from './guest-layout';
import { createAuthenticatedSessionAdapter, renderWithProviders } from '../../test/test-utils';

function TestChild(): React.ReactElement {
  return <div>Guest content</div>;
}

function DashboardSentinel(): React.ReactElement {
  return <div>Dashboard page</div>;
}

function renderLayout(sessionAdapter?: ReturnType<typeof createAuthenticatedSessionAdapter>): void {
  renderWithProviders(
    <Routes>
      <Route path="/login" element={<GuestLayout />}>
        <Route index element={<TestChild />} />
      </Route>
      <Route path="/" element={<DashboardSentinel />} />
    </Routes>,
    { route: '/login', sessionAdapter },
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
});
