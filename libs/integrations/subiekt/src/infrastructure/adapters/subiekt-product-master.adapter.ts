/**
 * Subiekt Product Master Adapter (Subiekt GT)
 *
 * Implements `ProductMasterPort` over the bridge's `/api/products*` surface
 * (Sfera GT `TowaryManager` on the Windows side — see
 * `../../bridge/subiekt-bridge-products.types.ts`, the frozen wire contract
 * this adapter is built against).
 *
 * **NOT verified live.** This adapter was built in an isolated git worktree
 * with no `powershell.exe` access to the Windows bridge machine (the sandbox
 * categorically refuses shell commands that could reach outside the worktree
 * from an isolated agent), so the Windows side (`ProductsEndpoints.cs`) does
 * not exist yet and this code has been exercised only against unit-test
 * mocks. Whoever wires the real bridge endpoint should treat
 * `subiekt-bridge-products.types.ts` as the contract to implement, then run
 * this adapter against it live before trusting it in production.
 *
 * Own small HTTP client (not a shared file) — the parallel product build
 * deliberately avoided touching `subiekt-bridge-http.client.ts` /
 * `subiekt-bridge.client.ts` to prevent a file collision with 3 other
 * capability builds running at the same time. Reuses the existing bridge
 * error types (`SubiektBridgeUnreachableError` etc.) so a caller catching
 * those still works uniformly across every Subiekt capability.
 *
 * Variants: Subiekt GT's `TowaryManager` has no distinct "product with N
 * variants" concept matching OL's colour/size model (`DodajKomplet` is a
 * kit/bundle of DIFFERENT towary, not a variant axis on one towar) — so every
 * towar is treated as a simple product with exactly one synthetic variant,
 * the same posture PrestaShop/WooCommerce take for a simple product.
 *
 * MVP gaps (`SubiektProductNotSupportedException`): `deleteProduct` (Subiekt
 * GT towary are archived, not deleted, at the Sfera level — no confirmed
 * `TowaryManager` member for this in the research this adapter was built
 * from), `getProductCategories` / `assignCategories` / `getCategories` (no
 * category-facade research done for this capability — Subiekt GT has
 * "Grupy asortymentu" / "Rodzaje asortymentu", unexplored).
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters
 */
import { randomUUID } from 'crypto';
import type { LoggerPort } from '@openlinker/shared/logging';
import { Logger } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';
import type {
  Category,
  Product,
  ProductMasterPort,
  ProductVariant,
  ProductTaxRateReader,
  ReadProductTaxRateInput,
  TaxRateResolution,
} from '@openlinker/core/products';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type { ProductCreate, ProductFilters, ProductUpdate } from '@openlinker/core/products';
import type {
  IdentifierMappingPort,
  Connection,
  ExternalIdMapping,
} from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type {
  BridgeCreateProductRequest,
  BridgeListCategoriesResponse,
  BridgeListProductSymbolsResponse,
  BridgeProduct,
  BridgeSearchProductsResponse,
  BridgeUpdateProductRequest,
} from '../../bridge/subiekt-bridge-products.types';
import { SubiektBridgeUnreachableError, SubiektRejectedError } from '../../bridge/subiekt-bridge.errors';
import {
  extractErrorCode,
  classifyRetryability,
  SubiektBridgeUnreachableWithPhaseError,
} from '../../bridge/subiekt-transport-retryability';
import { SubiektBridgeAuthError } from '../../domain/exceptions/subiekt-bridge-auth.exception';
import { SubiektConfigException } from '../../domain/exceptions/subiekt-config.exception';
import { SubiektProductNotSupportedException } from '../../domain/exceptions/subiekt-product-not-supported.exception';
import { SubiektBridgeTransportError } from '../../domain/exceptions/subiekt-bridge-transport.exception';
import type { SubiektTransportRetryability } from '../../domain/types/subiekt-transport-retryability.types';
import { isBridgeUrlSafe } from '../http/subiekt-url-safety';

/** Read the retryability phase, defaulting to the fiscal-safe `'indeterminate'` (mirrors the Inventory/Invoicing adapters' identical helper). */
/**
 * Project a towar's group onto the neutral `Category[]`.
 *
 * Pure, and deliberately conservative about what counts as "has a group":
 * both an absent field (a bridge predating it) and a `null` (a towar with no
 * group) answer `[]`, because neither is something an operator can map. A
 * group id with no name still answers a category - the id is the mappable
 * fact and a missing label is a display problem, not an absent group - while
 * a name with no id answers `[]`, since there is no key to map against.
 */
function toDomainCategories(bridgeProduct: BridgeProduct): Category[] {
  const id = bridgeProduct.grupaId;
  if (typeof id !== 'number' || !Number.isFinite(id)) {
    return [];
  }
  const name = bridgeProduct.grupaNazwa;
  return [
    {
      id: String(id),
      name: typeof name === 'string' && name !== '' ? name : String(id),
    },
  ];
}

function readRetryability(error: SubiektBridgeUnreachableError): SubiektTransportRetryability {
  const phase = (error as { retryability?: unknown }).retryability;
  return phase === 'safe' || phase === 'indeterminate' ? phase : 'indeterminate';
}

/** Same generic envelope every Subiekt bridge route uses. */
interface BridgeEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class SubiektProductMasterAdapter implements ProductMasterPort, ProductTaxRateReader {
  private readonly logger: LoggerPort;
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(
    baseUrl: string,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly connection: Connection,
    opts: { token?: string; timeoutMs?: number; fetchImpl?: FetchLike; logger?: LoggerPort } = {},
  ) {
    if (!isBridgeUrlSafe(baseUrl)) {
      throw new SubiektConfigException('bridgeBaseUrl is not a safe URL', 'bridgeBaseUrl', baseUrl);
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // eslint-disable-next-line no-restricted-globals, @typescript-eslint/no-unnecessary-condition -- test-only fallback; production call sites all inject a connection-bound transport (SubiektBridgeHttpClient precedent, #1810)
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch);
    this.logger = opts.logger ?? new Logger(SubiektProductMasterAdapter.name);
  }

  async getProduct(productId: string): Promise<Product> {
    const symbol = await this.resolveExternalSymbol(productId);
    if (symbol === null) {
      throw new MasterProductNotFoundError(productId, this.connection.id);
    }
    try {
      const bridgeProduct = await this.getJson<BridgeProduct>(`/api/products/${encodeURIComponent(symbol)}`);
      return this.toDomainProduct(productId, bridgeProduct);
    } catch (error: unknown) {
      if (error instanceof SubiektRejectedError) {
        // The bridge reports "no such towar" via the rejected-request shape —
        // that IS a master-side deletion for this adapter's purposes.
        throw new MasterProductNotFoundError(productId, this.connection.id, error);
      }
      throw this.translateBridgeError(error);
    }
  }

  async getProducts(filters?: ProductFilters): Promise<Product[]> {
    if (filters?.externalIds && filters.externalIds.length > 0) {
      const results: Product[] = [];
      for (const symbol of filters.externalIds) {
        try {
          const bridgeProduct = await this.getJson<BridgeProduct>(
            `/api/products/${encodeURIComponent(symbol)}`,
          );
          const internalId = await this.identifierMapping.getOrCreateInternalId(
            CORE_ENTITY_TYPE.Product,
            symbol,
            this.connection.id,
          );
          results.push(this.toDomainProduct(internalId, bridgeProduct));
        } catch (error: unknown) {
          if (error instanceof SubiektRejectedError) {
            continue; // gone at the master — silently skip, matching a filtered list read
          }
          throw this.translateBridgeError(error);
        }
      }
      return results;
    }

    const symbols = await this.listSymbols(filters?.limit, filters?.offset);
    const results: Product[] = [];
    for (const symbol of symbols) {
      const bridgeProduct = await this.getJson<BridgeProduct>(
        `/api/products/${encodeURIComponent(symbol)}`,
      );
      const internalId = await this.identifierMapping.getOrCreateInternalId(
        CORE_ENTITY_TYPE.Product,
        symbol,
        this.connection.id,
      );
      results.push(this.toDomainProduct(internalId, bridgeProduct));
    }
    return results;
  }

  async createProduct(product: ProductCreate): Promise<Product> {
    const request: BridgeCreateProductRequest = {
      symbol: product.sku,
      nazwa: product.name,
      cenaSprzedazyBrutto: product.price,
      waluta: product.currency,
      opis: product.description,
      waga: product.weight,
    };
    try {
      const bridgeProduct = await this.postJson<BridgeProduct>('/api/products', request);
      const internalId = await this.identifierMapping.getOrCreateInternalId(
        CORE_ENTITY_TYPE.Product,
        bridgeProduct.symbol,
        this.connection.id,
      );
      return this.toDomainProduct(internalId, bridgeProduct);
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  async updateProduct(productId: string, product: ProductUpdate): Promise<Product> {
    const symbol = await this.resolveExternalSymbol(productId);
    if (symbol === null) {
      throw new MasterProductNotFoundError(productId, this.connection.id);
    }
    const request: BridgeUpdateProductRequest = {
      nazwa: product.name,
      cenaSprzedazyBrutto: product.price,
      waluta: product.currency,
      opis: product.description,
      waga: product.weight,
    };
    try {
      const bridgeProduct = await this.putJson<BridgeProduct>(
        `/api/products/${encodeURIComponent(symbol)}`,
        request,
      );
      return this.toDomainProduct(productId, bridgeProduct);
    } catch (error: unknown) {
      if (error instanceof SubiektRejectedError) {
        throw new MasterProductNotFoundError(productId, this.connection.id, error);
      }
      throw this.translateBridgeError(error);
    }
  }

  deleteProduct(_productId: string): Promise<void> {
    return Promise.reject(new SubiektProductNotSupportedException('deleteProduct'));
  }

  async getProductVariants(productId: string): Promise<ProductVariant[]> {
    // Synthetic single variant — see the class docblock. Re-fetch the RAW
    // bridge product (not via getProduct/toDomainProduct, which maps onto
    // `Product` — a type with no `ean` field at all) so `kodKreskowy` survives
    // onto the variant, which is the only domain shape that carries barcode.
    // Previously this always emitted `ean: null, gtin: null` unconditionally,
    // silently dropping every barcode the bridge reported.
    const symbol = await this.resolveExternalSymbol(productId);
    if (symbol === null) {
      throw new MasterProductNotFoundError(productId, this.connection.id);
    }
    let bridgeProduct: BridgeProduct;
    try {
      bridgeProduct = await this.getJson<BridgeProduct>(`/api/products/${encodeURIComponent(symbol)}`);
    } catch (error: unknown) {
      if (error instanceof SubiektRejectedError) {
        throw new MasterProductNotFoundError(productId, this.connection.id, error);
      }
      throw this.translateBridgeError(error);
    }
    const product = this.toDomainProduct(productId, bridgeProduct);
    const variantExternalId = `${symbol}::variant`;
    const variantInternalId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.ProductVariant,
      variantExternalId,
      this.connection.id,
    );
    return [
      {
        id: variantInternalId,
        productId,
        sku: product.sku,
        attributes: null,
        ean: bridgeProduct.kodKreskowy,
        gtin: bridgeProduct.kodKreskowy,
        price: product.price ?? undefined,
      },
    ];
  }

  upsertProductVariant(_productId: string): Promise<ProductVariant> {
    // Synthetic-variant posture: there is nothing separate to write at the
    // master — the variant IS the product. #3356: this previously returned
    // the current variant unchanged, silently dressing the discarded write
    // as success. Honest failure, matching `deleteProduct`'s posture — zero
    // production callers confirmed repo-wide for any adapter.
    return Promise.reject(new SubiektProductNotSupportedException('upsertProductVariant'));
  }

  /**
   * The towar's group, as a single-element `Category[]`.
   *
   * Subiekt GT gives a towar exactly ONE group (`tw__Towar.tw_IdGrupa`), so
   * this never returns more than one entry - the array is the port's shape,
   * not a claim that a product can sit in several categories here.
   *
   * An empty array means the towar carries no group, and is deliberately the
   * same answer as "this bridge does not report one": in both cases there is
   * nothing to map, and the alternative (throwing, as this used to) makes a
   * perfectly ordinary ungrouped product fail a catalogue read.
   */
  async getProductCategories(productId: string): Promise<Category[]> {
    const symbol = await this.resolveExternalSymbol(productId);
    if (symbol === null) {
      throw new MasterProductNotFoundError(productId, this.connection.id);
    }
    try {
      const bridgeProduct = await this.getJson<BridgeProduct>(
        `/api/products/${encodeURIComponent(symbol)}`,
      );
      return toDomainCategories(bridgeProduct);
    } catch (error: unknown) {
      if (error instanceof SubiektRejectedError) {
        throw new MasterProductNotFoundError(productId, this.connection.id, error);
      }
      throw this.translateBridgeError(error);
    }
  }

  /**
   * The connection's whole group list (`sl_GrupaTw`), for the category-mapping
   * surface.
   *
   * FLAT by construction: `sl_GrupaTw` has no parent column, so no `parentId`
   * and no `depth` are emitted. Synthesising either - for instance by reading
   * `grt_NrAnalityka` as a path - would invent a hierarchy Subiekt does not
   * have, and an operator mapping against it would be mapping against a shape
   * that exists nowhere but here.
   *
   * `active` is likewise omitted rather than defaulted to `true`: Subiekt
   * carries no such flag for a group, and the neutral `Category` already
   * documents an absent value as "defaults to true".
   */
  async getCategories(): Promise<Category[]> {
    try {
      const response = await this.getJson<BridgeListCategoriesResponse>(
        '/api/products/categories',
      );
      return response.categories.map((category) => ({
        id: String(category.id),
        name: category.nazwa,
      }));
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  assignCategories(_productId: string, _categoryIds: string[]): Promise<void> {
    // Read-only by decision, not by accident: nothing in OpenLinker needs to
    // WRITE a Subiekt group in order to map categories, and a write here would
    // move a towar between the operator's own groups on the strength of a
    // mapping they authored for a marketplace. Honest failure, matching
    // `deleteProduct` / `upsertProductVariant`.
    return Promise.reject(new SubiektProductNotSupportedException('assignCategories'));
  }

  async searchProducts(query: string, filters?: ProductFilters): Promise<Product[]> {
    const params = new URLSearchParams({ q: query });
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    try {
      const response = await this.getJson<BridgeSearchProductsResponse>(
        `/api/products/search?${params.toString()}`,
      );
      const results: Product[] = [];
      for (const bridgeProduct of response.products) {
        const internalId = await this.identifierMapping.getOrCreateInternalId(
          CORE_ENTITY_TYPE.Product,
          bridgeProduct.symbol,
          this.connection.id,
        );
        results.push(this.toDomainProduct(internalId, bridgeProduct));
      }
      return results;
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  async listExternalIds(filters?: { limit?: number; offset?: number }): Promise<string[]> {
    return this.listSymbols(filters?.limit, filters?.offset);
  }

  /**
   * Subiekt GT's VAT-rate assignment (`tw_IdVatSp`) is a property of the
   * towar itself, not of any per-variant concept — same posture as
   * PrestaShop (#2054), whose synthetic-variant simple-product model this
   * adapter already shares. Every variant of a product shares the
   * product's rate; `variantId` is ignored.
   */
  readsTaxRatePerVariant(): boolean {
    return false;
  }

  /**
   * State the towar's VAT rate (#3357, ADR-063). Every Subiekt-sourced
   * order line's `taxRate` was NULL forever before this — Net Sales
   * excluded 100% of this connection's revenue — because no `ProductMaster`
   * capability answered `isProductTaxRateReader`'s guard.
   *
   * The bridge's `stawkaVat` is `null` when the towar carries no VAT-rate
   * assignment at all (`tw_IdVatSp IS NULL`) — a genuine `unknown`, not a
   * real 0% rate — versus a resolved `'0'` string, which IS a deliberate
   * zero (export, exempt goods; #2054's "unknown is not zero" rule).
   */
  async readProductTaxRate(input: ReadProductTaxRateInput): Promise<TaxRateResolution> {
    const symbol = await this.resolveExternalSymbol(input.productId);
    if (symbol === null) {
      throw new MasterProductNotFoundError(input.productId, this.connection.id);
    }
    let bridgeProduct: BridgeProduct;
    try {
      bridgeProduct = await this.getJson<BridgeProduct>(`/api/products/${encodeURIComponent(symbol)}`);
    } catch (error: unknown) {
      if (error instanceof SubiektRejectedError) {
        throw new MasterProductNotFoundError(input.productId, this.connection.id, error);
      }
      // A transport/infra failure says nothing about the towar's VAT
      // configuration — re-raise rather than reporting 'unknown', or one
      // failed sweep tick would freeze a false "no rate" onto the catalogue.
      throw this.translateBridgeError(error);
    }
    if (bridgeProduct.stawkaVat === null) {
      return { kind: 'unknown', reason: 'not-configured', detail: 'tw_IdVatSp is not set' };
    }
    return { kind: 'resolved', code: bridgeProduct.stawkaVat, countryIso2: 'PL' };
  }

  // --- helpers ---------------------------------------------------------------

  private async listSymbols(limit?: number, offset?: number): Promise<string[]> {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', String(limit));
    if (offset !== undefined) params.set('offset', String(offset));
    const qs = params.toString();
    try {
      const response = await this.getJson<BridgeListProductSymbolsResponse>(
        `/api/products${qs ? `?${qs}` : ''}`,
      );
      return response.symbols;
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  /** Internal id -> external symbol, via the connection's own mapping. `null` when unmapped (caller decides deleted vs. never-synced). */
  private async resolveExternalSymbol(internalProductId: string): Promise<string | null> {
    const externalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Product,
      internalProductId,
    );
    const match = externalIds.find((e: ExternalIdMapping) => e.connectionId === this.connection.id);
    return match?.externalId ?? null;
  }

  private toDomainProduct(internalId: string, bridgeProduct: BridgeProduct): Product {
    return {
      id: internalId,
      name: bridgeProduct.nazwa,
      sku: bridgeProduct.symbol,
      price: bridgeProduct.cenaSprzedazyBrutto ?? bridgeProduct.cenaSprzedazyNetto ?? null,
      description: bridgeProduct.opis,
      // Served by the bridge itself from Subiekt's own `tw_ZdjecieTw` blobs.
      // Only OpenLinker fetches these URLs — it downloads the bytes and
      // re-uploads them to the channel's CDN — so the bridge's base only has to
      // be reachable from the worker, not from the public internet. `null`
      // rather than `[]` when the towar has none, matching the field's "not
      // known" reading. Without them a Subiekt-sourced product cannot be
      // published at all: Allegro refuses an offer that carries no image.
      images:
        bridgeProduct.zdjecia && bridgeProduct.zdjecia.length > 0 ? bridgeProduct.zdjecia : null,
      currency: bridgeProduct.waluta,
      weight: bridgeProduct.waga ?? undefined,
    };
  }

  /**
   * #3369/#3373 fix: `SubiektBridgeUnreachableError` (including the
   * phase-carrying `SubiektBridgeUnreachableWithPhaseError` subclass thrown by
   * this adapter's own private transport) MUST be wrapped into
   * `SubiektBridgeTransportError` — that is the ONLY type
   * `SubiektRetryClassifierAdapter.isNonRetryable` pattern-matches for the
   * fiscal-safety retryability pivot. Passing the raw unreachable error
   * through unchanged (the pre-fix behavior) made the classifier abstain on
   * every transport failure from this adapter, silently discarding the
   * classified phase and falling back to the runner's unclassified default.
   */
  private translateBridgeError(error: unknown): Error {
    if (error instanceof SubiektBridgeUnreachableError) {
      return new SubiektBridgeTransportError(error.message, readRetryability(error));
    }
    if (
      error instanceof SubiektBridgeAuthError ||
      error instanceof SubiektConfigException ||
      error instanceof SubiektRejectedError
    ) {
      return error;
    }
    return new SubiektBridgeTransportError(
      error instanceof Error ? error.message : 'Unknown Subiekt bridge error',
      'indeterminate',
      { cause: error },
    );
  }

  // --- minimal own HTTP transport (deliberately not shared, see docblock) ----

  private buildHeaders(hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (hasBody) headers['content-type'] = 'application/json';
    if (this.token !== undefined && this.token.length > 0) {
      headers.authorization = `Bearer ${this.token}`;
      headers['x-bridge-token'] = this.token;
    }
    return headers;
  }

  private async getJson<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, undefined);
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async putJson<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: this.buildHeaders(body !== undefined),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error: unknown) {
      const correlationId = randomUUID();
      // Transport-level failure — classify retryability (#2348 audit B2) so a
      // transient blip against this adapter's own private transport doesn't
      // silently rely on `translateBridgeError`'s current retryable-abstain
      // fallback (the only reason this path was safe by accident before).
      const code = extractErrorCode(error);
      this.logger.debug(`Subiekt bridge request failed (correlationId: ${correlationId})`, {
        error: error instanceof Error ? error.message : String(error),
        code,
      });
      throw new SubiektBridgeUnreachableWithPhaseError(
        `Subiekt bridge is unreachable (${code ?? 'unknown'}, correlationId: ${correlationId})`,
        classifyRetryability(code),
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw new SubiektBridgeAuthError(response.status);
    }

    let envelope: BridgeEnvelope<T>;
    try {
      envelope = (await response.json()) as BridgeEnvelope<T>;
    } catch {
      // Response received but unparseable — the write may or may not have
      // landed, so this stays 'indeterminate'.
      throw new SubiektBridgeUnreachableWithPhaseError(
        'Subiekt bridge returned a non-JSON response',
        'indeterminate',
      );
    }

    if (!envelope.success || envelope.data === null) {
      throw new SubiektRejectedError(envelope.error ?? `HTTP ${response.status}`);
    }
    return envelope.data;
  }
}
