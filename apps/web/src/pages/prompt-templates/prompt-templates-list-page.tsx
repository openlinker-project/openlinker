/**
 * Prompt Templates List Page
 *
 * Admin-only list of prompt templates grouped by `(key, channel)`. Row
 * click navigates to the detail/editor page. Hidden from non-admin sessions.
 *
 * @module apps/web/src/pages/prompt-templates
 */
import { useMemo, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSession } from '../../shared/auth/use-session';
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
import { usePromptTemplatesQuery } from '../../features/prompt-templates/hooks/use-prompt-templates-query';
import type {
  PromptTemplateChannel,
  PromptTemplateListFilters,
  PromptTemplateSummary,
} from '../../features/prompt-templates/api/prompt-templates.types';

const CHANNEL_TONE: Record<string, StatusBadgeTone> = {
  prestashop: 'info',
  allegro: 'info',
  master: 'neutral',
};

function channelLabel(channel: PromptTemplateChannel | null): string {
  return channel === null ? 'master' : channel;
}

function parseChannelParam(value: string | null): PromptTemplateListFilters['channel'] | undefined {
  if (value === null || value === '') return undefined;
  if (value === 'master' || value === 'prestashop' || value === 'allegro') return value;
  return undefined;
}

const CARD_VIEW: DataTableCardView<PromptTemplateSummary> = {
  title: (row) => <span className="mono-text">{row.key}</span>,
  subtitle: (row) => (
    <div className="prompt-templates-card__meta">
      <StatusBadge tone={CHANNEL_TONE[channelLabel(row.channel)]} compact>
        {channelLabel(row.channel)}
      </StatusBadge>
      <span className="mono-text">
        {row.publishedVersion !== null ? `published v${row.publishedVersion}` : 'never published'}
      </span>
      {row.hasDraft ? (
        <StatusBadge tone="review" compact>
          draft v{row.latestVersion}
        </StatusBadge>
      ) : null}
    </div>
  ),
};

export function PromptTemplatesListPage(): ReactElement {
  const { session } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();

  const channelFilter = parseChannelParam(searchParams.get('channel'));

  const filters = useMemo<PromptTemplateListFilters>(
    () => (channelFilter !== undefined ? { channel: channelFilter } : {}),
    [channelFilter],
  );

  const query = usePromptTemplatesQuery(filters);

  if (session.status === 'authenticated' && session.user?.role !== 'admin') {
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

  const rows = query.data ?? [];

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
      cell: (row) => (
        <StatusBadge tone={CHANNEL_TONE[channelLabel(row.channel)]} compact>
          {channelLabel(row.channel)}
        </StatusBadge>
      ),
      accessor: (row) => channelLabel(row.channel),
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
  ];

  return (
    <PageLayout
      eyebrow="Settings"
      title="Prompt templates"
      description="Author, version, and publish the prompts the AI suggestion flow sends to the model."
    >
      <div className="prompt-templates-toolbar">
        <FormField label="Channel" name="prompt-templates-channel-filter" description="Filter by target channel">
          <Select value={channelFilter ?? ''} onChange={handleChannelChange}>
            <option value="">All</option>
            <option value="master">Master (generic)</option>
            <option value="prestashop">PrestaShop</option>
            <option value="allegro">Allegro</option>
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
          cardView={CARD_VIEW}
        />
      )}

    </PageLayout>
  );
}
