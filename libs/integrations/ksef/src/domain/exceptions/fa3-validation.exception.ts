/**
 * FA(3) XSD / Well-formedness Validation Exception
 *
 * Thrown when a built FA(3) document fails structural validation — either it is
 * not well-formed XML or it violates the vendored FA(3) structural rule set
 * (missing required section, wrong cardinality, unknown root). Distinct from
 * `Fa3BuildException` (a mapping fault before serialisation): a validation
 * failure means the serialised document is structurally wrong and must not
 * leave the builder.
 *
 * Carries a bounded list of neutral `{ path, message }` issues for diagnostics.
 * It MUST NOT embed the raw XML (which would echo buyer PII into logs) — callers
 * log `issues` only. See SCHEMA_VALIDATION_STATUS.md for the authority caveat:
 * this is structural, working-copy validation, NOT MF example-pack compliance.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */

/** One structural validation issue — a neutral location + human-readable reason. */
export interface Fa3ValidationIssue {
  path: string;
  message: string;
}

export class Fa3XsdValidationException extends Error {
  constructor(public readonly issues: Fa3ValidationIssue[]) {
    super(
      `FA(3) document failed structural validation (${issues.length} issue(s)): ` +
        issues
          .slice(0, 5)
          .map((i) => `${i.path}: ${i.message}`)
          .join('; '),
    );
    this.name = 'Fa3XsdValidationException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, Fa3XsdValidationException);
    }
  }
}
