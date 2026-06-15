/**
 * Erli Offer Manager Adapter
 *
 * Implements `OfferManagerPort` + `OfferCreator` + `OfferFieldUpdater` against
 * Erli's single seller-keyed product resource (#984):
 *   - createOffer        → POST  /products/{externalId}
 *   - updateOfferFields  → PATCH /products/{externalId} (sparse)
 *   - updateOfferQuantity→ PATCH /products/{externalId} (sparse, stock only)
 *
 * Async write model (ADR-025): Erli returns HTTP 202 (validated + stored,
 * ~20-min cache lag — no read-after-write). A 202/2xx create maps to
 * `CreateOfferResult.status = 'draft'` ("submitted, not yet confirmed") — NOT
 * `'validating'`, which would schedule the #989 status poll that has no
 * `OfferStatusReader` yet and would flip the record to `business_failure`.
 * #989 introduces `OfferStatusReader` and flips this to `'validating'`.
 *
 * Category/parameter reuse (#985): the create body carries `externalCategories`
 * + `externalAttributes` tagged `source:"allegro"`, built from the already-
 * resolved Allegro ids riding on the command (`overrides.categoryId` +
 * `overrides.platformParams.parameters`/`.productParameters`). Erli processes
 * only the ids (ADR-025 §3); no Erli-native taxonomy authoring. Applies to the
 * create path only — `buildPatchFromFields` is untouched.
 *
 * Out of scope (own issues, marked seams): variant grouping #986, stock/price
 * master sourcing + frozen-field exclusion #988, offer-status reconciliation
 * #989.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link OfferManagerPort}
 */
import {
  OfferCreateRejectedException,
  type CreateOfferCommand,
  type CreateOfferResult,
  type CreateOfferValidationError,
  type OfferCreator,
  type OfferDescriptionUpdate,
  type OfferFieldUpdate,
  type OfferFieldUpdater,
  type OfferManagerPort,
  type UpdateOfferFieldsCommand,
  type UpdateOfferQuantityCommand,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';
import { ErliApiException } from '../../domain/exceptions/erli-api.exception';
import { ErliConfigException } from '../../domain/exceptions/erli-config.exception';
import type { ErliDispatchTime } from '../../domain/types/erli-connection.types';
import type { IErliHttpClient } from '../http/erli-http-client.interface';
import type {
  ErliExternalAttribute,
  ErliExternalCategory,
  ErliProductCreateBody,
  ErliProductImage,
  ErliProductPatchBody,
} from './erli-product.types';

/**
 * Seller-keyed product-id allowlist. The id is interpolated into the request
 * path, so it MUST exclude `/`, `?`, `#`, and `..` (path-traversal / injection)
 * regardless of any future #992 charset change; `encodeURIComponent` is the
 * backstop. Today the id is the OL internal variant id — if #992 switches the
 * seller-key format, this pattern AND {@link ErliOfferManagerAdapter.resolveErliProductId}
 * must change in lockstep (a mismatch fails closed: updates throw, never send).
 */
const ERLI_PRODUCT_ID_PATTERN = /^ol_variant_[a-f0-9]{32}$/;

export class ErliOfferManagerAdapter implements OfferManagerPort, OfferCreator, OfferFieldUpdater {
  private readonly logger = new Logger(ErliOfferManagerAdapter.name);

  constructor(
    private readonly connectionId: string,
    private readonly adapterKey: string,
    private readonly httpClient: IErliHttpClient,
    /**
     * Shop-wide default dispatch time from `connection.config`. Used on offer
     * create when the per-offer override (`overrides.platformParams.dispatchTime`)
     * is absent; create fails closed if neither is present (Erli requires it).
     */
    private readonly defaultDispatchTime?: ErliDispatchTime,
  ) {}

  async createOffer(cmd: CreateOfferCommand): Promise<CreateOfferResult> {
    const externalOfferId = this.resolveErliProductId(cmd);
    const body = this.buildCreateBody(cmd);
    try {
      // POST is non-idempotent by default in the client; the deterministic
      // seller-keyed id makes this an upsert, so opt into retry-safety (D3).
      // `cmd.idempotencyKey` is intentionally not forwarded — the resource id
      // (a POST to /products/{id} upserts) IS the dedup key, so a separate key
      // would add nothing on this transport.
      await this.httpClient.post(this.productPath(externalOfferId), body, { idempotent: true });
    } catch (error) {
      if (error instanceof ErliApiException) {
        throw this.toCreateRejected(error);
      }
      // Auth / network / rate-limit propagate to the runner + classifiers.
      throw error;
    }
    // 202/2xx = submitted, not confirmed (ADR-025). 'draft' → outcome 'ok',
    // no status poll. #989 flips to 'validating' once OfferStatusReader exists.
    // `cmd.publishImmediately` is intentionally not actionable here: Erli's write
    // is async with no read-after-write, so the live publication state can't be
    // confirmed synchronously — it is reconciled later via #989's OfferStatusReader
    // regardless of the requested flag.
    return { externalOfferId, status: 'draft' };
  }

  async updateOfferFields(cmd: UpdateOfferFieldsCommand): Promise<void> {
    const body = this.buildPatchFromFields(cmd.fields);
    await this.httpClient.patch(this.productPath(cmd.externalOfferId), body);
  }

  async updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void> {
    const body: ErliProductPatchBody = { stock: cmd.quantity };
    await this.httpClient.patch(this.productPath(cmd.offerId), body);
  }

  /**
   * Derive the Erli seller-keyed external id from the command. Identity today
   * (the OL variant id is the seller key); the #992 spike may switch to a
   * SKU/barcode, in which case only this helper changes — and the security
   * invariant in {@link productPath} still holds.
   */
  private resolveErliProductId(cmd: CreateOfferCommand): string {
    return cmd.internalVariantId;
  }

  /** Validate (fail-closed) + encode the id before interpolating into the path. */
  private productPath(rawId: string): string {
    if (!ERLI_PRODUCT_ID_PATTERN.test(rawId)) {
      throw new ErliConfigException(
        // Report only the shape, never the raw (attacker-influenceable) id, so a
        // malformed value can't ride into logs/upstream verbatim (PR1058-SEC-05).
        `Erli product id failed validation (expected ol_variant_<32 hex>, got ${rawId.length} chars)`,
        this.connectionId,
      );
    }
    return `products/${encodeURIComponent(rawId)}`;
  }

  private buildCreateBody(cmd: CreateOfferCommand): ErliProductCreateBody {
    // Erli requires name, images, price, stock, dispatchTime on create. Fail
    // CLOSED locally on every required field (same posture as dispatchTime) so a
    // command missing one is rejected up front instead of burning a round-trip on
    // a guaranteed Erli 4xx — and `ErliProductCreateBody` never serialises an
    // invalid (partial) create body (PR1058-TECH-04).
    const name = this.resolveName(cmd.overrides?.title);
    const images = this.resolveImages(cmd.overrides?.imageUrls);
    const body: ErliProductCreateBody = {
      name,
      price: toErliMinorUnits(cmd.price.amount),
      stock: cmd.stock,
      images,
      dispatchTime: this.resolveDispatchTime(cmd.overrides?.platformParams),
    };
    if (cmd.overrides?.description != null) {
      body.description = flattenDescription(cmd.overrides.description);
    }
    if (cmd.variantBarcode != null) {
      body.ean = cmd.variantBarcode;
    }
    // #985: reuse OL's already-resolved Allegro ids (source:"allegro").
    const externalCategories = buildExternalCategories(cmd);
    if (externalCategories.length > 0) {
      body.externalCategories = externalCategories;
    } else {
      // No Allegro category → list without taxonomy reuse (ADR-025 §3 / #978
      // §6.2): graceful-omit, not a hard create failure.
      this.logger.warn(
        `Erli offer has no Allegro category; listing without taxonomy reuse — #985/#978 §6.2 [connectionId=${this.connectionId}]`,
      );
    }
    const externalAttributes = buildExternalAttributes(cmd);
    if (externalAttributes.length > 0) {
      body.externalAttributes = externalAttributes;
    }
    // #986: externalVariantGroup is assembled here.
    return body;
  }

  /** Required offer name (Erli product name). Fail closed on absent/blank. */
  private resolveName(title: string | undefined): string {
    if (title === undefined || title.trim().length === 0) {
      throw new ErliConfigException(
        'Erli offer create requires a non-empty title (maps to the product name).',
        this.connectionId,
      );
    }
    return title;
  }

  /**
   * Required offer images. Fail closed when no safe https image survives — Erli
   * rejects an imageless product, and #992 confirmed `images` is mandatory on
   * create, so an empty array must not reach the wire.
   */
  private resolveImages(urls: string[] | null | undefined): ErliProductImage[] {
    const images = this.sanitizeImageUrls(urls).map(toErliImage);
    if (images.length === 0) {
      throw new ErliConfigException(
        'Erli offer create requires at least one valid public https image URL.',
        this.connectionId,
      );
    }
    return images;
  }

  private buildPatchFromFields(fields: OfferFieldUpdate): ErliProductPatchBody {
    const body: ErliProductPatchBody = {};
    if (fields.price !== undefined) {
      body.price = toErliMinorUnits(fields.price.amount);
    }
    if (fields.title !== undefined) {
      body.name = fields.title;
    }
    if (fields.description !== undefined) {
      body.description = flattenDescription(fields.description);
    }
    return body;
  }

  /**
   * Map a deterministic Erli 4xx to the neutral create-rejection. `responseBody`
   * is diagnostics-only (may echo submitted data) — it stays in a debug log and
   * NEVER reaches the operator-facing `errors[].message`. #992 may parse a
   * structured Erli error body into per-field errors here.
   */
  private toCreateRejected(error: ErliApiException): OfferCreateRejectedException {
    this.logger.debug(
      `Erli rejected offer creation (status=${error.statusCode ?? 'unknown'}) body=${
        error.responseBody ?? '<none>'
      }`,
    );
    const errors: CreateOfferValidationError[] = [
      {
        code: 'ERLI_REJECTED',
        message: `Erli rejected the offer (HTTP ${error.statusCode ?? 'unknown'}).`,
      },
    ];
    return new OfferCreateRejectedException(this.adapterKey, error.statusCode ?? 0, errors);
  }

  /**
   * Resolve the offer's dispatch time: per-offer override
   * (`overrides.platformParams.dispatchTime`) wins over the connection-level
   * default. Fail closed if neither is present — Erli requires `dispatchTime`
   * on create, so we never send an invalid body.
   */
  private resolveDispatchTime(
    platformParams: Record<string, unknown> | undefined,
  ): ErliDispatchTime {
    const resolved = readDispatchTimeParam(platformParams) ?? this.defaultDispatchTime;
    if (!resolved) {
      throw new ErliConfigException(
        'Erli offer create requires a dispatch time: set defaultDispatchTime on the ' +
          'connection config or pass overrides.platformParams.dispatchTime.',
        this.connectionId,
      );
    }
    return resolved;
  }

  /** Best-effort hygiene: forward only https absolute URLs to non-internal hosts. */
  private sanitizeImageUrls(urls: string[] | null | undefined): string[] {
    if (!urls) {
      return [];
    }
    return urls.filter((url) => {
      if (isSafePublicHttpsUrl(url)) {
        return true;
      }
      this.logger.warn(`Dropping unsafe Erli offer image URL [connectionId=${this.connectionId}]`);
      return false;
    });
  }
}

function toErliMinorUnits(amount: number | string): number {
  const numeric = typeof amount === 'string' ? Number(amount) : amount;
  // Fail closed rather than serialize NaN into the price body: a non-numeric
  // string amount is a caller/config error, not a value Erli should ever see.
  if (!Number.isFinite(numeric)) {
    throw new ErliConfigException(`Erli price amount is not a finite number: ${String(amount)}`);
  }
  // Erli prices are integer minor units (grosze); PLN-only, no currency field.
  return Math.round(numeric * 100);
}

/** Map a sanitized image URL to Erli's image-object wire shape. */
function toErliImage(url: string): ErliProductImage {
  return { url };
}

const ERLI_DISPATCH_TIME_UNITS = new Set<ErliDispatchTime['unit']>(['hour', 'day', 'month']);

/**
 * Read + validate a per-offer `dispatchTime` override off the un-modeled
 * `overrides.platformParams`. Returns `undefined` when no override key is
 * present (caller falls back to the connection default). Throws if an override
 * IS present but malformed — an explicit operator value must not be silently
 * dropped (fail closed).
 */
function readDispatchTimeParam(
  platformParams: Record<string, unknown> | undefined,
): ErliDispatchTime | undefined {
  const raw = platformParams?.dispatchTime;
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'object') {
    throw new ErliConfigException('overrides.platformParams.dispatchTime must be an object');
  }
  const candidate = raw as { period?: unknown; unit?: unknown };
  const period = candidate.period;
  if (typeof period !== 'number' || !Number.isInteger(period) || period < 0) {
    throw new ErliConfigException(
      'overrides.platformParams.dispatchTime.period must be a non-negative integer',
    );
  }
  if (candidate.unit !== undefined && !ERLI_DISPATCH_TIME_UNITS.has(candidate.unit as never)) {
    throw new ErliConfigException(
      "overrides.platformParams.dispatchTime.unit must be 'hour', 'day', or 'month'",
    );
  }
  return candidate.unit === undefined
    ? { period }
    : { period, unit: candidate.unit as ErliDispatchTime['unit'] };
}

/**
 * Map the OL-resolved Allegro category id (`overrides.categoryId`) into the
 * single-element `source:"allegro"` category list. Empty when absent (#985).
 */
function buildExternalCategories(cmd: CreateOfferCommand): ErliExternalCategory[] {
  const categoryId = cmd.overrides?.categoryId;
  if (typeof categoryId === 'string' && categoryId.length > 0) {
    return [{ source: 'allegro', id: categoryId }];
  }
  return [];
}

/**
 * Flatten the Allegro offer-section + product-section parameter lists into one
 * `source:"allegro"` attribute array (Erli has a single flat list — the
 * offer/product split is Allegro-only). Each entry is narrowed with
 * {@link isAllegroParameterShape}; dictionary value-ids win over free-text
 * scalars, range-only and malformed entries are dropped (#985).
 */
function buildExternalAttributes(cmd: CreateOfferCommand): ErliExternalAttribute[] {
  const platformParams = cmd.overrides?.platformParams;
  const raw = [
    ...toUnknownArray(platformParams?.parameters),
    ...toUnknownArray(platformParams?.productParameters),
  ];
  const attributes: ErliExternalAttribute[] = [];
  for (const entry of raw) {
    if (!isAllegroParameterShape(entry)) {
      continue;
    }
    if (entry.valuesIds !== undefined && entry.valuesIds.length > 0) {
      attributes.push({ source: 'allegro', id: entry.id, type: 'dictionary', values: entry.valuesIds });
    } else if (entry.values !== undefined && entry.values.length > 0) {
      attributes.push({ source: 'allegro', id: entry.id, type: 'string', values: entry.values });
    }
    // rangeValue-only / empty → dropped in v1 (#985 risk R3).
  }
  return attributes;
}

function toUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** Allegro command-parameter entry, after narrowing. */
interface AllegroParameterShape {
  id: string;
  values?: string[];
  valuesIds?: string[];
}

/**
 * Narrow an untyped `platformParams.parameters` entry to the Allegro parameter
 * shape (mirrors `isAllegroOfferParameterShape` in the Allegro adapter): require
 * a non-empty `id: string`, and `values`/`valuesIds` (when present) must be
 * string arrays. Anything else is dropped — Erli would reject it anyway.
 */
function isAllegroParameterShape(candidate: unknown): candidate is AllegroParameterShape {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  const c = candidate as { id?: unknown; values?: unknown; valuesIds?: unknown };
  if (typeof c.id !== 'string' || c.id.length === 0) {
    return false;
  }
  if (c.values !== undefined && (!Array.isArray(c.values) || !c.values.every((v) => typeof v === 'string'))) {
    return false;
  }
  if (
    c.valuesIds !== undefined &&
    (!Array.isArray(c.valuesIds) || !c.valuesIds.every((v) => typeof v === 'string'))
  ) {
    return false;
  }
  return true;
}

function flattenDescription(input: string | OfferDescriptionUpdate): string {
  if (typeof input === 'string') {
    return input;
  }
  return input.sections
    .flatMap((section) => section.items)
    .map((item) => item.content)
    .join('\n\n');
}

/**
 * Best-effort SSRF-conduit hygiene (NOT full egress control — the actual
 * fetcher is Erli, and DNS-rebinding / public-resolves-internal are out of
 * scope; that's network-layer). Reject non-https + obviously-internal hosts,
 * across both IPv4 (loopback/RFC1918/unspecified/cloud-metadata) and IPv6
 * (loopback/unspecified, ULA fc00::/7, link-local fe80::/10) literals.
 */
function isSafePublicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.internal') || host === '169.254.169.254') {
    return false;
  }
  // IPv6 literals retain their surrounding brackets in URL.hostname.
  if (host === '[::1]' || host === '[::]' || /^\[f[cd]/.test(host) || /^\[fe[89ab]/.test(host)) {
    return false;
  }
  if (
    host === '0.0.0.0' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host)
  ) {
    return false;
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return false;
  }
  return true;
}
