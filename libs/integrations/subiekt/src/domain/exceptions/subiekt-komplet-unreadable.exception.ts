/**
 * Subiekt Komplet-Unreadable Exception
 *
 * Raised by `SubiektProductMasterAdapter.readBundleComposition` when a komplet
 * exists but its composition cannot be expressed as a bundle OpenLinker can
 * trust: a component that is deleted or missing, or a quantity that is not a
 * positive whole number. Answering with a shortened or rounded composition
 * would let core treat a broken kit as a smaller one, so the read refuses
 * instead.
 *
 * @module libs/integrations/subiekt/src/domain/exceptions
 */
export class SubiektKompletUnreadableException extends Error {
  constructor(
    public readonly symbol: string,
    public readonly detail: string
  ) {
    super(`Subiekt komplet "${symbol}" cannot be read as a bundle: ${detail}`);
    this.name = 'SubiektKompletUnreadableException';
    Error.captureStackTrace(this, this.constructor);
  }
}
