/**
 * Order Source Change Card (#3961, mockup `source-quantity-change.html`)
 *
 * One card per change from the shop: what changed ("2 -> 1"), what OpenLinker
 * already did, and what is left to decide. Rendered above the order's panels,
 * in the same slot as the edited-order notice.
 *
 * State comes from `describeSourceChange`; this component only renders it and
 * runs the two actions. "Check again" re-runs the comparison ingestion runs, so
 * a box the packer has emptied is applied without waiting for the shop to send
 * another update. "Keep the box as it is" records the decision against this
 * exact change; a later change from the shop is raised again.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { useWriteAccess } from '../../../shared/auth/use-permission';
import { formatDateTime } from '../../../shared/format/format-date';
import { Button } from '../../../shared/ui/button';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { useToast } from '../../../shared/ui/toast-provider';
import { useDemoMode } from '../../system';
import type { OrderAmendmentChange, OrderOmsAttentionEntry } from '../api/orders.types';
import { useSourceChangeMutation } from '../hooks/use-source-change-mutation';
import { describeSourceChange, type SourceChangeStatus } from '../lib/order-source-change';
import { SOURCE_CHANGE_COPY } from '../lib/order-source-change.copy';

export interface OrderSourceChangeCardProps {
  readonly internalOrderId: string;
  readonly lastAmendmentChanges: readonly OrderAmendmentChange[] | null | undefined;
  readonly lastAmendedAt: string | null | undefined;
  readonly omsAttention: readonly OrderOmsAttentionEntry[] | null | undefined;
  readonly itemNames: Readonly<Record<string, string>>;
  readonly hasPackingWork: boolean;
  /** Display name of the source connection. */
  readonly sourceName: string | null;
}

const STATUS_TONE: Record<SourceChangeStatus, StatusBadgeTone> = {
  applied: 'success',
  decision: 'warning',
  shipped: 'info',
  failed: 'warning',
};

const MARK_GLYPH = { done: '✓', todo: '!', none: '–' } as const;

export function OrderSourceChangeCard({
  internalOrderId,
  lastAmendmentChanges,
  lastAmendedAt,
  omsAttention,
  itemNames,
  hasPackingWork,
  sourceName,
}: OrderSourceChangeCardProps): ReactElement | null {
  const demoMode = useDemoMode();
  const write = useWriteAccess('orders:write', demoMode);
  const mutation = useSourceChangeMutation();
  const { showToast } = useToast();

  const view = describeSourceChange({ lastAmendmentChanges, omsAttention, itemNames, hasPackingWork });
  if (view === null) return null;

  const title = sourceName ? SOURCE_CHANGE_COPY.title(sourceName) : SOURCE_CHANGE_COPY.titleFallback;
  const tone = STATUS_TONE[view.status];

  const run = (action: 'recheck' | 'accept'): void => {
    mutation.mutate(
      { internalOrderId, action },
      {
        onSuccess: (result) => {
          showToast({
            tone: result.outcome === 'failed' || result.outcome === 'contended' ? 'error' : 'success',
            description: SOURCE_CHANGE_COPY.outcome[result.outcome],
          });
        },
        onError: (error) => {
          showToast({ tone: 'error', description: error.message || SOURCE_CHANGE_COPY.outcome.failed });
        },
      },
    );
  };

  return (
    <section
      className={`order-source-change order-source-change--${tone}`}
      aria-label={title}
      data-testid="order-source-change"
      data-state={view.status}
    >
      <header className="order-source-change__head">
        <span className="order-source-change__title">{title}</span>
        {lastAmendedAt ? (
          <time className="order-source-change__when" dateTime={lastAmendedAt}>
            {formatDateTime(lastAmendedAt)}
          </time>
        ) : null}
        <StatusBadge tone={tone} withDot>
          {SOURCE_CHANGE_COPY.status[view.status]}
        </StatusBadge>
      </header>

      {view.lines.length > 0 ? (
        <ul className="order-source-change__lines">
          {view.lines.map((line) => (
            <li key={line.key} className="order-source-change__line">
              <span className="order-source-change__item">{line.name}</span>
              <span className="order-source-change__nums">
                <s>{line.from}</s>
                <span aria-hidden="true">→</span>
                <strong>{line.to === 0 ? SOURCE_CHANGE_COPY.lineRemoved : line.to}</strong>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="order-source-change__effects">
        {view.effects.map((effect) => (
          <li key={effect.text} className={`order-source-change__effect order-source-change__effect--${effect.mark}`}>
            <span className="order-source-change__mark" aria-hidden="true">
              {MARK_GLYPH[effect.mark]}
            </span>
            {effect.text}
          </li>
        ))}
      </ul>

      {view.actions.length > 0 && write.visible ? (
        <footer className="order-source-change__actions">
          {view.actions.map((entry, index) => (
            <Button
              key={entry.action}
              tone={index === 0 ? 'primary' : 'secondary'}
              className="button--sm"
              disabled={!write.canWrite || mutation.isPending}
              onClick={() => run(entry.action)}
            >
              {entry.label}
            </Button>
          ))}
        </footer>
      ) : null}
    </section>
  );
}
