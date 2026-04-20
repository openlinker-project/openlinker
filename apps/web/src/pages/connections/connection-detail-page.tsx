import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useConnectionQuery } from '../../features/connections/hooks/use-connection-query';
import { ConnectionActionsPanel } from '../../features/connections/components/ConnectionActionsPanel';
import { ConnectionCapabilitiesPanel } from '../../features/connections/components/ConnectionCapabilitiesPanel';
import { ConnectionConfigPanel } from '../../features/connections/components/ConnectionConfigPanel';
import { ConnectionDiagnosticsPanel } from '../../features/connections/components/ConnectionDiagnosticsPanel';
import type { ConnectionStatus } from '../../features/connections/api/connections.types';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { KeyValueList } from '../../shared/ui/key-value-list';
import { PageLayout } from '../../shared/ui/page-layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../shared/ui/tabs';
import { TimeDisplay } from '../../shared/ui/time-display';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { Alert } from '../../shared/ui/alert';

function toStatusTone(status: ConnectionStatus): StatusBadgeTone {
  switch (status) {
    case 'active':
      return 'success';
    case 'disabled':
      return 'neutral';
    case 'error':
      return 'error';
  }
}

export function ConnectionDetailPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const connectionQuery = useConnectionQuery(connectionId);

  const connection = connectionQuery.data;

  return (
    <PageLayout
      eyebrow="Integration detail"
      title={connection ? connection.name : `Connection ${connectionId}`}
      description="Connection overview, configuration, health, and operator actions."
      actions={
        <div className="button-group">
          {connection ? (
            <>
              <Link className="button button--primary" to={`/connections/${connectionId}/edit`}>
                Edit connection
              </Link>
              <Link className="button button--secondary" to={`/connections/${connectionId}/mappings`}>
                Mappings
              </Link>
              {connection.enabledCapabilities.includes('ProductMaster') ? (
                <Link className="button button--secondary" to={`/connections/${connectionId}/mappings/categories`}>
                  Category Mappings
                </Link>
              ) : null}
            </>
          ) : null}
          <Link className="button button--secondary" to="/connections">
            Back to integrations
          </Link>
        </div>
      }
      summary={
        connection ? (
          <>
            <div className="toolbar__group">
              <span className="toolbar-chip">{connection.platformType}</span>
              <StatusBadge tone={toStatusTone(connection.status)}>{connection.status}</StatusBadge>
            </div>
            <div className="toolbar__group">
              <span className="muted-text">Created <TimeDisplay iso={connection.createdAt} format="date" /></span>
            </div>
          </>
        ) : undefined
      }
    >
      {connectionQuery.isLoading ? (
        <LoadingState
          title="Loading connection"
          message="Fetching the latest connection summary and diagnostics."
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
      {!connectionQuery.isLoading && !connectionQuery.error && !connection ? (
        <EmptyState
          title="Connection not found"
          message="No connection data was returned for this route. Retry from the integrations list or verify the selected identifier."
        />
      ) : null}
      {connection &&
      connection.enabledCapabilities.includes('Marketplace') &&
      typeof connection.config.masterCatalogConnectionId !== 'string' ? (
        <Alert tone="warning" title="Product catalog not linked">
          Offer-to-product barcode linking is disabled. Edit this connection to select a ProductMaster
          catalog connection, or barcode sync will be skipped.
        </Alert>
      ) : null}
      {connection ? (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="health">Health</TabsTrigger>
            <TabsTrigger value="actions">Actions</TabsTrigger>
            <TabsTrigger value="config">Config</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="panel panel--dense">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Connection summary</p>
                  <h3 className="section-title">Overview</h3>
                </div>
                <StatusBadge tone={toStatusTone(connection.status)}>
                  {connection.status}
                </StatusBadge>
              </div>

              <KeyValueList
                items={[
                  { id: 'name', label: 'Name', value: connection.name },
                  { id: 'platform', label: 'Platform', value: connection.platformType },
                  {
                    id: 'credentials',
                    label: 'Credentials',
                    value: connection.credentialsBacked ? 'DB-managed' : 'Environment variable',
                  },
                  {
                    id: 'adapter',
                    label: 'Adapter',
                    value: connection.adapterKey ?? 'default adapter',
                    mono: true,
                  },
                  { id: 'id', label: 'Connection ID', value: connection.id, mono: true },
                  {
                    id: 'updatedAt',
                    label: 'Last updated',
                    value: <TimeDisplay iso={connection.updatedAt} />,
                  },
                ]}
              />
            </div>

            <ConnectionCapabilitiesPanel connection={connection} />
          </TabsContent>

          <TabsContent value="health">
            <ConnectionDiagnosticsPanel connectionId={connection.id} />
          </TabsContent>

          <TabsContent value="actions">
            <ConnectionActionsPanel connection={connection} />
          </TabsContent>

          <TabsContent value="config">
            <ConnectionConfigPanel config={connection.config} />
          </TabsContent>
        </Tabs>
      ) : null}
    </PageLayout>
  );
}
