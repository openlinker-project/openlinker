/**
 * Users Management Page
 *
 * Admin-only page for listing, approving, rejecting, and managing user accounts.
 * Two tabs: "All users" (every account, including pending — read-only there)
 * and "Pending" (dedicated approval queue with Approve/Reject actions).
 *
 * @module pages/users
 */
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../shared/ui/tabs';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { EmptyState } from '../../shared/ui/feedback-state';
import { QueryErrorState } from '../../shared/ui/query-error-state';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { Button } from '../../shared/ui/button';
import { Alert } from '../../shared/ui/alert';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { ReadOnlyLock } from '../../shared/ui/read-only-lock';
import { Select } from '../../shared/ui/select';
import { useToast } from '../../shared/ui/toast-provider';
import { useSession } from '../../shared/auth/use-session';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { demoReadOnlyActionMessage } from '../../shared/config/demo-mode';
import { useDemoMode, useSystemConfigQuery } from '../../features/system';
import { useUsersQuery } from '../../features/users/hooks/use-users-query';
import { useApproveUserMutation } from '../../features/users/hooks/use-approve-user-mutation';
import { useRejectUserMutation } from '../../features/users/hooks/use-reject-user-mutation';
import { useUpdateRoleMutation } from '../../features/users/hooks/use-update-role-mutation';
import { useDeactivateUserMutation } from '../../features/users/hooks/use-deactivate-user-mutation';
import { PackStationLabelDialog } from '../../features/users/components/pack-station-label-dialog';
import { useReactivateUserMutation } from '../../features/users/hooks/use-reactivate-user-mutation';
import { useDeleteUserMutation } from '../../features/users/hooks/use-delete-user-mutation';
import type { UserRole, UserStatus, UserSummary } from '../../features/users/api/users.types';
import { ASSIGNABLE_ROLES, userRoleLabel, userStatusLabel } from '../../features/users';
import { interpolate, renderRich, useFormat, useMessages } from '../../shared/i18n';

const STATUS_TONE: Record<UserStatus, StatusBadgeTone> = {
  active: 'success',
  pending: 'warning',
  deactivated: 'neutral',
};

const PAGE_SIZE = 25;

// Guards against a malformed `?allPage=abc` / `?pendingPage=abc` producing
// NaN, which would otherwise be sent straight through to the API as the
// `page` filter.
function readPageParam(raw: string | null): number {
  const parsed = Number(raw ?? '0');
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

interface UsersPageProps {
  defaultTab?: 'all' | 'pending';
}

export function UsersPage({ defaultTab = 'all' }: UsersPageProps): ReactElement {
  const systemConfig = useSystemConfigQuery();
  const loginCopy = useMessages('login-page-settings');
  const [pendingRoles, setPendingRoles] = useState<Record<string, UserRole>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [labelDialogTarget, setLabelDialogTarget] = useState<UserSummary | null>(null);
  const { showToast } = useToast();
  const copy = useMessages('users');
  const format = useFormat();
  const toasts = copy.toasts;
  const { session } = useSession();
  const currentUserId = session.user?.id ?? null;
  // #3404 — admin-only, same route as the role change above (`@Roles('admin')`).
  const demoMode = useDemoMode();
  const packStationWrite = useWriteAccess('users:write', demoMode);

  // Per-tab page state lives in the URL (docs/frontend-architecture.md § URL
  // State) so each tab's position is bookmarkable and switching tabs never
  // resets the other tab's page.
  const [searchParams, setSearchParams] = useSearchParams();
  const allPage = readPageParam(searchParams.get('allPage'));
  const pendingPage = readPageParam(searchParams.get('pendingPage'));

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
  // status filter, so its rows (and total) include pending registrations —
  // filtering them out client-side would desync the page count from what the
  // unfiltered query actually paginates over, stranding managed users on
  // pages beyond a client-computed pageCount. "Pending" applies an exact
  // server-side status filter and is unaffected.
  const allUsersQuery = useUsersQuery({ page: allPage, pageSize: PAGE_SIZE });
  const pendingUsersQuery = useUsersQuery({ status: 'pending', page: pendingPage, pageSize: PAGE_SIZE });
  const approveMutation = useApproveUserMutation();
  const rejectMutation = useRejectUserMutation();
  const updateRoleMutation = useUpdateRoleMutation();
  const deactivateMutation = useDeactivateUserMutation();
  const reactivateMutation = useReactivateUserMutation();
  const deleteMutation = useDeleteUserMutation();

  const allUsers = allUsersQuery.data?.users ?? [];
  const pendingUsers = pendingUsersQuery.data?.users ?? [];
  const pendingTotal = pendingUsersQuery.data?.total ?? 0;
  const allTotal = allUsersQuery.data?.total ?? 0;

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
      showToast({ tone: 'success', title: toasts.approved, description: toasts.approvedDescription });
    } catch {
      showToast({ tone: 'error', title: toasts.approveFailed, description: toasts.approveFailedDescription });
    }
  }

  async function handleReject(userId: string): Promise<void> {
    try {
      await rejectMutation.mutateAsync(userId);
      showToast({ tone: 'success', title: toasts.rejected, description: toasts.rejectedDescription });
    } catch {
      showToast({ tone: 'error', title: toasts.rejectFailed, description: toasts.tryAgain });
    }
  }

  async function handleUpdateRole(userId: string, role: UserRole): Promise<void> {
    try {
      await updateRoleMutation.mutateAsync({ userId, role });
      showToast({ tone: 'success', title: toasts.roleUpdated, description: interpolate(toasts.roleUpdatedDescription, { role: userRoleLabel(role, copy) }) });
    } catch {
      showToast({ tone: 'error', title: toasts.roleUpdateFailed, description: toasts.tryAgain });
    }
  }

  async function handleDeactivate(userId: string): Promise<void> {
    try {
      await deactivateMutation.mutateAsync(userId);
      showToast({ tone: 'success', title: toasts.deactivated, description: toasts.deactivatedDescription });
    } catch {
      showToast({ tone: 'error', title: toasts.deactivateFailed, description: toasts.tryAgain });
    }
  }

  async function handleReactivate(userId: string): Promise<void> {
    try {
      await reactivateMutation.mutateAsync(userId);
      showToast({ tone: 'success', title: toasts.reactivated, description: toasts.reactivatedDescription });
    } catch {
      showToast({ tone: 'error', title: toasts.reactivateFailed, description: toasts.tryAgain });
    }
  }

  async function handleDelete(userId: string): Promise<void> {
    try {
      await deleteMutation.mutateAsync(userId);
      setPendingDeleteId(null);
      showToast({ tone: 'success', title: toasts.deleted, description: toasts.deletedDescription });
    } catch {
      showToast({ tone: 'error', title: toasts.deleteFailed, description: toasts.tryAgain });
    }
  }

  // Columns for the Pending tab: role picker inline with Approve, separate Reject
  const pendingColumns = useMemo<DataTableColumn<UserSummary>[]>(() => [
    {
      id: 'username',
      header: copy.columns.username,
      cell: (row) => <span className="mono-text">{row.username}</span>,
    },
    {
      id: 'email',
      header: copy.columns.email,
      cell: (row) => row.email ?? <span className="empty-value">—</span>,
    },
    {
      id: 'requested',
      header: copy.columns.requested,
      cell: (row) => (
        <span className="cell-meta mono-text tabular">
          {format.date(row.createdAt)}
        </span>
      ),
    },
    {
      id: 'approve',
      header: copy.columns.approve,
      cell: (row) => (
        <div className="table-actions">
          <Select
            className="select--sm"
            aria-label={copy.roleForApproval}
            value={getRoleForPending(row.id)}
            onChange={(e) =>
              setPendingRoles((prev) => ({ ...prev, [row.id]: e.target.value as UserRole }))
            }
          >
            {ASSIGNABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {userRoleLabel(role, copy)}
              </option>
            ))}
          </Select>
          <Button
            tone="primary"
            className="button--sm"
            onClick={() => void handleApprove(row.id)}
            disabled={approveMutation.isPending}
          >
            {copy.approve}
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
          {copy.reject}
        </Button>
      ),
    },
  ], [pendingRoles, approveMutation.isPending, rejectMutation.isPending, copy, format]);

  // Columns for the All users tab: status badge, inline role select (auto-save),
  // member since, actions. Pending rows render role/actions read-only — role
  // assignment and removal for an unapproved account go through the dedicated
  // Approve/Reject flow on the Pending tab, not this auto-save control (the
  // backend's PATCH /users/:id/role has no pending-status guard).
  const allUsersColumns = useMemo<DataTableColumn<UserSummary>[]>(() => [
    {
      id: 'username',
      header: copy.columns.username,
      cell: (row) => <span className="mono-text">{row.username}</span>,
    },
    {
      id: 'email',
      header: copy.columns.email,
      cell: (row) => row.email ?? <span className="empty-value">—</span>,
    },
    {
      id: 'status',
      header: copy.columns.status,
      cell: (row) => (
        <StatusBadge tone={STATUS_TONE[row.status]}>{userStatusLabel(row.status, copy)}</StatusBadge>
      ),
    },
    {
      id: 'role',
      header: copy.columns.role,
      cell: (row) =>
        row.id === currentUserId || row.status === 'pending' ? (
          <span className="cell-meta">{userRoleLabel(row.role, copy)}</span>
        ) : (
          <Select
            className="select--sm"
            aria-label={copy.changeRole}
            value={row.role}
            onChange={(e) => void handleUpdateRole(row.id, e.target.value as UserRole)}
            disabled={updateRoleMutation.isPending}
          >
            {ASSIGNABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {userRoleLabel(role, copy)}
              </option>
            ))}
          </Select>
        ),
    },
    {
      id: 'createdAt',
      header: copy.columns.memberSince,
      cell: (row) => (
        <span className="cell-meta mono-text tabular">
          {format.date(row.createdAt)}
        </span>
      ),
    },
    {
      id: 'packStationLabel',
      header: copy.columns.packStation,
      /*
       * #3404. Its own column rather than an entry in "Actions", because the
       * VALUE is the useful part on a list - an admin scanning for the bench
       * nobody has named needs to see the gap, not open three dialogs to find
       * it.
       *
       * Shown for every role, not only `packer`: an operator who covers a
       * bench at peak has the same printer, and hiding the field by role would
       * make the column lie about who can be given one.
       */
      cell: (row) => (
        <div className="table-actions">
          {row.packStationLabel === null || row.packStationLabel === '' ? (
            <span className="text-muted">{copy.packStation.notSet}</span>
          ) : (
            <span className="cell-meta mono-text">{row.packStationLabel}</span>
          )}
          {packStationWrite.visible ? (
            <ReadOnlyLock active={packStationWrite.demoReadOnly} message={demoReadOnlyActionMessage()}>
              <Button
                tone="ghost"
                className="button--sm"
                disabled={packStationWrite.demoReadOnly}
                onClick={() => {
                  setLabelDialogTarget(row);
                }}
              >
                {row.packStationLabel === null || row.packStationLabel === ''
                  ? copy.packStation.set
                  : copy.packStation.change}
              </Button>
            </ReadOnlyLock>
          ) : null}
        </div>
      ),
    },
    {
      id: 'actions',
      header: copy.columns.actions,
      cell: (row) => {
        if (row.id === currentUserId) return null;
        if (row.status === 'pending') {
          return <span className="text-muted">{copy.rowActions.reviewInPending}</span>;
        }
        return (
          <div className="table-actions">
            {row.status === 'active' && (
              <Button
                tone="danger"
                className="button--sm"
                onClick={() => void handleDeactivate(row.id)}
                disabled={deactivateMutation.isPending}
              >
                {copy.rowActions.deactivate}
              </Button>
            )}
            {row.status === 'deactivated' && (
              <Button
                tone="secondary"
                className="button--sm"
                onClick={() => void handleReactivate(row.id)}
                disabled={reactivateMutation.isPending}
              >
                {copy.rowActions.reactivate}
              </Button>
            )}
            <Button
              tone="danger"
              className="button--sm"
              onClick={() => setPendingDeleteId(row.id)}
            >
              {copy.rowActions.delete}
            </Button>
          </div>
        );
      },
    },
  ], [currentUserId, updateRoleMutation.isPending, deactivateMutation.isPending, reactivateMutation.isPending, copy, format]);

  function renderPagination(page: number, setPage: (next: number) => void, total: number): ReactElement | null {
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (pageCount <= 1) return null;
    return (
      <div className="pagination">
        <span className="text-muted">
          {interpolate(copy.pagination.pageOf, { page: page + 1, count: pageCount })}
        </span>
        <div className="pagination__actions">
          <Button disabled={page <= 0} onClick={() => setPage(page - 1)}>
            {copy.pagination.previous}
          </Button>
          <Button disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>
            {copy.pagination.next}
          </Button>
        </div>
      </div>
    );
  }

  function renderAllContent(): ReactElement {
    if (allUsersQuery.isLoading) return <DataTableSkeleton columns={6} rows={5} />;
    if (allUsersQuery.error) {
      return (
        <QueryErrorState
          error={allUsersQuery.error}
          onRetry={() => void allUsersQuery.refetch()}
          copy={{
            error: { title: copy.errors.loadFailed, message: allUsersQuery.error.message, retry: copy.errors.retry },
            denied: {
              title: copy.errors.deniedTitle,
              message: copy.errors.deniedMessage,
            },
          }}
        />
      );
    }
    if (allTotal === 0) {
      return <EmptyState title={copy.empty.allTitle} message={copy.empty.allMessage} />;
    }
    return (
      <>
        <DataTable
          caption={copy.tabs.allCaption}
          rows={allUsers}
          columns={allUsersColumns}
          rowKey={(u) => u.id}
        />
        {renderPagination(allPage, setAllPage, allTotal)}
      </>
    );
  }

  function renderPendingContent(): ReactElement {
    if (pendingUsersQuery.isLoading) return <DataTableSkeleton columns={5} rows={3} />;
    if (pendingUsersQuery.error) {
      return (
        <QueryErrorState
          error={pendingUsersQuery.error}
          onRetry={() => void pendingUsersQuery.refetch()}
          copy={{
            error: { title: copy.errors.loadFailed, message: pendingUsersQuery.error.message, retry: copy.errors.retry },
            denied: {
              title: copy.errors.deniedTitle,
              message: copy.errors.deniedMessage,
            },
          }}
        />
      );
    }
    if (pendingTotal === 0) {
      return (
        <EmptyState
          title={copy.empty.pendingTitle}
          message={copy.empty.pendingMessage}
        />
      );
    }
    return (
      <>
        <DataTable
          caption={copy.tabs.pendingCaption}
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
      eyebrow={copy.page.eyebrow}
      title={copy.page.title}
      description={copy.page.description}
    >
      {anyError ? <Alert tone="error">{anyError.message}</Alert> : null}

      {/* #4028 - where requests for access come from, and where they are switched on. */}
      {systemConfig.data && !systemConfig.data.demoMode ? (
        <Alert tone="info" density="compact">
          {renderRich(
            systemConfig.data.registrationEnabled ? loginCopy.usersOn : loginCopy.usersOff,
            { link: (chunk) => <Link to="/settings/login-page">{chunk}</Link> }
          )}
        </Alert>
      ) : null}

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="all">
            {copy.tabs.all}
            {allTotal > 0 && (
              <span className="tabs__count">{allTotal}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="pending">
            {copy.tabs.pending}
            {pendingTotal > 0 && (
              <span className="tabs__count">{pendingTotal}</span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all">{renderAllContent()}</TabsContent>
        <TabsContent value="pending">{renderPendingContent()}</TabsContent>
      </Tabs>

      {/* #3404 - pinned to the row that opened it, so a list re-fetch behind
          an open dialog cannot move it onto a different user. */}
      <PackStationLabelDialog
        target={labelDialogTarget}
        onClose={() => {
          setLabelDialogTarget(null);
        }}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}
        title={copy.deleteDialog.title}
        description={copy.deleteDialog.description}
        tone="danger"
        confirmLabel={copy.deleteDialog.confirm}
        isConfirming={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDeleteId !== null) void handleDelete(pendingDeleteId);
        }}
      />
    </PageLayout>
  );
}
