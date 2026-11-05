/**
 * GiftPromotionsList (#3940, mockup M31 `promotions/list`)
 *
 * The gift promotions in the order they are checked, with Up and Down. The order
 * matters only where a promotion says "do not combine with others": it then stops
 * the ones below it, so a one-line note says so instead of a settings page about
 * priorities. Each row says what it gives so far and, when OpenLinker paused it
 * by itself, why.
 *
 * @module apps/web/src/features/gifts/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { formatAmount } from '../../../shared/format/format-amount';
import { formatAbsoluteDate as formatDate } from '../../../shared/format/format-date';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { Connection } from '../../connections';
import type { GiftRule } from '../api/gifts.types';
import { movedOrder, ruleStateKey, type GiftRuleStateKey } from '../lib/gift-rule-view';

export interface GiftPromotionsListProps {
  rules: readonly GiftRule[];
  connections: readonly Connection[];
  canWrite: boolean;
  moving: boolean;
  onReorder: (ruleIds: string[]) => void;
}

const TONE: Record<GiftRuleStateKey, StatusBadgeTone> = {
  active: 'success',
  scheduled: 'info',
  pausedStock: 'warning',
  pausedLimit: 'warning',
  draft: 'neutral',
  ended: 'neutral',
};

export function GiftPromotionsList({
  rules,
  connections,
  canWrite,
  moving,
  onReorder,
}: GiftPromotionsListProps): ReactElement {
  const copy = useMessages('gifts');
  const ids = rules.map((rule) => rule.id);

  const channelsOf = (rule: GiftRule): string => {
    const condition = rule.conditions.find((c) => c.field === 'sourceConnectionIn');
    if (condition === undefined || condition.field !== 'sourceConnectionIn') return copy.list.allChannels;
    return condition.values.map((id) => connections.find((c) => c.id === id)?.name ?? id).join(', ');
  };

  const summaryOf = (rule: GiftRule): string => {
    const parts: string[] = [];
    const amount = rule.conditions.find((c) => c.field === 'orderTotalGross');
    if (amount !== undefined && amount.field === 'orderTotalGross') {
      parts.push(
        interpolate(copy.list.fromAmount, { amount: formatAmount(Number(amount.amount), amount.currency) }),
      );
    }
    parts.push(channelsOf(rule));
    if (rule.effectiveTo !== null) {
      parts.push(interpolate(copy.list.until, { date: formatDate(rule.effectiveTo) }));
    }
    return parts.join(' · ');
  };

  return (
    <div className="gift-list" data-testid="gift-rule-table">
      <p className="text-muted" data-testid="gift-rule-order-note">
        {copy.list.orderNote}
      </p>
      <table className="data-table" aria-label={copy.list.tableLabel}>
        <thead>
          <tr>
            <th scope="col">{copy.list.colOrder}</th>
            <th scope="col">{copy.list.colPromotion}</th>
            <th scope="col">{copy.list.colState}</th>
            <th scope="col">{copy.list.colGiven}</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule, index) => {
            const state = ruleStateKey(rule);
            const gift = rule.gift;
            return (
              <tr key={rule.id} data-testid={`gift-rule-row-${rule.id}`}>
                <td>
                  <span data-testid={`gift-rule-pos-${rule.id}`}>{index + 1}</span>
                  {canWrite ? (
                    <span className="gift-list__order">
                      <Button
                        tone="secondary"
                        disabled={moving || index === 0}
                        aria-label={interpolate(copy.list.upLabel, { name: rule.name })}
                        data-testid={`gift-rule-up-${rule.id}`}
                        onClick={() => {
                          const next = movedOrder(ids, rule.id, 'up');
                          if (next !== null) onReorder(next);
                        }}
                      >
                        {copy.list.up}
                      </Button>
                      <Button
                        tone="secondary"
                        disabled={moving || index === rules.length - 1}
                        aria-label={interpolate(copy.list.downLabel, { name: rule.name })}
                        data-testid={`gift-rule-down-${rule.id}`}
                        onClick={() => {
                          const next = movedOrder(ids, rule.id, 'down');
                          if (next !== null) onReorder(next);
                        }}
                      >
                        {copy.list.down}
                      </Button>
                    </span>
                  ) : null}
                </td>
                <td>
                  <Link
                    to={`/automations/gifts/${encodeURIComponent(rule.id)}`}
                    data-testid={`gift-rule-link-${rule.id}`}
                  >
                    {rule.name}
                  </Link>
                  <p className="text-muted">{summaryOf(rule)}</p>
                  {gift?.doNotCombine ? (
                    <StatusBadge tone="neutral" compact data-testid={`gift-rule-nostack-${rule.id}`}>
                      {copy.list.doNotCombine}
                    </StatusBadge>
                  ) : null}
                </td>
                <td>
                  <StatusBadge tone={TONE[state]} withDot data-testid={`gift-rule-status-${rule.id}`}>
                    {copy.status[state]}
                  </StatusBadge>
                  {state === 'pausedStock' || state === 'pausedLimit' ? (
                    <p className="text-muted" data-testid={`gift-rule-reason-${rule.id}`}>
                      {state === 'pausedStock'
                        ? copy.list.reasonStock
                        : interpolate(copy.list.reasonLimit, {
                            given: String(rule.unitsGiven),
                            cap: String(rule.effectiveCap ?? rule.unitsGiven),
                          })}
                    </p>
                  ) : null}
                </td>
                <td data-testid={`gift-rule-given-${rule.id}`}>
                  {rule.effectiveCap === null
                    ? interpolate(copy.list.givenNoCap, { given: String(rule.unitsGiven) })
                    : interpolate(copy.list.givenOfCap, {
                        given: String(rule.unitsGiven),
                        cap: String(rule.effectiveCap),
                      })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
