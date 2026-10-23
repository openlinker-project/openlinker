/**
 * After-action ranking (#3057)
 *
 * The frontend twin of core's `mostRestrictiveAfterAction`. The mirror script
 * pins the ranking against core; this pins what the ranking is FOR.
 */
import { describe, expect, it } from 'vitest';

import { mostRestrictiveAfterAction } from './sourcing-rule-vocabulary';

describe('mostRestrictiveAfterAction', () => {
  it('answers quantity-split for an empty set', () => {
    // Nothing declared means nothing to honour - an unconfigured install must
    // read as "nothing is restricted", never as "splitting is forbidden".
    expect(mostRestrictiveAfterAction([])).toBe('quantity-split');
  });

  it('takes the most restrictive rung, whatever the input order', () => {
    expect(mostRestrictiveAfterAction(['quantity-split', 'no-split', 'line-split'])).toBe(
      'no-split'
    );
    expect(mostRestrictiveAfterAction(['no-split', 'quantity-split'])).toBe('no-split');
    expect(mostRestrictiveAfterAction(['line-split', 'quantity-split'])).toBe('line-split');
  });

  it('ignores a value this build does not recognise', () => {
    // Guessing would state a limit the operator never authored.
    expect(mostRestrictiveAfterAction(['invented-later'])).toBe('quantity-split');
    expect(mostRestrictiveAfterAction(['invented-later', 'line-split'])).toBe('line-split');
  });
});
