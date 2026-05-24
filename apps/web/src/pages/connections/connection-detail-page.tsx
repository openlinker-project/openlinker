import type { ReactElement } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useConnectionQuery } from '../../features/connections/hooks/use-connection-query';
import { useProductMasterConnections } from '../../features/connections/hooks/use-product-master-connections';
import { ConnectionActionsPanel } from '../../features/connections/components/ConnectionActionsPanel';
import { ConnectionCapabilitiesPanel } from '../../features/connections/components/ConnectionCapabilitiesPanel';
import { ConnectionConfigPanel } from '../../features/connections/components/ConnectionConfigPanel';
import { ConnectionDiagnosticsPanel } from '../../features/connections/components/ConnectionDiagnosticsPanel';
import type { Connection, ConnectionStatus } from '../../features/connections/api/connections.types';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { EntityLabel } from '../../shared/ui/entity-label';
import { KeyValueList } from '../../shared/ui/key-value-list';
import { PageLayout } from '../../shared/ui/page-layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../shared/ui/tabs';
import { TimeDisplay } from '../../shared/ui/time-display';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { Alert } from '../../shared/ui/alert';
import { usePlatform } from '../../shared/plugins';

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
  }
}

/**
 * Re-authentication banner (#819).
 *
 * Shown when a connection has been auto-flagged `needs_reauth` after a terminal
 * credential rejection (the scheduler has paused syncing against it). For OAuth
 * platforms it links to the setup wizard in re-auth mode (`?reauth={id}`),
 * which rotates credentials in place and clears the flag. Non-OAuth platforms
 * fall back to editing the connection's credentials.
 */
function ReauthRequiredBanner({ connection }: { connection: Connection }): ReactElement | null {
  const platform = usePlatform(connection.platformType);

  if (connection.status !== 'needs_reauth') return null;

  const platformLabel = platform?.displayName ?? connection.platformType;
  const oauthReauthTo =
    platform?.requiresExternalAuthRedirect && platform.setupCard?.to
      ? `${platform.setupCard.to}?reauth=${connection.id}`
      : null;

  return (
    <Alert
      tone="warning"
      title="Re-authentication required"
      action={
        oauthReauthTo ? (
          <Link className="button button--primary" to={oauthReauthTo}>
            Re-authenticate
          </Link>
        ) : (
          <Link className="button button--primary" to={`/connections/${connection.id}/edit`}>
            Update credentials
          </Link>
        )
      }
    >
      OpenLinker can no longer authenticate with {platformLabel} — the stored credentials were
      rejected, so syncing is paused for this connection. Re-authenticate to restore access; the
      connection and its mappings are preserved.
    </Alert>
  );
}

const TAB_VALUES = ['overview', 'health', 'actions', 'config'] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(value: string | null): value is TabValue {
  return value !== null && (TAB_VALUES as readonly string[]).includes(value);
}

interface ProductCatalogLinkBannerProps {
  connection: Connection;
  candidates: Connection[];
  isLoading: boolean;
  hasError: boolean;
}

function ProductCatalogLinkBanner({
  connection,
  candidates,
  isLoading,
  hasError,
}: ProductCatalogLinkBannerProps): ReactElement | null {
  if (!connection.enabledCapabilities.includes('OfferManager')) return null;

  const rawMaster = connection.config.masterCatalogConnectionId;
  const explicitMaster = typeof rawMaster === 'string' ? rawMaster : null;
  const editHref = `/connections/${connection.id}/edit`;

  if (explicitMaster !== null && explicitMaster.length > 0) {
    // Linked — no banner.
    return null;
  }

  if (explicitMaster === '') {
    return (
      <Alert tone="warning" title="Barcode linking disabled">
        Barcode linking is turned off for this connection. <Link to={editHref}>Edit connection</Link>{' '}
        to select a catalog.
      </Alert>
    );
  }

  // From here: explicitMaster === null (server never stored the key).
  // Defer banner render until candidates query settles, and stay silent on
  // candidate-query errors (advisory banner, not blocking; avoids double
  // noise when the user already sees global query errors elsewhere).
  if (isLoading) return null;
  if (hasError) return null;

  if (candidates.length === 1) {
    return (
      <Alert tone="info" title="Product catalog auto-linked">
        Barcode linking will use <strong>{candidates[0].name}</strong> (the only ProductMaster
        connection). <Link to={editHref}>Edit connection</Link> to pin this explicitly.
      </Alert>
    );
  }

  if (candidates.length === 0) {
    return (
      <Alert tone="warning" title="Product catalog not linked">
        No active ProductMaster connections to link to.{' '}
        <Link to="/connections/new?platform=prestashop">Add a PrestaShop connection</Link> first.
      </Alert>
    );
  }

  return (
    <Alert tone="warning" title="Product catalog not linked">
      Multiple ProductMaster connections exist — pick one explicitly or barcode sync will be
      skipped. <Link to={editHref}>Edit connection</Link>.
    </Alert>
  );
}

export function ConnectionDetailPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const connectionQuery = useConnectionQuery(connectionId);
  const {
    productMasterConnections,
    connectionsQuery: productMasterConnectionsQuery,
  } = useProductMasterConnections();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab');
  const activeTab: TabValue = isTabValue(tabParam) ? tabParam : 'overview';

  const handleTabChange = (value: string): void => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (value === 'overview') {
          params.delete('tab');
        } else {
          params.set('tab', value);
        }
        return params;
      },
      { replace: true },
    );
  };

  const connection = connectionQuery.data;

  return (
    <PageLayout
      eyebrow="Integration detail"
      title={
        connection ? (
          <EntityLabel id={connection.id} name={connection.name} />
        ) : (
          `Connection ${connectionId}`
        )
      }
      description="Connection overview, configuration, health, and operator actions."
      backTo={{ to: '/connections', label: 'Connections' }}
      actions={
        connection ? (
          <div className="button-group">
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
          </div>
        ) : undefined
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
      {connection ? <ReauthRequiredBanner connection={connection} /> : null}
      {connection ? (
        <ProductCatalogLinkBanner
          connection={connection}
          candidates={productMasterConnections.filter((c) => c.id !== connection.id)}
          isLoading={productMasterConnectionsQuery.isLoading}
          hasError={Boolean(productMasterConnectionsQuery.error)}
        />
      ) : null}
      {connection ? (
        <Tabs value={activeTab} onValueChange={handleTabChange}>
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
