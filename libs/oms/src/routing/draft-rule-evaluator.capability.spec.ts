import { isDraftRuleEvaluator } from './draft-rule-evaluator.capability';

describe('isDraftRuleEvaluator', () => {
  it('should be true when the router exposes evaluateAgainstDraft', () => {
    expect(isDraftRuleEvaluator({ evaluateAgainstDraft: () => Promise.resolve({}) })).toBe(true);
  });

  it('should be false when the router has only evaluate and route', () => {
    expect(
      isDraftRuleEvaluator({
        evaluate: () => Promise.resolve({}),
        route: () => Promise.resolve({}),
      })
    ).toBe(false);
  });

  it('should be false when evaluateAgainstDraft is not a function', () => {
    expect(isDraftRuleEvaluator({ evaluateAgainstDraft: 'yes' })).toBe(false);
  });
});
