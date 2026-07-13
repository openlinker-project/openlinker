/**
 * Category Resolution Service
 *
 * Resolves the destination category for a listing via the provenance-aware
 * placement chain (ADR-023 §1), each step gated on a declared capability:
 * 1. Provision — mirror/create on the destination (gated on `CategoryProvisioner`,
 *    delivered by #1041; a no-op seam until then)
 * 2. Barcode — GTIN/EAN catalog auto-detect (`CategoryBarcodeMatcher`)
 * 3. Mapping — configured per-source-category → destination mapping
 * 4. Manual — returns null for the operator to choose
 *
 * Returns a neutral `{ destinationCategoryId, provenance, method }`; `provenance`
 * (owns/borrows/open) is derived from the destination adapter's capabilities,
 * never its `platformType`.
 *
 * @module libs/core/src/listings/application/services
 * @implements {ICategoryResolutionService}
 */

import { Injectable, Inject } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type {
  OfferManagerPort,
  EanMatchResult,
} from '@openlinker/core/listings';
import {
  isCategoryBarcodeMatcher,
  isCategoryBrowser,
  isCategoryParametersReader,
  isEanCategoryMatcher,
} from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IMappingConfigService, MAPPING_CONFIG_SERVICE_TOKEN } from '@openlinker/core/mappings';
import type { ICategoryResolutionService } from '../interfaces/category-resolution.service.interface';
import type {
  BatchCategoryResolveInput,
  CategoryProvenance,
  CategoryResolutionInput,
  CategoryResolutionResult,
} from '../types/category-resolution.types';

@Injectable()
export class CategoryResolutionService implements ICategoryResolutionService {
  private readonly logger = new Logger(CategoryResolutionService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(MAPPING_CONFIG_SERVICE_TOKEN)
    private readonly mappingConfig: IMappingConfigService
  ) {}

  async resolveCategory(input: CategoryResolutionInput): Promise<CategoryResolutionResult> {
    const { connectionId, barcode, sourceCategoryIds, borrowedTaxonomy, sourceConnectionId } = input;

    // `provenance` is populated from the resolved adapter on the barcode step.
    // On the mapping / manual paths it is now seeded from the caller-threaded
    // `borrowedTaxonomy` (#1045): a destination that borrows is — by definition —
    // a `borrows` destination, so its mapping-path result carries that provenance.
    // `owns` / `open` destinations still leave it null on the non-barcode paths
    // (no adapter resolved here — by design, no extra I/O).
    let provenance: CategoryProvenance | null = borrowedTaxonomy ? 'borrows' : null;

    // Step 1: Provision (open provenance). No-op seam — the `CategoryProvisioner`
    // capability is delivered by #1041; until then this always falls through.
    const provisioned = await this.tryProvision();
    if (provisioned) {
      this.logger.debug(
        `Category resolved via provision (connection=${connectionId}, categoryId=${provisioned})`
      );
      return { destinationCategoryId: provisioned, provenance: 'open', method: 'provision' };
    }

    // Step 2: Auto-detect via barcode
    if (barcode) {
      const autoDetected = await this.tryAutoDetect(connectionId, barcode);
      provenance = autoDetected.provenance;
      if (autoDetected.categoryId) {
        this.logger.debug(
          `Category resolved via auto_detect (connection=${connectionId}, barcode=${barcode}, categoryId=${autoDetected.categoryId})`
        );
        return {
          destinationCategoryId: autoDetected.categoryId,
          provenance,
          method: 'auto_detect',
        };
      }
    }

    // Step 3: Category mapping fallback
    if (sourceCategoryIds && sourceCategoryIds.length > 0) {
      const mapped = await this.tryCategoryMapping(connectionId, sourceCategoryIds, {
        borrowedTaxonomy,
        sourceConnectionId,
      });
      if (mapped) {
        this.logger.debug(
          `Category resolved via category_mapping (connection=${connectionId}, categoryId=${mapped})`
        );
        return { destinationCategoryId: mapped, provenance, method: 'category_mapping' };
      }
    }

    // Step 4: Manual pick
    this.logger.debug(`Category unresolved, manual pick required (connection=${connectionId})`);
    return { destinationCategoryId: null, provenance, method: 'manual' };
  }

  async resolveCategoriesBatch(
    connectionId: string,
    input: BatchCategoryResolveInput
  ): Promise<Map<string, EanMatchResult>> {
    // Resolving the OfferManager adapter validates the connection up front:
    // unknown/disabled connections surface as 404/409, and a non-marketplace
    // connection as 422 — same gate the single-resolve route relies on.
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );
    // A destination that can't batch-match EANs (it `borrows` its taxonomy, e.g.
    // Erli per ADR-025 §3 — reuses already-resolved Allegro ids, has no catalog
    // of its own) degrades to `no-match` for every variant rather than aborting
    // the whole batch. It resolves the category server-side at submit instead
    // (the wizard suppresses the pre-flight blocker for it). This mirrors the
    // single-resolve chain's graceful fall-through and the per-item no-throw
    // contract, and is gated on the declared capability, never `platformType`.
    if (!isEanCategoryMatcher(adapter)) {
      this.logger.debug(
        `Adapter lacks EanCategoryMatcher; degrading ${input.items.length} variant(s) to no-match ` +
          `for manual category selection (connection=${connectionId})`
      );
      return new Map<string, EanMatchResult>(
        input.items.map((item) => [item.variantId, { kind: 'no-match' }])
      );
    }
    this.logger.debug(
      `Batch-resolving ${input.items.length} variant EAN(s) (connection=${connectionId})`
    );
    // EAN catalogue match stays the PRIMARY path — the adapter only needs
    // `{ variantId, ean }`; `sourceCategoryIds` is a core-owned fallback input.
    const eanResults = await adapter.resolveCategoriesForBatchByEan({
      items: input.items.map((item) => ({ variantId: item.variantId, ean: item.ean })),
    });

    // #1522 — mapping fallback. When the EAN yields no catalogue match (or the
    // variant has no EAN) and the item supplies source categories, consult the
    // operator's configured per-source-category mapping — the same mapping
    // `OfferBuilderService` honours at offer-build time — so the wizard preview
    // agrees with the build. A hit resolves to a `matched` result with no
    // catalogue card (the offer self-links by barcode at build time).
    const resolved = new Map<string, EanMatchResult>();
    for (const item of input.items) {
      const eanResult = eanResults.get(item.variantId) ?? { kind: 'no-match' };
      if (
        (eanResult.kind === 'no-match' || eanResult.kind === 'no-ean') &&
        item.sourceCategoryIds &&
        item.sourceCategoryIds.length > 0
      ) {
        const mapped = await this.tryCategoryMapping(connectionId, item.sourceCategoryIds, {});
        if (mapped) {
          this.logger.debug(
            `Variant ${item.variantId} resolved via category_mapping (connection=${connectionId}, categoryId=${mapped})`
          );
          resolved.set(item.variantId, {
            kind: 'matched',
            allegroCategoryId: mapped,
            productCardId: '',
            method: 'category_mapping',
          });
          continue;
        }
      }
      resolved.set(item.variantId, eanResult);
    }
    return resolved;
  }

  /**
   * Provision step (ADR-023 §1, step 1) — mirror/create the source category on
   * the destination. Gated on the `CategoryProvisioner` capability (ADR-024),
   * delivered by #1041; a no-op until then, so the chain always falls through
   * to the barcode step. #1041 resolves the destination adapter, narrows via
   * `isCategoryProvisioner`, calls `provisionCategory(...)`, and returns the
   * provisioned id (provenance `open`).
   */
  private tryProvision(): Promise<string | null> {
    // No-op seam: returns a resolved Promise so the async contract #1041 fills
    // is already in place at the call site (non-`async` avoids an empty-await lint).
    return Promise.resolve(null);
  }

  /**
   * Barcode step — resolve the destination adapter (capturing its provenance)
   * and, when it supports barcode matching, auto-detect the category.
   *
   * Returns the matched category id (or null) alongside the destination's
   * taxonomy provenance. On adapter-resolution failure the step degrades
   * gracefully (null id, null provenance) so the chain can still fall through
   * to mapping.
   */
  private async tryAutoDetect(
    connectionId: string,
    barcode: string
  ): Promise<{ categoryId: string | null; provenance: CategoryProvenance | null }> {
    try {
      const marketplace = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
        connectionId,
        'OfferManager'
      );
      const provenance = this.deriveProvenance(marketplace);
      if (!isCategoryBarcodeMatcher(marketplace)) {
        this.logger.debug(
          `Destination adapter does not support matchCategoryByBarcode (connection=${connectionId})`
        );
        return { categoryId: null, provenance };
      }
      return { categoryId: await marketplace.matchCategoryByBarcode(barcode), provenance };
    } catch (error) {
      this.logger.warn(
        `Auto-detect category failed (connection=${connectionId}): ${(error as Error).message}`
      );
      return { categoryId: null, provenance: null };
    }
  }

  /**
   * Derive how the destination relates to the taxonomy it resolves against,
   * from its declared capabilities (never `platformType`). A destination that
   * browses its own category tree / exposes per-category parameters `owns` the
   * taxonomy (Allegro); one that does neither `borrows` it (ERLI). `open`
   * (shop provisioning) is reachable once #1041 adds `CategoryProvisioner`.
   */
  private deriveProvenance(adapter: OfferManagerPort): CategoryProvenance {
    if (isCategoryBrowser(adapter) || isCategoryParametersReader(adapter)) {
      return 'owns';
    }
    return 'borrows';
  }

  private async tryCategoryMapping(
    connectionId: string,
    sourceCategoryIds: string[],
    opts: { borrowedTaxonomy?: string; sourceConnectionId?: string }
  ): Promise<string | null> {
    // Pass the opts object only when it carries something — keeps the call shape
    // minimal (and the legacy 2-arg contract intact) for owns/open destinations
    // that thread neither a borrowed taxonomy nor a source connection.
    const hasOpts = opts.borrowedTaxonomy != null || opts.sourceConnectionId != null;
    for (const categoryId of sourceCategoryIds) {
      const resolved = hasOpts
        ? await this.mappingConfig.resolveDestinationCategory(connectionId, categoryId, opts)
        : await this.mappingConfig.resolveDestinationCategory(connectionId, categoryId);
      if (resolved) {
        return resolved;
      }
    }
    return null;
  }
}
