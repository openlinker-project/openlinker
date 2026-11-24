import { useMemo, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import type { Connection, ConnectionFilters, ConnectionStatus } from '../../features/connections/api/connections.types';
import { canArchive } from '../../features/connections/api/connections.types';
import { usePlatforms } from '../../shared/plugins';
import { resolvePlatformLabel } from '../../features/mappings';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { ErrorState, LoadingState, EmptyState } from '../../shared/ui/feedback-state';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { Button } from '../../shared/ui/button';
import { PageLayout } from '../../shared/ui/page-layout';
import { Select } from '../../shared/ui/select';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useDemoMode } from '../../features/system';
import { captureDemoEvent } from '../../features/demo';
import { OmsAttentionBadges, useOmsAttentionQuery } from '../../features/fulfillment-authority';
import { ArchiveConnectionButton } from '../../features/connections/components/archive-connection-button';
import { RestoreConnectionButton } from '../../features/connections/components/restore-connection-button';
import { describeConnectionStatus } from '../oms/oms-connection';
import { useMessages, type Messages, type ResolvedCopy } from '../../shared/i18n';
import { describeApiError } from '../../shared/api/describe-api-error';

type PageCopy = ResolvedCopy<Messages['connections']>['connectionsListPage'];

const CONNECTION_STATUSES = ['active', 'disabled', 'error', 'needs_reauth', 'archived'] as const;

function isValidStatus(value: string): value is ConnectionStatus {
  return CONNECTION_STATUSES.includes(value as ConnectionStatus);
}

function toStatusTone(status: ConnectionStatus): StatusBadgeTone {
  switch (status) {
    case 'active':
      return 'success';
    case 'disabled':
      return 'neutral';
    case 'error':
      return 'error';
    case 'needs_reauth':
      return 'warning';
    case 'archived':
      return 'neutral';
  }
}

function renderStatusBadge(connection: Connection, compact: boolean): ReactElement {
  const view = describeConnectionStatus(connection, toStatusTone(connection.status));
  return (
    <StatusBadge tone={view.tone} compact={compact}>
      {view.label}
    </StatusBadge>
  );
}

/**
 * #3657 — the only row-level write on this page. Archive is offered on a
 * DISABLED connection alone, and never on an adapter that declares itself
 * non-archivable (the OMS, which is disabled only) (the API refuses any other status, and a two-step
 * disable-then-archive keeps a live integration from being hidden by one
 * click); Restore on an archived one. Every other status gets no action.
 */
function ConnectionRowAction({ connection }: { connection: Connection }): ReactElement | null {
  if (canArchive(connection)) {
    return <ArchiveConnectionButton connection={connection} />;
  }
  if (connection.status === 'archived') {
    return <RestoreConnectionButton connection={connection} />;
  }
  return null;
}

/**
 * #2356 — the columns are built per render because the Status cell now also
 * carries the connection's OMS inert states, which come from a query.
 *
 * `attentionFor` is passed in rather than the hook being called here: a module-
 * level const cannot call a hook, and resolving it per row would re-run the
 * projection for every connection on the page.
 */
function buildColumns(
  attentionFor: (connectionId: string) => readonly { reason: string }[],
  // Passed in for the same reason `attentionFor` is: a module-level const
  // cannot call a hook. `platforms` turns the `platformType` slug into the
  // product name an operator recognises - load-bearing now that two products
  // can share a slug prefix (`subiekt-gt` vs `subiekt-nexo`).
  platforms: readonly { platformType: string; displayName: string }[],
  canWrite: boolean,
  copy: PageCopy
): DataTableColumn<Connection>[] {
  const actionColumn: DataTableColumn<Connection>[] = canWrite
    ? [
        {
          id: 'actions',
          header: <span className="sr-only">{copy.columns.actions}</span>,
          cell: (connection) => <ConnectionRowAction connection={connection} />,
        },
      ]
    : [];
  return [
  {
    id: 'name',
    header: copy.columns.connection,
    cell: (connection) => (
      <div className="data-table__stack">
        <strong>{connection.name}</strong>
        <span className="muted-text">
          {resolvePlatformLabel(platforms, connection)} ·{' '}
          {connection.adapterKey ?? copy.defaultAdapter}
        </span>
      </div>
    ),
    accessor: (connection) => connection.name,
    sortable: true,
  },
  {
    id: 'identifier',
    header: copy.columns.identifier,
    cell: (connection) => (
      <span className="mono-text" title={connection.id}>
        {connection.id}
      </span>
    ),
    hideBelow: 1024,
  },
  {
    id: 'status',
    header: copy.columns.status,
    cell: (connection) => (
      <span className="data-table__badge-row">
        {renderStatusBadge(connection, false)}
        {/* An inert state derived from THIS connection's config (#2356). Beside
            the connection's own status, never instead of it: a connection can be
            perfectly `active` and still be one of two systems claiming the same
            authority, which is precisely the case worth surfacing. */}
        <OmsAttentionBadges entries={attentionFor(connection.id)} compact />
      </span>
    ),
    accessor: (connection) => connection.status,
    sortable: true,
  },
  ...actionColumn,
  ];
}

export function ConnectionsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, setSort } = useTableSort([{ id: 'name', desc: false }]);
  const plugins = usePlatforms();
  const demoMode = useDemoMode();
  // "New connection" opens the create-connection form (an "open a form"
  // action, #1615 precedent) - stays visible AND enabled for a demo viewer;
  // only the form's own final submit gets locked (create-connection-form.tsx).
  const write = useWriteAccess('connections:write', demoMode);
  const copy = useMessages('connections').connectionsListPage;
  const common = useMessages('ui').common;
  // #2356 — one read for the whole page, projected per connection. A failed read
  // costs the badges, never the list: the states are supplementary and an
  // operator must not lose their connections because a settings read hiccuped.
  const attention = useOmsAttentionQuery();
  const attentionFor = useMemo(
    () => (connectionId: string) => attention.byConnectionId.get(connectionId) ?? [],
    [attention.byConnectionId]
  );
  const columns = useMemo(
    () => buildColumns(attentionFor, plugins, write.visible, copy),
    [attentionFor, plugins, write.visible, copy]
  );

  const platformType = searchParams.get('platformType') ?? '';
  const status = searchParams.get('status') ?? '';
  const isKnownPlatform = platformType !== '' && plugins.some((p) => p.platformType === platformType);

  const filters: ConnectionFilters = {
    platformType: isKnownPlatform ? platformType : undefined,
    status: isValidStatus(status) ? status : undefined,
  };

  const query = useConnectionsQuery(filters);

  function handleFilterChange(key: string, value: string): void {
    captureDemoEvent('demo_connections_filtered', { filter: key, value });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  function clearFilters(): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('platformType');
      next.delete('status');
      return next;
    });
  }

  const filtersActive = Boolean(filters.platformType || filters.status);

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      actions={
        write.visible ? (
          <Link className="button" to="/connections/new">
            {copy.newConnection}
          </Link>
        ) : null
      }
    >
      {/* Filters */}
      <div className="toolbar">
        <div className="toolbar__group">
          <Select
            aria-label={copy.filters.platform}
            value={platformType}
            onChange={(e) => { handleFilterChange('platformType', e.target.value); }}
          >
            <option value="">{copy.filters.allPlatforms}</option>
            {plugins.map((p) => (
              <option key={p.platformType} value={p.platformType}>{p.displayName}</option>
            ))}
          </Select>
          <Select
            aria-label={copy.filters.status}
            value={status}
            onChange={(e) => { handleFilterChange('status', e.target.value); }}
          >
            <option value="">{copy.filters.allStatuses}</option>
            {CONNECTION_STATUSES.map((s) => (
              <option key={s} value={s}>{copy.statusOptions[s]}</option>
            ))}
          </Select>
        </div>
      </div>

      {/* Content */}
      {query.isLoading ? (
        <LoadingState
          title={copy.loading.title}
          message={copy.loading.message}
        />
      ) : query.error ? (
        <ErrorState
          title={copy.error.title}
          message={describeApiError(query.error, 'connections')}
          action={
            <Button onClick={() => { void query.refetch(); }}>{common.retry}</Button>
          }
        />
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState
          title={copy.empty.title}
          message={
            filtersActive
              ? copy.empty.filtered
              : copy.empty.unfiltered
          }
          action={
            filtersActive ? (
              <Button onClick={clearFilters}>{copy.empty.clearFilters}</Button>
            ) : write.visible ? (
              <Link className="button button--primary" to="/connections/new">
                {copy.empty.addFirst}
              </Link>
            ) : null
          }
        />
      ) : (
        <DataTable
          caption={copy.caption}
          columns={columns}
          rowKey={(connection) => connection.id}
          rows={query.data ?? []}
          rowHref={(connection) => `/connections/${connection.id}`}
          sort={sort}
          onSortChange={setSort}
          cardView={{
            title: (connection) => connection.name,
            subtitle: (connection) =>
              `${resolvePlatformLabel(plugins, connection)} · ${connection.adapterKey ?? copy.defaultAdapter}`,
            meta: (connection) => (
              <span className="data-table__badge-row">
                {renderStatusBadge(connection, true)}
                <OmsAttentionBadges entries={attentionFor(connection.id)} compact />
              </span>
            ),
            // Outside the card's navigation link (data-table.tsx), which is
            // the only legal home for a button on a card that sets rowHref.
            actions: write.visible
              ? (connection) => <ConnectionRowAction connection={connection} />
              : undefined,
          }}
        />
      )}
    </PageLayout>
  );
}
