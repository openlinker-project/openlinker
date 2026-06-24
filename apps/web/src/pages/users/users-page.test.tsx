import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { UsersPage } from './users-page';
import type { UserListResponse, UserSummary } from '../../features/users/api/users.types';

function makeUser(overrides: Partial<UserSummary> = {}): UserSummary {
  return {
    id: 'u1',
    username: 'alice',
    email: 'alice@test.com',
    role: 'viewer',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('UsersPage', () => {
  afterEach(cleanup);

  it('should show loading skeleton while fetching', () => {
    const mockApi = createMockApiClient({
      users: { list: vi.fn(() => new Promise<UserListResponse>(() => undefined)) as ReturnType<typeof createMockApiClient>['users']['list'] },
    });
    renderWithProviders(<UsersPage />, { apiClient: mockApi });

    expect(document.querySelector('.data-table-skeleton')).not.toBeNull();
  });

  it('should render users in the table', async () => {
    const mockApi = createMockApiClient({
      users: {
        list: vi.fn().mockResolvedValue({
          users: [makeUser({ id: 'u1', username: 'alice', status: 'active' })],
          total: 1,
        }),
      },
    });
    renderWithProviders(<UsersPage />, { apiClient: mockApi });

    expect(await screen.findByText('alice')).toBeInTheDocument();
  });

  it('should show empty state when no users match', async () => {
    const mockApi = createMockApiClient({
      users: { list: vi.fn().mockResolvedValue({ users: [], total: 0 }) },
    });
    renderWithProviders(<UsersPage />, { apiClient: mockApi });

    expect(await screen.findByText('No users found')).toBeInTheDocument();
  });

  it('should show error state and retry button on fetch failure', async () => {
    const mockApi = createMockApiClient({
      users: { list: vi.fn().mockRejectedValue(new Error('Network error')) },
    });
    renderWithProviders(<UsersPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load users')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('should show role picker and Approve + Reject buttons for pending users', async () => {
    const mockApi = createMockApiClient({
      users: {
        list: vi.fn().mockResolvedValue({
          users: [makeUser({ id: 'u1', username: 'bob', status: 'pending' })],
          total: 1,
        }),
      },
    });
    renderWithProviders(<UsersPage defaultTab="pending" />, { apiClient: mockApi });

    expect(await screen.findByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /role for approval/i })).toBeInTheDocument();
  });

  it('should show role change select for active users', async () => {
    const mockApi = createMockApiClient({
      users: {
        list: vi.fn().mockResolvedValue({
          users: [makeUser({ id: 'u1', username: 'alice', status: 'active' })],
          total: 1,
        }),
      },
    });
    renderWithProviders(<UsersPage />, { apiClient: mockApi });

    expect(await screen.findByRole('combobox', { name: /change role/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
  });

  it('should call approve API with selected role when Approve clicked', async () => {
    const approveUser = vi.fn().mockResolvedValue(undefined);
    const mockApi = createMockApiClient({
      users: {
        list: vi.fn().mockResolvedValue({
          users: [makeUser({ id: 'u1', username: 'bob', status: 'pending' })],
          total: 1,
        }),
        approve: approveUser,
      },
    });
    renderWithProviders(<UsersPage defaultTab="pending" />, { apiClient: mockApi });

    const roleSelect = await screen.findByRole('combobox', { name: /role for approval/i });
    await userEvent.selectOptions(roleSelect, 'admin');
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));

    expect(approveUser).toHaveBeenCalledWith('u1', { role: 'admin' });
  });
});
