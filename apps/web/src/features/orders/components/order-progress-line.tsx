/**
 * Order progress line (#4286)
 *
 * Six steps from placed to delivered, read from facts the page already holds.
 * A step is `done`, `current` (the first one not done) or `todo`. Nothing here
 * decides anything: it only shows how far the order has got.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { TimeDisplay } from '../../../shared/ui/time-display';

export interface OrderProgressInput {
  placedAt: string | null;
  paid: boolean;
  syncedCount: number;
  syncTotal: number;
  packedAt: string | null;
  dispatched: boolean;
  delivered: boolean;
}

type StepState = 'done' | 'current' | 'todo';

export function OrderProgressLine({ input }: { input: OrderProgressInput }): ReactElement {
  const copy = useMessages('orders').orderDetailPage.progress;
  const sent = input.syncTotal > 0 && input.syncedCount === input.syncTotal;
  const done = [
    input.placedAt !== null,
    input.paid,
    sent,
    input.packedAt !== null,
    input.dispatched || input.delivered,
    input.delivered,
  ];
  const firstTodo = done.findIndex((d) => !d);
  const stateOf = (i: number): StepState =>
    done[i] ? 'done' : i === firstTodo ? 'current' : 'todo';
  const steps: Array<{ key: string; label: string; detail: ReactElement | string | null }> = [
    {
      key: 'placed',
      label: copy.placed,
      detail: input.placedAt ? (
        <TimeDisplay iso={input.placedAt} format="datetime" className="mono-text tabular" />
      ) : null,
    },
    { key: 'paid', label: copy.paid, detail: null },
    {
      key: 'sent',
      label: copy.sent,
      detail:
        input.syncTotal > 0
          ? interpolate(copy.sentCount, { done: input.syncedCount, total: input.syncTotal })
          : null,
    },
    {
      key: 'packed',
      label: copy.packed,
      detail: input.packedAt ? (
        <TimeDisplay iso={input.packedAt} format="datetime" className="mono-text tabular" />
      ) : null,
    },
    { key: 'shipped', label: copy.shipped, detail: null },
    { key: 'delivered', label: copy.delivered, detail: null },
  ];
  return (
    <ol className="order-progress" aria-label={copy.label}>
      {steps.map((step, i) => (
        <li
          key={step.key}
          className={`order-progress__step order-progress__step--${stateOf(i)}`}
          aria-current={stateOf(i) === 'current' ? 'step' : undefined}
        >
          <span className="order-progress__dot" aria-hidden="true">
            {stateOf(i) === 'done' ? '✓' : ''}
          </span>
          <span className="order-progress__label">{step.label}</span>
          {step.detail ? <span className="order-progress__detail">{step.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}
