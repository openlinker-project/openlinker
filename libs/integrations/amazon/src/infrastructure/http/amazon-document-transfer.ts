/**
 * Amazon Document Transfer (#4184)
 *
 * Reports and feeds move their content through presigned links Amazon hands
 * out (`getReportDocument`, `createFeedDocument`), not through the SP-API host.
 * This module downloads and uploads those documents over the connection-bound
 * transport, and only to an Amazon host over HTTPS: a link is data from a
 * response, and following one anywhere else would let a forged response point
 * OpenLinker at an internal address.
 *
 * Downloads are capped in size, gunzipped when Amazon says so, and decoded with
 * the charset the response declares (flat-file reports for European
 * marketplaces are not always UTF-8).
 *
 * @module libs/integrations/amazon/src/infrastructure/http
 */
import { gunzipSync } from 'node:zlib';

import type { FetchLike } from '@openlinker/shared/http';

import { isAmazonTestOrigin } from '../../amazon.constants';
import { AmazonApiError } from '../../domain/exceptions/amazon-api.error';

const DOCUMENT_HOST_PATTERN = /(^|\.)(amazonaws\.com|amazon\.com)$/;
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

/** The link, if it is an HTTPS link on an Amazon host without credentials in it. */
export function safeAmazonDocumentUrl(resource: string, label: string): string {
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    throw new AmazonApiError(502, 'DocumentLinkInvalid', `${label} link is not a URL`, undefined);
  }
  // Test seam (ignored in production): the fake server hands out its own links.
  if (isAmazonTestOrigin(url.origin) && url.username === '' && url.password === '') {
    return url.toString();
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    !DOCUMENT_HOST_PATTERN.test(url.hostname)
  ) {
    throw new AmazonApiError(502, 'DocumentLinkInvalid', `${label} link is not on an Amazon host (${url.hostname})`, undefined);
  }
  return url.toString();
}

export async function downloadAmazonDocument(
  fetchImpl: FetchLike,
  resource: string,
  compression: string | undefined,
  label: string,
): Promise<string> {
  const response = await fetchImpl(safeAmazonDocumentUrl(resource, label), { method: 'GET', redirect: 'manual' });
  if (response.status < 200 || response.status >= 300) {
    throw new AmazonApiError(response.status, 'DocumentDownloadFailed', `${label} download failed`, undefined);
  }
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_DOCUMENT_BYTES) {
    throw new AmazonApiError(502, 'DocumentTooLarge', `${label} is larger than expected`, undefined);
  }
  let bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    throw new AmazonApiError(502, 'DocumentTooLarge', `${label} is larger than expected`, undefined);
  }
  if (compression?.toUpperCase() === 'GZIP') {
    bytes = gunzipSync(bytes, { maxOutputLength: MAX_DOCUMENT_BYTES });
  }
  return decode(bytes, response.headers.get('content-type'));
}

export async function uploadAmazonDocument(
  fetchImpl: FetchLike,
  resource: string,
  content: string,
  contentType: string,
  label: string,
): Promise<void> {
  const response = await fetchImpl(safeAmazonDocumentUrl(resource, label), {
    method: 'PUT',
    redirect: 'manual',
    headers: { 'Content-Type': contentType },
    body: content,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new AmazonApiError(response.status, 'DocumentUploadFailed', `${label} upload failed`, undefined);
  }
}

function decode(bytes: Buffer, contentType: string | null): string {
  const charset = /charset=([^;]+)/i.exec(contentType ?? '')?.[1]?.trim().toLowerCase();
  try {
    return new TextDecoder(charset && charset.length > 0 ? charset : 'utf-8').decode(bytes);
  } catch {
    // An unknown label: UTF-8 is what Amazon sends unless it says otherwise.
    return new TextDecoder('utf-8').decode(bytes);
  }
}
