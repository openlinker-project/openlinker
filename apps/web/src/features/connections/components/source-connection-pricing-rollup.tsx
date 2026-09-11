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
 * @module apps/web/src/features/connections/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { LoadingState, ErrorState, EmptyState } from '../../../shared/ui/feedback-state';
import { useConnectionAsSourceQuery, ruleLabelFor } from '../../price-changes';
import type { ConnectionAsSourceEntry } from '../../price-changes';

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

  const entries = query.data ?? [];
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No destinations yet"
        message="Nothing sells your catalogue through a price-adjusting connection yet."
      />
    );
  }

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
    </div>
  );
}
