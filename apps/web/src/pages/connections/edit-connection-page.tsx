import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useConnectionQuery } from '../../features/connections/hooks/use-connection-query';
import { EditConnectionForm } from '../../features/connections/components/EditConnectionForm';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';

export function EditConnectionPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const connectionQuery = useConnectionQuery(connectionId);

  return (
    <PageLayout
      backTo={{
        to: `/connections/${connectionId}`,
        label: connectionQuery.data?.name ?? 'Connection',
      }}
      eyebrow="Connection settings"
      title="Edit connection"
      description="Update the connection name, configuration, and adapter settings."
    >
      {connectionQuery.isLoading ? (
        <LoadingState
          title="Loading connection"
          message="Fetching connection data for editing."
        />
      ) : null}
      {connectionQuery.error ? (
        <ErrorState
          title="Unable to load connection"
          message={connectionQuery.error.message}
          action={
            <button type="button" className="button button--secondary" onClick={() => void connectionQuery.refetch()}>
              Retry
            </button>
          }
        />
      ) : null}
      {!connectionQuery.isLoading && !connectionQuery.error && !connectionQuery.data ? (
        <EmptyState
          title="Connection not found"
          message="No connection data was returned. Check the connection ID or return to the list."
        />
      ) : null}
      {connectionQuery.data ? (
        <EditConnectionForm connection={connectionQuery.data} />
      ) : null}
    </PageLayout>
  );
}
