/**
 * Connection Pricing & Sync Page (#3149/#3166 review, ADR-072)
 *
 * The single editable surface for `PricingAndSyncSection` — see
 * `connection-pricing-sync.route.tsx` for why it moved off the shared
 * `EditConnectionForm` mega-form: two independent writers of
 * `Connection.config.pricingRule` on one page (this section's nested
 * `{default, sourceOverrides}` shape, and the legacy flat
 * `StockAndPricingSection` still on the mega-form) produced a contradiction
 * on first paint, a destructive checkbox interaction, and a stale-merge
 * hazard on the mega-form's own Save. Splitting the surfaces removes all
 * three structurally rather than patching around them.
 *
 * Gated the same way the mega-form gated the inline section: a viable
 * pricing destination is one that can either list marketplace offers or
 * publish shop products (`OfferManager` / `ProductPublisher`).
 *
 * @module apps/web/src/pages/connections
 */
import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { useConnectionQuery } from '../../features/connections';
import { PricingAndSyncSection } from '../../features/connections/components/pricing-and-sync-section';

const DESTINATION_CAPABILITIES = ['OfferManager', 'ProductPublisher'] as const;

export function ConnectionPricingSyncPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const connectionQuery = useConnectionQuery(connectionId);
  const backTo = { to: `/connections/${connectionId}`, label: 'Connection' } as const;

  if (connectionQuery.isLoading) {
    return (
      <PageLayout eyebrow="Connection" title="Pricing & sync" description="Loading connection…">
        <LoadingState liveRegion="off" title="Loading" message="Fetching connection details." />
      </PageLayout>
    );
  }

  if (connectionQuery.error || !connectionQuery.data) {
    return (
      <PageLayout
        backTo={backTo}
        eyebrow="Connection"
        title="Pricing & sync"
        description="Unable to load connection."
      >
        <ErrorState
          title="Unable to load connection"
          message={connectionQuery.error?.message ?? 'Unknown error'}
        />
      </PageLayout>
    );
  }

  const connection = connectionQuery.data;
  const isDestination = DESTINATION_CAPABILITIES.some((cap) =>
    connection.enabledCapabilities.includes(cap),
  );

  if (!isDestination) {
    return (
      <PageLayout
        backTo={backTo}
        eyebrow="Connection"
        title="Pricing & sync"
        description={`${connection.name} is not a pricing destination.`}
      >
        <EmptyState
          title="Nothing to configure here"
          message="Only a connection that can list marketplace offers or publish shop products gets a pricing rule. Enable OfferManager or ProductPublisher on this connection first."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      backTo={backTo}
      eyebrow="Connection"
      title={`Pricing & sync — ${connection.name}`}
      description="The default pricing rule and sync mode for this destination, plus any per-source overrides."
    >
      <PricingAndSyncSection connectionId={connectionId} />
    </PageLayout>
  );
}
