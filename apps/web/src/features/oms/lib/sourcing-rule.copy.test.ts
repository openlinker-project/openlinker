/**
 * Sourcing-rule copy (#3062)
 *
 * Every accessor here is LOOSE by design: the API stores `kind` / `name` /
 * `afterAction` verbatim and reports `recognised: false` for a row this build
 * cannot evaluate, so an unrecognised value must degrade to *shown but
 * unlabelled* — never to a confident label for something we do not understand,
 * and never to a blank cell.
 */
import { describe, expect, it } from 'vitest';

import {
  sourcingAfterActionHint,
  sourcingAfterActionLabel,
  sourcingRuleKindHint,
  sourcingRuleNameHint,
  sourcingRuleNameLabel,
} from './sourcing-rule.copy';
import {
  SOURCING_AFTER_ACTION_VALUES,
  SOURCING_FILTER_NAME_VALUES,
  SOURCING_RULE_KIND_VALUES,
  SOURCING_SORT_NAME_VALUES,
} from './sourcing-rule-vocabulary';

describe('sourcing-rule copy', () => {
  it('labels every name this build knows', () => {
    for (const name of [...SOURCING_FILTER_NAME_VALUES, ...SOURCING_SORT_NAME_VALUES]) {
      // A missing entry would render the kebab-case wire value where a label
      // belongs — survivable, but not intended for a value we DO know.
      expect(sourcingRuleNameLabel(name)).not.toBe(name);
      expect(sourcingRuleNameHint(name)).not.toBeNull();
    }
  });

  it('labels every after-action and kind this build knows', () => {
    for (const action of SOURCING_AFTER_ACTION_VALUES) {
      expect(sourcingAfterActionLabel(action)).not.toBe(action);
      expect(sourcingAfterActionHint(action)).not.toBeNull();
    }
    for (const kind of SOURCING_RULE_KIND_VALUES) {
      expect(sourcingRuleKindHint(kind)).not.toBeNull();
    }
  });

  it('falls back to the RAW value for a name it does not know', () => {
    expect(sourcingRuleNameLabel('invented-later')).toBe('invented-later');
    expect(sourcingAfterActionLabel('split-sideways')).toBe('split-sideways');
  });

  it('answers null for a hint it does not have, rather than inventing one', () => {
    // `null` lets the caller render nothing; a generic sentence would claim
    // knowledge of a rule this build cannot evaluate.
    expect(sourcingRuleNameHint('invented-later')).toBeNull();
    expect(sourcingAfterActionHint('split-sideways')).toBeNull();
    expect(sourcingRuleKindHint('neither')).toBeNull();
  });
});
