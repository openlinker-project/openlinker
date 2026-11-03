/**
 * Copy for the "this system packs and ships orders itself" setting (#2118).
 *
 * Worded from the operator's side: they know whether their warehouse system
 * packs the box, not what a routing flag is. Lives in a `*.copy.ts` so
 * `check-ui-vocabulary` scans it.
 *
 * @module features/connections/lib
 */
export const FULFILMENT_OWNERSHIP_COPY = {
  heading: 'Who packs the orders',
  toggle: 'This system packs and ships orders itself',
  help: 'Turn this on when the system packs the box and ships it (for example an external warehouse system). OpenLinker then hides its own "Mark packed" button and packed tick for orders that go here. It only changes what you see: nothing is blocked, and that system can still report an order as packed.',
} as const;
