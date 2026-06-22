/**
 * Label / protocol blob-download helpers
 *
 * Shared helpers for the imperative document downloads (`useLabelDownload`,
 * `useProtocolDownload`). A blob-URL download can't read the server's
 * `Content-Disposition`, so the filename extension is derived from `blob.type`
 * (which `Response.blob()` populates from the response `Content-Type`). Mirrors
 * the backend `extensionForContentType` (apps/api shipment.controller) — the two
 * can't share code across the FE/BE boundary, so the small map lives here once
 * for both download hooks (#1109).
 *
 * @module apps/web/src/features/shipments/lib
 */

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'application/zpl': 'zpl',
  'application/x-zpl': 'zpl',
  'text/zpl': 'zpl',
  'application/epl': 'epl',
  'application/x-epl': 'epl',
};

/** Map a document blob's MIME type to a download-filename extension. */
export function extensionForBlob(blob: Blob): string {
  const mime = blob.type.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  return EXTENSION_BY_MIME[mime] ?? 'bin';
}

/**
 * Trigger a browser download for an already-fetched blob via an in-memory
 * object URL + a programmatic `<a download>` click. Defers `revokeObjectURL`
 * past the current tick — some engines cancel the in-flight download if the URL
 * is revoked synchronously after `click()`.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
