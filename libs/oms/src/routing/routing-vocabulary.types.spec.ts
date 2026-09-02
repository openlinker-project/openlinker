/**
 * Split-ladder reduction — spec
 *
 * Covers the property the ladder exists for: the most restrictive rung any rule
 * declares governs, whatever order the rules arrived in, so a permissive sibling
 * can never lift a restriction the operator authored. The last case asserts the
 * three rungs stay DISTINCT — a build that collapsed `line-split` into
 * `quantity-split` would pass every other case in this file.
 *
 * @module libs/oms/src/routing
 */
import { mostRestrictiveAfterAction, RoutingAfterActionValues } from './routing-vocabulary.types';

describe('mostRestrictiveAfterAction', () => {
  it('should answer `quantity-split` for an empty ruleset', () => {
    // With no rule declaring anything there is no restriction to honour, which
    // is what keeps an unconfigured install byte-identical to having no router.
    expect(mostRestrictiveAfterAction([])).toBe('quantity-split');
  });

  it.each(RoutingAfterActionValues)('should answer `%s` when it is declared alone', (action) => {
    expect(mostRestrictiveAfterAction([action])).toBe(action);
  });

  it('should let the most restrictive declaration win, whatever the order', () => {
    // A permissive sibling must never be able to lift a restriction the
    // operator authored — the reduction is a floor, not a vote.
    expect(mostRestrictiveAfterAction(['quantity-split', 'no-split'])).toBe('no-split');
    expect(mostRestrictiveAfterAction(['no-split', 'quantity-split'])).toBe('no-split');
    expect(mostRestrictiveAfterAction(['quantity-split', 'line-split'])).toBe('line-split');
    expect(mostRestrictiveAfterAction(['line-split', 'no-split', 'quantity-split'])).toBe('no-split');
  });

  it('should rank the ladder strictly, so no rung collapses into another', () => {
    // Three rungs must produce three answers. A build that read `line-split`
    // as `quantity-split` would pass every test above that never names it.
    const answers = RoutingAfterActionValues.map((action) => mostRestrictiveAfterAction([action]));
    expect(new Set(answers).size).toBe(RoutingAfterActionValues.length);
  });
});
