import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { UsersPage } from './users-page';
import type { UserListFilters, UserListResponse, UserSummary } from '../../features/users/api/users.types';

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

function makeUsers(count: number, overrides: Partial<UserSummary> = {}): UserSummary[] {
  return Array.from({ length: count }, (_, i) =>
    makeUser({ id: `u${i}`, username: `user${i}`, ...overrides }),
  );
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

  it('should render role and actions as read-only for a pending user on the All users tab', async () => {
    // PATCH /users/:id/role has no pending-status guard on the backend, so the
    // auto-save role select must not appear for pending rows in this table —
    // role assignment for an unapproved account belongs to the dedicated
    // Approve flow on the Pending tab (see #1258 review).
    const mockApi = createMockApiClient({
      users: {
        list: vi.fn().mockResolvedValue({
          users: [makeUser({ id: 'u1', username: 'bob', status: 'pending' })],
          total: 1,
        }),
      },
    });
    renderWithProviders(<UsersPage />, { apiClient: mockApi });

    await screen.findByText('bob');
    expect(screen.queryByRole('combobox', { name: /change role/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByText('Review in Pending tab')).toBeInTheDocument();
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

  it('should call deactivate API when Deactivate clicked', async () => {
    const deactivateUser = vi.fn().mockResolvedValue(undefined);
    const mockApi = createMockApiClient({
      users: {
        list: vi.fn().mockResolvedValue({
          users: [makeUser({ id: 'u1', username: 'alice', status: 'active' })],
          total: 1,
        }),
        deactivate: deactivateUser,
      },
    });
    renderWithProviders(<UsersPage />, { apiClient: mockApi });

    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));

    expect(deactivateUser).toHaveBeenCalledWith('u1');
  });

  it('should show error toast when deactivate fails', async () => {
    const mockApi = createMockApiClient({
      users: {
        list: vi.fn().mockResolvedValue({
          users: [makeUser({ id: 'u1', username: 'alice', status: 'active' })],
          total: 1,
        }),
        deactivate: vi.fn().mockRejectedValue(new Error('Server error')),
      },
    });
    renderWithProviders(<UsersPage />, { apiClient: mockApi });

    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));

    expect(await screen.findByText('Deactivation failed')).toBeInTheDocument();
  });

  it('should call reactivate API when Reactivate clicked', async () => {
    const reactivateUser = vi.fn().mockResolvedValue(undefined);
    const mockApi = createMockApiClient({
      users: {
        list: vi.fn().mockResolvedValue({
          users: [makeUser({ id: 'u1', username: 'alice', status: 'deactivated' })],
          total: 1,
        }),
        reactivate: reactivateUser,
      },
    });
    renderWithProviders(<UsersPage />, { apiClient: mockApi });

    await userEvent.click(await screen.findByRole('button', { name: 'Reactivate' }));

    expect(reactivateUser).toHaveBeenCalledWith('u1');
  });

  it('should call delete API when Delete clicked and confirmed in dialog', async () => {
    const deleteUser = vi.fn().mockResolvedValue(undefined);
    const mockApi = createMockApiClient({
      users: {
        list: vi.fn().mockResolvedValue({
          users: [makeUser({ id: 'u1', username: 'alice', status: 'active' })],
          total: 1,
        }),
        delete: deleteUser,
      },
    });
    renderWithProviders(<UsersPage />, { apiClient: mockApi });

    // First click opens the ConfirmDialog
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    // Confirm inside the dialog to trigger the actual API call
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(deleteUser).toHaveBeenCalledWith('u1');
  });

  describe('pagination (#1258)', () => {
    it('should show "Page 1 of 2" with Previous disabled and Next enabled when total exceeds one page', async () => {
      const listMock = vi.fn((filters?: UserListFilters) => {
        if (filters?.status === 'pending') {
          return Promise.resolve({ users: [], total: 0 });
        }
        return Promise.resolve({ users: makeUsers(25), total: 26 });
      });
      const mockApi = createMockApiClient({ users: { list: listMock } });
      renderWithProviders(<UsersPage />, { apiClient: mockApi });

      expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    });

    it('should advance to the next page and disable Next once on the last page', async () => {
      const listMock = vi.fn((filters?: UserListFilters) => {
        if (filters?.status === 'pending') {
          return Promise.resolve({ users: [], total: 0 });
        }
        const page = filters?.page ?? 0;
        return Promise.resolve({
          users: page === 0 ? makeUsers(25) : makeUsers(1, { id: 'u25', username: 'user25' }),
          total: 26,
        });
      });
      const mockApi = createMockApiClient({ users: { list: listMock } });
      renderWithProviders(<UsersPage />, { apiClient: mockApi });

      await screen.findByText('Page 1 of 2');
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));

      expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();
      expect(listMock).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
    });

    it('should reflect the backend total on the tab badge, not the loaded page row count', async () => {
      const listMock = vi.fn((filters?: UserListFilters) => {
        if (filters?.status === 'pending') {
          return Promise.resolve({ users: [], total: 0 });
        }
        return Promise.resolve({ users: makeUsers(25), total: 40 });
      });
      const mockApi = createMockApiClient({ users: { list: listMock } });
      renderWithProviders(<UsersPage />, { apiClient: mockApi });

      const allTab = await screen.findByRole('tab', { name: /all users/i });
      expect(await within(allTab).findByText('40')).toBeInTheDocument();
    });

    it('should keep every managed user reachable via Next when pending rows are interleaved into All-tab pages', async () => {
      // 20 pending + 40 managed = 60 total, unfiltered pageSize 25. Pending
      // registrations are newest-first from the backend, so page 0 is mostly
      // pending rows and the managed users spill onto pages 1 and 2 — the
      // "All users" tab must paginate over the unfiltered total (60, 3 pages),
      // not a client-derived "managed" total, or the tail of managed users
      // becomes unreachable (see #1258 review).
      const pendingUsers = makeUsers(20, { status: 'pending' });
      const managedUsers = makeUsers(40, { status: 'active' }).map((u, i) => ({
        ...u,
        id: `m${i}`,
        username: `managed${i}`,
      }));
      const listMock = vi.fn((filters?: UserListFilters) => {
        if (filters?.status === 'pending') {
          return Promise.resolve({ users: pendingUsers, total: 20 });
        }
        const page = filters?.page ?? 0;
        const allUnfiltered = [...pendingUsers, ...managedUsers];
        const start = page * 25;
        return Promise.resolve({
          users: allUnfiltered.slice(start, start + 25),
          total: allUnfiltered.length,
        });
      });
      const mockApi = createMockApiClient({ users: { list: listMock } });
      renderWithProviders(<UsersPage />, { apiClient: mockApi });

      expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
      expect(screen.getByText('managed0')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
      expect(screen.getByText('managed39')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    });

    it("should preserve the Pending tab's page position when switching tabs and back", async () => {
      const listMock = vi.fn((filters?: UserListFilters) => {
        if (filters?.status === 'pending') {
          const page = filters.page ?? 0;
          return Promise.resolve({
            users:
              page === 0
                ? makeUsers(25, { status: 'pending' })
                : makeUsers(1, { id: 'u25', username: 'user25', status: 'pending' }),
            total: 26,
          });
        }
        return Promise.resolve({ users: [], total: 0 });
      });
      const mockApi = createMockApiClient({ users: { list: listMock } });
      renderWithProviders(<UsersPage defaultTab="pending" />, { apiClient: mockApi });

      await screen.findByText('Page 1 of 2');
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('tab', { name: /all users/i }));
      await userEvent.click(screen.getByRole('tab', { name: /pending/i }));

      expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();
    });
  });
});
