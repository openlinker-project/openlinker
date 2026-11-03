/**
 * OMS routing state types (#3505)
 *
 * The answer `useOmsRoutingState` gives: whether fulfilment routing is on for
 * this install, plus the two ways of not knowing. See the hook's docblock for
 * why "not answered yet" and "could not be read" are kept apart.
 *
 * @module apps/web/src/features/fulfillment-authority/hooks
 */
export const OmsRoutingStateValues = ['unknown', 'unreadable', 'off', 'on'] as const;

export type OmsRoutingState = (typeof OmsRoutingStateValues)[number];
