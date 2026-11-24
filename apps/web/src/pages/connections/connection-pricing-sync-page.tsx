/**
 * Connection Pricing & Sync Page (#3149/#3166 review, #3150, ADR-072)
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
 * **Also the one route #3150's two entry paths land on (#3167 review,
 * finding 2) — resolved by CAPABILITY, never mutual exclusivity.** A viable
 * pricing destination (`OfferManager` / `ProductPublisher`) gets the
 * editable settings above; a `ProductMaster` connection additionally gets
 * the read-only `SourceConnectionPricingRollup` — "how each destination
 * this connection feeds adjusts the price". These are independent facts
 * about one connection, not alternatives: a WooCommerce connection with
 * BOTH `ProductMaster` and `ProductPublisher` enabled is a real shipped
 * configuration (it publishes its own catalogue AND feeds other
 * destinations), and an earlier version of this page picked one branch and
 * silently dropped the other. Both render when both capabilities are
 * present; neither capability at all is the only case with nothing to
 * show.
 *
 * `?source=` pre-expands a source's override editor in the editable
 * section — the landing spot for the source rollup's own "Manage" links
 * and for #3148's Edit-dialog "Set a rule just for this source" permalink.
 *
 * @module apps/web/src/pages/connections
 */
import type { ReactElement } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { interpolate, useMessages } from '../../shared/i18n';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { isPricingDestination, useConnectionQuery } from '../../features/connections';
import { PricingAndSyncSection } from '../../features/connections/components/pricing-and-sync-section';
import { SourceConnectionPricingRollup } from '../../features/price-changes/components/source-connection-pricing-rollup';
import { describeApiError } from '../../shared/api/describe-api-error';

export function ConnectionPricingSyncPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const connectionQuery = useConnectionQuery(connectionId);
  const copy = useMessages('connections').connectionPricingSyncPage;
  const backTo = { to: `/connections/${connectionId}`, label: copy.eyebrow } as const;

  if (connectionQuery.isLoading) {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.title} description={copy.loading.description}>
        <LoadingState liveRegion="off" title={copy.loading.title} message={copy.loading.message} />
      </PageLayout>
    );
  }

  if (connectionQuery.error || !connectionQuery.data) {
    return (
      <PageLayout
        backTo={backTo}
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.error.description}
      >
        <ErrorState
          title={copy.error.title}
          message={
            connectionQuery.error
              ? describeApiError(connectionQuery.error, 'connections')
              : copy.error.unknown
          }
        />
      </PageLayout>
    );
  }

  const connection = connectionQuery.data;
  const isDestination = isPricingDestination(connection);
  const isSource = connection.enabledCapabilities.includes('ProductMaster');

  if (!isDestination && !isSource) {
    return (
      <PageLayout
        backTo={backTo}
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={interpolate(copy.nothing.description, { name: connection.name })}
      >
        <EmptyState
          title={copy.nothing.title}
          message={copy.nothing.message}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      backTo={backTo}
      eyebrow={copy.eyebrow}
      title={interpolate(copy.titleWithName, { name: connection.name })}
      description={
        isDestination && isSource
          ? copy.descriptions.destinationAndSource
          : isDestination
            ? copy.descriptions.destination
            : copy.descriptions.source
      }
    >
      {isDestination ? (
        <PricingAndSyncSection
          connectionId={connectionId}
          initialExpandSourceId={searchParams.get('source') ?? undefined}
          // `?source=` alone means "show me this row". Creating an override
          // needs `&override=1` (#3167 round-3 review) — the rollup's
          // "Manage" link is a neutral pointer and must not stage a rule
          // nobody ticked.
          initialCreateOverrideForSourceId={
            searchParams.get('override') === '1'
              ? (searchParams.get('source') ?? undefined)
              : undefined
          }
        />
      ) : null}
      {isSource ? <SourceConnectionPricingRollup connectionId={connectionId} /> : null}
    </PageLayout>
  );
}
