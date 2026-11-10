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
import { usePermission } from '../../../shared/auth/use-permission';
import { useToast } from '../../../shared/ui/toast-provider';
import { useGiftAttentionQuery, useSkipGiftAttentionMutation } from '../hooks/use-gifts';
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
  const runs = useGiftAttentionQuery(internalOrderId);
  const dismiss = useSkipGiftAttentionMutation(internalOrderId);
  const { showToast } = useToast();
  // The gift-only door: whoever may add a gift may also send the order without one.
  const canDecide = usePermission('gifts:write');
  const items = readGiftAttention(runs.data?.items ?? []);
  // A read that failed says nothing about whether a gift is missing: say so
  // instead of rendering as if there were nothing to report.
  const readFailed = runs.isError;
  if (items.length === 0 && !shopRejected && !readFailed) return null;

  const skip = (runId: string): void => {
    dismiss.mutate(runId, {
      onSuccess: () => showToast({ tone: 'success', title: copy.attention.decisionSaved, description: '' }),
      onError: (error) =>
        showToast({ tone: 'error', title: copy.attention.skipFailed, description: error.message }),
    });
  };

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
            {item.kind === 'out-of-stock' && canDecide ? (
              <Button
                tone="secondary"
                disabled={dismiss.isPending}
                onClick={() => skip(item.runId)}
                data-testid="order-gift-choice-skip"
              >
                {copy.attention.skip}
              </Button>
            ) : null}
            {item.kind === 'out-of-stock' && onAddGift ? (
              <Button
                tone="secondary"
                onClick={onAddGift}
                data-testid="order-gift-choice-substitute"
              >
                {copy.attention.addAnother}
              </Button>
            ) : null}
            <Link to={`/automations/gifts/${encodeURIComponent(item.ruleId)}`} data-testid="order-gift-open-rule">
              {item.kind === 'out-of-stock' ? copy.attention.seePromotion : copy.attention.openRule}
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
      {readFailed ? (
        <Alert tone="warning" density="compact" data-testid="order-gift-attention-read-failed">
          {copy.attention.readFailed}
        </Alert>
      ) : null}
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
