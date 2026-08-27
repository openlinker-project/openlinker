/**
 * Offer Builder Service
 *
 * Assembles a platform-neutral `CreateOfferCommand` from an OL internal variant
 * id. Fetches variant metadata via `IProductsService`, resolves the parent
 * master product via `ProductMasterPort` (for name/description/images/price),
 * resolves the marketplace category via `ICategoryResolutionService`
 * (barcode → per-source-category mapping → manual, provenance-aware), projects
 * the variant's attributes into neutral `OfferParameter[]` via
 * `IAttributeProjectionService`, and validates required fields. Throws
 * `OfferBuilderValidationException` with a list of issues when anything is
 * missing so callers can surface all problems at once — `OfferCreationExecution`
 * maps that to `business_failure` (ADR-007).
 *
 * Two publish gates (ADR-023 §5):
 *  1. unresolved category / price → `business_failure`.
 *  2. unresolved **offer-section** required parameters → `business_failure`.
 *     Product-section required params are deferred to the adapter / marketplace
 *     because Allegro catalog smart-link (#431/#808) inherits them from the
 *     card; gating them here would false-fail card-linked / bulk (#824) offers.
 *
 * Variant-group pre-resolution (#1065): for a multi-variant product (>1 sibling
 * variant) the builder stamps a platform-neutral `command.variantGroup`
 * (`groupId` = parent product id + this variant's flattened distinguishing
 * `attributes`). Adapters that group explicitly (Erli `externalVariantGroup`)
 * consume it; auto-grouping adapters (Allegro) ignore it. Single-variant /
 * simple products leave `variantGroup` absent and list standalone.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferBuilderService}
 */

import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  CONNECTION_PORT_TOKEN,
  ConnectionPort,
  applyPricingRule,
  applyStockSafetyBuffer,
  isPresentButInvalidStockSafetyBuffer,
  readPricingRule,
  readStockSafetyBuffer,
  readStockZeroThreshold,
} from '@openlinker/core/identifier-mapping';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type {
  CreateOfferCommand,
  CreateOfferOverrides,
  OfferManagerPort,
  OfferParameter,
  OfferVariantGroup,
  SourceAttribute,
  SourceCategoryRef,
} from '@openlinker/core/listings';
import {
  isAdapterSuppliedParametersReader,
  isCategoryBrowser,
  isEanCategoryMatcher,
  isTaxonomyBorrower,
} from '@openlinker/core/listings';
import type { TaxonomyOwner } from '@openlinker/core/listings';
import type { ProductMasterPort, ProductVariant } from '@openlinker/core/products';
import {
  IProductsService,
  PRODUCTS_SERVICE_TOKEN,
} from '@openlinker/core/products';

import { MasterCatalogConnectionNotConfiguredException } from '../../domain/exceptions/master-catalog-connection-not-configured.exception';
import type { OfferBuilderValidationIssue } from '../../domain/exceptions/offer-builder-validation.exception';
import { OfferBuilderValidationException } from '../../domain/exceptions/offer-builder-validation.exception';
import {
  ATTRIBUTE_PROJECTION_SERVICE_TOKEN,
  CATEGORY_RESOLUTION_SERVICE_TOKEN,
} from '../../listings.tokens';
import { IAttributeProjectionService } from '../interfaces/attribute-projection.service.interface';
import { ICategoryResolutionService } from '../interfaces/category-resolution.service.interface';
import type { IOfferBuilderService } from '../interfaces/offer-builder.service.interface';
import type { BuildCreateOfferCommandInput } from '../types/offer-builder.types';
import type { AttributeProjectionMetadata } from '../types/attribute-projection.types';
import { buildProjectionMetadata } from './build-projection-metadata';
import {
  formatDescriptionForDestination,
  resolveOfferDescriptionFormat,
} from './description-format-resolution';
import { flattenAttributes } from './variant-attributes.util';

@Injectable()
export class OfferBuilderService implements IOfferBuilderService {
  private readonly logger = new Logger(OfferBuilderService.name);

  constructor(
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(CATEGORY_RESOLUTION_SERVICE_TOKEN)
    private readonly categoryResolution: ICategoryResolutionService,
    @Inject(ATTRIBUTE_PROJECTION_SERVICE_TOKEN)
    private readonly attributeProjection: IAttributeProjectionService
  ) {}

  async buildCreateOfferCommand(input: BuildCreateOfferCommandInput): Promise<CreateOfferCommand> {
    const issues: OfferBuilderValidationIssue[] = [];

    const variant = await this.productsService.getVariant(input.internalVariantId);
    if (!variant) {
      throw new OfferBuilderValidationException([
        {
          field: 'internalVariantId',
          code: 'NOT_FOUND',
          message: `Variant ${input.internalVariantId} not found`,
        },
      ]);
    }

    const connection = await this.connectionPort.get(input.connectionId);
    const masterConnectionId = this.readMasterCatalogConnectionId(connection.config);
    if (!masterConnectionId) {
      throw new MasterCatalogConnectionNotConfiguredException(input.connectionId);
    }

    const productMaster = await this.integrationsService.getCapabilityAdapter<ProductMasterPort>(
      masterConnectionId,
      'ProductMaster'
    );
    const product = await productMaster.getProduct(variant.productId);

    // A destination that browses/owns its taxonomy (Allegro — `CategoryBrowser`
    // / `EanCategoryMatcher`) needs a resolved marketplace category before the
    // offer can be built. A `borrows` destination (Erli, #1096 / ADR-025 §3)
    // falls back to source-shop categories (or none), so it must NOT block here.
    const destination = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      input.connectionId,
      'OfferManager'
    );
    const requiresResolvedCategory =
      isCategoryBrowser(destination) || isEanCategoryMatcher(destination);

    // #1045 — a `borrows` destination (ERLI) names the owner taxonomy whose
    // category/attribute mappings it reuses verbatim. Read it once from the
    // already-resolved adapter (no extra resolution downstream) and thread it +
    // the master connection through category resolution and attribute projection.
    const borrowedTaxonomy: TaxonomyOwner | undefined = isTaxonomyBorrower(destination)
      ? destination.getBorrowedTaxonomy()
      : undefined;

    // #1741: an operator-supplied per-offer EAN override wins over the variant's
    // own barcode at BOTH catalog sites (category-resolution-by-barcode below and
    // the `variantBarcode` self-link), so a corrected/rescued EAN actually links
    // the card and groups instead of reaching the builder as null.
    const effectiveBarcode = input.overrides?.ean ?? variant.ean ?? variant.gtin ?? null;

    const categoryId = await this.resolveCategory(
      input,
      effectiveBarcode,
      product.categories,
      { borrowedTaxonomy, sourceConnectionId: masterConnectionId }
    );
    if (!categoryId && requiresResolvedCategory) {
      issues.push({
        field: 'overrides.categoryId',
        code: 'REQUIRED',
        message:
          'No automatic category match for variant barcode and no override provided; supply overrides.categoryId',
      });
    }

    const price = this.resolvePrice(input, product, connection.config, issues);

    // Gate 1 — category / price. Throw before projection: projection needs a
    // resolved category, and surfacing all field problems at once is the
    // builder's contract.
    if (issues.length > 0) {
      throw new OfferBuilderValidationException(issues);
    }

    // Category params only exist relative to a resolved marketplace category. A
    // `borrows` destination with no resolved category (Erli source-shop fallback)
    // carries no projected params (#1096) — skip the projection rather than query
    // it for a null category.
    const parameters = categoryId
      ? await this.buildOfferParameters(
          input,
          masterConnectionId,
          categoryId,
          variant.attributes ?? {},
          borrowedTaxonomy,
          buildProjectionMetadata(product, variant, effectiveBarcode),
          destination
        )
      : [];

    // #1065 — a multi-variant product (>1 sibling) becomes one grouped listing.
    // The sibling count is the populate decision; the actual fan-out (after the
    // #824 barcode filter) can be smaller and need not match. Resolved after the
    // validation throw above so a build that fails validation skips the read.
    const siblings = await this.productsService.getVariantsByProductId(variant.productId);
    const variantGroup = this.resolveVariantGroup(variant, siblings.length);

    const title = input.overrides?.title ?? product.name;
    // ADR-046: shape the description into what THIS destination accepts, using
    // the format the already-resolved adapter declares. Returns undefined when
    // nothing survives, which the cleanup below then omits - the Allegro
    // adapter used to implement that emptiness check locally.
    const description = formatDescriptionForDestination(
      input.overrides?.description ?? product.description,
      resolveOfferDescriptionFormat(destination)
    );
    const imageUrls = input.overrides?.imageUrls ?? product.images;

    const overrides = {
      title,
      description,
      categoryId,
      imageUrls,
      platformParams: input.overrides?.platformParams,
    };

    // Strip both null and undefined so the command shape stays tidy and
    // adapters see a consistent "absent field" regardless of whether the
    // source was a missing override or a null Product field.
    const cleanedOverrides: CreateOfferCommand['overrides'] = {};
    if (overrides.title != null) cleanedOverrides.title = overrides.title;
    if (overrides.description != null) cleanedOverrides.description = overrides.description;
    if (overrides.categoryId != null) cleanedOverrides.categoryId = overrides.categoryId;
    if (overrides.imageUrls != null) cleanedOverrides.imageUrls = overrides.imageUrls;
    if (overrides.platformParams != null) {
      cleanedOverrides.platformParams = overrides.platformParams;
    }

    // #1096 — thread the master product's source-shop categories so a borrows
    // destination (Erli) can emit `source:"shop"` taxonomy when no marketplace
    // category was resolved. Neutral data; owns-taxonomy adapters ignore it.
    // F3: prefer the master's full category path (root→leaf, {id,name}) when
    // present so the breadcrumb carries names; otherwise fall back to the bare
    // ids the master always supplies.
    const sourceCategories: SourceCategoryRef[] =
      product.categoryBreadcrumb && product.categoryBreadcrumb.length > 0
        ? product.categoryBreadcrumb.map((c) => ({ id: c.id, name: c.name }))
        : (product.categories ?? []).map((id) => ({ id }));

    // #1096 F2 — thread the master product's features as neutral source-shop
    // attributes. A borrows destination (Erli) emits `source:"shop"`
    // `externalAttributes`; owns-taxonomy adapters ignore them. Each feature's
    // `id` is a stable slug of its name so the same feature is byte-stable across
    // runs (idempotency-friendly).
    const sourceAttributes: SourceAttribute[] = (product.features ?? [])
      .filter((f) => f.name.length > 0 && f.value.length > 0)
      .map((f) => ({ id: slugifyFeatureName(f.name), name: f.name, value: f.value }));

    const command: CreateOfferCommand = {
      internalVariantId: input.internalVariantId,
      connectionId: input.connectionId,
      // `price` is guaranteed defined here because `issues` would have caught it above.
      price: price as { amount: number; currency: string },
      // #1844 — hold back the destination's per-connection stock safety buffer so
      // a fast-moving item keeps a cushion and can't oversell between syncs.
      // Default reserve 0 => master stock passes through unchanged.
      stock: applyStockSafetyBuffer(
        input.stock,
        this.resolveStockReserve(input.connectionId, connection.config),
        readStockZeroThreshold(connection.config)
      ),
      publishImmediately: input.publishImmediately ?? false,
      overrides: Object.keys(cleanedOverrides).length > 0 ? cleanedOverrides : undefined,
      idempotencyKey: input.idempotencyKey,
      // #1500 — marketplaces require a condition ("Stan") on offer creation.
      // Default to 'new' when the operator supplies none so non-UI / borrows
      // paths never silently omit it; an explicit operator condition wins. The
      // neutral value stays platform-free — each adapter maps it to its wire id.
      condition: input.condition ?? 'new',
      ...(sourceCategories.length > 0 ? { sourceCategories } : {}),
      ...(sourceAttributes.length > 0 ? { sourceAttributes } : {}),
      // Neutral parameters (#1039/#1071): projected attributes merged with
      // operator-picked `overrides.parameters` (operator wins by id). The
      // destination adapter is the sole shaper (splits by `section`). Omitted
      // when empty so offers with no params keep their existing command shape.
      ...(parameters.length > 0 ? { parameters } : {}),
      // #431 — smart-link by barcode. Pre-resolved here so adapters that
      // need it (Allegro) don't have to re-fetch the variant.
      variantBarcode: effectiveBarcode,
      // #808 — smart-link by pre-resolved catalogue card. When the wizard
      // already matched a unique product card by EAN, thread its id straight
      // through so the adapter links it (and inherits its required product
      // parameters) instead of re-resolving — kept off `overrides` so the
      // adapter sees it as a top-level hint alongside `variantBarcode`.
      productCardId: input.overrides?.productCardId ?? null,
    };

    // #2249 (ADR-063) — propagate the shop's rate onto the offer, in the same
    // pass that already carries price and stock. Read from OL's own catalogue
    // projection, so publishing does not depend on the shop being reachable and
    // the offer carries the same rate an invoice for it would.
    //
    // Set only when the shop actually has one: an absent rate must reach the
    // adapter as absent, so it can refuse rather than publish an offer with no
    // tax settings. Publishing rate-less is exactly what produced the offers
    // whose orders report `tax: null` today.
    const taxRate = await this.resolveTaxRate(product.id, input.internalVariantId);
    if (taxRate.code) {
      command.taxRate = taxRate.code;
      if (taxRate.countryIso2) command.taxRateCountry = taxRate.countryIso2;
    }

    // #1065 — only set when populated, keeping the command shape tidy (mirrors
    // the `?? null` / cleanedOverrides posture above).
    if (variantGroup) {
      command.variantGroup = variantGroup;
    }

    this.logger.debug(
      `Built CreateOfferCommand for variant=${input.internalVariantId} connection=${input.connectionId} categoryId=${categoryId ?? 'null'} params=${parameters.length} productCardId=${command.productCardId ?? 'null'}`
    );

    return command;
  }

  /**
   * Pure helper (#1065): build the platform-neutral grouping hint for a sibling
   * of a multi-variant product. Returns `undefined` for single-variant / simple
   * products (`siblingCount <= 1`) so they list standalone. The `groupId` is the
   * parent product id — the natural, stable, already-loaded anchor every sibling
   * shares (no new identifier-mapping row).
   */
  private resolveVariantGroup(
    variant: ProductVariant,
    siblingCount: number
  ): OfferVariantGroup | undefined {
    if (siblingCount <= 1) {
      return undefined;
    }
    return {
      groupId: variant.productId,
      attributes: flattenAttributes(variant.attributes),
    };
  }

  private async resolveCategory(
    input: BuildCreateOfferCommandInput,
    barcode: string | null,
    sourceCategoryIds: string[] | undefined,
    taxonomy: { borrowedTaxonomy?: TaxonomyOwner; sourceConnectionId: string }
  ): Promise<string | null> {
    if (input.overrides?.categoryId) {
      return input.overrides.categoryId;
    }
    const hasSourceCategories = sourceCategoryIds != null && sourceCategoryIds.length > 0;
    // Nothing to resolve from: no override, no barcode, no source categories.
    if (!barcode && !hasSourceCategories) {
      return null;
    }
    const result = await this.categoryResolution.resolveCategory({
      connectionId: input.connectionId,
      barcode,
      // Only include when present so the call shape stays minimal (the chain
      // treats an absent list the same as an empty one).
      ...(hasSourceCategories ? { sourceCategoryIds } : {}),
      // #1045 — borrowed-taxonomy reuse + source-store scoping for the mapping step.
      ...(taxonomy.borrowedTaxonomy ? { borrowedTaxonomy: taxonomy.borrowedTaxonomy } : {}),
      sourceConnectionId: taxonomy.sourceConnectionId,
    });
    return result.destinationCategoryId;
  }

  /**
   * Project the variant's attributes, merge with operator-picked params, and
   * apply Gate 2 (offer-section required params). Returns the merged neutral
   * `OfferParameter[]` for `command.parameters`; the adapter is the sole shaper.
   */
  private async buildOfferParameters(
    input: BuildCreateOfferCommandInput,
    sourceConnectionId: string,
    destinationCategoryId: string,
    attributes: Record<string, string>,
    borrowedTaxonomy: TaxonomyOwner | undefined,
    metadata: AttributeProjectionMetadata,
    destination: OfferManagerPort
  ): Promise<OfferParameter[]> {
    const projection = await this.attributeProjection.project({
      sourceConnectionId,
      destinationConnectionId: input.connectionId,
      destinationCategoryId,
      attributes,
      // #1841 — product-derived metadata for operator place-value / scope rules.
      metadata,
      // #1045 — reuse the owner's attribute mappings for a borrows destination.
      ...(borrowedTaxonomy ? { borrowedTaxonomy } : {}),
    });

    const operatorParameters = this.normalizeOperatorParameters(input.overrides);

    // Gate 2 — offer-section required params only. Product-section required
    // params are deferred to the adapter / marketplace (Allegro catalog-card
    // inheritance, #431/#808; bulk self-link, #824). An operator-supplied
    // offer-section param satisfies the requirement, so exclude those ids.
    const operatorOfferIds = new Set(
      operatorParameters.filter((p) => p.section === 'offer').map((p) => p.id)
    );

    // #1934/F1 — a required offer-section param the ADAPTER derives from a
    // neutral command field is not missing, so it must not block. Allegro's
    // "Stan" (11323) is synthesised from `command.condition`, which this
    // builder always sets (defaulting to 'new') a few lines below — yet the
    // gate ran first, saw it unresolved, and rejected every offer whose
    // operator had never hand-mapped a parameter the wizard never showed them.
    // The adapter declares these because the neutral → wire mapping is its own;
    // core does not know which platform id means "condition".
    const adapterSuppliedIds = isAdapterSuppliedParametersReader(destination)
      ? new Set(
          destination.getAdapterSuppliedParameterIds({ condition: input.condition ?? 'new' })
        )
      : new Set<string>();

    const blockingRequired = projection.unresolvedRequired.filter(
      (param) =>
        param.section === 'offer' &&
        !operatorOfferIds.has(param.id) &&
        !adapterSuppliedIds.has(param.id)
    );
    if (blockingRequired.length > 0) {
      throw new OfferBuilderValidationException(
        blockingRequired.map((param) => ({
          field: `parameters.${param.name}`,
          code: 'PARAMETER_REQUIRED',
          message: `Required offer parameter "${param.name}" (id=${param.id}) has no resolvable value; map the source attribute or supply it explicitly`,
        }))
      );
    }

    if (projection.unmappedSourceKeys.length > 0) {
      this.logger.warn(
        `Omitting ${projection.unmappedSourceKeys.length} unmapped source attribute(s) for variant=${input.internalVariantId} connection=${input.connectionId}: ${projection.unmappedSourceKeys.join(', ')}`
      );
    }

    // Operator-picked params win over projected by id.
    const byId = new Map<string, OfferParameter>();
    for (const p of projection.parameters) byId.set(p.id, p);
    for (const p of operatorParameters) byId.set(p.id, p);
    return Array.from(byId.values());
  }

  /**
   * Resolve operator-supplied neutral parameters (#1071): prefer the neutral
   * `overrides.parameters`; for pre-migration persisted snapshots that still
   * carry params under `platformParams.{parameters,productParameters}`, hoist
   * them to the neutral shape so retrying an old failed record neither loses
   * params nor newly trips Gate 2. The fallback is transitional — removable
   * once such records age out.
   */
  private normalizeOperatorParameters(
    overrides: CreateOfferOverrides | undefined
  ): OfferParameter[] {
    if (overrides?.parameters && overrides.parameters.length > 0) {
      return overrides.parameters;
    }
    const platformParams = overrides?.platformParams;
    if (!platformParams) return [];
    const out: OfferParameter[] = [];
    this.appendLegacyParams(out, platformParams['parameters'], 'offer');
    this.appendLegacyParams(out, platformParams['productParameters'], 'product');
    return out;
  }

  /** Narrow a legacy `platformParams` wire array into neutral `OfferParameter`s. */
  private appendLegacyParams(
    out: OfferParameter[],
    raw: unknown,
    section: OfferParameter['section']
  ): void {
    if (!Array.isArray(raw)) return;
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as {
        id?: unknown;
        values?: unknown;
        valuesIds?: unknown;
        rangeValue?: unknown;
      };
      if (typeof e.id !== 'string' || e.id === '') continue;
      const param: OfferParameter = { id: e.id, section };
      if (Array.isArray(e.values) && e.values.every((v) => typeof v === 'string')) {
        param.values = e.values as string[];
      }
      if (Array.isArray(e.valuesIds) && e.valuesIds.every((v) => typeof v === 'string')) {
        param.valuesIds = e.valuesIds as string[];
      }
      if (e.rangeValue !== null && typeof e.rangeValue === 'object') {
        const r = e.rangeValue as { from?: unknown; to?: unknown };
        if (typeof r.from === 'string' && typeof r.to === 'string') {
          param.rangeValue = { from: r.from, to: r.to };
        }
      }
      out.push(param);
    }
  }

  /**
   * Resolve `command.price`. An explicit `input.price` always wins (per-item
   * operator/UI-resolved price, e.g. the bulk wizard's client-side pricing
   * policy) and is used verbatim — no rule applies to it. Otherwise falls back
   * to the master catalog price, run through the connection's pricing-resolution
   * rule (#1843, `pricing-rule.types.ts`) — markup/margin formula + rounding.
   * A connection with no configured rule is untouched (`applyPricingRule`
   * returns the master price unchanged), preserving the pre-#1843 passthrough.
   */
  private resolvePrice(
    input: BuildCreateOfferCommandInput,
    product: { price: number | null; currency: string | null },
    connectionConfig: Parameters<typeof readPricingRule>[0],
    issues: OfferBuilderValidationIssue[]
  ): { amount: number; currency: string } | null {
    if (input.price) {
      return input.price;
    }
    const amount = product.price;
    const currency = product.currency;
    if (typeof amount !== 'number') {
      issues.push({
        field: 'price.amount',
        code: 'REQUIRED',
        message:
          'Price amount could not be resolved from input or master product; provide input.price explicitly',
      });
      return null;
    }
    // Marketplaces reject non-positive prices; distinguish "missing" from "zero/negative"
    // so the caller can see which fix is needed.
    if (amount <= 0) {
      issues.push({
        field: 'price.amount',
        code: 'NON_POSITIVE',
        message: `Master product price (${amount}) is not a positive value; provide input.price explicitly`,
      });
      return null;
    }
    if (!currency) {
      issues.push({
        field: 'price.currency',
        code: 'REQUIRED',
        message:
          'Currency could not be resolved from input or master product; provide input.price explicitly',
      });
      return null;
    }
    const resolvedAmount = applyPricingRule(amount, readPricingRule(connectionConfig));
    if (resolvedAmount <= 0) {
      issues.push({
        field: 'price.amount',
        code: 'NON_POSITIVE',
        message: `Resolved price (${resolvedAmount}) from the connection's pricing rule is not a positive value; provide input.price explicitly or adjust the pricing rule`,
      });
      return null;
    }
    return { amount: resolvedAmount, currency };
  }

  private readMasterCatalogConnectionId(
    config: Record<string, unknown> | null | undefined
  ): string | null {
    if (!config) return null;
    const value = config['masterCatalogConnectionId'];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  /**
   * #1844 — resolve the per-connection stock reserve, warning when a present
   * `config.stockSafetyBuffer` coerced to 0. A mistyped buffer (e.g. `"5"` or a
   * negative number) silently drops the oversell protection the operator thinks
   * they configured, so surface it rather than fail silently.
   */
  private resolveStockReserve(
    connectionId: string,
    config: Parameters<typeof readStockSafetyBuffer>[0]
  ): number {
    if (isPresentButInvalidStockSafetyBuffer(config)) {
      this.logger.warn(
        `Connection ${connectionId} has a stockSafetyBuffer that is present but invalid ` +
          `(non-numeric, negative, zero, or non-finite) — it coerces to 0, so no stock ` +
          `reserve is applied. Set a positive integer to enable oversell protection.`
      );
    }
    return readStockSafetyBuffer(config);
  }

  /**
   * The catalogue's rate for this variant (#2249).
   *
   * Best-effort: a read failure degrades to "no rate" - the same outcome as a
   * genuinely rate-less product, so the two are handled identically downstream.
   * What happens then depends on `OL_TAX_RATE_STRICT_ENABLED`: with it off (the
   * default) the adapter warns and publishes with the rate omitted, exactly as
   * before this epic; with it on the adapter refuses. The gate on the invoicing
   * side is what makes a rate-less line visible either way.
   */
  private async resolveTaxRate(
    productId: string,
    variantId: string
  ): Promise<{ code: string | null; countryIso2: string | null }> {
    try {
      const stored = await this.productsService.getEffectiveTaxRate(productId, variantId);
      return { code: stored.code, countryIso2: stored.countryIso2 };
    } catch (error) {
      this.logger.warn(
        `Could not read the catalogue tax rate for variant ${variantId}: ${(error as Error).message}`
      );
      return { code: null, countryIso2: null };
    }
  }
}

/**
 * Flatten a variant's `attributes` map (#1065) into the neutral distinguishing
 * axes array. Drops empty names/values (no `trim` — a deliberately-set single
 * space is preserved) and sorts by name so two runs of the same variant produce
 * a byte-identical command (idempotency-friendly). Pure (no I/O). A `null`
 * attributes map yields `[]` — the group ref alone groups siblings; the axes
 * only label the selectable options.
 *
 * Attribute strings are externally-sourced (PrestaShop combinations, etc.) and
 * pass through verbatim into the adapter request body only — never a path /
 * query / SQL / log surface. v1 applies no length/cardinality bound (the
 * body-only destination contains the blast radius; Erli validates size
 * server-side).
 */
/**
 * Slugify a product-feature name into a stable id (#1096 F2): lowercase, collapse
 * runs of non-alphanumerics to a single `-`, and trim leading/trailing `-`. Pure.
 * The slug feeds a body-only `externalAttributes[].id` — never a path/query/SQL
 * surface — so no length/charset bound beyond this normalisation is applied. A
 * name that slugs to empty (all-punctuation) yields `''`; the adapter still emits
 * the entry keyed by its `name`.
 */
function slugifyFeatureName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

