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
