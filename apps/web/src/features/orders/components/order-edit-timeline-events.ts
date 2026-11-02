/**
 * Order edit timeline events (#3544, mockup M1 `edit-saved` Activity)
 *
 * Maps an edited order's history into Activity rows, so what an operator changed
 * survives a reload. The timeline learns nothing about editing: this builds
 * `TimelineEvent`s and the page hands them over.
 *
 * Every dated row states the same fact in the same words: the change was made in
 * OpenLinker only and the channel keeps its original (D9). "Refund not confirmed
 * yet" is UNDATED on purpose, the `order-cancel-timeline-events` rule: it is a
 * current-state fact ("nobody has confirmed a refund"), not something that
 * happened at an instant, and it disappears once the refund is confirmed.
 *
 * @module apps/web/src/features/orders/components
 */
import type { OrderEditsView } from '../api/order-edit.types';
import { formatDecimalAmount, orderEditHistoryTitle } from '../lib/order-edit';
import type { DatedTimelineEvent, TimelineEvent } from './order-activity-timeline';

export interface OrderEditTimelineEvents {
  /** Rows with an instant, to merge chronologically. */
  dated: DatedTimelineEvent[];
  /** Current-state rows with no instant; they sit after the dated ones. */
  trailing: TimelineEvent[];
}

export function buildOrderEditTimelineEvents(
  edits: OrderEditsView | null | undefined,
  sourceName: string | null,
): OrderEditTimelineEvents {
  if (!edits) return { dated: [], trailing: [] };
  const channel = sourceName ?? 'The sales channel';
  const dated: DatedTimelineEvent[] = [];
  const trailing: TimelineEvent[] = [];

  for (const entry of edits.history) {
    dated.push({
      id: `order-edit:${entry.changeId}`,
      timestamp: entry.at,
      title: orderEditHistoryTitle(entry),
      by: 'operator',
      description: `Changed in OpenLinker only - ${channel} keeps the original.`,
      tone: 'warning',
    });
  }

  for (const proposal of edits.discountProposals) {
    if (proposal.kind === 'order.discount_refund') {
      trailing.push({
        id: `order-edit-refund-pending:${proposal.changeId}`,
        timestamp: null,
        title: 'Refund not confirmed yet',
        by: 'waiting on you',
        description: `Refund ${
          proposal.amount ? formatDecimalAmount(proposal.amount, proposal.currency) : 'the difference'
        } on ${channel}, then use Confirm refund.`,
        tone: 'warning',
      });
    } else {
      dated.push({
        id: `order-edit-correction:${proposal.changeId}`,
        timestamp: proposal.requestedAt,
        title: 'Correction invoice drafted for the discount',
        by: 'system · invoicing',
        description: 'Waiting for you to review and confirm it.',
        tone: 'warning',
      });
    }
  }

  return { dated, trailing };
}
