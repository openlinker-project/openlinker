/**
 * Zero-Value Line Capability (#3930)
 *
 * Optional declaration a document provider (invoicing or fiscalization) makes
 * about whether it accepts a line priced 0,00. It is one shared interface in
 * `sales-documents`, not one per document context, because both mappers feed the
 * same `presentGiftLines` helper and a fiscal receipt is not an invoice
 * (ADR-041), so neither context could own it for the other.
 *
 * Guard-only (ADR-046): absent from `CoreCapabilityValues` and from manifests,
 * and the guard probes the METHOD rather than trusting the type, so an adapter
 * compiled before this existed simply declares nothing. Declaring nothing means
 * the "show at 0,00" gift form is not offered for that provider.
 *
 * @module libs/core/src/sales-documents/domain/ports/capabilities
 */
export interface ZeroValueLineSupport {
  /** `true` when a document line priced 0,00 is accepted. Synchronous, no I/O. */
  acceptsZeroValueLine(): boolean;
}

export function isZeroValueLineSupport(adapter: unknown): adapter is ZeroValueLineSupport {
  return (
    typeof adapter === 'object' &&
    adapter !== null &&
    typeof (adapter as Partial<ZeroValueLineSupport>).acceptsZeroValueLine === 'function'
  );
}

/**
 * Read the declaration as a plain boolean for a pure mapper: `undefined` when
 * the adapter declares nothing (or throws - a declaration bug must not fail an
 * issuance), otherwise the declared answer.
 */
export function readZeroValueLineSupport(adapter: unknown): boolean | undefined {
  if (!isZeroValueLineSupport(adapter)) return undefined;
  try {
    const answer = adapter.acceptsZeroValueLine();
    return typeof answer === 'boolean' ? answer : undefined;
  } catch {
    return undefined;
  }
}
