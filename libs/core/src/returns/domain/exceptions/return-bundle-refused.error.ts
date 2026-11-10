/**
 * Return Bundle Refused Error (#3933)
 *
 * Raised when a partial return of a bundle cannot be priced or described.
 * `no-split-basis` means a returned or kept component has neither a standalone
 * price nor a cost, so the set price cannot be divided without guessing;
 * `bad-total` means the price paid for the set is unknown; `bad-selection` means
 * the returned components are not a non-empty subset of the line's components.
 * Nothing was written.
 *
 * @module domain/exceptions
 */
export const ReturnBundleRefusalReasonValues = [
  'no-split-basis',
  'bad-total',
  'bad-selection',
] as const;
export type ReturnBundleRefusalReason = (typeof ReturnBundleRefusalReasonValues)[number];

export class ReturnBundleRefusedError extends Error {
  constructor(
    public readonly reason: ReturnBundleRefusalReason,
    public readonly variantIds: readonly string[] = []
  ) {
    super(
      `Bundle return refused (${reason})` +
        (variantIds.length > 0 ? `: ${variantIds.join(', ')}` : '') +
        ' - nothing was changed'
    );
    this.name = 'ReturnBundleRefusedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
