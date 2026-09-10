/**
 * PricingSyncPage (#3150)
 *
 * The one route (`connections/:connectionId/pricing-sync`) both of #3150's
 * entry paths — and #3148's Edit-dialog "Set a rule just for this source"
 * permalink — land on, resolved by the connection's own capabilities per
 * the issue's own assumption ("the real route/page selection logic should
 * resolve based on the connection's actual capabilities, not assume mutual
 * exclusivity"): a viable destination (OfferManager or ProductPublisher)
 * gets the editable Pricing & sync settings (#3149); anything else gets the
 * read-only source rollup (#3150). A connection that is both takes the
 * destination branch, since that is the one with something to edit.
 *
 * @module apps/web/src/pages/connections
 */
import type { ReactElement } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useConnectionQuery } from '../../features/connections/hooks/use-connection-query';
import { PricingAndSyncSection } from '../../features/connections/components/pricing-and-sync-section';
import { SourceConnectionPricingRollup } from '../../features/connections/components/source-connection-pricing-rollup';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';

export function PricingSyncPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const connectionQuery = useConnectionQuery(connectionId);

  const connection = connectionQuery.data;
  const isDestination =
    connection?.enabledCapabilities.includes('OfferManager') ||
    connection?.enabledCapabilities.includes('ProductPublisher');

  return (
    <PageLayout
      backTo={{ to: `/connections/${connectionId}`, label: connection?.name ?? 'Connection' }}
      eyebrow="Connection settings"
      title="Pricing & sync"
      description={
        isDestination
          ? "Choose how this connection's price updates get reviewed and priced."
          : 'How each place you sell adjusts your price.'
      }
    >
      {connectionQuery.isLoading ? (
        <LoadingState title="Loading connection" message="Fetching connection data." />
      ) : null}
      {connectionQuery.error ? (
        <ErrorState
          title="Unable to load connection"
          message={connectionQuery.error.message}
          action={
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void connectionQuery.refetch()}
            >
              Retry
            </button>
          }
        />
      ) : null}
      {!connectionQuery.isLoading && !connectionQuery.error && !connection ? (
        <EmptyState
          title="Connection not found"
          message="No connection data was returned. Check the connection ID or return to the list."
        />
      ) : null}
      {connection ? (
        isDestination ? (
          <PricingAndSyncSection
            connectionId={connection.id}
            initialExpandSourceId={searchParams.get('source') ?? undefined}
          />
        ) : (
          <SourceConnectionPricingRollup connectionId={connection.id} />
        )
      ) : null}
    </PageLayout>
  );
}
