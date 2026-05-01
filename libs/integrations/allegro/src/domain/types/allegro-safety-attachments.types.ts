/**
 * Allegro Safety Attachment Types
 *
 * Constants and types for uploading safety-information attachments to
 * Allegro. The returned `id` is referenced from
 * `productSet[*].safetyInformation.attachments[].id` on offer create
 * (see `allegro-seller-defaults.types.ts` for the discriminated union
 * shape).
 *
 * The endpoint path, accepted MIME types, and size cap are working
 * assumptions until first sandbox verification — see #449 §3.1. They
 * live behind named constants so a wrong assumption is a one-line edit.
 *
 * @module libs/integrations/allegro/src/domain/types
 */

/**
 * Allegro upload-domain path for safety-information attachments.
 * Mounted on `upload.allegro.pl[.allegrosandbox.pl]`.
 */
export const ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH = '/sale/sale-product-offer-attachments';

/**
 * Hard cap matched at the API boundary by `multer` (`limits.fileSize`)
 * and at the util boundary as a defensive second check. Initial 25 MB
 * tracks Allegro's documented per-attachment ceiling for offer
 * documents; tighten or relax once sandbox surfaces the real value.
 */
export const ALLEGRO_SAFETY_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * MIME types accepted on safety-information attachments. The issue
 * mentions "PDF and a few other types" — the Allegro Developer Portal
 * lists at least PDF; we'll widen this set if sandbox confirms more
 * formats. Validated both in `multer`'s `ParseFilePipe` and inside the
 * util before the upload call (defence-in-depth).
 */
export const ACCEPTED_SAFETY_ATTACHMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
]);

/**
 * Input shape for `SafetyAttachmentUploader.uploadSafetyAttachment`.
 * Bytes are passed as `Uint8Array` — typical attachment is a single
 * PDF under the cap above, so streaming would be premature.
 */
export interface SafetyAttachmentUploadInput {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

/**
 * Result shape returned to callers. Allegro's response may carry
 * additional fields (e.g. `status`, `fileName`); we only consume `id`,
 * which is what `safetyInformation.attachments[].id` references on
 * offer create.
 */
export interface SafetyAttachmentUploadResult {
  id: string;
}
