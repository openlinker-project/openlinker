/**
 * Category-Parameter Restriction Types
 *
 * A destination declares what a parameter value may look like — length bounds,
 * numeric bounds, decimal precision, dictionary membership, how many values it
 * accepts — and every one of those bounds arrives on
 * `CategoryParameter.restrictions` long before we publish anything (#2243).
 * Until now nothing read them: the offer went out, and the marketplace answered
 * with its own rejection minutes later, one record at a time.
 *
 * `checkParameterRestrictions` (the co-located pure checker) turns those
 * declarations into issues, so a violation can be reported by the field the
 * operator recognises instead of by the platform's error string.
 *
 * `severity: 'block'` means the value cannot publish as it stands; `'warn'` is a
 * signal an operator may proceed through. Everything shipped today is `'block'`
 * — a declared bound is not a matter of taste — and the field exists so a future
 * soft rule needs no shape change. Same posture as `RequiredToSellIssue`
 * (#1842), whose shape this mirrors deliberately.
 *
 * NOT a security boundary and not a sanitizer: the checker reports, it never
 * rewrites a value. Whoever holds the value decides what to do with the issue —
 * the offer builder blocks, the projection reports, the frontend draws a chip.
 *
 * @module libs/core/src/listings/domain/types
 */

/**
 * `block` means the destination will reject the value as it stands; `warn` is
 * informational. Mirrors `RequiredToSellSeverity`.
 */
export const ParameterRestrictionSeverityValues = ['block', 'warn'] as const;
export type ParameterRestrictionSeverity = (typeof ParameterRestrictionSeverityValues)[number];

/**
 * One violated declaration. Kept as a closed union so a consumer can branch
 * exhaustively; the frontend mirrors this list verbatim (guarded by
 * `scripts/check-parameter-restriction-mirror.mjs`).
 */
export const ParameterRestrictionIssueCodeValues = [
  'VALUE_TOO_SHORT',
  'VALUE_TOO_LONG',
  'VALUE_BELOW_MIN',
  'VALUE_ABOVE_MAX',
  'PRECISION_EXCEEDED',
  'NOT_NUMERIC',
  'VALUE_NOT_IN_DICTIONARY',
  'TOO_MANY_VALUES',
] as const;
export type ParameterRestrictionIssueCode =
  (typeof ParameterRestrictionIssueCodeValues)[number];

/** One value that violates one declaration of the parameter it belongs to. */
export interface ParameterRestrictionIssue {
  code: ParameterRestrictionIssueCode;
  severity: ParameterRestrictionSeverity;
  /** The destination's own parameter id, so the issue survives a rename. */
  parameterId: string;
  /** The parameter name as the destination spells it — what the operator sees. */
  parameterName: string;
  /** Operator-facing explanation naming the declared bound and the actual value. */
  message: string;
}

/**
 * The value side of the check. Deliberately not `OfferParameter`: the checker
 * runs over an already-resolved value in core (attribute projection) AND over a
 * half-typed one in the browser, and neither should have to build a wire-shaped
 * parameter first.
 *
 * `values` carries dictionary value ids; `texts` carries free-text / numeric
 * values as strings, exactly as the wire shape does — a numeric parameter is a
 * string on the wire, so parsing it is the checker's job, not the caller's.
 */
export interface ParameterValueInput {
  values?: readonly string[];
  texts?: readonly string[];
}
