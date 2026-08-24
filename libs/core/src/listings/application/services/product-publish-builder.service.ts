/**
 * Product Publish Builder Service
 *
 * Assembles a platform-neutral `PublishProductCommand` from an OL internal
 * variant id. Fetches variant metadata via `IProductsService`, resolves the
 * parent master product via `ProductMasterPort` (name/description/images/price/
 * categories), **provisions** the destination category on the shop
 * (open-provenance, via `CategoryProvisioner` when the destination supports it),
 * projects the variant's attributes into neutral `OfferParameter[]` via
 * `IAttributeProjectionService`, and validates required fields — throwing
 * `ProductPublishBuilderValidationException` so `ProductPublishExecutionService`
 * maps it to `business_failure` (ADR-007).
 *
 * Shop-side sibling of `OfferBuilderService`. Two deliberate departures:
 *  - Category placement is **provisioning-only** here (not the marketplace
 *    `CategoryResolutionService` chain, which resolves `'OfferManager'` and runs
 *    on the offer hot path). No provisioner / no source categories → publish
 *    uncategorised (not a gate failure).
 *  - The publish gate has no offer/product section split — every unresolved
 *    required destination parameter blocks.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IProductPublishBuilderService}
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  formatDescriptionForDestination,
  resolveShopDescriptionFormat,
} from './description-format-resolution';
import type { DescriptionFormat } from '../../domain/types/description-format.types';

import { Logger } from '@openlinker/shared/logging';
import {
  CONNECTION_PORT_TOKEN,
  ConnectionPort,
  applyPricingRule,
  readPricingRule,
} from '@openlinker/core/identifier-mapping';
import {
  AVAILABILITY_SERVICE_TOKEN,
  type IAvailabilityService,
} from '@openlinker/core/inventory';
import { AvailabilityUnknownError } from '../../domain/exceptions/availability-unknown.error';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type {
  OfferParameter,
  ProvisionCategoryCommand,
  PublishProductCommand,
  PublishProductContent,
  PublishProductVariantGroup,
  ShopProductManagerPort,
} from '@openlinker/core/listings';
import { isCategoryProvisioner } from '@openlinker/core/listings';
import type { Category, ProductMasterPort, ProductVariant } from '@openlinker/core/products';
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';

import { MasterCatalogConnectionNotConfiguredException } from '../../domain/exceptions/master-catalog-connection-not-configured.exception';
import type { ProductPublishBuilderValidationIssue } from '../../domain/exceptions/product-publish-builder-validation.exception';
import { ProductPublishBuilderValidationException } from '../../domain/exceptions/product-publish-builder-validation.exception';
import { ATTRIBUTE_PROJECTION_SERVICE_TOKEN } from '../../listings.tokens';
import { IAttributeProjectionService } from '../interfaces/attribute-projection.service.interface';
import type { IProductPublishBuilderService } from '../interfaces/product-publish-builder.service.interface';
import type { BuildPublishProductCommandInput } from '../types/product-publish-builder.types';
import type { AttributeProjectionMetadata } from '../types/attribute-projection.types';
import type { RequiredToSellIssue } from '../../domain/types/required-to-sell.types';
import { buildProjectionMetadata } from './build-projection-metadata';
import { checkRequiredToSell } from './check-required-to-sell';
import { flattenAttributes } from './variant-attributes.util';

@Injectable()
export class ProductPublishBuilderService implements IProductPublishBuilderService {
  private readonly logger = new Logger(ProductPublishBuilderService.name);

  constructor(
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(ATTRIBUTE_PROJECTION_SERVICE_TOKEN)
    private readonly attributeProjection: IAttributeProjectionService,
    @Inject(AVAILABILITY_SERVICE_TOKEN)
    private readonly availabilityService: IAvailabilityService
  ) {}

  async buildPublishProductCommand(
    input: BuildPublishProductCommandInput
  ): Promise<PublishProductCommand> {
    const issues: ProductPublishBuilderValidationIssue[] = [];

    const variant = await this.productsService.getVariant(input.internalVariantId);
    if (!variant) {
      throw new ProductPublishBuilderValidationException([
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

    const price = this.resolvePrice(input, product, connection.config, issues);
    if (issues.length > 0) {
      throw new ProductPublishBuilderValidationException(issues);
    }

    // Per-item overrides (#1831) WIN over server-derived defaults. A supplied
    // (defined) array — even empty — is an explicit operator choice: it skips
    // server-side provisioning / projection. Omitted (undefined) ⇒ derive as today.
    const destinationCategoryIds =
      input.destinationCategoryIds !== undefined
        ? input.destinationCategoryIds
        : await this.provisionCategory(input.connectionId, productMaster, variant.productId);
    const parameters =
      input.parameters !== undefined
        ? input.parameters
        : await this.projectParameters(
            input,
            masterConnectionId,
            destinationCategoryIds[0] ?? null,
            variant.attributes ?? {},
            buildProjectionMetadata(product, variant, variant.gtin ?? variant.ean ?? null)
          );

    // ADR-046: the destination declares what it accepts in a description.
    // Resolved here rather than inside `buildContent` so the resolution happens
    // once per build and stays on the path that already awaits - the category
    // provisioner's own resolution below is conditional and cannot be reused.
    const destination = await this.integrationsService.getCapabilityAdapter<ShopProductManagerPort>(
      input.connectionId,
      'ProductPublisher'
    );
    const content = this.buildContent(
      input.content,
      product,
      resolveShopDescriptionFormat(destination)
    );

    // Master-derived barcode/weight: prefer the variant's own value, fall back
    // to the product's. Empty/absent ⇒ omitted (never sent as blank/zero).
    const barcode = variant.gtin ?? variant.ean ?? undefined;
    const weight = variant.weight ?? product.weight;

    // #1836 — a multi-variant product (>1 sibling) publishes as one grouped
    // shop record (WooCommerce variable product + variations). Mirrors the
    // marketplace #1065 populate decision (sibling count only; the read
    // happens once per publish regardless of fan-out width).
    const siblings = await this.productsService.getVariantsByProductId(variant.productId);
    const variantGroup = this.resolveVariantGroup(variant, siblings);

    // #1844 / #2323 — hold back the destination's per-connection stock safety
    // buffer so a fast-moving item keeps a cushion and can't oversell between
    // syncs. The availability seam owns the arithmetic now; default reserve 0
    // => the caller's quantity passes through unchanged.
    //
    // `input.stock` is the caller's quantity, NOT master availability — see the
    // matching note in `OfferBuilderService`.
    const stockControl = await this.availabilityService.applyPublishControls({
      quantity: input.stock,
      scope: { kind: 'channel', connectionId: input.connectionId },
    });
    if (stockControl.quantity === null) {
      // Raised BEFORE the command exists so no unbuffered quantity can escape.
      throw new AvailabilityUnknownError(input.connectionId, input.internalVariantId);
    }

    const command: PublishProductCommand = {
      internalVariantId: input.internalVariantId,
      connectionId: input.connectionId,
      destinationCategoryIds,
      // `price` is guaranteed defined here — `issues` would have caught it above.
      price: price as { amount: number; currency: string },
      stock: stockControl.quantity,
      status: input.status,
      // Thread the variant SKU so shop products publish with a reference the
      // shop can key on (reconciliation, inventory-by-SKU). Omitted when the
      // variant has no SKU, matching the spread-omit convention below.
      ...(variant.sku ? { sku: variant.sku } : {}),
      ...(barcode ? { barcode } : {}),
      ...(weight != null ? { weight } : {}),
      ...(content ? { content } : {}),
      ...(input.commerce ? { commerce: input.commerce } : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    };

    // #1836 — only set when populated, keeping the command shape tidy for
    // single-variant / simple products (mirrors the #1065 marketplace posture).
    if (variantGroup) {
      command.variantGroup = variantGroup;
    }

    // #1842 — required-to-sell preflight: a publish that succeeds on the
    // destination but isn't actually buyable there (missing weight/dimensions
    // for weight-based shipping, zero stock). Pure, no extra I/O — reads only
    // fields already resolved onto `command`. `block`-severity issues gate the
    // publish exactly like the price/parameter gates above; today every rule is
    // `warn` (soft-block, operator-overridable at Review — see the FE Review
    // step), so this only logs. The check is exported standalone so a future
    // preflight surface (FE dry-run, HTTP endpoint) can call it without
    // resolving a full command first.
    this.gateOnRequiredToSell(command);

    this.logger.debug(
      `Built PublishProductCommand for variant=${input.internalVariantId} connection=${input.connectionId} categories=${destinationCategoryIds.length} params=${parameters.length} status=${input.status} grouped=${variantGroup != null}`
    );

    return command;
  }

  /**
   * Pure helper (#1836): build the shop-neutral grouping hint for a sibling of
   * a multi-variant product. Returns `undefined` for single-variant / simple
   * products (`siblings.length <= 1`) so they publish standalone, preserving
   * the exact pre-#1836 simple-product path. `groupAttributeValues` unions
   * every sibling's own distinguishing values per attribute name so the
   * destination's parent record can declare the full option set regardless of
   * which sibling happens to publish first.
   */
  private resolveVariantGroup(
    variant: ProductVariant,
    siblings: ProductVariant[]
  ): PublishProductVariantGroup | undefined {
    if (siblings.length <= 1) {
      return undefined;
    }
    const groupAttributeValues: Record<string, string[]> = {};
    for (const sibling of siblings) {
      for (const { name, value } of flattenAttributes(sibling.attributes)) {
        const existing = groupAttributeValues[name];
        if (existing) {
          if (!existing.includes(value)) existing.push(value);
        } else {
          groupAttributeValues[name] = [value];
        }
      }
    }
    return {
      groupId: variant.productId,
      attributes: flattenAttributes(variant.attributes),
      groupAttributeValues,
    };
  }

  /**
   * Provision the destination category path (open-provenance, ADR-024 §2) when
   * the shop adapter supports `CategoryProvisioner`. Best-effort: no provisioner
   * or no source categories → `[]` (publish uncategorised). The source path is
   * built from the master product's categories ordered root→leaf by `depth`.
   */
  private async provisionCategory(
    connectionId: string,
    productMaster: ProductMasterPort,
    productId: string
  ): Promise<string[]> {
    const adapter = await this.integrationsService.getCapabilityAdapter<ShopProductManagerPort>(
      connectionId,
      'ProductPublisher'
    );
    if (!isCategoryProvisioner(adapter)) {
      return [];
    }

    let categories: Category[];
    try {
      categories = await productMaster.getProductCategories(productId);
    } catch (error) {
      // Best-effort per the class docstring: a master that can't report
      // categories (e.g. PrestaShop's ProductMaster, not yet implemented)
      // must not block the publish — it just ships uncategorised.
      this.logger.warn(
        `Could not read master categories for product ${productId}; publishing uncategorised: ${(error as Error).message}`
      );
      return [];
    }
    const path = this.toProvisionPath(categories);
    if (path.length === 0) {
      return [];
    }

    const cmd: ProvisionCategoryCommand = { connectionId, path };
    const result = await adapter.provisionCategory(cmd);
    return [result.destinationCategoryId];
  }

  /**
   * Order the product's source categories root→leaf and map them to the
   * provision path shape. MVP best-effort: sorts by `depth` ascending
   * (root→leaf); platforms without a depth report keep the returned order.
   * Assumes a single category branch — multi-branch products provision the
   * combined ordered list (a documented MVP limitation, refined alongside
   * multi-category placement).
   */
  private toProvisionPath(categories: Category[]): { sourceCategoryId: string; name: string }[] {
    return [...categories]
      .sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0))
      .map((c) => ({ sourceCategoryId: c.id, name: c.name }));
  }

  /**
   * Project the variant's attributes into neutral `OfferParameter[]` and gate
   * on unresolved required destination parameters (all sections — shops have no
   * offer/product split). `destinationCategoryId` null (uncategorised) ⇒ skip
   * projection (no category schema to project against).
   */
  private async projectParameters(
    input: BuildPublishProductCommandInput,
    sourceConnectionId: string,
    destinationCategoryId: string | null,
    attributes: Record<string, string>,
    metadata: AttributeProjectionMetadata
  ): Promise<OfferParameter[]> {
    if (!destinationCategoryId) {
      return [];
    }
    const projection = await this.attributeProjection.project({
      sourceConnectionId,
      destinationConnectionId: input.connectionId,
      destinationCategoryId,
      attributes,
      // #1841 — product-derived metadata for operator place-value / scope rules.
      metadata,
      // Shop connections expose the schema reader under `ProductPublisher`, not
      // the marketplace `OfferManager` (which they don't support — resolving it
      // would throw `CapabilityNotSupportedException`).
      destinationCapability: 'ProductPublisher',
    });

    if (projection.unresolvedRequired.length > 0) {
      throw new ProductPublishBuilderValidationException(
        projection.unresolvedRequired.map((param) => ({
          field: `parameters.${param.name}`,
          code: 'PARAMETER_REQUIRED',
          message: `Required destination parameter "${param.name}" (id=${param.id}) has no resolvable value; map the source attribute or supply it explicitly`,
        }))
      );
    }

    if (projection.unmappedSourceKeys.length > 0) {
      this.logger.warn(
        `Omitting ${projection.unmappedSourceKeys.length} unmapped source attribute(s) for variant=${input.internalVariantId} connection=${input.connectionId}: ${projection.unmappedSourceKeys.join(', ')}`
      );
    }

    return projection.parameters;
  }

  /**
   * Merge caller content overrides with master-product fallbacks, stripping
   * null/undefined so adapters see a consistent "absent field". Returns
   * `undefined` when nothing resolved (keeps the command shape tidy).
   */
  private buildContent(
    overrides: PublishProductContent | undefined,
    product: { name: string; description: string | null; images: string[] | null },
    descriptionFormat: DescriptionFormat
  ): PublishProductContent | undefined {
    const title = overrides?.title ?? product.name;
    // ADR-046: shape for the shop's declared format. `getDescriptionFormat` is
    // required on `ShopProductManagerPort`, so a shop always declares one.
    const description = formatDescriptionForDestination(
      overrides?.description ?? product.description,
      descriptionFormat
    );
    const imageUrls = overrides?.imageUrls ?? product.images;

    const content: PublishProductContent = {};
    if (title != null) content.title = title;
    if (description != null) content.description = description;
    if (imageUrls != null) content.imageUrls = imageUrls;
    // Operator-only, no master fallback: the master product carries no
    // short-description / tags fields. Threaded here so the builder-owned
    // content object actually reaches the adapter (both single + bulk flow
    // through this method).
    if (overrides?.shortDescription != null) content.shortDescription = overrides.shortDescription;
    if (overrides?.tags != null) content.tags = overrides.tags;
    if (overrides?.seo != null) content.seo = overrides.seo;

    return Object.keys(content).length > 0 ? content : undefined;
  }

  /**
   * Resolve `command.price`. An explicit `input.price` always wins (per-item
   * operator/UI-resolved price) and is used verbatim — no rule applies to it.
   * Otherwise falls back to the master catalog price, run through the
   * connection's pricing-resolution rule (#1843, `pricing-rule.types.ts`) —
   * markup/margin formula + rounding. A connection with no configured rule is
   * untouched (`applyPricingRule` returns the master price unchanged),
   * preserving the pre-#1843 passthrough.
   */
  private resolvePrice(
    input: BuildPublishProductCommandInput,
    product: { price: number | null; currency: string | null },
    connectionConfig: Parameters<typeof readPricingRule>[0],
    issues: ProductPublishBuilderValidationIssue[]
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

  /**
   * #1842 — run the required-to-sell preflight over the assembled command and
   * apply its verdict: `block`-severity issues gate the publish (raised the
   * same way as the price/parameter gates above); `warn`-severity issues are
   * logged only — they're the operator-overridable signals the Review step
   * surfaces before submit, so by the time a command reaches the builder the
   * operator has already had the chance to confirm through.
   */
  private gateOnRequiredToSell(command: PublishProductCommand): void {
    const issues: RequiredToSellIssue[] = checkRequiredToSell({
      stock: command.stock,
      weight: command.weight,
      dimensions: command.commerce?.dimensions,
    });
    if (issues.length === 0) return;

    const blocking = issues.filter((issue) => issue.severity === 'block');
    if (blocking.length > 0) {
      throw new ProductPublishBuilderValidationException(
        blocking.map((issue) => ({ field: issue.field, code: issue.code, message: issue.message }))
      );
    }

    this.logger.warn(
      `Required-to-sell preflight found ${issues.length} issue(s) for variant=${command.internalVariantId} connection=${command.connectionId}: ${issues.map((issue) => issue.code).join(', ')}`
    );
  }

  private readMasterCatalogConnectionId(
    config: Record<string, unknown> | null | undefined
  ): string | null {
    if (!config) return null;
    const value = config['masterCatalogConnectionId'];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

}
