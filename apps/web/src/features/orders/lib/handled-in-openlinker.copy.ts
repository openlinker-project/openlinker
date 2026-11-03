/**
 * Operator copy for an order OpenLinker handles itself (#3482).
 *
 * ONE copy source for every surface (list cell, mobile card, detail header), so
 * the same fact cannot be worded two ways. Kept in a `*.copy.ts` so
 * `check-ui-vocabulary` scans it.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { OrderWorkStageValue, WaitingFulfillmentBlockReasonValue } from '../api/orders.types';

/** The packing position, in time order. `satisfies` makes a new stage a compile error here. */
export const ORDER_WORK_STAGE_COPY = {
  'to-pack': { label: 'To pack', mark: '○', hint: 'Waiting to be packed in OpenLinker' },
  'packing': { label: 'Packing', mark: '◐', hint: 'Being packed at a pack station now' },
  'packed': { label: 'Packed', mark: '✓', hint: 'Packed in OpenLinker' },
} as const satisfies Record<
  OrderWorkStageValue,
  { label: string; mark: string; hint: string }
>;

export const HANDLED_IN_OPENLINKER_COPY = {
  /** The destination shown in the Channel column instead of an empty target. */
  channelDestination: 'OpenLinker',
  /** The Sync-cell hint on the detail header, replacing "No destinations configured". */
  syncHint: 'Handled in OpenLinker',
  /** The Sync-cell headline on the detail header. */
  syncLabel: 'In OpenLinker',
  /** Mobile card fact labels. */
  waitingOnFact: 'Waiting on',
  /** Who packs it, under To pack / Packing (mockup: "To pack · Unassigned"). */
  unassigned: 'Unassigned',
  /** An assigned packer whose name this page cannot resolve - never a raw id. */
  assignedUnknown: 'Assigned',
  /** A split order whose parcels are assigned to different packers. */
  severalPackers: 'Several packers',
} as const;

/**
 * A held order's reason, as an operator reads it. Keyed by the BACKEND's persisted
 * value (`satisfies` ties the keys to the frontend mirror, and
 * `check-fulfillment-reason-mirror.mjs` ties that mirror to core); the three
 * #3485 states. The other held states (`routing-in-doubt`,
 * `routing-contended`, `routing-already-live-elsewhere`) are deliberately absent:
 * they are transient guards, not an order waiting on the operator, so they render
 * no badge rather than a misleading one.
 */
export const WAITING_REASON_COPY = {
  'routing-refused': {
    label: 'Waiting: stock',
    fact: 'Stock',
    hint: 'OpenLinker is holding this order: a line is out of stock at every location. It is re-routed automatically when stock returns.',
    tone: 'warning',
  },
  'routing-no-shipping-address': {
    label: 'Waiting: address',
    fact: 'Shipping address',
    hint: 'OpenLinker is holding this order: it has no shipping address. It continues when the channel sends one.',
    tone: 'warning',
  },
  'routing-failed': {
    label: 'Waiting: routing',
    fact: 'Routing error',
    hint: 'OpenLinker is holding this order: routing it failed. It is retried automatically.',
    tone: 'error',
  },
} as const satisfies Record<
  WaitingFulfillmentBlockReasonValue,
  { label: string; fact: string; hint: string; tone: 'warning' | 'error' }
>;
