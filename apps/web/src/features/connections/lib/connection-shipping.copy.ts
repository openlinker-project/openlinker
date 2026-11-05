/**
 * Copy for the shipping cards on connection pages (#3958)
 *
 * A carrier's page says which delivery methods it ships; an order source's
 * page says how many of its delivery methods get a label from OpenLinker. The
 * route wording itself ("OpenLinker buys the label from InPost") is
 * `SHIPPING_ROUTE_COPY`'s in `features/mappings`; this file holds only the
 * card text around it. Lives in a `*.copy.ts` so `check-ui-vocabulary` scans it.
 *
 * @module features/connections/lib
 */
export const CONNECTION_SHIPPING_COPY = {
  shipsForTitle: 'Ships for',
  shipsForEyebrow: 'Delivery methods',
  shipsForIntro: (carrier: string): string =>
    `The delivery methods ${carrier} buys the labels for, per sales channel.`,
  shipsForEmpty: (carrier: string): string => `No delivery method goes to ${carrier} yet.`,
  // Method names that could not be read are counted, never shown as raw ids.
  shipsForUnnamed: (count: number): string =>
    count === 1 ? '1 delivery method (name not loaded)' : `${count} delivery methods (names not loaded)`,
  shipsForNoSources:
    'No sales channel is connected yet. Connect one first, then choose which of its delivery methods this carrier ships.',
  rowChange: 'Change',
  rowChoose: 'Choose',
  rowLoading: 'Loading delivery methods...',
  rowUnavailable: 'Could not load who ships these delivery methods.',
  createdTitle: (carrier: string): string => `${carrier} is connected.`,
  createdBody: (carrier: string): string =>
    `Next, choose which delivery methods ${carrier} ships. Until then no order goes to it.`,
  createdAction: 'Choose delivery methods',
  shippingTitle: 'Shipping',
  shippingEyebrow: 'Who ships it',
  shippingSummary: (labelled: number, total: number): string =>
    `${labelled} of ${total} delivery methods get an OpenLinker label`,
  shippingRestByShop: (rest: number): string =>
    rest === 1
      ? '1 delivery method is shipped by your shop, the way it was before OpenLinker.'
      : `${rest} delivery methods are shipped by your shop, the way they were before OpenLinker.`,
  shippingAllLabelled: 'Every delivery method gets a label from OpenLinker.',
  /** The coverage sentence on the source card; the count is the part an operator scans for. */
  shippingCoverageLead: (labelled: number, total: number): string => `${labelled} of ${total}`,
  shippingCoverageTail: 'delivery methods get an OpenLinker label',
  shippingChange: 'Change who ships what',
  shippingUnlisted:
    'This sales channel cannot list its delivery methods, so there is nothing to route here.',
  shippingNoMethods: 'This sales channel has no delivery methods yet.',
  shippingLoading: 'Loading delivery methods...',
  backToOmsSetup: 'Back to OMS setup',
} as const;
