/**
 * OrderGiftAttention (#3940, mockup M31 `order/gift-out-of-stock`,
 * `gift-not-added*`, `gift-not-added-shop-rejected`)
 *
 * Says, on the order, why a gift that should be here is not. The reasons come
 * from the gift rules' own run records for this order, so the page states what
 * OpenLinker decided rather than guessing from the lines. Two kinds of notice:
 * a warning where the seller may want to act (the gift ran out, a limit was hit,
 * the rule failed), and a quiet explanation where the rule did exactly what it
 * was set to (below the amount, the customer already had theirs, an earlier
 * promotion stopped this one). A shop that refused an order carrying a gift
 * line is a third notice, derived from the order's own sync result.
 *
 * @module apps/web/src/features/gifts/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { useSubjectAutomationRunsQuery } from '../../automation';
import {
  GIFT_ATTENTION_ACTIONABLE,
  readGiftAttention,
  type GiftAttentionItem,
} from '../lib/gift-attention';

export interface OrderGiftAttentionProps {
  internalOrderId: string;
  /** The shop refused the order and it carries a gift line. */
  shopRejected: boolean;
  /** Opens the add-gift dialog; absent for a role that cannot add one. */
  onAddGift?: () => void;
}

export function OrderGiftAttention({
  internalOrderId,
  shopRejected,
  onAddGift,
}: OrderGiftAttentionProps): ReactElement | null {
  const copy = useMessages('gifts');
  const runs = useSubjectAutomationRunsQuery('order', internalOrderId);
  const items = readGiftAttention(runs.data?.runs ?? []);
  if (items.length === 0 && !shopRejected) return null;

  const renderItem = (item: GiftAttentionItem): ReactElement => {
    const actionable = GIFT_ATTENTION_ACTIONABLE.includes(item.kind);
    const text = copy.attention.reasons[item.kind];
    return (
      <Alert
        key={item.ruleId}
        tone={actionable ? 'warning' : 'info'}
        title={interpolate(text.title, { rule: item.ruleName })}
        data-testid={`order-gift-attention-${item.kind}`}
        action={
          <>
            {item.kind === 'out-of-stock' && onAddGift ? (
              <Button tone="secondary" onClick={onAddGift} data-testid="order-gift-attention-add">
                {copy.attention.addAnother}
              </Button>
            ) : null}
            <Link to={`/automations/gifts/${encodeURIComponent(item.ruleId)}`} data-testid="order-gift-open-rule">
              {copy.attention.openRule}
            </Link>
          </>
        }
      >
        {text.body}
      </Alert>
    );
  };

  return (
    <div className="gift-attention" data-testid="order-gift-banner">
      {items.map(renderItem)}
      {shopRejected ? (
        <Alert
          tone="error"
          title={copy.attention.shopRejected.title}
          data-testid="order-gift-attention-shop-rejected"
        >
          {copy.attention.shopRejected.body}
        </Alert>
      ) : null}
    </div>
  );
}
