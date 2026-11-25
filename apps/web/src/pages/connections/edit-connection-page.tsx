import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useConnectionQuery } from '../../features/connections/hooks/use-connection-query';
import { EditConnectionForm } from '../../features/connections/components/EditConnectionForm';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { useMessages } from '../../shared/i18n';
import { usePermission } from '../../shared/auth/use-permission';
import { describeApiError } from '../../shared/api/describe-api-error';
import { StatusBadge } from '../../shared/ui/status-badge';
import { usePlatforms } from '../../shared/plugins';
import { resolvePlatformLabel } from '../../features/mappings';
import { readConnectionEnvironment } from '../../features/connections/lib/connection-environment';
import { describeConnectionStatus } from '../oms/oms-connection';
import type { StatusBadgeTone } from '../../shared/ui/status-badge';
import type { ConnectionStatus } from '../../features/connections/api/connections.types';

const STATUS_TONE: Record<ConnectionStatus, StatusBadgeTone> = {
  active: 'success',
  disabled: 'neutral',
  error: 'error',
  needs_reauth: 'warning',
  archived: 'neutral',
};

/** Platforms with a hue of their own; the rest get a neutral tile. */
const KNOWN_HUES = new Set(['allegro', 'prestashop', 'erli', 'woocommerce', 'amazon', 'shopify']);

function initials(label: string): string {
  const words = label.split(/[\s-]+/).filter(Boolean);
  const letters = words.length > 1 ? words.slice(0, 2).map((w) => w[0]) : [label.slice(0, 2)];
  return letters.join('').toUpperCase();
}

export function EditConnectionPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const connectionQuery = useConnectionQuery(connectionId);
  const copy = useMessages('connections').editConnectionPage;
  const common = useMessages('ui').common;
  // Same convention as the other connection pages: a session without
  // connections:write must not be offered a form whose save it cannot perform.
  const canWrite = usePermission('connections:write');
  const platforms = usePlatforms();
  const connection = connectionQuery.data;
  const platformLabel = connection ? resolvePlatformLabel(platforms, connection) : '';
  const environment = connection ? readConnectionEnvironment(connection.config) : null;
  const status = connection ? describeConnectionStatus(connection, STATUS_TONE[connection.status]) : null;

  if (connection && status && canWrite) {
    const mark = (
      <span
        className="settings-page__mark"
        data-channel={KNOWN_HUES.has(connection.platformType) ? connection.platformType : undefined}
        aria-hidden="true"
      >
        {initials(platformLabel)}
      </span>
    );
    return (
      <EditConnectionForm
        connection={connection}
        backTo={{ to: `/connections/${connectionId}`, label: copy.backLabel }}
        mark={mark}
        subtitle={
          <>
            <span>
              {platformLabel}
              {environment ? ` \u00b7 ${copy.environment[environment]}` : ''}
            </span>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </>
        }
      />
    );
  }

  return (
    <PageLayout
      backTo={{
        to: `/connections/${connectionId}`,
        label: copy.backLabel,
      }}
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
    >
      {connectionQuery.isLoading ? (
        <LoadingState
          title={copy.loading.title}
          message={copy.loading.message}
        />
      ) : null}
      {connectionQuery.error ? (
        <ErrorState
          title={copy.error.title}
          message={describeApiError(connectionQuery.error, 'connections')}
          action={
            <button type="button" className="button button--secondary" onClick={() => void connectionQuery.refetch()}>
              {common.retry}
            </button>
          }
        />
      ) : null}
      {!connectionQuery.isLoading && !connectionQuery.error && !connectionQuery.data ? (
        <EmptyState
          title={copy.notFound.title}
          message={copy.notFound.message}
        />
      ) : null}
      {connectionQuery.data && !canWrite ? (
        <EmptyState title={copy.readOnly.title} message={copy.readOnly.message} />
      ) : null}
    </PageLayout>
  );
}
