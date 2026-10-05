/**
 * Subiekt Product-Not-Supported Exception
 *
 * Raised by `SubiektProductMasterAdapter` for `ProductMasterPort` methods that
 * have no MVP mapping onto Subiekt GT's `TowaryManager` (delete/archive,
 * category assignment — no category-facade research has been done yet for this
 * capability). `ProductMasterPort`'s own docs explicitly permit "For MVP, this
 * may throw NotSupportedException" per method — this IS that exception,
 * Subiekt-scoped rather than a shared core type (no shared convention exists in
 * this tree; every plugin defines its own).
 *
 * @module libs/integrations/subiekt/src/domain/exceptions
 */
export class SubiektProductNotSupportedException extends Error {
  constructor(operation: string) {
    super(`Subiekt GT ProductMaster does not support "${operation}" (MVP gap)`);
    this.name = 'SubiektProductNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
