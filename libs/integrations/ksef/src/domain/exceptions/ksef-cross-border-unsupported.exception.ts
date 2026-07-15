/**
 * KSeF Cross-Border Unsupported Exception
 *
 * Thrown before any document build/send when a command's buyer country differs
 * from the seller's own country and the connection has NOT opted into
 * cross-border handling (`KsefConnectionConfig.allowCrossBorder`). This is the
 * interim guard for #1586: OpenLinker does not yet select the correct FA(3) tax
 * band (WDT / export / `np` / OSS) from the buyer country, so rather than
 * silently emitting a domestic-rate document for a cross-border sale (a legally
 * wrong invoice), issuance refuses with an actionable, terminal error. A
 * deterministic input/config fault - never a transient retry: the core
 * `InvoiceService` marks the record failed. Extends `Error` directly, matching
 * the other terminal build-fault exceptions in this package
 * (`KsefUnsupportedDocumentTypeException`, `Fa3BuildException`).
 *
 * The escape hatch (`allowCrossBorder: true`) suppresses the throw for an
 * operator who asserts they have handled banding out of band; the full
 * per-order band-selection function is a documented follow-up (see
 * `FA3_IMPLEMENTATION_NOTES.md`).
 *
 * Never carries credential material in its message.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
export class KsefCrossBorderUnsupportedException extends Error {
  constructor(
    public readonly sellerCountry: string,
    public readonly buyerCountry: string,
  ) {
    super(
      `Cross-border sale (seller ${sellerCountry} -> buyer ${buyerCountry}) cannot be issued: ` +
        `OpenLinker does not yet select the correct FA(3) tax band from the buyer country and ` +
        `would otherwise emit a silently-wrong domestic-rate document. Set the connection's ` +
        `allowCrossBorder flag to issue anyway once you have handled the tax banding out of band.`,
    );
    this.name = 'KsefCrossBorderUnsupportedException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefCrossBorderUnsupportedException);
    }
  }
}
