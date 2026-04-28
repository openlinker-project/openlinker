/**
 * Upload Images Via Allegro
 *
 * Orchestrator that takes a list of operator-supplied image URLs (typically
 * PrestaShop product images), downloads each one, validates the response
 * shape, and re-uploads the bytes to Allegro's image CDN
 * (`POST /sale/images`). Returns the list of Allegro-hosted CDN URLs in the
 * same order as the input so callers can drop them straight into
 * `body.images` for `POST /sale/product-offers`.
 *
 * The util **never throws** for image-related failures — it returns a
 * discriminated `UploadImagesResult`. Failure surfaces as a list of
 * `CreateOfferValidationError` carrying:
 *
 * - `IMAGE_DOWNLOAD_FAILED`         — non-2xx, network error, or timeout when
 *                                     GETting the operator's image URL
 * - `IMAGE_DOWNLOAD_INVALID_TYPE`   — GET succeeded but Content-Type is not
 *                                     `image/jpeg|png|gif|webp`, or the bytes
 *                                     could not be parsed by `image-size`
 * - `IMAGE_TOO_SMALL_FOR_PRODUCT`   — image dimensions are below Allegro's
 *                                     `productSet[0].product.images[]`
 *                                     400px-longer-side rule. Rejecting up-front
 *                                     avoids burning an upload on bytes that
 *                                     would fail product validation at the
 *                                     end of the offer-creation flow (#424).
 * - `IMAGE_UPLOAD_FAILED`           — Allegro's `POST /sale/images` rejected
 *                                     the upload, or its response is missing
 *                                     the `location` field
 *
 * Adapter-key context (e.g. `'allegro.publicapi.v1'`) lives in the calling
 * adapter, not here — the util stays adapter-agnostic.
 *
 * Implementation notes:
 * - Downloads run in parallel via `Promise.all` (typical N is 1–8).
 * - On any failure, the **other** in-flight pipelines run to completion and
 *   their results are discarded; the wasted work is bounded and Allegro GCs
 *   any uploads that don't end up attached to an offer.
 * - Bytes are buffered in `Uint8Array`. Streaming would be premature — typical
 *   product images are < 5MB, and buffering keeps the HTTP-client interface
 *   simple.
 *
 * @module libs/integrations/allegro/src/infrastructure/util
 * @see {@link AllegroOfferManagerAdapter.createOffer} — sole consumer
 */
import imageSize from 'image-size';
import { CreateOfferValidationError } from '@openlinker/core/listings';
import { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import { AllegroApiException } from '../../domain/exceptions/allegro-api.exception';
import { UploadImagesResult, UploadImagesViaAllegroOptions } from './upload-images-via-allegro.types';

export type { UploadImagesResult, UploadImagesViaAllegroOptions } from './upload-images-via-allegro.types';

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;

const ACCEPTED_IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/**
 * Allegro's `productSet[0].product.images[]` validator rejects images whose
 * longer side is below this threshold with `ProductValidationException:
 * TOO_SMALL_IMAGE` (sandbox repro 2026-04-27, #424). Apply at download time
 * so we fail fast with actionable diagnostics instead of incurring an upload
 * + a 422 at the end of the offer-creation flow.
 *
 * The offer-side `body.images[]` validator is more lenient — same threshold
 * may eventually apply there too. We gate up-front on the assumption that
 * any image used for an offer is also used to create the inline product
 * (mirrored since #420).
 */
export const ALLEGRO_PRODUCT_IMAGE_MIN_LONGER_SIDE_PX = 400;

export async function uploadImagesViaAllegro(
  uploadHttpClient: IAllegroHttpClient,
  imageUrls: string[],
  options?: UploadImagesViaAllegroOptions,
): Promise<UploadImagesResult> {
  if (imageUrls.length === 0) {
    return { ok: true, locations: [] };
  }

  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const downloadTimeoutMs = options?.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;

  const results = await Promise.all(
    imageUrls.map(async (url) => {
      const download = await downloadImage(url, fetchImpl, downloadTimeoutMs);
      if (!download.ok) {
        return { ok: false as const, failure: download.failure };
      }
      const upload = await uploadOneImage(
        uploadHttpClient,
        download.contentType,
        download.bytes,
        url,
      );
      if (!upload.ok) {
        return { ok: false as const, failure: upload.failure };
      }
      return { ok: true as const, location: upload.location };
    }),
  );

  const failures: CreateOfferValidationError[] = [];
  const locations: string[] = [];
  for (const r of results) {
    if (r.ok) {
      locations.push(r.location);
    } else {
      failures.push(r.failure);
    }
  }

  if (failures.length > 0) {
    return { ok: false, failures };
  }
  return { ok: true, locations };
}

// ---------- internal helpers (file-private) ----------

type DownloadOk = { ok: true; contentType: string; bytes: Uint8Array };
type DownloadErr = { ok: false; failure: CreateOfferValidationError };

async function downloadImage(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<DownloadOk | DownloadErr> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'GET', signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return downloadFailure('IMAGE_DOWNLOAD_FAILED', `Image URL '${url}' timed out after ${timeoutMs}ms`);
    }
    const message = error instanceof Error ? error.message : String(error);
    return downloadFailure('IMAGE_DOWNLOAD_FAILED', `Image URL '${url}': ${message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    return downloadFailure(
      'IMAGE_DOWNLOAD_FAILED',
      `Image URL '${url}' returned HTTP ${response.status}`,
    );
  }

  const rawContentType = response.headers.get('content-type');
  const contentType = normalizeImageContentType(rawContentType);
  if (!contentType) {
    return downloadFailure(
      'IMAGE_DOWNLOAD_INVALID_TYPE',
      `Image URL '${url}' returned content-type '${rawContentType ?? 'missing'}', expected one of image/jpeg, image/png, image/gif, image/webp`,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return downloadFailure('IMAGE_DOWNLOAD_FAILED', `Image URL '${url}': failed to read body — ${message}`);
  }

  // Header-only dimension check — `image-size` reads the format header
  // (e.g. PNG IHDR, JPEG SOF) without decoding pixel data, so this stays
  // cheap even for the upper end of typical product-image sizes (~5MB).
  let width: number | undefined;
  let height: number | undefined;
  try {
    const dimensions = imageSize(bytes);
    width = dimensions.width;
    height = dimensions.height;
  } catch (error) {
    // The content-type validator already accepted the bytes as image/*;
    // a header-decode failure here points at corrupt or truncated source
    // data. Surface as INVALID_TYPE so the operator gets the same actionable
    // copy ("not a usable image") rather than a generic download failure.
    const message = error instanceof Error ? error.message : String(error);
    return downloadFailure(
      'IMAGE_DOWNLOAD_INVALID_TYPE',
      `Image URL '${url}': bytes claimed content-type '${contentType}' but could not be decoded — ${message}`,
    );
  }

  const longerSide = Math.max(width ?? 0, height ?? 0);
  if (longerSide < ALLEGRO_PRODUCT_IMAGE_MIN_LONGER_SIDE_PX) {
    return downloadFailure(
      'IMAGE_TOO_SMALL_FOR_PRODUCT',
      `Image URL '${url}' is ${width ?? '?'}×${height ?? '?'}px; ` +
        `Allegro requires a longer side ≥ ${ALLEGRO_PRODUCT_IMAGE_MIN_LONGER_SIDE_PX}px ` +
        `for product images. Use a larger source image.`,
    );
  }

  return { ok: true, contentType, bytes };
}

type UploadOk = { ok: true; location: string };
type UploadErr = { ok: false; failure: CreateOfferValidationError };

async function uploadOneImage(
  uploadHttpClient: IAllegroHttpClient,
  contentType: string,
  bytes: Uint8Array,
  sourceUrl: string,
): Promise<UploadOk | UploadErr> {
  let response;
  try {
    response = await uploadHttpClient.postBinary<{ location?: unknown }>(
      '/sale/images',
      contentType,
      bytes,
    );
  } catch (error) {
    const status = error instanceof AllegroApiException ? error.statusCode : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const detail = status !== undefined ? `HTTP ${status}` : message;
    return uploadFailure(`Allegro rejected image upload for '${sourceUrl}': ${detail}`);
  }

  const location = response.data?.location;
  if (typeof location !== 'string' || location.length === 0) {
    return uploadFailure(`Allegro upload response missing 'location' for image '${sourceUrl}'`);
  }

  return { ok: true, location };
}

function normalizeImageContentType(raw: string | null): string | null {
  if (!raw) return null;
  // Strip parameters (e.g. `; charset=utf-8`) and lowercase.
  const head = raw.split(';')[0]?.trim().toLowerCase();
  if (!head) return null;
  // The only normalization the spec calls out: `image/jpg` → `image/jpeg`.
  const normalized = head === 'image/jpg' ? 'image/jpeg' : head;
  return ACCEPTED_IMAGE_CONTENT_TYPES.has(normalized) ? normalized : null;
}

function downloadFailure(
  code: 'IMAGE_DOWNLOAD_FAILED' | 'IMAGE_DOWNLOAD_INVALID_TYPE' | 'IMAGE_TOO_SMALL_FOR_PRODUCT',
  message: string,
): DownloadErr {
  return { ok: false, failure: { field: 'images', code, message } };
}

function uploadFailure(message: string): UploadErr {
  return {
    ok: false,
    failure: { field: 'images', code: 'IMAGE_UPLOAD_FAILED', message },
  };
}
