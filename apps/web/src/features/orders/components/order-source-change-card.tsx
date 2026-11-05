/**
 * Order Source Change Card (#3961, mockup `source-quantity-change.html`)
 *
 * One card per change from the shop: what changed ("3 -> 1"), what OpenLinker
 * already did, and what is left to decide. Rendered in the full-width slot
 * above the order's panels, beside the buyer note.
 *
 * It shares the buyer note's visual language on purpose: both are a message
 * from OUTSIDE OpenLinker (the buyer, the shop), so both are a neutral surface
 * with a coloured edge rather than an Alert. The edge carries the state, the
 * quantity change is the one strong element, and the actions sit in their own
 * footer so "what happened" and "what to do" never run together.
 *
 * State comes from `describeSourceChange`; this component only renders it and
 * runs the two actions. "Check again" re-runs the comparison ingestion runs, so
 * a box the packer has emptied is applied without waiting for the shop to send
 * another update. "Keep the box as it is" records the decision against this
 * exact change; a later change from the shop is raised again.
 *
 * @module apps/web/src/features/orders/components
 */
import { useId, type ReactElement } from 'react';

import { useWriteAccess } from '../../../shared/auth/use-permission';
import { Button } from '../../../shared/ui/button';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { useToast } from '../../../shared/ui/toast-provider';
import { useDemoMode } from '../../system';
import type { OrderAmendmentChange, OrderOmsAttentionEntry } from '../api/orders.types';
import { useSourceChangeMutation } from '../hooks/use-source-change-mutation';
import {
  describeSourceChange,
  type SourceChangeLineView,
  type SourceChangeStatus,
} from '../lib/order-source-change';
import { SOURCE_CHANGE_COPY, type SourceChangeMark } from '../lib/order-source-change.copy';

export interface OrderSourceChangeCardProps {
  readonly internalOrderId: string;
  readonly lastAmendmentChanges: readonly OrderAmendmentChange[] | null | undefined;
  readonly lastAmendedAt: string | null | undefined;
  readonly omsAttention: readonly OrderOmsAttentionEntry[] | null | undefined;
  readonly itemNames: Readonly<Record<string, string>>;
  readonly hasPackingWork: boolean;
  /** Display name of the source connection. */
  readonly sourceName: string | null;
  /** The source's platform, so the channel pill carries the platform colour. */
  readonly sourcePlatform?: string | null;
}

const STATUS_TONE: Record<SourceChangeStatus, StatusBadgeTone> = {
  applied: 'success',
  decision: 'warning',
  shipped: 'info',
  failed: 'error',
};

export function OrderSourceChangeCard({
  internalOrderId,
  lastAmendmentChanges,
  lastAmendedAt,
  omsAttention,
  itemNames,
  hasPackingWork,
  sourceName,
  sourcePlatform = null,
}: OrderSourceChangeCardProps): ReactElement | null {
  const demoMode = useDemoMode();
  const write = useWriteAccess('orders:write', demoMode);
  const mutation = useSourceChangeMutation();
  const { showToast } = useToast();
  const titleId = useId();

  const view = describeSourceChange({ lastAmendmentChanges, omsAttention, itemNames, hasPackingWork });
  if (view === null) return null;

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

  const showActions = view.actions.length > 0 && write.visible;

  return (
    <section
      className="order-source-change"
      aria-labelledby={titleId}
      data-testid="order-source-change"
      data-state={view.status}
    >
      <header className="order-source-change__head">
        <h3 className="order-source-change__title" id={titleId}>
          <ShopChangeIcon />
          {SOURCE_CHANGE_COPY.title}
        </h3>
        {sourceName ? (
          <span className="channel-pill" data-channel={sourcePlatform ?? undefined}>
            {sourceName}
          </span>
        ) : null}
        {lastAmendedAt ? (
          <TimeDisplay iso={lastAmendedAt} className="order-source-change__when mono-text tabular" />
        ) : null}
        <span className="order-source-change__status">
          <StatusBadge tone={STATUS_TONE[view.status]} withDot>
            {SOURCE_CHANGE_COPY.status[view.status]}
          </StatusBadge>
        </span>
      </header>

      <div className="order-source-change__body">
        {view.lines.length > 0 ? (
          <ul className="order-source-change__lines">
            {view.lines.map((line) => (
              <SourceChangeLine key={line.key} line={line} />
            ))}
          </ul>
        ) : null}

        <ul className="order-source-change__effects">
          {view.effects.map((effect) => (
            <li key={effect.text} className="order-source-change__effect" data-mark={effect.mark}>
              <EffectIcon mark={effect.mark} />
              <span>{effect.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {showActions ? (
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

function SourceChangeLine({ line }: { readonly line: SourceChangeLineView }): ReactElement {
  const removed = line.to === 0;
  const added = line.from === 0;
  return (
    <li className="order-source-change__line">
      <span className="order-source-change__item">
        <span className="order-source-change__name">{line.name}</span>
        {line.sku !== null ? (
          <span className="order-source-change__sku mono-text">{SOURCE_CHANGE_COPY.sku(line.sku)}</span>
        ) : null}
      </span>
      <span
        className="order-source-change__qty"
        aria-label={`${String(line.from)} to ${removed ? SOURCE_CHANGE_COPY.lineRemoved : String(line.to)}`}
      >
        {added ? (
          <span className="order-source-change__was">{SOURCE_CHANGE_COPY.lineAdded}</span>
        ) : (
          <span className="order-source-change__was">{line.from}</span>
        )}
        <ArrowIcon />
        <strong className="order-source-change__now" data-removed={removed || undefined}>
          {removed ? SOURCE_CHANGE_COPY.lineRemoved : line.to}
        </strong>
      </span>
    </li>
  );
}

const ICON_PROPS = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

function ShopChangeIcon(): ReactElement {
  return (
    <svg width={14} height={14} {...ICON_PROPS}>
      <path d="M2.5 6.5 3.4 3h9.2l.9 3.5" />
      <path d="M3 6.5V13h10V6.5" />
      <path d="M6.5 13V9.5h3V13" />
    </svg>
  );
}

function ArrowIcon(): ReactElement {
  return (
    <svg className="order-source-change__arrow" width={16} height={16} {...ICON_PROPS}>
      <path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5" />
    </svg>
  );
}

function EffectIcon({ mark }: { readonly mark: SourceChangeMark }): ReactElement {
  return (
    <span className="order-source-change__icon" aria-hidden="true">
      <svg width={12} height={12} {...ICON_PROPS} strokeWidth={2}>
        {mark === 'done' ? <path d="m3.5 8.5 3 3 6-7" /> : null}
        {mark === 'todo' ? <path d="M8 4v5M8 12v.01" /> : null}
        {mark === 'none' ? <path d="M8 4.5V8l2.5 1.5" /> : null}
      </svg>
    </span>
  );
}
