import { cleanup, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Permission } from '../../shared/auth/session.types';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../test/test-utils';
import { EditConnectionPage } from './edit-connection-page';

type TestSessionAdapter = ReturnType<typeof createAuthenticatedSessionAdapter>;

function sessionWith(
  role: 'viewer' | 'admin',
  permissions: Permission[],
): TestSessionAdapter {
  return createAuthenticatedSessionAdapter({
    id: `${role}-1`,
    username: role,
    email: `${role}@example.com`,
    role,
    permissions,
  });
}

function renderPage(sessionAdapter: TestSessionAdapter): void {
  const apiClient = createMockApiClient({
    connections: { getById: vi.fn().mockResolvedValue(sampleConnection) },
  });
  renderWithProviders(
    <Routes>
      <Route path="/connections/:connectionId/edit" element={<EditConnectionPage />} />
    </Routes>,
    { apiClient, route: `/connections/${sampleConnection.id}/edit`, sessionAdapter },
  );
}

describe('EditConnectionPage access', () => {
  afterEach(() => cleanup());

  it('should show a read-only note and no save button when the session lacks connections:write', async () => {
    renderPage(sessionWith('viewer', ['connections:read']));

    expect(await screen.findByText('Read-only access')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
  });

  it('should render the edit form when the session holds connections:write', async () => {
    renderPage(sessionWith('admin', ['connections:read', 'connections:write']));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled(),
    );
  });
});
