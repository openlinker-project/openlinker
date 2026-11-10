/**
 * Sync Progress Page (#4024)
 *
 * Diagnostics > Sync progress (route `/cursors`). Every sync bookmark grouped
 * by connection, judged on time against its schedule, with the syncs that
 * need a look summarised on top, a detail panel per row and a guide that
 * explains every state. Mockup: `docs/plans/mockups/sync-progress.html`.
 *
 * @module apps/web/src/pages/cursors
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { describeApiError } from '../../shared/api/describe-api-error';
import { PageLayout } from '../../shared/ui/page-layout';
import { Button } from '../../shared/ui/button';
import { Input } from '../../shared/ui/input';
import { Select } from '../../shared/ui/select';
import { SegmentedControl } from '../../shared/ui/segmented-control';
import { StatusBadge } from '../../shared/ui/status-badge';
import { EmptyState, ErrorState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { formatRelativeTime } from '../../shared/format/format-relative-time';
import { formatDateTime } from '../../shared/format/format-date';
import { useIsAdmin, useWriteAccess } from '../../shared/auth/use-permission';
import { useDemoMode } from '../../features/system';
import {
  SYSTEM_CONNECTION_ID,
  useConnectionsQuery,
  type Connection,
} from '../../features/connections';
import { ConnectionDot } from '../../features/orders';
import { useCursorOverviewQuery } from '../../features/cursors/hooks/use-cursor-overview-query';
import type {
  CursorOverviewConnection,
  CursorOverviewItem,
} from '../../features/cursors/api/cursors.types';
import {
  cursorLabel,
  sweepKeyForCompletionStamp,
} from '../../features/cursors/lib/cursor-catalogue';
import {
  isProblem,
  readCursorHealth,
  readCursorProgress,
} from '../../features/cursors/lib/read-cursor-health';
import {
  useSyncProgressCopy,
  type SyncProgressCopy,
} from '../../features/cursors/lib/sync-progress-copy';
import { CursorRow, type CursorRowView } from '../../features/cursors/components/cursor-row';
import { WriteMarksBundle } from '../../features/cursors/components/write-marks-bundle';
import {
  CursorDetailPanel,
  type CursorDetailConnection,
} from '../../features/cursors/components/cursor-detail-panel';
import { SyncGuidePanel } from '../../features/cursors/components/sync-guide-panel';

const HEALTH_FILTERS = ['all', 'problem', 'ok'] as const;
/** The needs-a-look box stays a summary; the full set is one click away. */
const PROBLEMS_SHOWN = 5;
type HealthFilter = (typeof HEALTH_FILTERS)[number];
/** A connection with no bookmarks is described as push-fed only when it is a data source. */
const SOURCE_CAPABILITIES = ['OrderSource', 'ProductMaster', 'InventoryMaster'];

interface GroupView {
  id: string;
  connection: CursorDetailConnection;
  role: string | null;
  rows: CursorRowView[];
  allRows: CursorRowView[];
  writeMarks: CursorOverviewConnection['writeMarks'];
  pushes: boolean;
}

function readHealthFilter(value: string | null): HealthFilter {
  return (HEALTH_FILTERS as readonly string[]).includes(value ?? '')
    ? (value as HealthFilter)
    : 'all';
}

function roleOf(connection: Connection | undefined, C: SyncProgressCopy): string | null {
  if (!connection) return null;
  const caps = connection.enabledCapabilities;
  if (caps.includes('ProductMaster')) return C.roles.masterCatalogue;
  if (caps.includes('OfferManager')) return C.roles.marketplace;
  if (caps.includes('ShippingProviderManager')) return C.roles.carrier;
  if (caps.includes('OrderSource')) return C.roles.shop;
  return null;
}

export function CursorsListPage(): ReactElement {
  const C = useSyncProgressCopy();
  const [searchParams, setSearchParams] = useSearchParams();
  const connectionFilter = searchParams.get('connectionId') ?? 'all';
  const health = readHealthFilter(searchParams.get('health'));
  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const [showKeys, setShowKeys] = useState(false);
  const [allProblems, setAllProblems] = useState(false);
  // Held as ids, not as a row snapshot, so the open panel follows every refetch.
  const [selected, setSelected] = useState<{ view: CursorRowView; groupId: string } | null>(null);
  const [guide, setGuide] = useState<{ open: boolean; focus: string | null }>({
    open: false,
    focus: null,
  });

  // A chosen connection is read on its own, so the 1,000-cursor overview
  // limit never hides any of that connection's bookmarks.
  const overview = useCursorOverviewQuery(
    connectionFilter === 'all' || connectionFilter === SYSTEM_CONNECTION_ID
      ? undefined
      : connectionFilter
  );
  const connections = useConnectionsQuery();
  const demoMode = useDemoMode();
  const write = useWriteAccess('sync:write', demoMode);
  const isAdmin = useIsAdmin();
  const canAct = write.canWrite && isAdmin;

  // Stable between refetches, so every row is judged against the same instant.
  const now = overview.dataUpdatedAt || Date.now();
  const ago = useCallback((iso: string) => formatRelativeTime(iso, now), [now]);
  const formatWhen = useCallback((iso: string) => formatDateTime(iso), []);
  const q = search.trim().toLowerCase();

  const setParam = (key: string, value: string | null): void => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true }
    );
  };

  const explain = useCallback((id: string) => {
    setGuide({ open: true, focus: id });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (e.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        e.preventDefault();
        setGuide({ open: true, focus: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const groups = useMemo<GroupView[]>(() => {
    const byId = new Map((connections.data ?? []).map((c) => [c.id, c]));
    const seen = new Set<string>();
    const out: GroupView[] = [];
    for (const g of overview.data?.connections ?? []) {
      seen.add(g.connectionId);
      const conn = byId.get(g.connectionId);
      const isSystem = g.connectionId === SYSTEM_CONNECTION_ID;
      const platform = conn?.platformType ?? null;
      const stamps = new Map<string, string>();
      for (const item of g.cursors) {
        const sweepKey =
          item.family === 'completion-stamp' ? sweepKeyForCompletionStamp(item.cursorKey) : null;
        if (sweepKey) stamps.set(sweepKey, item.value);
      }
      const toView = (item: CursorOverviewItem): CursorRowView => ({
        cursor: item,
        label: cursorLabel(item.cursorKey, C),
        health: readCursorHealth(item, platform, now, ago, formatWhen, C),
        progress: readCursorProgress(item, stamps.get(item.cursorKey) ?? null, ago, formatWhen, C),
      });
      const allRows = g.cursors.filter((c) => c.family !== 'completion-stamp').map(toView);
      out.push({
        id: g.connectionId,
        connection: {
          id: g.connectionId,
          name: isSystem ? C.systemName : conn?.name ?? g.connectionId,
          platformType: platform,
          isSystem,
        },
        role: isSystem ? C.systemRole : roleOf(conn, C),
        allRows,
        rows: allRows,
        writeMarks: g.writeMarks,
        pushes: false,
      });
    }
    for (const conn of connections.data ?? []) {
      if (seen.has(conn.id) || conn.status !== 'active') continue;
      if (!conn.enabledCapabilities.some((cap) => SOURCE_CAPABILITIES.includes(cap))) continue;
      out.push({
        id: conn.id,
        connection: {
          id: conn.id,
          name: conn.name,
          platformType: conn.platformType,
          isSystem: false,
        },
        role: roleOf(conn, C),
        allRows: [],
        rows: [],
        writeMarks: null,
        pushes: true,
      });
    }
    return out;
  }, [overview.data, connections.data, now, ago, formatWhen, C]);

  const toViewFor = useCallback(
    (group: GroupView) =>
      (item: CursorOverviewItem): CursorRowView => ({
        cursor: item,
        label: cursorLabel(item.cursorKey, C),
        health: readCursorHealth(item, group.connection.platformType, now, ago, formatWhen, C),
        progress: readCursorProgress(item, null, ago, formatWhen, C),
      }),
    [now, ago, formatWhen, C]
  );

  const matchesSearch = (row: CursorRowView): boolean =>
    !q || row.cursor.cursorKey.toLowerCase().includes(q) || row.label.toLowerCase().includes(q);
  const matchesHealth = (row: CursorRowView): boolean =>
    health === 'all' || (health === 'problem' ? isProblem(row.health) : !isProblem(row.health));

  // Options come from the connection list, not from the overview: a filtered or
  // truncated overview would otherwise shrink the very list used to widen it.
  const connectionOptions = [
    ...(connections.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    ...(groups.some((g) => g.connection.isSystem) || connectionFilter === SYSTEM_CONNECTION_ID
      ? [{ id: SYSTEM_CONNECTION_ID, name: C.systemName }]
      : []),
  ];
  const inScope = groups.filter((g) => connectionFilter === 'all' || g.id === connectionFilter);
  const scopedRows = inScope.flatMap((g) => g.allRows.filter(matchesSearch));
  const counts: Record<HealthFilter, number> = {
    all: scopedRows.length,
    problem: scopedRows.filter((r) => isProblem(r.health)).length,
    ok: scopedRows.filter((r) => !isProblem(r.health)).length,
  };
  const problems = groups.flatMap((g) =>
    g.allRows.filter((r) => isProblem(r.health)).map((r) => ({ group: g, row: r }))
  );

  const visibleGroups = inScope
    .map((g) => ({ ...g, rows: g.allRows.filter((r) => matchesSearch(r) && matchesHealth(r)) }))
    .filter(
      (g) =>
        g.rows.length > 0 ||
        (g.writeMarks !== null && health !== 'problem') ||
        (g.pushes && !q && health === 'all')
    )
    .sort(
      (a, b) =>
        b.allRows.filter((r) => isProblem(r.health)).length -
        a.allRows.filter((r) => isProblem(r.health)).length
    );

  const selectedGroup = selected ? groups.find((g) => g.id === selected.groupId) ?? null : null;
  const selectedView = selected
    ? selectedGroup?.allRows.find((r) => r.cursor.cursorKey === selected.view.cursor.cursorKey) ??
      selected.view
    : null;
  const clearFilters = (): void => {
    setSearch('');
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const loading = overview.isLoading || connections.isLoading;

  return (
    <PageLayout
      eyebrow={C.eyebrow}
      title={C.title}
      description={C.description}
      actions={
        <div className="sync-progress__header-actions">
          <label className="sync-progress__switch">
            <input
              type="checkbox"
              id="sync-progress-keys"
              checked={showKeys}
              onChange={(e) => {
                setShowKeys(e.target.checked);
              }}
            />
            {C.showKeys}
          </label>
          <Button
            tone="secondary"
            aria-keyshortcuts="?"
            onClick={() => {
              setGuide({ open: true, focus: null });
            }}
          >
            <span className="sync-progress__qmark" aria-hidden="true">
              ?
            </span>
            {C.howToRead}
            <kbd className="sync-progress__kbd" aria-hidden="true">
              ?
            </kbd>
          </Button>
        </div>
      }
    >
      {loading ? null : overview.error ? null : problems.length > 0 ? (
        <section className="sync-progress__attention" aria-label={C.filterProblem}>
          <div className="sync-progress__attention-head">
            <p className="sync-progress__attention-title">{C.needsLookTitle(problems.length)}</p>
            <button
              type="button"
              className="card-button-reset sync-progress__help-link"
              onClick={() => {
                explain('h-late');
              }}
            >
              {C.needsLookExplain}
            </button>
          </div>
          <ul className="sync-progress__attention-list">
            {(allProblems ? problems : problems.slice(0, PROBLEMS_SHOWN)).map(({ group, row }) => (
              <li
                key={`${group.id}:${row.cursor.cursorKey}`}
                className="sync-progress__attention-item"
              >
                <StatusBadge tone={row.health.tone} withDot>
                  {row.health.label}
                </StatusBadge>
                <strong>
                  {group.connection.name}: {row.label}.
                </strong>
                <span>{row.health.why}</span>
                <button
                  type="button"
                  className="card-button-reset sync-progress__help-link"
                  onClick={() => {
                    setSelected({ view: row, groupId: group.id });
                  }}
                >
                  {C.details}
                </button>
              </li>
            ))}
          </ul>
          {problems.length > PROBLEMS_SHOWN ? (
            <button
              type="button"
              className="card-button-reset sync-progress__help-link sync-progress__more"
              aria-expanded={allProblems}
              onClick={() => {
                setAllProblems(!allProblems);
              }}
            >
              {allProblems ? C.showFewerProblems : C.showAllProblems(problems.length)}
            </button>
          ) : null}
        </section>
      ) : groups.length > 0 ? (
        <div className="sync-progress__allgood">{C.allGood}</div>
      ) : null}

      <div className="sync-progress__toolbar">
        <label className="sync-progress__field">
          <span className="sync-progress__field-label">{C.connection}</span>
          <Select
            id="sync-progress-connection"
            value={connectionFilter}
            onChange={(e) => {
              setParam('connectionId', e.target.value === 'all' ? null : e.target.value);
            }}
          >
            <option value="all">{C.allConnections}</option>
            {connectionOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="sync-progress__field sync-progress__field--grow">
          <span className="sync-progress__field-label">{C.search}</span>
          <Input
            id="sync-progress-search"
            type="search"
            placeholder={C.searchPlaceholder}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setParam('q', e.target.value || null);
            }}
          />
        </label>
        <div className="sync-progress__field">
          <span className="sync-progress__field-label">{C.health}</span>
          <SegmentedControl<HealthFilter>
            aria-label={C.healthFilterLabel}
            value={health}
            onChange={(value) => {
              setParam('health', value === 'all' ? null : value);
            }}
            options={[
              {
                value: 'all',
                label: (
                  <>
                    {C.filterAll} <span className="sync-progress__count">{counts.all}</span>
                  </>
                ),
              },
              {
                value: 'problem',
                label: (
                  <>
                    {C.filterProblem} <span className="sync-progress__count">{counts.problem}</span>
                  </>
                ),
              },
              {
                value: 'ok',
                label: (
                  <>
                    {C.filterOk} <span className="sync-progress__count">{counts.ok}</span>
                  </>
                ),
              },
            ]}
          />
        </div>
      </div>

      {loading ? (
        <DataTableSkeleton rows={5} columns={4} />
      ) : overview.error ? (
        <ErrorState
          title={C.errorTitle}
          message={describeApiError(overview.error, 'cursors')}
          action={
            <Button
              onClick={() => {
                void overview.refetch();
              }}
            >
              {C.retry}
            </Button>
          }
        />
      ) : groups.length === 0 ? (
        <EmptyState liveRegion="off" title={C.emptyTitle} message={C.emptyMessage} />
      ) : visibleGroups.length === 0 ? (
        <div className="sync-progress__nomatch">
          {C.noMatch}{' '}
          <button
            type="button"
            className="card-button-reset sync-progress__help-link"
            onClick={clearFilters}
          >
            {C.clearFilters}
          </button>
        </div>
      ) : (
        <div className="sync-progress__list">
          {visibleGroups.map((g) => {
            const bad = g.allRows.filter((r) => isProblem(r.health)).length;
            return (
              <section key={g.id} className="sync-progress__group" aria-label={g.connection.name}>
                <header className="sync-progress__group-head">
                  <span className="sync-progress__entity">
                    <ConnectionDot
                      name={g.connection.isSystem ? null : g.connection.name}
                      platformType={g.connection.platformType}
                    />
                    <span className="sync-progress__entity-name">{g.connection.name}</span>
                    {g.role ? <span className="sync-progress__entity-meta">{g.role}</span> : null}
                  </span>
                  <span className="sync-progress__group-actions">
                    {g.pushes ? (
                      <StatusBadge tone="neutral">{C.verdictPushes}</StatusBadge>
                    ) : bad > 0 ? (
                      <StatusBadge tone="warning" withDot>
                        {C.verdictNeedLook(bad)}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="success">{C.verdictOnTime}</StatusBadge>
                    )}
                    {g.connection.isSystem ? null : (
                      <Link className="sync-progress__link" to={`/connections/${g.id}`}>
                        {C.openConnection}
                      </Link>
                    )}
                  </span>
                </header>
                {g.pushes ? (
                  <div className="sync-progress__note-row">
                    <span>
                      {C.pushesNote(g.connection.name)}{' '}
                      <button
                        type="button"
                        className="card-button-reset sync-progress__help-link"
                        onClick={() => {
                          explain('h-pushes');
                        }}
                      >
                        {C.why}
                      </button>
                    </span>
                  </div>
                ) : null}
                {g.rows.length > 0 ? (
                  <>
                    <div className="sync-progress__cols">
                      <button
                        type="button"
                        className="card-button-reset sync-progress__col-btn"
                        onClick={() => {
                          explain('s-orders');
                        }}
                      >
                        {C.colSync}{' '}
                        <span className="sync-progress__qmark" aria-hidden="true">
                          ?
                        </span>
                      </button>
                      <button
                        type="button"
                        className="card-button-reset sync-progress__col-btn"
                        onClick={() => {
                          explain('p-readupto');
                        }}
                      >
                        {C.colProgress}{' '}
                        <span className="sync-progress__qmark" aria-hidden="true">
                          ?
                        </span>
                      </button>
                      <button
                        type="button"
                        className="card-button-reset sync-progress__col-btn"
                        onClick={() => {
                          explain('h-ok');
                        }}
                      >
                        {C.colHealth}{' '}
                        <span className="sync-progress__qmark" aria-hidden="true">
                          ?
                        </span>
                      </button>
                      <span>{C.colLastMoved}</span>
                      <span />
                    </div>
                    {g.rows.map((row) => (
                      <CursorRow
                        key={row.cursor.cursorKey}
                        view={row}
                        showKeys={showKeys}
                        ago={ago}
                        formatWhen={formatWhen}
                        copy={C}
                        onOpen={() => {
                          setSelected({ view: row, groupId: g.id });
                        }}
                      />
                    ))}
                  </>
                ) : null}
                {g.writeMarks && health !== 'problem' ? (
                  <WriteMarksBundle
                    connectionId={g.id}
                    summary={g.writeMarks}
                    search={q}
                    showKeys={showKeys}
                    ago={ago}
                    formatWhen={formatWhen}
                    copy={C}
                    toView={toViewFor(g)}
                    onOpen={(view) => {
                      setSelected({ view, groupId: g.id });
                    }}
                  />
                ) : null}
              </section>
            );
          })}
          {overview.data?.truncated ? <p className="sync-progress__note">{C.truncated}</p> : null}
        </div>
      )}

      <CursorDetailPanel
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        view={selectedView}
        connection={selectedGroup?.connection ?? null}
        canAct={canAct}
        ago={ago}
        formatWhen={formatWhen}
        copy={C}
        onExplain={explain}
      />
      <SyncGuidePanel
        open={guide.open}
        focusId={guide.focus}
        onOpenChange={(open) => {
          if (!open) setGuide({ open: false, focus: null });
        }}
      />
    </PageLayout>
  );
}
