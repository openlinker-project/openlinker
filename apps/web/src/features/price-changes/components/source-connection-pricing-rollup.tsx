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
import { ruleLabelFor, syncModeLabelFor, toRuleSummary } from '../lib/price-rule-labels';
import { getMessages, interpolate, useMessages } from '../../../shared/i18n';
import { describeOverride, hasOwnOverride } from '../lib/pricing-sync-overrides';
import type { ConnectionAsSourceEntry } from '../api/pricing-sync.types';

export interface SourceConnectionPricingRollupProps {
  connectionId: string;
}

function summaryFor(entry: ConnectionAsSourceEntry): string {
  const copy = getMessages('price-changes').sourceConnectionPricingRollup;
  const mode = syncModeLabelFor(entry.effectiveMode);
  const rule = ruleLabelFor(toRuleSummary(entry.effectiveRuleSummary));
  return hasOwnOverride(entry)
    ? interpolate(copy.summaryOverride, { mode, rule, override: describeOverride(entry) })
    : interpolate(copy.summaryDefault, { mode, rule, destination: entry.destinationLabel });
}

export function SourceConnectionPricingRollup({
  connectionId,
}: SourceConnectionPricingRollupProps): ReactElement {
  const query = useConnectionAsSourceQuery(connectionId);
  const copy = useMessages('price-changes').sourceConnectionPricingRollup;

  if (query.isLoading) {
    return <LoadingState title={copy.loadingTitle} message={copy.loadingMessage} />;
  }
  if (query.error) {
    return (
      <ErrorState
        title={copy.errorTitle}
        message={query.error.message}
      />
    );
  }

  // The backend only lists a destination here once it has its own override
  // for this source OR an open price-change episode
  // (`modeOverridden || ruleOverridden || destinationIdsFromEpisodes.has(destination.id)`),
  // so a destination consuming this source with its DEFAULT rule and a
  // clean queue is filtered out — the common steady state. "No
  // destinations" would be a false claim in that state (#3167 review,
  // finding 5): destinations ARE consuming this source's prices, they just
  // have nothing here to show yet. Widening the backend query to include
  // every destination whose `masterCatalogConnectionId` names this source
  // is a follow-up, not this component's fix.
  const entries = query.data ?? [];

  return (
    <div className="pricing-rollup">
      <div className="pricing-rollup__head">
        <div>
          <h3>{copy.heading}</h3>
          <p className="pricing-rollup__desc">{copy.description}</p>
        </div>
      </div>
      {entries.length === 0 ? (
        <EmptyState
          title={copy.empty.title}
          message={copy.empty.message}
        />
      ) : (
        <div className="pricing-rollup__list" id="source-page-list">
          {entries.map((entry) => (
            <div className="pricing-rollup__row" key={entry.destinationConnectionId}>
              <div className="pricing-rollup__row-head">
                <span className="pricing-rollup__row-name">{entry.destinationLabel}</span>
                <Link
                  className="button button--secondary button--xs"
                  id={`source-page-manage-${entry.destinationConnectionId}`}
                  to={`/connections/${entry.destinationConnectionId}/pricing-sync?source=${connectionId}`}
                >
                  {copy.manage}
                </Link>
              </div>
              <div className="pricing-rollup__row-summary">{summaryFor(entry)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
