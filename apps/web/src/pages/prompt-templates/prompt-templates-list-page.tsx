/**
 * Prompt Templates List Page
 *
 * Admin-only list of prompt templates grouped by `(key, channel)`. Row
 * click navigates to the detail/editor page. Hidden from non-admin sessions.
 * Page-header action launches the new-template dialog (#488). Each row
 * exposes an Archive trigger (#489) that opens the archive dialog. The
 * `?status=` filter (active | archived | all) hides fully-retired rows
 * from the default Active view.
 *
 * @module apps/web/src/pages/prompt-templates
 */
import { useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSession } from '../../shared/auth/use-session';
import { Button } from '../../shared/ui/button';
import { PageLayout } from '../../shared/ui/page-layout';
import {
  DataTable,
  type DataTableCardView,
  type DataTableColumn,
} from '../../shared/ui/data-table';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { Select } from '../../shared/ui/select';
import { FormField } from '../../shared/ui/form-field';
import { formatRelativeTime } from '../../shared/format/format-relative-time';
import { formatDateTime } from '../../shared/format/format-date';
import { usePlugin, usePlugins } from '../../shared/plugins';
import type { PlatformPlugin } from '../../shared/plugins';
import { usePromptTemplatesQuery } from '../../features/prompt-templates/hooks/use-prompt-templates-query';
import { ArchivePromptTemplateDialog } from '../../features/prompt-templates/components/archive-prompt-template-dialog';
import { NewPromptTemplateDialog } from '../../features/prompt-templates/components/new-prompt-template-dialog';
import type {
  PromptTemplateChannel,
  PromptTemplateListFilters,
  PromptTemplateSummary,
} from '../../features/prompt-templates/api/prompt-templates.types';

const STATUS_FILTER_VALUES = ['active', 'archived', 'all'] as const;
type StatusFilterValue = (typeof STATUS_FILTER_VALUES)[number];

/**
 * Channel-tone gate. Channel is open-world per #580; we can't keep a per-
 * platform tone map without re-introducing the closed enum the issue
 * removes. The semantic split is "master template (neutral) vs platform
 * template (info)" — that's all the badge tone needs to communicate.
 */
function channelTone(channel: PromptTemplateChannel | null): StatusBadgeTone {
  return channel === null ? 'neutral' : 'info';
}

/**
 * Humanise an open-world channel string for display when no plugin
 * `displayName` is available (channel registered backend-side but the FE
 * plugin manifest hasn't caught up). Capitalises the first letter; no
 * other transformation. The matching column never reaches this branch
 * for known channels because `usePlugin(channel)?.displayName` wins.
 */
function humaniseChannel(channel: string): string {
  if (channel.length === 0) return channel;
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function resolveChannelLabel(
  channel: PromptTemplateChannel | null,
  plugin: PlatformPlugin | undefined,
): string {
  if (channel === null) return 'master';
  return plugin?.displayName ?? humaniseChannel(channel);
}

/**
 * Channel-filter query-param: accepts the `'master'` sentinel and any
 * string (open-world per #580). Empty / null → undefined (no filter).
 */
function parseChannelParam(value: string | null): PromptTemplateListFilters['channel'] | undefined {
  if (value === null || value === '') return undefined;
  return value;
}

function parseStatusParam(value: string | null): StatusFilterValue {
  if (value !== null && (STATUS_FILTER_VALUES as readonly string[]).includes(value)) {
    return value as StatusFilterValue;
  }
  return 'active';
}

/**
 * Client-side status filter. The list endpoint returns one summary per
 * (key, channel) — Active = at least one usable version exists.
 */
function matchesStatusFilter(row: PromptTemplateSummary, status: StatusFilterValue): boolean {
  if (status === 'all') return true;
  const isFullyArchived = !row.hasDraft && row.publishedVersion === null;
  return status === 'archived' ? isFullyArchived : !isFullyArchived;
}

/**
 * Channel badge — resolves the plugin display name at render time so an
 * unknown channel (e.g. seeded backend-side before the FE plugin manifest
 * catches up) shows a humanised fallback instead of nothing. Used by both
 * the column cell and the mobile card-view subtitle.
 */
function ChannelBadge({
  channel,
}: {
  channel: PromptTemplateChannel | null;
}): ReactElement {
  // `usePlugin(null)` is fine — the hook returns `undefined` for any
  // non-matching key, and the resolveChannelLabel branch handles `null`
  // explicitly to render the `'master'` label.
  const plugin = usePlugin(channel ?? '');
  return (
    <StatusBadge tone={channelTone(channel)} compact>
      {resolveChannelLabel(channel, plugin)}
    </StatusBadge>
  );
}

export function PromptTemplatesListPage(): ReactElement {
  const { session } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();

  const channelFilter = parseChannelParam(searchParams.get('channel'));
  const statusFilter = parseStatusParam(searchParams.get('status'));

  const filters = useMemo<PromptTemplateListFilters>(
    () => (channelFilter !== undefined ? { channel: channelFilter } : {}),
    [channelFilter],
  );

  const query = usePromptTemplatesQuery(filters);

  // Channel filter dropdown is registry-driven post-#580 — the master
  // sentinel + every registered plugin. Memoised so the option list
  // identity is stable across renders.
  const platformPlugins = usePlugins();
  const channelFilterOptions = useMemo(
    () => [
      { value: '', label: 'All' },
      { value: 'master', label: 'Master (generic)' },
      ...platformPlugins.map((plugin) => ({
        value: plugin.platformType,
        label: plugin.displayName,
      })),
    ],
    [platformPlugins],
  );

  const cardView = useMemo<DataTableCardView<PromptTemplateSummary>>(
    () => ({
      title: (row) => <span className="mono-text">{row.key}</span>,
      subtitle: (row) => (
        <div className="prompt-templates-card__meta">
          <ChannelBadge channel={row.channel} />
          <span className="mono-text">
            {row.publishedVersion !== null
              ? `published v${row.publishedVersion}`
              : 'never published'}
          </span>
          {row.hasDraft ? (
            <StatusBadge tone="review" compact>
              draft v{row.latestVersion}
            </StatusBadge>
          ) : null}
        </div>
      ),
    }),
    [],
  );

  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<PromptTemplateSummary | null>(null);

  const isAdmin = session.status === 'authenticated' && session.user?.role === 'admin';

  if (session.status === 'authenticated' && !isAdmin) {
    return (
      <PageLayout
        eyebrow="Settings"
        title="Prompt templates"
        description="Admin-only access."
      >
        <ErrorState
          title="Admin role required"
          message="This page manages prompts that ship to the model and requires an admin session."
        />
      </PageLayout>
    );
  }

  const handleChannelChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (event.target.value === '') {
        next.delete('channel');
      } else {
        next.set('channel', event.target.value);
      }
      return next;
    });
  };

  const handleStatusChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (event.target.value === 'active') {
        next.delete('status');
      } else {
        next.set('status', event.target.value);
      }
      return next;
    });
  };

  const allRows = query.data ?? [];
  const rows = allRows.filter((row) => matchesStatusFilter(row, statusFilter));

  const columns: DataTableColumn<PromptTemplateSummary>[] = [
    {
      id: 'key',
      header: 'Key',
      cell: (row) => <span className="mono-text">{row.key}</span>,
      accessor: (row) => row.key,
      sortable: true,
    },
    {
      id: 'channel',
      header: 'Channel',
      cell: (row) => <ChannelBadge channel={row.channel} />,
      // Accessor is used only for client-side sort: render the raw channel
      // (or `'master'` sentinel) so sort order stays deterministic without
      // depending on a plugin lookup that might not be registered.
      accessor: (row) => row.channel ?? 'master',
      sortable: true,
    },
    {
      id: 'published',
      header: 'Published',
      cell: (row) =>
        row.publishedVersion !== null ? (
          <span className="mono-text">v{row.publishedVersion}</span>
        ) : (
          <span className="muted-text">—</span>
        ),
      accessor: (row) => row.publishedVersion ?? -1,
      sortable: true,
    },
    {
      id: 'draft',
      header: 'Draft',
      cell: (row) =>
        row.hasDraft ? (
          <StatusBadge tone="review" compact>
            v{row.latestVersion}
          </StatusBadge>
        ) : (
          <span className="muted-text">—</span>
        ),
      hideBelow: 768,
    },
    {
      id: 'updatedAt',
      header: 'Updated',
      cell: (row) => (
        <span title={formatDateTime(row.updatedAt)}>{formatRelativeTime(row.updatedAt)}</span>
      ),
      accessor: (row) => row.updatedAt,
      sortable: true,
      hideBelow: 1024,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Row actions</span>,
      cell: (row) =>
        row.latestState !== 'archived' ? (
          <Button
            tone="ghost"
            onClick={(event) => {
              // Stop the row-click navigation that DataTable wires via rowHref.
              event.stopPropagation();
              event.preventDefault();
              setArchiveTarget(row);
            }}
          >
            Archive
          </Button>
        ) : (
          <span className="muted-text">archived</span>
        ),
    },
  ];

  return (
    <PageLayout
      eyebrow="Settings"
      title="Prompt templates"
      description="Author, version, and publish the prompts the AI suggestion flow sends to the model."
      actions={
        isAdmin ? (
          <Button tone="primary" onClick={() => setNewDialogOpen(true)}>
            New template
          </Button>
        ) : undefined
      }
    >
      <div className="prompt-templates-toolbar">
        <FormField label="Channel" name="prompt-templates-channel-filter" description="Filter by target channel">
          <Select value={channelFilter ?? ''} onChange={handleChannelChange}>
            {channelFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Status" name="prompt-templates-status-filter" description="Hide fully-archived rows by default">
          <Select value={statusFilter} onChange={handleStatusChange}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </Select>
        </FormField>
      </div>

      {query.isLoading ? (
        <LoadingState title="Loading prompt templates" message="Fetching templates…" />
      ) : query.error ? (
        <ErrorState
          title="Unable to load prompt templates"
          message={query.error instanceof Error ? query.error.message : 'Unknown error'}
          action={
            <button className="button button--secondary" onClick={() => void query.refetch()}>
              Retry
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No prompt templates yet"
          message="The suggestion flow uses these prompts. Seed migrations usually create the first versions."
        />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.latestId}
          rowHref={(row) => `/ai/prompt-templates/${row.latestId}`}
          cardView={cardView}
        />
      )}

      <NewPromptTemplateDialog open={newDialogOpen} onOpenChange={setNewDialogOpen} />
      <ArchivePromptTemplateDialog
        row={archiveTarget}
        onOpenChange={(next) => {
          if (!next) setArchiveTarget(null);
        }}
      />
    </PageLayout>
  );
}
