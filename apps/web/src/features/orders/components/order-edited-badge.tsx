/**
 * Order Edited Badge (#3544, mockup M1 `edit-saved`)
 *
 * "Edited in OpenLinker": a marker that an operator changed this order and the
 * channel still holds the original. One component for the detail header, the
 * desktop list row and the mobile card.
 *
 * It is NOT the lifecycle phase `amending` ("waiting for the channel"): nothing
 * waits on a channel after an edit (D9), so this is a separate marker and never
 * a pending state. It lives in the STATUS group of a list row beside the hold
 * badge, an exception-shaped fact someone may need to know before shipping.
 *
 * Renders nothing unless the flag is explicitly true, so an older payload that
 * carries no `editedInOpenLinker` says nothing rather than something false.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { useMessages } from '../../../shared/i18n';
import { StatusBadge } from '../../../shared/ui/status-badge';

interface OrderEditedBadgeProps {
  edited: boolean | null | undefined;
  /** An edit refers to a line the channel no longer reports (`editsNeedAttention`). */
  needsAttention?: boolean | null;
  /** Compact badge for a table row / card badge-row; the detail header is not. */
  compact?: boolean;
}

export function OrderEditedBadge({
  edited,
  needsAttention = false,
  compact = false,
}: OrderEditedBadgeProps): ReactElement | null {
  const copy = useMessages('orders').orderEditedBadge;
  if (needsAttention === true) {
    return (
      <span title={copy.attentionTitle}>
        <StatusBadge
          tone="warning"
          withDot
          compact={compact}
          data-testid="order-edit-attention-badge"
        >
          {copy.attention}
        </StatusBadge>
      </span>
    );
  }
  if (edited !== true) return null;
  return (
    <span title={copy.editedTitle}>
      <StatusBadge tone="info" withDot compact={compact} data-testid="order-edit-saved-badge">
        {copy.edited}
      </StatusBadge>
    </span>
  );
}
