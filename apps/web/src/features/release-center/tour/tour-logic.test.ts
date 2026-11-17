import { describe, expect, it } from 'vitest';
import { applyChoice, readChoice, TOUR_CHOICES } from './tour-choices';
import { INITIAL_TOUR_STATE, tourReducer } from './tour-reducer';
import type { TourStepInput } from './tour-context';

const steps: TourStepInput[] = [
  { stepId: 'shipping-routing', connectionId: 'c1', importance: 'required' },
  { stepId: 'packing-owner', connectionId: 'c1', importance: 'optional' },
];

describe('tourReducer', () => {
  it('should start on the first step waiting for its target', () => {
    const state = tourReducer(INITIAL_TOUR_STATE, { type: 'start', steps });
    expect(state).toMatchObject({ active: true, index: 0, target: 'waiting' });
  });

  it('should not start when there are no steps', () => {
    expect(tourReducer(INITIAL_TOUR_STATE, { type: 'start', steps: [] }).active).toBe(false);
  });

  it('should reset the target when moving and end after the last step', () => {
    let state = tourReducer(INITIAL_TOUR_STATE, { type: 'start', steps });
    state = tourReducer(state, { type: 'target', state: 'found' });
    state = tourReducer(state, { type: 'next' });
    expect(state).toMatchObject({ index: 1, target: 'waiting' });
    expect(tourReducer(state, { type: 'next' })).toEqual(INITIAL_TOUR_STATE);
  });

  it('should not go back before the first step', () => {
    const state = tourReducer(INITIAL_TOUR_STATE, { type: 'start', steps });
    expect(tourReducer(state, { type: 'back' })).toBe(state);
  });

  it('should be idle on a fresh mount, so a reload ends the tour', () => {
    expect(tourReducer(INITIAL_TOUR_STATE, { type: 'target', state: 'found' })).toBe(INITIAL_TOUR_STATE);
    expect(INITIAL_TOUR_STATE.active).toBe(false);
  });
});

describe('tour choices', () => {
  it('should write a nested choice without losing the rest of the config', () => {
    const spec = TOUR_CHOICES['inpost-notify-buyer'];
    const next = applyChoice(spec, { a: 1, shipping: { other: true } }, 'notifyNow');
    expect(next).toEqual({ a: 1, shipping: { other: true, notifyMarketplaceOnLabelPurchase: true } });
  });

  it('should read the pressed choice back, and none when unset', () => {
    const spec = TOUR_CHOICES['packing-owner'];
    expect(readChoice(spec, {})).toBeNull();
    expect(readChoice(spec, { fulfilmentOwnedByDestination: false })).toBe('ownPacking');
  });

  it('should refuse an unknown choice', () => {
    expect(applyChoice(TOUR_CHOICES['packing-owner'], {}, 'nope')).toBeNull();
  });
});
