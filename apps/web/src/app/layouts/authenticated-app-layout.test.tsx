import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { AuthenticatedAppLayout } from './authenticated-app-layout';
import { createAuthenticatedSessionAdapter, renderWithProviders } from '../../test/test-utils';

function TestChild(): React.ReactElement {
  return <div>Authenticated content</div>;
}

function LoginSentinel(): React.ReactElement {
  return <div>Login page</div>;
}

function renderLayout(sessionAdapter?: ReturnType<typeof createAuthenticatedSessionAdapter>): void {
  renderWithProviders(
    <Routes>
      <Route path="/" element={<AuthenticatedAppLayout />}>
        <Route index element={<TestChild />} />
      </Route>
      <Route path="/login" element={<LoginSentinel />} />
    </Routes>,
    { sessionAdapter },
  );
}

describe('AuthenticatedAppLayout', () => {
  it('should redirect to /login when session is anonymous', async () => {
    renderLayout();

    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('should render children when session is authenticated', async () => {
    renderLayout(createAuthenticatedSessionAdapter());

    expect(await screen.findByText('Authenticated content')).toBeInTheDocument();
  });
});
