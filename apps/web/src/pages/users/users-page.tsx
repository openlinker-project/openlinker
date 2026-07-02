/**
 * Users Management Page
 *
 * Admin-only page for listing, approving, rejecting, and managing user accounts.
 * Two tabs: "All users" (active + deactivated) and "Pending" (approval queue).
 *
 * @module pages/users
 */
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../shared/ui/tabs';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { Button } from '../../shared/ui/button';
import { Alert } from '../../shared/ui/alert';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { Select } from '../../shared/ui/select';
import { useToast } from '../../shared/ui/toast-provider';
import { useSession } from '../../shared/auth/use-session';
import { useUsersQuery } from '../../features/users/hooks/use-users-query';
import { useApproveUserMutation } from '../../features/users/hooks/use-approve-user-mutation';
import { useRejectUserMutation } from '../../features/users/hooks/use-reject-user-mutation';
import { useUpdateRoleMutation } from '../../features/users/hooks/use-update-role-mutation';
import { useDeactivateUserMutation } from '../../features/users/hooks/use-deactivate-user-mutation';
import { useReactivateUserMutation } from '../../features/users/hooks/use-reactivate-user-mutation';
import { useDeleteUserMutation } from '../../features/users/hooks/use-delete-user-mutation';
import type { UserRole, UserStatus, UserSummary } from '../../features/users/api/users.types';

const STATUS_TONE: Record<UserStatus, StatusBadgeTone> = {
  active: 'success',
  pending: 'warning',
  deactivated: 'neutral',
};

const PAGE_SIZE = 25;

interface UsersPageProps {
  defaultTab?: 'all' | 'pending';
}

export function UsersPage({ defaultTab = 'all' }: UsersPageProps): ReactElement {
  const [pendingRoles, setPendingRoles] = useState<Record<string, UserRole>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const { showToast } = useToast();
  const { session } = useSession();
  const currentUserId = session.user?.id ?? null;

  // Per-tab page state lives in the URL (docs/frontend-architecture.md § URL
  // State) so each tab's position is bookmarkable and switching tabs never
  // resets the other tab's page.
  const [searchParams, setSearchParams] = useSearchParams();
  const allPage = Number(searchParams.get('allPage') ?? '0');
  const pendingPage = Number(searchParams.get('pendingPage') ?? '0');

  function setAllPage(next: number): void {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 0) {
        p.delete('allPage');
      } else {
        p.set('allPage', String(next));
      }
      return p;
    });
  }

  function setPendingPage(next: number): void {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 0) {
        p.delete('pendingPage');
      } else {
        p.set('pendingPage', String(next));
      }
      return p;
    });
  }

  // Two independent server-paginated queries (#1258). "All users" has no
  // status filter — pending rows mixed into a page are excluded client-side
  // below — while "Pending" applies an exact server-side status filter.
  const allUsersQuery = useUsersQuery({ page: allPage, pageSize: PAGE_SIZE });
  const pendingUsersQuery = useUsersQuery({ status: 'pending', page: pendingPage, pageSize: PAGE_SIZE });
  const approveMutation = useApproveUserMutation();
  const rejectMutation = useRejectUserMutation();
  const updateRoleMutation = useUpdateRoleMutation();
  const deactivateMutation = useDeactivateUserMutation();
  const reactivateMutation = useReactivateUserMutation();
  const deleteMutation = useDeleteUserMutation();

  const managedUsers = (allUsersQuery.data?.users ?? []).filter((u) => u.status !== 'pending');
  const pendingUsers = pendingUsersQuery.data?.users ?? [];
  const pendingTotal = pendingUsersQuery.data?.total ?? 0;
  // Approximate but correct for typical usage — pending registrations are a
  // small set, and the "All users" query has no status filter of its own.
  const managedTotal = Math.max(0, (allUsersQuery.data?.total ?? 0) - pendingTotal);

  const getRoleForPending = (userId: string): UserRole => pendingRoles[userId] ?? 'viewer';

  const anyError =
    approveMutation.error ??
    rejectMutation.error ??
    updateRoleMutation.error ??
    deactivateMutation.error ??
    reactivateMutation.error ??
    deleteMutation.error;

  async function handleApprove(userId: string): Promise<void> {
    const role = getRoleForPending(userId);
    try {
      await approveMutation.mutateAsync({ userId, input: { role } });
      showToast({ tone: 'success', title: 'User approved', description: 'The user can now log in.' });
    } catch {
      showToast({ tone: 'error', title: 'Approval failed', description: 'Try again or check permissions.' });
    }
  }

  async function handleReject(userId: string): Promise<void> {
    try {
      await rejectMutation.mutateAsync(userId);
      showToast({ tone: 'success', title: 'Registration rejected', description: 'The registration has been removed.' });
    } catch {
      showToast({ tone: 'error', title: 'Rejection failed', description: 'Try again.' });
    }
  }

  async function handleUpdateRole(userId: string, role: UserRole): Promise<void> {
    try {
      await updateRoleMutation.mutateAsync({ userId, role });
      showToast({ tone: 'success', title: 'Role updated', description: `Role changed to ${role}.` });
    } catch {
      showToast({ tone: 'error', title: 'Role update failed', description: 'Try again.' });
    }
  }

  async function handleDeactivate(userId: string): Promise<void> {
    try {
      await deactivateMutation.mutateAsync(userId);
      showToast({ tone: 'success', title: 'User deactivated', description: 'The user can no longer log in.' });
    } catch {
      showToast({ tone: 'error', title: 'Deactivation failed', description: 'Try again.' });
    }
  }

  async function handleReactivate(userId: string): Promise<void> {
    try {
      await reactivateMutation.mutateAsync(userId);
      showToast({ tone: 'success', title: 'User reactivated', description: 'The user can log in again.' });
    } catch {
      showToast({ tone: 'error', title: 'Reactivation failed', description: 'Try again.' });
    }
  }

  async function handleDelete(userId: string): Promise<void> {
    try {
      await deleteMutation.mutateAsync(userId);
      setPendingDeleteId(null);
      showToast({ tone: 'success', title: 'User deleted', description: 'The user has been removed.' });
    } catch {
      showToast({ tone: 'error', title: 'Deletion failed', description: 'Try again.' });
    }
  }

  // Columns for the Pending tab: role picker inline with Approve, separate Reject
  const pendingColumns = useMemo<DataTableColumn<UserSummary>[]>(() => [
    {
      id: 'username',
      header: 'Username',
      cell: (row) => <span className="mono-text">{row.username}</span>,
    },
    {
      id: 'email',
      header: 'Email',
      cell: (row) => row.email ?? <span className="empty-value">—</span>,
    },
    {
      id: 'requested',
      header: 'Requested',
      cell: (row) => (
        <span className="cell-meta mono-text tabular">
          {new Date(row.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: 'approve',
      header: 'Assign role & approve',
      cell: (row) => (
        <div className="table-actions">
          <Select
            className="select--sm"
            aria-label="Role for approval"
            value={getRoleForPending(row.id)}
            onChange={(e) =>
              setPendingRoles((prev) => ({ ...prev, [row.id]: e.target.value as UserRole }))
            }
          >
            <option value="viewer">Viewer</option>
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
          </Select>
          <Button
            tone="primary"
            className="button--sm"
            onClick={() => void handleApprove(row.id)}
            disabled={approveMutation.isPending}
          >
            Approve
          </Button>
        </div>
      ),
    },
    {
      id: 'reject',
      header: '',
      cell: (row) => (
        <Button
          tone="danger"
          className="button--sm"
          onClick={() => void handleReject(row.id)}
          disabled={rejectMutation.isPending}
        >
          Reject
        </Button>
      ),
    },
  ], [pendingRoles, approveMutation.isPending, rejectMutation.isPending]);

  // Columns for the All users tab: status badge, inline role select (auto-save), member since, actions
  const managedColumns = useMemo<DataTableColumn<UserSummary>[]>(() => [
    {
      id: 'username',
      header: 'Username',
      cell: (row) => <span className="mono-text">{row.username}</span>,
    },
    {
      id: 'email',
      header: 'Email',
      cell: (row) => row.email ?? <span className="empty-value">—</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <StatusBadge tone={STATUS_TONE[row.status]}>{row.status}</StatusBadge>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      cell: (row) =>
        row.id === currentUserId ? (
          <span className="cell-meta">{row.role}</span>
        ) : (
          <Select
            className="select--sm"
            aria-label="Change role"
            value={row.role}
            onChange={(e) => void handleUpdateRole(row.id, e.target.value as UserRole)}
            disabled={updateRoleMutation.isPending}
          >
            <option value="viewer">Viewer</option>
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
          </Select>
        ),
    },
    {
      id: 'createdAt',
      header: 'Member since',
      cell: (row) => (
        <span className="cell-meta mono-text tabular">
          {new Date(row.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (row) => {
        if (row.id === currentUserId) return null;
        return (
          <div className="table-actions">
            {row.status === 'active' && (
              <Button
                tone="danger"
                className="button--sm"
                onClick={() => void handleDeactivate(row.id)}
                disabled={deactivateMutation.isPending}
              >
                Deactivate
              </Button>
            )}
            {row.status === 'deactivated' && (
              <Button
                tone="secondary"
                className="button--sm"
                onClick={() => void handleReactivate(row.id)}
                disabled={reactivateMutation.isPending}
              >
                Reactivate
              </Button>
            )}
            <Button
              tone="danger"
              className="button--sm"
              onClick={() => setPendingDeleteId(row.id)}
            >
              Delete
            </Button>
          </div>
        );
      },
    },
  ], [currentUserId, updateRoleMutation.isPending, deactivateMutation.isPending, reactivateMutation.isPending]);

  function renderPagination(page: number, setPage: (next: number) => void, total: number): ReactElement {
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    return (
      <div className="pagination">
        <span className="text-muted">
          Page {page + 1} of {pageCount}
        </span>
        <div className="pagination__actions">
          <Button disabled={page <= 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Button disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      </div>
    );
  }

  function renderAllContent(): ReactElement {
    if (allUsersQuery.isLoading) return <DataTableSkeleton columns={6} rows={5} />;
    if (allUsersQuery.error) {
      return (
        <ErrorState
          title="Unable to load users"
          message={allUsersQuery.error.message}
          action={<Button onClick={() => void allUsersQuery.refetch()}>Retry</Button>}
        />
      );
    }
    if (managedTotal === 0) {
      return <EmptyState title="No users found" message="No active or deactivated users." />;
    }
    return (
      <>
        <DataTable
          caption="All users"
          rows={managedUsers}
          columns={managedColumns}
          rowKey={(u) => u.id}
        />
        {renderPagination(allPage, setAllPage, managedTotal)}
      </>
    );
  }

  function renderPendingContent(): ReactElement {
    if (pendingUsersQuery.isLoading) return <DataTableSkeleton columns={5} rows={3} />;
    if (pendingUsersQuery.error) {
      return (
        <ErrorState
          title="Unable to load users"
          message={pendingUsersQuery.error.message}
          action={<Button onClick={() => void pendingUsersQuery.refetch()}>Retry</Button>}
        />
      );
    }
    if (pendingTotal === 0) {
      return (
        <EmptyState
          title="No pending registrations"
          message="New registration requests will appear here for you to approve or reject."
        />
      );
    }
    return (
      <>
        <DataTable
          caption="Pending registrations"
          rows={pendingUsers}
          columns={pendingColumns}
          rowKey={(u) => u.id}
        />
        {renderPagination(pendingPage, setPendingPage, pendingTotal)}
      </>
    );
  }

  return (
    <PageLayout
      eyebrow="Administration"
      title="Users"
      description="Manage user accounts and pending registrations."
    >
      {anyError ? <Alert tone="error">{anyError.message}</Alert> : null}

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="all">
            All users
            {managedTotal > 0 && (
              <span className="tabs__count">{managedTotal}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="pending">
            Pending
            {pendingTotal > 0 && (
              <span className="tabs__count">{pendingTotal}</span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all">{renderAllContent()}</TabsContent>
        <TabsContent value="pending">{renderPendingContent()}</TabsContent>
      </Tabs>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}
        title="Delete user"
        description="This will permanently delete the user account. This action cannot be undone."
        tone="danger"
        confirmLabel="Delete"
        isConfirming={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDeleteId !== null) void handleDelete(pendingDeleteId);
        }}
      />
    </PageLayout>
  );
}
