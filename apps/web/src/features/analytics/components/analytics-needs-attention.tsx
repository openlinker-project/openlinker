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
import { interpolate, renderRich, useMessages } from '../../../shared/i18n';
import {
  Button,
  ErrorState,
  LoadingState,
  StatusBadge,
  TimeDisplay,
  type StatusBadgeTone,
} from '../../../shared/ui';
import { useConnectionsQuery } from '../../connections';
import { useNeedsAttentionQuery } from '../hooks/use-needs-attention-query';
import {
  deriveCoverageHeadline,
  deriveFailedSyncHeadline,
  deriveStockHeadline,
  type AttentionRowCopy,
} from '../lib/needs-attention.lib';

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
  const copy = useMessages('analytics').analyticsNeedsAttention;
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
          <h3 className="section-title">{copy.title}</h3>
        </div>
        <LoadingState title={copy.loading.title} message={copy.loading.message} />
      </article>
    );
  }

  if (needsAttentionQuery.error) {
    return (
      <article className="panel panel--dense">
        <div className="panel__header">
          <h3 className="section-title">{copy.title}</h3>
        </div>
        <ErrorState
          title={copy.error.title}
          message={needsAttentionQuery.error.message}
          action={
            <Button type="button" onClick={() => void needsAttentionQuery.refetch()}>
              {copy.error.retry}
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
          <h3 className="section-title">{copy.title}</h3>
        </div>
      </article>
    );
  }

  const rows: AttentionRow[] = [];

  if (summary.coverageGapsTotalCount > 0) {
    const { connectionId, ...coverageCopy } = deriveCoverageHeadline(
      summary.coverageGaps,
      summary.coverageGapsTotalCount,
      connectionName
    );
    // summary.coverageGaps is already a server-side-capped preview (≤
    // DEFAULT_AGGREGATE_LIMIT), so productIds/variantIds are derived from
    // the SAME item list rather than sliced independently — otherwise a
    // variantId could survive its own product being dropped by a separate
    // slice (#2120 review, SUGGESTION).
    const isPartialSample = summary.coverageGaps.length < summary.coverageGapsTotalCount;
    const productIds = uniqueValues(summary.coverageGaps.map((item) => item.productId));
    const variantIds = uniqueValues(summary.coverageGaps.map((item) => item.variantId));
    const params = new URLSearchParams({
      productIds: productIds.join(','),
      variantIds: variantIds.join(','),
    });
    // `connectionId` is read from the headline's OWN resolution, never
    // re-derived here — a separately-computed, weaker predicate could pin a
    // channel into this link that the headline above explicitly declined to
    // name (#2120 re-review, IMPORTANT).
    if (connectionId) {
      params.set('connectionId', connectionId);
    }

    rows.push({
      key: 'coverage-gaps',
      tone: 'warning',
      badgeLabel: copy.badges.action,
      linkTo: `/listings/bulk-create/wizard?${params.toString()}`,
      linkLabel: copy.links.publishNow,
      ...coverageCopy,
      // "Publish now" only seeds the sampled variants when the row's own
      // total exceeds the preview — say so, since a partial sample can
      // otherwise be reviewed and submitted while the headline still
      // reports the full total (#2120 review, IMPORTANT).
      sub: isPartialSample
        ? interpolate(copy.partialSample, {
            sub: coverageCopy.sub,
            shown: summary.coverageGaps.length,
            total: summary.coverageGapsTotalCount,
          })
        : coverageCopy.sub,
    });
  }

  if (summary.stockAtRiskTotalCount > 0) {
    const stockCopy = deriveStockHeadline(
      summary.stockAtRisk,
      summary.stockAtRiskTotalCount,
      connectionName
    );
    const firstProductId = summary.stockAtRisk[0]?.productId;

    rows.push({
      key: 'stock-at-risk',
      tone: 'warning',
      badgeLabel: copy.badges.action,
      linkTo: firstProductId ? `/products/${firstProductId}` : '/products',
      linkLabel: copy.links.reviewStock,
      ...stockCopy,
    });
  }

  if (summary.failedSyncValue.count > 0) {
    const failedSyncCopy = deriveFailedSyncHeadline(summary.failedSyncValue);

    rows.push({
      key: 'failed-sync-value',
      tone: 'error',
      badgeLabel: copy.badges.stuck,
      linkTo: '/orders?health=needs_attention',
      linkLabel: copy.links.reviewOrders,
      ...failedSyncCopy,
    });
  }

  const checkedCount = 3;

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <h3 className="section-title">{copy.title}</h3>
        {needsAttentionQuery.dataUpdatedAt > 0 && (
          <span className="text-muted mono-text">
            {renderRich(copy.checked, {
              time: () => (
                <TimeDisplay iso={new Date(needsAttentionQuery.dataUpdatedAt).toISOString()} />
              ),
            })}
          </span>
        )}
      </div>
      <ul className="attention-list">
        {rows.length === 0 ? (
          <li className="attention-list__item attention-list__item--resolved">
            <StatusBadge tone="neutral" withDot>
              {copy.clear.badge}
            </StatusBadge>
            <div className="attention-list__body">
              <span className="attention-list__headline">{copy.clear.headline}</span>
              <span className="attention-list__sub">
                {interpolate(copy.clear.sub, { n: checkedCount })}
              </span>
            </div>
          </li>
        ) : (
          rows.map((row) => (
            <li className="attention-list__item" key={row.key}>
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
            </li>
          ))
        )}
      </ul>
    </article>
  );
}
