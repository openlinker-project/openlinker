/**
 * Analytics Needs Attention
 *
 * The /analytics "needs attention" section (#1989): coverage gaps, stock at
 * risk, and value stuck in failed syncs — each rendered only while open, per
 * the design mockup's either/or rule (docs/plans/mockups/analytics-ledger-2003.html,
 * frame 02): the section is either the all-clear line or the open items,
 * never both, and a resolved category renders nothing.
 *
 * @module apps/web/src/features/analytics/components
 */
import { useMemo, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Button, ErrorState, LoadingState, StatusBadge, type StatusBadgeTone } from '../../../shared/ui';
import { useConnectionsQuery } from '../../connections';
import { useNeedsAttentionQuery } from '../hooks/use-needs-attention-query';
import {
  deriveCoverageHeadline,
  deriveFailedSyncHeadline,
  deriveStockHeadline,
  type AttentionRowCopy,
} from '../lib/needs-attention-copy.lib';

const MAX_WIZARD_IDS = 100;

interface AttentionRow extends AttentionRowCopy {
  key: string;
  tone: StatusBadgeTone;
  badgeLabel: string;
  linkTo: string;
  linkLabel: string;
}

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function AnalyticsNeedsAttention(): ReactElement {
  const needsAttentionQuery = useNeedsAttentionQuery();
  const connectionsQuery = useConnectionsQuery();

  const connectionName = useMemo(() => {
    const byId = new Map((connectionsQuery.data ?? []).map((c) => [c.id, c.name]));
    return (connectionId: string): string => byId.get(connectionId) ?? connectionId;
  }, [connectionsQuery.data]);

  if (needsAttentionQuery.isLoading) {
    return (
      <article className="panel panel--dense">
        <div className="panel__header">
          <h3 className="section-title">Needs attention</h3>
        </div>
        <LoadingState title="Checking for open items" message="Looking at coverage, stock, and failed syncs…" />
      </article>
    );
  }

  if (needsAttentionQuery.error) {
    return (
      <article className="panel panel--dense">
        <div className="panel__header">
          <h3 className="section-title">Needs attention</h3>
        </div>
        <ErrorState
          title="Unable to check for open items"
          message={needsAttentionQuery.error.message}
          action={
            <Button type="button" onClick={() => void needsAttentionQuery.refetch()}>
              Retry
            </Button>
          }
        />
      </article>
    );
  }

  const summary = needsAttentionQuery.data;
  if (!summary) {
    return (
      <article className="panel panel--dense">
        <div className="panel__header">
          <h3 className="section-title">Needs attention</h3>
        </div>
      </article>
    );
  }

  const rows: AttentionRow[] = [];

  if (summary.coverageGapsTotalCount > 0) {
    const copy = deriveCoverageHeadline(summary.coverageGaps, summary.coverageGapsTotalCount, connectionName);
    const productIds = uniqueValues(summary.coverageGaps.map((item) => item.productId)).slice(0, MAX_WIZARD_IDS);
    const variantIds = uniqueValues(summary.coverageGaps.map((item) => item.variantId)).slice(0, MAX_WIZARD_IDS);
    const missingConnectionIds = uniqueValues(
      summary.coverageGaps
        .filter((item) => item.missingFromConnectionIds.length === 1)
        .map((item) => item.missingFromConnectionIds[0])
    );
    const params = new URLSearchParams({
      productIds: productIds.join(','),
      variantIds: variantIds.join(','),
    });
    if (missingConnectionIds.length === 1) {
      params.set('connectionId', missingConnectionIds[0]);
    }

    rows.push({
      key: 'coverage-gaps',
      tone: 'warning',
      badgeLabel: 'Action',
      linkTo: `/listings/bulk-create/wizard?${params.toString()}`,
      linkLabel: 'Publish now',
      ...copy,
    });
  }

  if (summary.stockAtRiskTotalCount > 0) {
    const copy = deriveStockHeadline(summary.stockAtRisk, summary.stockAtRiskTotalCount, connectionName);
    const firstProductId = summary.stockAtRisk[0]?.productId;

    rows.push({
      key: 'stock-at-risk',
      tone: 'warning',
      badgeLabel: 'Action',
      linkTo: firstProductId ? `/products/${firstProductId}` : '/products',
      linkLabel: 'Review stock',
      ...copy,
    });
  }

  if (summary.failedSyncValue.count > 0) {
    const copy = deriveFailedSyncHeadline(summary.failedSyncValue);

    rows.push({
      key: 'failed-sync-value',
      tone: 'error',
      badgeLabel: 'Stuck',
      linkTo: '/orders?health=needs_attention',
      linkLabel: 'Review orders',
      ...copy,
    });
  }

  const checkedCount = 3;

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <h3 className="section-title">Needs attention</h3>
      </div>
      <div className="attention-list">
        {rows.length === 0 ? (
          <div className="attention-list__item attention-list__item--resolved">
            <StatusBadge tone="success" withDot>
              Clear
            </StatusBadge>
            <div className="attention-list__body">
              <span className="attention-list__headline">Nothing needs attention</span>
              <span className="attention-list__sub">
                {checkedCount} checks · coverage, stock, destination syncs
              </span>
            </div>
          </div>
        ) : (
          rows.map((row) => (
            <div className="attention-list__item" key={row.key}>
              <StatusBadge tone={row.tone} withDot>
                {row.badgeLabel}
              </StatusBadge>
              <div className="attention-list__body">
                <span className="attention-list__headline">{row.headline}</span>
                <span className="attention-list__sub">{row.sub}</span>
              </div>
              <Link className="button button--secondary button--sm" to={row.linkTo}>
                {row.linkLabel}
              </Link>
            </div>
          ))
        )}
      </div>
    </article>
  );
}
