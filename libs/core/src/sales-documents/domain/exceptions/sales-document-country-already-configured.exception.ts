/**
 * Sales-Document Country Already Configured Exception (#2186)
 *
 * Raised by `acknowledgeNoDocument` when the target country already carries
 * an active rule or country default. `createRule` / `upsertCountryDefault`
 * enforce the "a real configuration and a no-document acknowledgment can
 * never coexist" invariant in ONE direction (auto-clearing a stale
 * acknowledgment on write); this exception enforces the SAME invariant in
 * the other direction, rejecting an acknowledgment write for a country that
 * is still configured rather than silently producing the contradictory
 * state (`ruleCount > 0` and `acknowledgedNoDocumentAt` both set).
 *
 * @module libs/core/src/sales-documents/domain/exceptions
 */
export class SalesDocumentCountryAlreadyConfiguredException extends Error {
  constructor(public readonly country: string) {
    super(
      `Country '${country}' already has an active sales-document rule or country default — ` +
        `remove the existing configuration before acknowledging it intentionally has none.`,
    );
    this.name = 'SalesDocumentCountryAlreadyConfiguredException';
    Error.captureStackTrace(this, this.constructor);
  }
}
