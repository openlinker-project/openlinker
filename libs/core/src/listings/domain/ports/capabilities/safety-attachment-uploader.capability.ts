/**
 * Safety Attachment Uploader Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that support
 * uploading product-safety-information attachments (e.g. EU GPSR PDFs)
 * declare `implements SafetyAttachmentUploader`. Today the upload flow
 * is connection-level (Allegro `sellerDefaults.safetyInformation`), but
 * per-offer attachments are a likely follow-up — keeping this under
 * `OfferManagerPort` matches the existing offer-creation seam and
 * avoids growing a parallel port hierarchy. See #449.
 *
 * The returned attachment id is opaque to OL; adapters reference it on
 * subsequent offer-create payloads (e.g. Allegro's
 * `productSet[*].safetyInformation.attachments[].id`).
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { OfferManagerPort } from '../offer-manager.port';

/**
 * Input bytes plus content metadata. `fileName` is preserved for
 * upstream APIs that include it in their attachment metadata
 * (Allegro's `Content-Disposition: filename=...`). Adapters may
 * normalise / reject MIME types beyond the platform-agnostic shape
 * here.
 */
export interface SafetyAttachmentUploadInput {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

/**
 * Result returned to callers. Adapters may carry richer per-platform
 * metadata internally; this contract intentionally exposes only the
 * `id` that callers need to reference the attachment on subsequent
 * platform calls.
 */
export interface SafetyAttachmentUploadResult {
  id: string;
}

export interface SafetyAttachmentUploader {
  uploadSafetyAttachment(input: SafetyAttachmentUploadInput): Promise<SafetyAttachmentUploadResult>;
}

export function isSafetyAttachmentUploader(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & SafetyAttachmentUploader {
  return (
    typeof (adapter as Partial<SafetyAttachmentUploader>).uploadSafetyAttachment === 'function'
  );
}
