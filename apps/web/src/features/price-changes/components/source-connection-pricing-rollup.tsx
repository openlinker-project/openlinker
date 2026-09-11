/**
 * SourceConnectionPricingRollup (#3150, ADR-072 decision 2)
 *
 * A source connection (e.g. an operator's PrestaShop store) never gets an
 * editable pricing rule of its own — rules live on the destinations that
 * consume its prices (Model A). This is the READ-ONLY counterpart: an
 * operator who navigated to a source connection sees a rollup of how each
 * destination it feeds adjusts its price, and a "Manage" link into that
 * destination's own Pricing & sync page — never a form field here.
 *
 * Mirrors `docs/plans/mockups/price-changes-review-queue.html`'s
 * `#page-source` (`#source-page-list`, one row per destination).
 *
 * **Lives in `features/price-changes`, not `features/connections` (#3167
 * review, finding 5).** This component has no actual dependency on the
 * `connections` feature slice — only `react-router-dom`,
 * `shared/ui/feedback-state`, and the price-changes hook/copy below — so
 * placing it under `connections` created a latent barrel-cycle risk the
 * moment that barrel started re-exporting it
 * (`connections -> price-changes (barrel, via the queue table)
 * -> connections (barrel)`), plus the cost today of pulling the whole
 * price-changes barrel (the queue table, four dialogs, the bulk-progress
 * widget) into what should be a lightweight lazy route.
 *
 * @module apps/web/src/features/price-changes/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { LoadingState, ErrorState, EmptyState } from '../../../shared/ui/feedback-state';
import { useConnectionAsSourceQuery } from '../hooks/use-connection-as-source-query';
import { ruleLabelFor } from '../lib/price-change-copy';
import type { ConnectionAsSourceEntry } from '../api/pricing-sync.types';

export interface SourceConnectionPricingRollupProps {
  connectionId: string;
}

function summaryFor(entry: ConnectionAsSourceEntry): string {
  const modeLabel = entry.effectiveMode === 'automatic' ? 'Automatic' : 'Manual review';
  const ruleLabel = ruleLabelFor(entry.effectiveRuleSummary);
  const suffix = entry.isCustomOverride
    ? '— a rule just for this source'
    : `— using ${entry.destinationLabel}'s default rule`;
  return `${modeLabel} · ${ruleLabel} ${suffix}`;
}

export function SourceConnectionPricingRollup({
  connectionId,
}: SourceConnectionPricingRollupProps): ReactElement {
  const query = useConnectionAsSourceQuery(connectionId);

  if (query.isLoading) {
    return <LoadingState title="Pricing & sync" message="Loading how your prices get adjusted…" />;
  }
  if (query.error) {
    return (
      <ErrorState
        title="Couldn't load pricing & sync settings"
        message={query.error.message}
      />
    );
  }

  // The backend only lists a destination here once it has its own override
  // for this source OR an open price-change episode
  // (`isCustomOverride || destinationIdsFromEpisodes.has(destination.id)`),
  // so a destination consuming this source with its DEFAULT rule and a
  // clean queue is filtered out — the common steady state. "No
  // destinations" would be a false claim in that state (#3167 review,
  // finding 5): destinations ARE consuming this source's prices, they just
  // have nothing here to show yet. Widening the backend query to include
  // every destination whose `masterCatalogConnectionId` names this source
  // is a follow-up, not this component's fix.
  const entries = query.data ?? [];

  return (
    <div className="settings-section">
      <div className="settings-section__head">
        <div>
          <h2>How your prices get adjusted</h2>
          <p className="settings-section__desc">
            Each place you sell can mark up or round your price differently. Manage a rule from
            where it&apos;s used.
          </p>
        </div>
      </div>
      {entries.length === 0 ? (
        <EmptyState
          title="Nothing to show yet"
          message="No destinations are adjusting your prices right now. A destination appears here once it has its own rule for this source, or a price change from it is waiting for review."
        />
      ) : (
        <div className="source-list" id="source-page-list">
          {entries.map((entry) => (
            <div className="source-row" key={entry.destinationConnectionId}>
              <div className="source-row__head">
                <span className="source-row__name">{entry.destinationLabel}</span>
                <Link
                  className="button button--secondary button--xs"
                  id={`source-page-manage-${entry.destinationConnectionId}`}
                  to={`/connections/${entry.destinationConnectionId}/pricing-sync?source=${connectionId}`}
                >
                  Manage
                </Link>
              </div>
              <div className="source-row__summary">{summaryFor(entry)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
