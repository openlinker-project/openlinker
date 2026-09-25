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
 * **Variants come from Subiekt MODELS.** An earlier version of this docblock
 * concluded that Subiekt GT has no variant concept at all, on the strength of
 * `DodajKomplet` being a kit of DIFFERENT towary rather than an axis on one.
 * That reasoning was sound and the conclusion was wrong: Subiekt carries
 * `sl_ModelTw` + `sl_ModelTowar`, the operator's own grouping of towary that
 * are one article in several sizes, and the retired WooCommerce-shim path had
 * been reading it since the spike while this native adapter never did - so a
 * three-size article reached OpenLinker as three unrelated products and the
 * bulk wizard silently showed one of them.
 *
 * The mapping is therefore:
 *
 * ```
 * Subiekt MODEL  -> OL Product         externalId `model:{mdt_Id}`
 * Subiekt TOWAR  -> OL ProductVariant  externalId `{tw_Symbol}`
 * towar with no model -> OL Product `{tw_Symbol}` + one synthetic variant
 *                        `{tw_Symbol}::variant`   (UNCHANGED)
 * ```
 *
 * The towar stays the unit of price, stock, barcode and image either way -
 * only what counts as a PRODUCT moves. An install with no models behaves
 * exactly as it did before, which is the overwhelming majority of towary.
 *
 * **A towar that JOINS a model stops being a product**, and this adapter says
 * so out loud: `getProduct` on its bare symbol raises
 * `MasterProductNotFoundError` and `listExternalIds` stops reporting it, so
 * the existing master-deletion chain (#1599/#1689) stales its variants and
 * pauses its offers. That is a real, loud transition rather than a silent one:
 * leaving the old mapping alive would leave offers pointing at an internal id
 * nothing syncs any more, with nothing anywhere reporting it. A migration
 * cannot soften it - the model structure lives in Subiekt, behind the bridge,
 * on a Windows machine, and no SQL migration can read it.
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
import { deriveVariantLabel, modelIdFromProductKey, modelProductKey } from './subiekt-model-key';
import type {
  IdentifierMappingPort,
  Connection,
  ExternalIdMapping,
} from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type {
  BridgeCreateProductRequest,
  BridgeListCategoriesResponse,
  BridgeListModelsResponse,
  BridgeListProductSymbolsResponse,
  BridgeModel,
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

/**
 * A model product's VAT rate: the one its members agree on.
 *
 * Subiekt assigns `tw_IdVatSp` per TOWAR, and a model is not a row in
 * `tw__Towar` at all, so a model-keyed product has no rate of its own to
 * read. Its members are the same article in different sizes and in practice
 * carry one rate, so the agreed value IS the product's rate.
 *
 * Disagreement answers `unknown` / `ambiguous` rather than taking the first
 * member's: `readsTaxRatePerVariant()` is false, so whatever this returns
 * settles EVERY sibling's order lines, and one member's rate silently applied
 * to another member's sale is a wrong figure on a fiscal document. The
 * ambiguous answer is persistable (`isPersistableTaxRateRead`), so it records
 * "the master named no rate" and the operator fixes the assignment in
 * Subiekt - which is the whole chain ADR-063 exists to keep pointed at the
 * catalogue rather than at a guess.
 *
 * A member with no assignment counts as a distinct value, so a model where
 * one towar is unassigned and the rest are 23% is ambiguous rather than 23%.
 *
 * An empty member list answers `unreadable`, not `not-configured`: the bridge
 * 404s a model with no live members (openlinker-subiekt-bridge#7), so this is
 * unreachable, and blaming a VAT assignment for a model that has no towar to
 * carry one would send an operator to the wrong screen.
 */
function toModelTaxRate(model: BridgeModel): TaxRateResolution {
  const members = model.pozycje;
  if (members.length === 0) {
    return { kind: 'unknown', reason: 'unreadable', detail: 'model carries no live members' };
  }
  const codes = new Set(members.map((member) => member.stawkaVat));
  if (codes.size > 1) {
    const listed = [...codes].map((code) => code ?? 'none').sort().join(', ');
    return {
      kind: 'unknown',
      reason: 'ambiguous',
      detail: `members disagree on tw_IdVatSp (${listed})`,
    };
  }
  const code = members[0].stawkaVat;
  if (code === null) {
    return { kind: 'unknown', reason: 'not-configured', detail: 'tw_IdVatSp is not set' };
  }
  return { kind: 'resolved', code, countryIso2: 'PL' };
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

/**
 * How many models one `/api/models` page asks for, and how many pages the
 * enumeration will walk before giving up. The cap exists so a misbehaving
 * bridge cannot turn one catalogue enumeration into an unbounded read; it is
 * reported when it fires rather than silently truncating.
 */
const MODEL_PAGE_SIZE = 200;
const MODEL_PAGE_CAP = 20_000;

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
    const key = await this.resolveExternalSymbol(productId);
    if (key === null) {
      throw new MasterProductNotFoundError(productId, this.connection.id);
    }
    const modelId = modelIdFromProductKey(key);
    try {
      if (modelId !== null) {
        const model = await this.getJson<BridgeModel>(`/api/models/${modelId}`);
        return this.toDomainProductFromModel(productId, model);
      }
      const bridgeProduct = await this.getJson<BridgeProduct>(`/api/products/${encodeURIComponent(key)}`);
      this.assertStillAProduct(productId, bridgeProduct);
      return this.toDomainProduct(productId, bridgeProduct);
    } catch (error: unknown) {
      // `assertStillAProduct` raises this from inside the try; rethrow it
      // untouched or the wrapper below would turn a deliberate deletion signal
      // into a retryable transport error and the offers would never pause.
      if (error instanceof MasterProductNotFoundError) throw error;
      if (error instanceof SubiektRejectedError) {
        // The bridge reports "no such towar" (and "no such model") via the
        // rejected-request shape — that IS a master-side deletion for this
        // adapter's purposes.
        throw new MasterProductNotFoundError(productId, this.connection.id, error);
      }
      throw this.translateBridgeError(error);
    }
  }

  /**
   * A towar the operator has since put into a model is a VARIANT now, not a
   * product, so a product mapping still keyed on its bare symbol names
   * something that no longer exists at that grain.
   *
   * Raising here routes it into the ordinary master-deletion path (#1599),
   * which stales the variants and pauses the offers (#1689). The alternative -
   * keep serving it as a standalone product - would leave two OpenLinker
   * products claiming the same towar: the model-keyed one and this one, both
   * syncing, both publishable, and the operator's stock split between them.
   */
  private assertStillAProduct(productId: string, bridgeProduct: BridgeProduct): void {
    if (bridgeProduct.modelId === null || bridgeProduct.modelId === undefined) return;
    this.logger.log(
      `subiekt_towar_became_variant symbol=${bridgeProduct.symbol} modelId=${bridgeProduct.modelId} ` +
        `productId=${productId} connectionId=${this.connection.id} — reporting it deleted at the master ` +
        `so its offers pause; it is now a variant of ${modelProductKey(bridgeProduct.modelId)}.`,
    );
    throw new MasterProductNotFoundError(productId, this.connection.id);
  }

  async getProducts(filters?: ProductFilters): Promise<Product[]> {
    // `listProductKeys` is deliberately 1:1 with the towary it read, so a
    // model appears once per member. Collapse that HERE: this read has no
    // cursor behind it, and left alone it would fetch `/api/models/{id}` once
    // per member and return the same Product three times.
    const keys =
      filters?.externalIds && filters.externalIds.length > 0
        ? filters.externalIds
        : [...new Set(await this.listProductKeys(filters?.limit, filters?.offset))];

    const results: Product[] = [];
    for (const key of keys) {
      try {
        results.push(await this.readProductByKey(key));
      } catch (error: unknown) {
        if (error instanceof SubiektRejectedError || error instanceof MasterProductNotFoundError) {
          // Gone at the master, or a symbol that has since become a variant of
          // a model — silently skipped, matching a filtered list read. The
          // per-product sync path is where a deletion is ADJUDICATED; a list
          // read that threw would take the whole page down with one bad id.
          continue;
        }
        throw this.translateBridgeError(error);
      }
    }
    return results;
  }

  /**
   * One product by its external key, whichever kind it is, minting the
   * internal id the same way for both. The single place that knows a product
   * key can be a model.
   */
  private async readProductByKey(key: string): Promise<Product> {
    const internalId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Product,
      key,
      this.connection.id,
    );
    const modelId = modelIdFromProductKey(key);
    if (modelId !== null) {
      const model = await this.getJson<BridgeModel>(`/api/models/${modelId}`);
      return this.toDomainProductFromModel(internalId, model);
    }
    const bridgeProduct = await this.getJson<BridgeProduct>(`/api/products/${encodeURIComponent(key)}`);
    this.assertStillAProduct(internalId, bridgeProduct);
    return this.toDomainProduct(internalId, bridgeProduct);
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
    // Re-fetches the RAW bridge payload (never via getProduct/toDomainProduct,
    // which maps onto `Product` — a type with no `ean` field at all) so
    // `kodKreskowy` survives onto the variant, the only domain shape that
    // carries a barcode. An earlier version dropped every barcode here.
    const key = await this.resolveExternalSymbol(productId);
    if (key === null) {
      throw new MasterProductNotFoundError(productId, this.connection.id);
    }
    const modelId = modelIdFromProductKey(key);
    try {
      return modelId !== null
        ? await this.readModelVariants(productId, modelId)
        : await this.readSyntheticVariant(productId, key);
    } catch (error: unknown) {
      if (error instanceof MasterProductNotFoundError) throw error;
      if (error instanceof SubiektRejectedError) {
        throw new MasterProductNotFoundError(productId, this.connection.id, error);
      }
      throw this.translateBridgeError(error);
    }
  }

  /**
   * One variant per live towar in the model, keyed by the towar's own symbol.
   *
   * The variant external id is the bare symbol rather than anything derived
   * from the model, so a towar keeps ONE variant identity for the life of the
   * install: moved between models, or taken out of one entirely, it is still
   * the same variant and its offers still point at it. Deriving the id from
   * the model would re-key every sibling the day an operator renames or
   * rebuilds the grouping.
   *
   * Price, barcode and stock are all per towar in Subiekt, so every one of
   * these is the member's own value and not a share of anything.
   */
  private async readModelVariants(productId: string, modelId: number): Promise<ProductVariant[]> {
    const model = await this.getJson<BridgeModel>(`/api/models/${modelId}`);
    const variants: ProductVariant[] = [];
    for (const member of model.pozycje) {
      const variantInternalId = await this.identifierMapping.getOrCreateInternalId(
        CORE_ENTITY_TYPE.ProductVariant,
        member.symbol,
        this.connection.id,
      );
      variants.push({
        id: variantInternalId,
        productId,
        sku: member.symbol,
        attributes: { Wariant: deriveVariantLabel(model.modelNazwa, member.nazwa) },
        ean: member.kodKreskowy,
        gtin: member.kodKreskowy,
        price: member.cenaSprzedazyBrutto ?? member.cenaSprzedazyNetto ?? undefined,
      });
    }
    return variants;
  }

  /**
   * The unchanged pre-model path: a towar in no model is its own product with
   * exactly one synthetic variant, keyed `{symbol}::variant`. `attributes`
   * stays null here and must - there is no sibling to be distinguished from,
   * and `OfferBuilderService` only builds a variant group when a product has
   * more than one variant anyway.
   */
  private async readSyntheticVariant(productId: string, symbol: string): Promise<ProductVariant[]> {
    const bridgeProduct = await this.getJson<BridgeProduct>(`/api/products/${encodeURIComponent(symbol)}`);
    this.assertStillAProduct(productId, bridgeProduct);
    const variantInternalId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.ProductVariant,
      `${symbol}::variant`,
      this.connection.id,
    );
    return [
      {
        id: variantInternalId,
        productId,
        sku: bridgeProduct.symbol,
        attributes: null,
        ean: bridgeProduct.kodKreskowy,
        gtin: bridgeProduct.kodKreskowy,
        price: bridgeProduct.cenaSprzedazyBrutto ?? bridgeProduct.cenaSprzedazyNetto ?? undefined,
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
   *
   * A MODEL-keyed product takes the group of its representative member - the
   * first by symbol, the same deterministic pick `toDomainProductFromModel`
   * already makes for description, weight, currency and price. Without this
   * branch the method GET `/api/products/model%3A5`, the bridge answered 404,
   * and a model product reported master-side DELETION rather than "no
   * category": `ProductPublishBuilderService` catches that and publishes the
   * product uncategorised, silently, so the defect surfaced as a shop listing
   * in no category rather than as an error anywhere.
   *
   * A member may in principle sit in a different group from its siblings;
   * Subiekt gives each towar exactly one `tw_IdGrupa` and offers no group on
   * the model itself, so there is no more authoritative answer to take. A
   * model with no members answers `[]` rather than throwing.
   */
  async getProductCategories(productId: string): Promise<Category[]> {
    const key = await this.resolveExternalSymbol(productId);
    if (key === null) {
      throw new MasterProductNotFoundError(productId, this.connection.id);
    }
    const modelId = modelIdFromProductKey(key);
    try {
      if (modelId !== null) {
        const model = await this.getJson<BridgeModel>(`/api/models/${modelId}`);
        const head = model.pozycje[0];
        return head === undefined ? [] : toDomainCategories(head);
      }
      const bridgeProduct = await this.getJson<BridgeProduct>(
        `/api/products/${encodeURIComponent(key)}`,
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
      // A hit that is a model MEMBER resolves to its model, so a search never
      // offers a caller a product that the sync path would refuse to serve.
      // Deduped: three members of one model are one result, not three.
      const results: Product[] = [];
      const seen = new Set<string>();
      for (const bridgeProduct of response.products) {
        const key =
          bridgeProduct.modelId === null || bridgeProduct.modelId === undefined
            ? bridgeProduct.symbol
            : modelProductKey(bridgeProduct.modelId);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(await this.readProductByKey(key));
      }
      return results;
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  async listExternalIds(filters?: { limit?: number; offset?: number }): Promise<string[]> {
    return this.listProductKeys(filters?.limit, filters?.offset);
  }

  /**
   * One page of PRODUCT keys: a model's key in place of each of its members,
   * and the bare symbol for every towar in no model.
   *
   * ONE KEY PER TOWAR READ, repeats included. A model with three members
   * contributes its key three times, and that is the contract rather than an
   * oversight: `readPagedIds` (`apps/worker/src/sync/bounded-sweep.ts`) counts
   * `consumed` from the length of what this returns and infers end-of-catalogue
   * from a page SHORTER than the size it asked for. Collapsing the repeats here
   * would hand it 97 keys for a page of 100 on the first page that carries two
   * members of one model - so the sweep would conclude the catalogue was
   * exhausted, clear the cursor, log `cycle complete`, and never reach anything
   * past page one, on every tick, with a healthy-looking log line. It is the
   * same trap `docs/architecture-overview.md` section 25 records against a
   * clamped WooCommerce page size.
   *
   * The helper dedupes the collected ids itself, after `consumed` is computed,
   * so the repeats cost nothing downstream. That also subsumes the cross-page
   * case - a model straddling a page boundary is reported on both - rather than
   * leaving one of them handled here and the other there.
   *
   * A caller with no cursor behind it is free to collapse the repeats, and
   * `getProducts` does, because it would otherwise fetch and return one model
   * once per member.
   *
   * Pages over towary, not over models, because that is the set the sweep's
   * offset is defined against and the one whose size the operator recognises.
   *
   * The model map is read once per CALL rather than per towar - that avoids the
   * N+1 over the catalogue, and it is worth knowing that a call is one sweep
   * PAGE, not one cycle: a full cycle re-enumerates every model once per page
   * (`MODEL_PAGE_SIZE` at a time). At 10 000 towary and 2 000 models that is
   * ~1 000 extra bridge reads per cycle - bounded, and not worth a cache with
   * an invalidation story it would have to get right.
   */
  private async listProductKeys(limit?: number, offset?: number): Promise<string[]> {
    const symbols = await this.listSymbols(limit, offset);
    const symbolToModelId = await this.readSymbolToModelId();
    if (symbolToModelId.size === 0) return symbols;

    return symbols.map((symbol) => {
      const modelId = symbolToModelId.get(symbol);
      return modelId === undefined ? symbol : modelProductKey(modelId);
    });
  }

  /**
   * `tw_Symbol -> mdt_Id` for every modelled towar.
   *
   * An empty map is the honest answer for the two cases that look alike from
   * here and behave identically: an install where the operator groups nothing,
   * and a bridge too old to serve `/api/models`. Both mean "no towar is a
   * variant", which is precisely the pre-model behaviour, so a bridge that
   * 404s this route degrades instead of failing the enumeration.
   */
  private async readSymbolToModelId(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    let offset = 0;
    for (;;) {
      let page: BridgeListModelsResponse;
      try {
        page = await this.getJson<BridgeListModelsResponse>(
          `/api/models?limit=${MODEL_PAGE_SIZE}&offset=${offset}`,
        );
      } catch (error: unknown) {
        if (error instanceof SubiektRejectedError) return map;
        throw this.translateBridgeError(error);
      }
      for (const model of page.models) {
        for (const symbol of model.symbole) map.set(symbol, model.modelId);
      }
      if (page.models.length < MODEL_PAGE_SIZE) return map;
      offset += MODEL_PAGE_SIZE;
      if (offset >= MODEL_PAGE_CAP) {
        this.logger.warn(
          `subiekt_model_enumeration_capped connectionId=${this.connection.id} offset=${offset} — ` +
            `stopped after ${MODEL_PAGE_CAP} models; towary in models past this point are reported ` +
            `as standalone products. Raise MODEL_PAGE_CAP if a real install has this many.`,
        );
        return map;
      }
    }
  }

  /**
   * Subiekt GT's VAT-rate assignment (`tw_IdVatSp`) is a property of the
   * towar itself, not of any per-variant concept — same posture as
   * PrestaShop (#2054), whose synthetic-variant simple-product model this
   * adapter already shares. `variantId` is ignored.
   *
   * On a MODEL-keyed product each member IS a towar and so carries its own
   * assignment, which makes a per-variant read expressible here in a way it
   * is not on PrestaShop. It stays off, for two reasons and one missing
   * piece. The members of a model are one article in several sizes and share
   * a rate in practice, so the flag would buy a different answer only on a
   * catalogue that is already misconfigured — and `toModelTaxRate` REPORTS
   * that case as `ambiguous` rather than hiding it. Flipping it also costs
   * one bridge GET per variant per sweep against a connection whose declared
   * 60 requests/minute the catalogue sweep already outruns. And it would need
   * a variant-typed sibling of `resolveExternalSymbol`, which is hardcoded to
   * `CoreEntityType.Product`; no such helper exists.
   *
   * Flip it when a real install's `ambiguous` reads show a model that
   * genuinely mixes rates — that answer is the signal, and it is persisted.
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
   *
   * A MODEL-keyed product reads its members' rates through `toModelTaxRate`.
   * Without that branch this method GET `/api/products/model%3A5`, took the
   * bridge's 404 and raised `MasterProductNotFoundError` — which
   * `MasterProductSyncService.syncTaxRate` swallows as a warn, so #3357 bought
   * a model-carrying catalogue NOTHING and every one of its order lines kept
   * the NULL rate the fix exists to remove. Silently: no failed job, no
   * blocked document, one log line nobody reads.
   *
   * `/api/models/{id}` already carries `stawkaVat` per member (the bridge
   * reads `sl_StawkaVAT` in the same query that hydrates them), so this costs
   * no extra round trip over the read every other model path already makes.
   */
  async readProductTaxRate(input: ReadProductTaxRateInput): Promise<TaxRateResolution> {
    const key = await this.resolveExternalSymbol(input.productId);
    if (key === null) {
      throw new MasterProductNotFoundError(input.productId, this.connection.id);
    }
    const modelId = modelIdFromProductKey(key);
    let bridgeProduct: BridgeProduct;
    try {
      if (modelId !== null) {
        return toModelTaxRate(await this.getJson<BridgeModel>(`/api/models/${modelId}`));
      }
      bridgeProduct = await this.getJson<BridgeProduct>(`/api/products/${encodeURIComponent(key)}`);
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

  /**
   * The towar symbols in a model, ordered as the bridge orders them.
   *
   * Public because `SubiektInventoryMasterAdapter` needs it: Subiekt keeps
   * stock per TOWAR, so a model-keyed product's stock is its members' stock,
   * and the inventory adapter has no product bridge of its own. Passed to it
   * as a bound function by the factory rather than by handing it this whole
   * adapter - the inventory side needs one question answered, not a second
   * capability port it might start reaching into.
   */
  async readModelMemberSymbols(modelId: number): Promise<string[]> {
    try {
      const model = await this.getJson<BridgeModel>(`/api/models/${modelId}`);
      return model.pozycje.map((member) => member.symbol);
    } catch (error: unknown) {
      if (error instanceof SubiektRejectedError) return [];
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

  /**
   * A model as one Product.
   *
   * Subiekt's model row carries a name and nothing else, so every other
   * product-level field is taken from the FIRST member by symbol - a
   * deterministic pick, so two reads never disagree, and a harmless one
   * because each of these is carried per variant where it matters. The one
   * exception is `images`, which unions every member's image in member order:
   * a grouped listing wants the whole gallery, and the members are the
   * photographs.
   *
   * `sku` is derived from the model id, and is deliberately NOT the model KEY.
   * The key is `model:{id}` (`modelProductKey`) and exists for identifier
   * mapping; this is the operator-facing string that reaches a listing and an
   * offer command, where a colon reads as a typo. What matters is what it is
   * not: borrowing a member's symbol would put one string on both a product and
   * a variant, and would move the product's SKU the day that member leaves the
   * model. Nothing resolves a product BY this value, so the two spellings
   * cannot be mistaken for one lookup.
   */
  private toDomainProductFromModel(internalId: string, model: BridgeModel): Product {
    const head = model.pozycje[0];
    const images = model.pozycje.flatMap((member) => member.zdjecia ?? []);
    return {
      id: internalId,
      name: model.modelNazwa,
      sku: `MODEL-${model.modelId}`,
      price: head?.cenaSprzedazyBrutto ?? head?.cenaSprzedazyNetto ?? null,
      description: head?.opis ?? null,
      images: images.length > 0 ? images : null,
      currency: head?.waluta ?? null,
      weight: head?.waga ?? undefined,
    };
  }

  private toDomainProduct(internalId: string, bridgeProduct: BridgeProduct): Product {
    return {
      id: internalId,
      name: bridgeProduct.nazwa,
      sku: bridgeProduct.symbol,
      price: bridgeProduct.cenaSprzedazyBrutto ?? bridgeProduct.cenaSprzedazyNetto ?? null,
      description: bridgeProduct.opis,
      // Served by the bridge itself from Subiekt's own `tw_ZdjecieTw` blobs.
      // OPENLINKER DOES NOT FETCH THESE. This comment used to claim it
      // downloads the bytes and re-uploads them to the channel's CDN, and
      // concluded the bridge's base only had to be reachable from the worker.
      // There is no such download anywhere in OpenLinker: the URL is stored
      // verbatim and dereferenced by the operator's BROWSER and by the
      // marketplace. That false premise is what made the bridge's
      // container-only default base look safe, and the symptom — a thumbnail
      // that renders exactly like a product with no photo — is why it survived.
      // `null` rather than `[]` when the towar has none, matching the field's
      // "not known" reading. Without an image a Subiekt-sourced product cannot
      // be published at all: Allegro refuses an offer that carries no image.
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
