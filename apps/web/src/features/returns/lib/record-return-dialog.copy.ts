/**
 * Record Return Dialog copy (#3078/#3084)
 *
 * Every operator sentence this dialog renders, in one place — a filename
 * `scripts/check-ui-vocabulary.mjs` actually scans (`features/returns` is one
 * of its three watched folders).
 *
 * @module apps/web/src/features/returns/lib
 */
export const RECORD_RETURN_DIALOG_COPY = {
  triggerLabel: '+ Record a return',
  title: 'Record a return by hand',
  description:
    "For a channel with no returns feed at all. Every field is required — OpenLinker can't open " +
    'a return without knowing which order, which channel and how many units.',

  orderFieldLabel: 'Order',
  orderFieldDescription: 'Pick a recent order below, or type its internal order id directly.',
  orderFieldPlaceholder: 'ol_order_… or pick from recent orders',

  connectionFieldLabel: 'From which connection?',
  connectionFieldDescription: 'OpenLinker uses this to work out where the item is actually mapped.',
  connectionPlaceholder: 'Select the channel this return came in on',
  /** Rendered as the select's one option while the read is in flight. */
  connectionLoadingPlaceholder: 'Loading connections…',
  /**
   * The required connection field is otherwise unsatisfiable with no
   * explanation when the read fails — the operator would fill the rest of
   * the form and only learn something was wrong from a validation message
   * about a list they never saw the state of (tech-lead review on #3284,
   * IMPORTANT).
   */
  connectionsLoadFailed:
    'The list of connections could not be loaded, so this return cannot be recorded right now.',

  skuFieldLabel: 'SKU',
  skuFieldDescription:
    "OpenLinker restocks by SKU. Without one, this return's units can never be added back to stock.",
  skuFieldPlaceholder: 'SKU',

  itemFieldLabel: 'What came back?',
  itemFieldPlaceholder: 'Item name',

  reasonFieldLabel: 'Why?',
  reasonPlaceholder: 'Select a reason',

  quantityFieldLabel: 'Quantity',

  /**
   * A proactive warning, not a blocking one — the order's OWN
   * `sourceConnectionId` disagreeing with the picked connection is worth a
   * second look, but the operator may still know something OpenLinker
   * doesn't (a return arriving via a different connection than the one that
   * placed the order is one of the documented orphan causes, #2332).
   */
  connectionMismatchWarning: (orderConnectionName: string): string =>
    `This order came in via ${orderConnectionName}, but you picked a different connection — ` +
    'double-check that is intentional.',

  note: "Each submit opens a new return. If you're not sure this one's already recorded, check the list first.",

  cancel: 'Cancel',
  confirm: 'Record it',
  confirming: 'Recording…',

  /** 400 `unknown-order` — a field error on the order field. */
  unknownOrder: (typed: string): string =>
    `OpenLinker doesn't have an order matching "${typed}" — double-check it, or pick one from the list.`,

  /** 400 `order-not-on-connection` — a field error on the connection field. */
  orderNotOnConnection:
    'OpenLinker holds no mapping for that order on this connection — pick the connection the ' +
    'order actually came in on.',

  genericError: 'The return could not be recorded. Try again.',
} as const;
