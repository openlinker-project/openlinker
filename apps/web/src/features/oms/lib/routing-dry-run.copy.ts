/**
 * Routing dry-run copy (#2954)
 *
 * Every operator-facing sentence of the "Test sourcing rules" panel, in one
 * table so `check-ui-vocabulary` covers it. Two things are deliberately NOT in
 * here: an unfulfillable line's reason and a rule's label. Both are the
 * router's own words and are rendered verbatim - a translation table in the
 * browser would be a second vocabulary to keep aligned with the engine.
 *
 * @module apps/web/src/features/oms/lib
 */
export const ROUTING_DRY_RUN_COPY = {
  title: 'Test sourcing rules',
  banner: 'Dry run - nothing is committed',
  bannerDetail:
    'A test never creates work, reserves stock or contacts a carrier. It uses the same engine as real routing.',
  modeOrder: 'Test on an order',
  modeBasket: 'Build a basket',
  orderSearchLabel: 'Find an order',
  orderSearchPlaceholder: 'Order number or buyer',
  orderSearchHint: 'Searches all connections.',
  orderSearchEmpty: 'No orders match.',
  orderSearchError: 'Orders could not be searched just now.',
  basketSku: 'Variant id',
  basketQuantity: 'Quantity',
  basketCountry: 'Country',
  basketPostcode: 'Postcode',
  basketDelivery: 'Delivery method',
  basketAddLine: 'Add line',
  basketRemoveLine: 'Remove line',
  runTest: 'Run test',
  running: 'Testing…',
  compareToggle: 'Compare with my draft',
  resultRoutable: 'Every line can be sourced',
  resultRoutableSplit: 'The order is split across locations. That is expected, not an error.',
  resultUnfulfillable: 'Some units cannot be sourced',
  resultUnfulfillableNote:
    'Unsourced units can only be resolved as a refund or a return, never as a partial cancellation.',
  resultInputHeading: 'What the rules saw',
  resultInputNote: 'Country, postcode, lines and delivery method only. No buyer details reach the rules.',
  resultLinesHeading: 'Where each line would ship from',
  explanationHeading: 'Why',
  explanationEmpty: 'No rules ran, so nothing was filtered or ranked.',
  explanationRemoved: (count: number): string => `removed ${count}`,
  compareHeading: 'Draft vs saved rules',
  compareNoChange: 'The draft places every line exactly where the saved rules do.',
  compareChanged: (count: number): string =>
    count === 1 ? '1 line would move' : `${count} lines would move`,
  compareSaved: 'Saved',
  compareDraft: 'Draft',
  unplaced: 'unassigned',
  errorTitle: "Couldn't finish this test",
  errorNothingChanged: 'Nothing was changed.',
  errorRetry: 'Try again',
} as const;
