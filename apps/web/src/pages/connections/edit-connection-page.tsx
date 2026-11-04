import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useConnectionQuery } from '../../features/connections/hooks/use-connection-query';
import { EditConnectionForm } from '../../features/connections/components/EditConnectionForm';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { useMessages } from '../../shared/i18n';

export function EditConnectionPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const connectionQuery = useConnectionQuery(connectionId);
  const copy = useMessages('connections').editConnectionPage;
  const common = useMessages('ui').common;

  return (
    <PageLayout
      backTo={{
        to: `/connections/${connectionId}`,
        label: connectionQuery.data?.name ?? copy.backLabel,
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
          message={connectionQuery.error.message}
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
      {connectionQuery.data ? (
        <EditConnectionForm connection={connectionQuery.data} />
      ) : null}
    </PageLayout>
  );
}
