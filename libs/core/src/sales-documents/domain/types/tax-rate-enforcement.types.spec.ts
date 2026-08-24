/**
 * Tax-rate Enforcement Switch Tests (#2245 review, #2260 review)
 *
 * Two properties are worth pinning. The coercion is deliberately narrow, so a
 * mis-typed value reads OFF rather than refusing every document; and
 * `isTaxRateEnforced` is the AND of both halves, which is the whole reason it
 * exists - an enforcement site that tests one half is the defect #2260 found.
 *
 * The env is passed explicitly wherever the signature allows it, so no test
 * mutates `process.env`.
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import {
  TAX_RATE_STRICT_ENV_VAR,
  TaxRateEraValues,
  isPreRolloutOrder,
  isTaxRateEnforced,
  isTaxRateEra,
  isTaxRateStrictEnabled,
  parseTaxRateStrictEnabled,
} from './tax-rate-enforcement.types';

/** An env bag carrying just the switch, at the documented variable name. */
function env(raw?: string): Record<string, string | undefined> {
  return raw === undefined ? {} : { [TAX_RATE_STRICT_ENV_VAR]: raw };
}

describe('parseTaxRateStrictEnabled', () => {
  it('should enable on the exact string true, case-insensitively and trimmed', () => {
    expect(parseTaxRateStrictEnabled('true')).toBe(true);
    expect(parseTaxRateStrictEnabled('TRUE')).toBe(true);
    expect(parseTaxRateStrictEnabled('True')).toBe(true);
    expect(parseTaxRateStrictEnabled('  true  ')).toBe(true);
    expect(parseTaxRateStrictEnabled('\ttrue\n')).toBe(true);
  });

  it('should read OFF for every other value, including plausible near-misses', () => {
    // The permissive side is the safe side: a typo must never be the thing that
    // stops a seller invoicing.
    expect(parseTaxRateStrictEnabled(undefined)).toBe(false);
    expect(parseTaxRateStrictEnabled('')).toBe(false);
    expect(parseTaxRateStrictEnabled('   ')).toBe(false);
    expect(parseTaxRateStrictEnabled('1')).toBe(false);
    expect(parseTaxRateStrictEnabled('yes')).toBe(false);
    expect(parseTaxRateStrictEnabled('on')).toBe(false);
    expect(parseTaxRateStrictEnabled('ture')).toBe(false);
    expect(parseTaxRateStrictEnabled('truex')).toBe(false);
    expect(parseTaxRateStrictEnabled('false')).toBe(false);
  });
});

describe('isTaxRateStrictEnabled', () => {
  it('should read the documented variable name out of the supplied env', () => {
    expect(isTaxRateStrictEnabled(env('true'))).toBe(true);
    expect(isTaxRateStrictEnabled(env('false'))).toBe(false);
    expect(isTaxRateStrictEnabled(env())).toBe(false);
  });

  it('should ignore any other variable, however similar', () => {
    expect(isTaxRateStrictEnabled({ OL_TAX_RATE_STRICT: 'true' })).toBe(false);
  });
});

describe('isTaxRateEra', () => {
  it('should accept every recognised era value', () => {
    for (const value of TaxRateEraValues) {
      expect(isTaxRateEra(value)).toBe(true);
    }
    expect(isTaxRateEra('pre-rollout')).toBe(true);
  });

  it('should coerce an unrecognised or non-string value to false', () => {
    // A value written by an older or newer release must not reach a policy
    // decision as an unknown literal.
    expect(isTaxRateEra('post-rollout')).toBe(false);
    expect(isTaxRateEra('PRE-ROLLOUT')).toBe(false);
    expect(isTaxRateEra('')).toBe(false);
    expect(isTaxRateEra(null)).toBe(false);
    expect(isTaxRateEra(undefined)).toBe(false);
    expect(isTaxRateEra(1)).toBe(false);
    expect(isTaxRateEra({})).toBe(false);
  });
});

describe('isPreRolloutOrder', () => {
  it('should be true only for the pre-rollout marker', () => {
    expect(isPreRolloutOrder('pre-rollout')).toBe(true);
  });

  it('should be false for no marker and for an unrecognised one', () => {
    expect(isPreRolloutOrder(null)).toBe(false);
    expect(isPreRolloutOrder(undefined)).toBe(false);
    expect(isPreRolloutOrder('')).toBe(false);
    expect(isPreRolloutOrder('legacy')).toBe(false);
    expect(isPreRolloutOrder(' pre-rollout ')).toBe(false);
  });
});

describe('isTaxRateEnforced', () => {
  it('should enforce only when the deployment opted in AND the order is not pre-rollout', () => {
    expect(isTaxRateEnforced(null, env('true'))).toBe(true);
  });

  it('should not enforce for a pre-rollout order even with the switch on', () => {
    // The #2260 case: reading the switch alone refuses history nobody can fix.
    expect(isTaxRateEnforced('pre-rollout', env('true'))).toBe(false);
  });

  it('should not enforce with the switch off, whatever the era says', () => {
    expect(isTaxRateEnforced(null, env('false'))).toBe(false);
    expect(isTaxRateEnforced('pre-rollout', env('false'))).toBe(false);
  });

  it('should treat an absent era as "after the feature"', () => {
    expect(isTaxRateEnforced(undefined, env('true'))).toBe(true);
    expect(isTaxRateEnforced(undefined, env())).toBe(false);
  });

  it('should treat an unrecognised era as not exempt', () => {
    // Exemption is a claim about history; an unknown marker is not evidence of
    // one, so the guard still applies.
    expect(isTaxRateEnforced('mystery', env('true'))).toBe(true);
  });
});
