/**
 * Source Change Copy (#3961)
 *
 * Every sentence the "Changed in {channel}" card on the order page says. Named
 * `*.copy.ts` so `check-ui-vocabulary` scans it. One table: what changed, what
 * OpenLinker already did, what is left, and the two actions.
 *
 * The cause codes are the backend's `SourceChangeHoldCause` plus the two codes
 * it writes when nothing is held (`shipped`, `apply-failed`). An unknown code
 * falls back to the generic decision copy rather than to nothing.
 *
 * @module apps/web/src/features/orders/lib
 */

export type SourceChangeMark = 'done' | 'todo' | 'none';

export interface SourceChangeEffectCopy {
  readonly mark: SourceChangeMark;
  readonly text: string;
}

export const SOURCE_CHANGE_COPY = {
  // The same words as the orders-list filter, so the card and the filter that
  // finds it read as one thing.
  title: 'Changed by the shop',
  status: {
    applied: 'Applied',
    decision: 'Needs a decision',
    shipped: 'Already shipped',
    failed: 'Not finished',
  },
  effects: {
    applied: [
      { mark: 'done', text: 'Packing asks for the new quantity' },
      { mark: 'done', text: 'Stock and reservation follow it' },
    ],
    'box-holds-more': [
      { mark: 'todo', text: 'The box already holds more' },
      { mark: 'done', text: 'The packer is told what to take out' },
      { mark: 'none', text: 'Stock changes once the box matches' },
    ],
    'box-closed': [
      { mark: 'todo', text: 'The box was closed before the change' },
      { mark: 'done', text: 'Packing is on hold' },
      { mark: 'none', text: 'Stock is unchanged' },
    ],
    'packed-elsewhere': [
      { mark: 'todo', text: 'This order is packed outside OpenLinker' },
      { mark: 'done', text: 'Packing is on hold' },
      { mark: 'none', text: 'Tell the warehouse, then decide here' },
    ],
    'already-fulfilled': [
      { mark: 'todo', text: 'More units were already reported packed' },
      { mark: 'done', text: 'Packing is on hold' },
      { mark: 'none', text: 'Stock is unchanged' },
    ],
    'units-added': [
      { mark: 'todo', text: 'OpenLinker does not add items to a box on its own' },
      { mark: 'done', text: 'Packing is on hold' },
      { mark: 'none', text: 'Stock is unchanged' },
    ],
    shipped: [
      { mark: 'none', text: 'The parcel left with the old quantity' },
      { mark: 'todo', text: 'Settle the difference with the buyer in the shop' },
    ],
    'apply-failed': [
      { mark: 'todo', text: 'Packing or stock could not be updated' },
      { mark: 'none', text: 'OpenLinker tries again with the next update' },
    ],
    unknown: [{ mark: 'todo', text: 'The box no longer matches the order' }],
  } satisfies Record<string, readonly SourceChangeEffectCopy[]>,
  actions: {
    recheck: 'Check again',
    keep: 'Keep the box as it is',
    handled: 'Mark as handled',
    retry: 'Try again',
  },
  lineRemoved: 'removed',
  lineAdded: 'new',
  sku: (sku: string): string => `SKU ${sku}`,
  outcome: {
    applied: 'Packing, stock and reservation now match the order.',
    held: 'The box still does not match. It stays on hold.',
    accepted: 'Kept as it is. The box is released.',
    shipped: 'The parcel already left. Nothing was changed.',
    'nothing-to-do': 'The order and its packing already match.',
    contended: 'Someone else is changing this order right now. Try again in a moment.',
    failed: 'This did not finish. Try again.',
  },
} as const;
