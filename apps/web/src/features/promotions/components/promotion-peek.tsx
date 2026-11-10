/**
 * PromotionPeek (#3935, mockup `promotions-list` peek)
 *
 * A side panel over the list (a bottom sheet on phones) with the promotion in
 * one sentence, its channels, what it gave in the last 30 days and its last
 * three uses, so a row can be read without leaving the list. Open takes you to
 * the page; the second action turns it off or on.
 *
 * @module apps/web/src/features/promotions/components
 */
import { useMemo, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { formatAbsoluteDate as formatDate } from '../../../shared/format/format-date';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { SidePanel } from '../../../shared/ui/side-panel';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { Connection } from '../../connections';
import type { Promotion } from '../api/promotions.types';
import { usePromotionHistoryQuery } from '../hooks/use-promotions';
import { usePromotionReportQuery } from '../hooks/use-promotion-report';
import { promotionToForm } from '../lib/promotion-form';
import { summarisePromotionResults } from '../lib/promotion-stats';
import { PROMOTION_STATE_TONE, promotionStateKey } from '../lib/promotion-view';
import { historyReasonText, useHistoryWhen } from './promotion-history-panel';
import { PromotionChannelChip } from './promotion-channel-chip';
import { PromotionResultsBody } from './promotion-results';
import { PromotionSentence } from './promotion-sentence';
import { useRowTexts } from './promotions-table';

const OUTCOME_TONE: Record<string, StatusBadgeTone> = { applied: 'success', skipped: 'neutral', failed: 'error' };

export interface PromotionPeekProps {
  promotion: Promotion | null;
  all: readonly Promotion[];
  connections: readonly Connection[];
  canWrite: boolean;
  onClose: () => void;
  onSetActive: (promotion: Promotion, active: boolean) => void;
}

export function PromotionPeek({
  promotion,
  all,
  connections,
  canWrite,
  onClose,
  onSetActive,
}: PromotionPeekProps): ReactElement {
  const copy = useMessages('promotions');
  const rows = useMemo(() => (promotion === null ? [] : [promotion]), [promotion]);
  const { summaries } = useRowTexts(rows);
  const when = useHistoryWhen();
  const open = promotion !== null;
  const report = usePromotionReportQuery(open);
  const history = usePromotionHistoryQuery(promotion?.id ?? '', open);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of rows) {
      map.set(p.benefit.variantId, summaries.get(p.benefit.variantId)?.name ?? p.benefit.variantId);
      for (const c of p.conditions) if (c.field === 'containsProduct') map.set(c.value, summaries.get(c.value)?.name ?? c.value);
    }
    return map;
  }, [rows, summaries]);

  const values = useMemo(() => (promotion === null ? null : promotionToForm(promotion, names)), [promotion, names]);
  const key = promotion === null ? null : promotionStateKey(promotion);
  const on = key === 'active' || key === 'scheduled';
  const results = useMemo(
    () => (promotion === null || report.data === undefined ? null : summarisePromotionResults(report.data.groups, promotion.id)),
    [promotion, report.data],
  );
  const covered = promotion === null ? [] : values?.channelIds.length === 0 ? connections.filter((c) => c.enabledCapabilities.includes('OrderSource')) : connections.filter((c) => values?.channelIds.includes(c.id));
  const recent = (history.data?.items ?? []).slice(0, 3);

  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      floating
      width={560}
      className="pm-peek orders-peek"
      closeIcon
      closeLabel={copy.peek.close}
      description={copy.peek.aria}
      kicker={
        promotion === null ? undefined : (
          <>
            <span className="eyebrow">{copy.peek.kicker}</span>
            <span className="mono-text">{interpolate(copy.peek.order, { n: String(promotion.position) })}</span>
          </>
        )
      }
      title={promotion?.name ?? ''}
      meta={
        promotion !== null && key !== null ? (
          <span>
            <StatusBadge tone={PROMOTION_STATE_TONE[key]} withDot compact>
              {copy.status[key]}
            </StatusBadge>{' '}
            <span className="text-muted orders-cell-sub pm-peek__until">
              {promotion.effectiveTo === null
                ? copy.row.noEnd
                : interpolate(copy.row.until, { date: formatDate(promotion.effectiveTo) })}
            </span>
          </span>
        ) : undefined
      }
      footer={
        promotion !== null ? (
          <div className="pm-peek__foot">
            <Link className="button button--sm" to={`/promotions/${encodeURIComponent(promotion.id)}`}>
              {copy.peek.open}
            </Link>
            {canWrite && key !== 'ended' && key !== 'pausedStock' && key !== 'pausedLimit' ? (
              <Button
                tone="secondary"
                className="button--sm"
                onClick={() => {
                  onSetActive(promotion, !on);
                }}
              >
                {on ? copy.peek.pause : copy.peek.resume}
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {promotion !== null && values !== null ? (
        <div className="orders-peek__body" data-testid="promotion-peek">
          <div className="rule-composer-readback">
            <p className="rule-composer-readback__eyebrow eyebrow">{copy.rb.eyebrow}</p>
            <p className="rule-composer-readback__sentence pm-sentence">
              <PromotionSentence
                values={values}
                channels={connections}
                combineNames={values.combineIds.map((id) => all.find((p) => p.id === id)?.name ?? id)}
                withPeriod={false}
              />
            </p>
          </div>
          <div>
            <h3 className="orders-peek__h">{copy.peek.channels}</h3>
            <span className="pm-chans">
              {covered.map((channel) => (
                <PromotionChannelChip key={channel.id} connection={channel} link />
              ))}
            </span>
          </div>
          <div>
            <h3 className="orders-peek__h">
              {copy.peek.results} <span className="text-muted pm-peek__range">{copy.peek.range}</span>
            </h3>
            <PromotionResultsBody promotion={promotion} results={results} failed={report.isError} />
          </div>
          <div>
            <h3 className="orders-peek__h">{copy.peek.recent}</h3>
            {recent.length === 0 ? (
              <p className="form-field__description">{copy.peek.recentNone}</p>
            ) : (
              <ul className="pm-applog">
                {recent.map((item) => {
                  const reason = historyReasonText(copy.history, item);
                  return (
                    <li key={item.id}>
                      <span>
                        <span className="mono">{item.orderNumber !== null ? `#${item.orderNumber}` : item.internalOrderId}</span>
                        <br />
                        <span className="text-muted">
                          {when(item.createdAt)}
                          {reason !== null ? ` · ${reason}` : ''}
                        </span>
                      </span>
                      <StatusBadge tone={OUTCOME_TONE[item.outcome] ?? 'neutral'} withDot compact>
                        {item.outcome === 'applied' ? copy.history.applied : item.outcome === 'skipped' ? copy.history.skipped : copy.history.error}
                      </StatusBadge>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </SidePanel>
  );
}
