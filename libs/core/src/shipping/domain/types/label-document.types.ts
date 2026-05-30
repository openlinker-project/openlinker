/**
 * Label Document Types
 *
 * Return type for the `LabelDocumentReader` sub-capability
 * (`ShippingProviderManagerPort.fetchLabel`). Carries the raw label bytes
 * plus the provider-reported MIME type.
 *
 * `contentType` is the canonical, provider-reported format signal — it is NOT
 * always `application/pdf`. Allegro Delivery returns PDF / ZPL / EPL depending
 * on the seller's "Ship with Allegro" account setting; InPost ShipX can return
 * PDF or PNG. Consumers (the controller's download-filename extension, the FE
 * download) MUST read `contentType` and never assume PDF — that's exactly why
 * the capability is named `LabelDocumentReader`, not `LabelPdfReader`.
 *
 * `body` is a `Uint8Array` (not Node `Buffer`) so the domain stays
 * framework/runtime-neutral; the HTTP boundary wraps it to `Buffer` when it
 * needs Node specifics.
 *
 * @module libs/core/src/shipping/domain/types
 */

export interface LabelDocument {
  /** Provider-reported MIME type of `body` (e.g. `application/pdf`,
   * `image/png`, `application/zpl`). Source of truth for the document format. */
  contentType: string;
  /** Raw label bytes, passed through unmodified from the provider. */
  body: Uint8Array;
}
