/**
 * Master Product Sync Service
 *
 * Core-owned orchestration for syncing product data from a master connection
 * to canonical storage.
 *
 * @module libs/core/src/products/application/services
 */

import { randomUUID } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { sanitizeStoredHtml } from '@openlinker/shared/html';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
  IEntityClaimService,
  ENTITY_CLAIM_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import { IIdentifierMappingService, IDENTIFIER_MAPPING_SERVICE_TOKEN, CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { EventPublisherPort, EVENT_PUBLISHER_TOKEN } from '@openlinker/core/events';
import { PRODUCTS_SERVICE_TOKEN, TAX_RATE_JOURNAL_SERVICE_TOKEN } from '../../products.tokens';
import { ITaxRateJournalService } from './tax-rate-journal.service.interface';
import { IProductsService } from './products.service.interface';
import type { ProductMasterPort } from '../../domain/ports/product-master.port';
import { isProductTaxRateReader } from '../../domain/ports/capabilities/product-tax-rate-reader.capability';
import type { TaxRateResolution } from '../../domain/types/tax-rate.types';
import { isPersistableTaxRateRead } from '../../domain/types/tax-rate.types';
import type { Product } from '../../domain/entities/product.entity';
import type { ProductVariant } from '../../domain/entities/product-variant.entity';
import { MasterProductNotFoundError } from '../../domain/exceptions/master-product-not-found.error';
import {
  MASTER_DELETION_EVENT_STREAM,
  MASTER_DELETION_EVENT_SCHEMA_VERSION,
  MASTER_PRODUCT_STALE_EVENT,
  MASTER_VARIANT_STALE_EVENT,
  type MasterDeletionEventPayload,
} from '../../domain/types/master-deletion-events.types';
import { normalizeBarcode, normalizeToEan13 } from '../../domain/utils/barcode-normalization';
import type {
  IMasterProductSyncService,
  MasterProductSyncResult,
  PruneSkippedReason,
} from './master-product-sync.service.interface';

@Injectable()
export class MasterProductSyncService implements IMasterProductSyncService {
  private readonly logger = new Logger(MasterProductSyncService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: EventPublisherPort,
    @Inject(ENTITY_CLAIM_SERVICE_TOKEN)
    private readonly entityClaims: IEntityClaimService,
    // #2250: provenance for every rate this sync observes. Append-only and
    // change-only, so an unchanged catalogue writes nothing.
    @Inject(TAX_RATE_JOURNAL_SERVICE_TOKEN)
    private readonly taxRateJournal: ITaxRateJournalService
  ) {}

  async syncFromMasterByExternalId(
    connectionId: string,
    externalId: string
  ): Promise<MasterProductSyncResult> {
    // One correlation id per sync run — ties log lines, the deletion event,
    // and (downstream, #1689) the stale-offer-pause job together.
    const correlationId = randomUUID();

    // Resolve internal product ID
    const internalProductId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Product,
      externalId,
      connectionId
    );

    // Resolve ProductMaster adapter
    const productAdapter = await this.integrationsService.getCapabilityAdapter<ProductMasterPort>(
      connectionId,
      'ProductMaster'
    );

    // Pull product and variants from adapter. A master-side deletion surfaces
    // as the neutral MasterProductNotFoundError (adapters translate their 404 at
    // the port boundary, #1599) — distinct from a transient failure, which
    // rethrows unchanged so the job stays retryable.
    let productFromAdapter: Product;
    let variantsFromAdapter: ProductVariant[];
    try {
      productFromAdapter = await productAdapter.getProduct(internalProductId);
      variantsFromAdapter = await productAdapter.getProductVariants(internalProductId);
    } catch (error) {
      if (error instanceof MasterProductNotFoundError) {
        return this.markProductDeletedAtMaster({
          connectionId,
          externalId,
          internalProductId,
          correlationId,
        });
      }
      throw error;
    }

    // Convert port -> domain entities
    const product = this.toDomainProduct(productFromAdapter);
    if (
      (productFromAdapter.description ?? null) !== null &&
      product.description !== productFromAdapter.description
    ) {
      // Logged, because the alternative is a silent rewrite of the operator's own
      // catalogue copy: `ContentDraftService` warns on all three of its branches
      // for the same reason. One line per altered product, with the ids needed to
      // find it - this runs inside a catalogue loop, so it says what changed
      // rather than dumping either value.
      this.logger.warn(
        `[master-sync] description sanitized on pull: connectionId=${connectionId} ` +
          `externalId=${externalId} internalId=${internalProductId} correlationId=${correlationId} ` +
          `before=${(productFromAdapter.description ?? '').length}B after=${(product.description ?? '').length}B`,
      );
    }
    const variants = variantsFromAdapter.map((v) => this.toDomainVariant(v, internalProductId));

    // Upsert into canonical storage (upsert clears any prior staleness on the
    // reappearing variants — see repository toOrmEntity).
    await this.productsService.upsertProduct(product);
    if (variants.length > 0) {
      await this.productsService.upsertVariants(internalProductId, variants);
    }

    // Pull the tax rate onto the catalogue projection (#2054, ADR-052 § 4), in
    // the same pass that already refreshes price and currency. Best-effort and
    // strictly after the upserts: a rate read that fails must not cost the
    // catalogue its product body, and leaving the row untouched keeps it in the
    // honest `never checked` state rather than recording a false `no rate`.
    await this.syncTaxRate(productAdapter, internalProductId, variants, connectionId, correlationId);

    // Soft-mark any previously-known variant absent from this master response as
    // stale (#1599 — the products-context counterpart of the inventory prune).
    // Guarded against a false positive: a successful pull returning ZERO variants
    // is ambiguous (a genuinely emptied product vs. a flaky master response), and
    // pruning against an empty keep-set would stale every variant. A real full
    // deletion arrives as MasterProductNotFoundError (markProductDeletedAtMaster) — the
    // authoritative signal — so here we only prune when the master actually
    // enumerated variants, and skip (with a warning) on an empty response.
    let markedStale: string[] = [];
    let pruneSkipped = false;
    let pruneSkippedReason: PruneSkippedReason = null;
    if (variants.length > 0) {
      // The prune is connection-blind (it keys on internalProductId alone), so
      // it is only safe while this connection is the sole ProductMaster claiming
      // that id (#1904).
      pruneSkipped = await this.isPruneBlockedByRivalMaster(
        connectionId,
        externalId,
        internalProductId
      );
      if (pruneSkipped) {
        pruneSkippedReason = 'rival';
      } else {
        markedStale = await this.productsService.markVariantsStaleExcept(
          internalProductId,
          variants.map((v) => v.id)
        );
        if (markedStale.length > 0) {
          this.logger.warn(
            `Master product sync marked variants stale (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, correlationId: ${correlationId}, markedStale=${markedStale.length})`
          );
          await this.publishDeletionEvent(false, {
            connectionId,
            internalProductId,
            variantIds: markedStale,
            externalId,
            correlationId,
          });
        }
      }
    } else {
      // Reported, not just logged: before #2222 a skipped prune was invisible to
      // the caller, because `pruneSkipped` means rival-blocked only.
      pruneSkippedReason = 'empty-response';
      this.logger.warn(
        `Master product sync returned 0 variants for an existing product — skipping prune to avoid staling all variants on a possibly-transient empty response (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, correlationId: ${correlationId})`
      );
    }

    this.logger.debug(
      `Master product sync complete (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, correlationId: ${correlationId}, variants: ${variants.length}, markedStale=${markedStale.length}, pruneSkipped=${pruneSkipped})`
    );

    return {
      internalProductId,
      variantsUpserted: variants.length,
      masterDeleted: false,
      pruneSkipped,
      pruneSkippedReason,
    };
  }

  /**
   * Ask the master what tax the product carries and store the answer (#2054).
   *
   * Three properties are deliberate.
   *
   * **A master with no answer is not asked.** `isProductTaxRateReader` narrows
   * the already-dispatched adapter; a master that does not implement the
   * capability leaves the row untouched, so it stays *never checked* rather
   * than being recorded as *checked, no rate*. The two drive different operator
   * copy and only one of them holds documents.
   *
   * **An `unknown` answer IS recorded - unless it is `unreadable`.** A null code
   * with a real timestamp says "the master answered, and what it said was 'I
   * have no rate for this'", which is why the timestamp column exists;
   * `not-configured` and `ambiguous` are exactly that, and skipping them would
   * make a configured-but-rate-less catalogue indistinguishable from one nobody
   * has synced. `unreadable` is the opposite: the read did not establish
   * anything, so persisting it would turn one flaky settings call into a whole
   * catalogue recorded as *no rate* - a state that blocks documents and refuses
   * publishes. It leaves the row untouched, exactly like a throw does
   * (`product-tax-rate-reader.capability.ts` states the same rule).
   *
   * **A throw is swallowed, and leaves the row untouched.** A transport failure
   * says nothing about the shop's configuration, so recording anything would be
   * a claim the read does not support; the next sync asks again. Swallowed per
   * product, and per variant inside the loop, so one unreadable row cannot cost
   * the rest of the sweep its rates.
   *
   * **An `inherited` variant read CLEARS any stored override.** It is the
   * variant saying it has no rate of its own, so the honest row is the absent
   * one - and until this cleared, a variation moved back to the product's tax
   * class kept settling every order line at the override it used to carry.
   */
  private async syncTaxRate(
    adapter: ProductMasterPort,
    internalProductId: string,
    variants: readonly ProductVariant[],
    connectionId: string,
    correlationId: string
  ): Promise<void> {
    if (!isProductTaxRateReader(adapter)) return;

    const readAt = new Date();
    try {
      const productRate = await adapter.readProductTaxRate({ productId: internalProductId });
      if (isPersistableTaxRateRead(productRate)) {
        const storedProductRate = this.toStoredTaxRate(productRate, readAt);
        await this.productsService.recordProductTaxRate(internalProductId, storedProductRate);
        await this.journalObservation(
          internalProductId,
          null,
          connectionId,
          storedProductRate.code,
          readAt
        );
      } else {
        this.logUnpersistedRead(productRate, connectionId, internalProductId, null, correlationId);
      }

      // Only a variant-keyed master gets per-variant reads. On a product-keyed
      // one (PrestaShop) every variant would echo the product's rate, and
      // storing that as an override would turn a shared value into N copies
      // that drift the moment the product's changes.
      if (adapter.readsTaxRatePerVariant?.() !== true) return;

      for (const variant of variants) {
        // Per variant, so an unreadable or failing variant leaves its own row
        // untouched without costing its siblings their reads.
        try {
          const variantRate = await adapter.readProductTaxRate({
            productId: internalProductId,
            variantId: variant.id,
          });

          // `inherited` means the variant defers to the product, which is not an
          // override at all - so any override the shop used to carry is REMOVED
          // rather than left standing. Skipping the row (the pre-review
          // behaviour) meant a variation moved back to `tax_class: 'parent'`
          // kept its old code forever, and `effectiveTaxRate` prefers a known
          // variant code over the product's - so every later order line settled
          // at the stale rate, with no journal entry to show it had happened.
          if (variantRate.kind === 'inherited') {
            await this.productsService.clearVariantTaxRate(variant.id);
            // Journalled like the other two states: the transition off an
            // override is precisely the change an operator needs to see, and
            // the journal is change-only, so a variant that never had one
            // writes nothing.
            await this.journalObservation(
              internalProductId,
              variant.id,
              connectionId,
              null,
              readAt
            );
            continue;
          }

          if (!isPersistableTaxRateRead(variantRate)) {
            this.logUnpersistedRead(
              variantRate,
              connectionId,
              internalProductId,
              variant.id,
              correlationId
            );
            continue;
          }

          const storedVariantRate = this.toStoredTaxRate(variantRate, readAt);
          await this.productsService.recordVariantTaxRate(variant.id, storedVariantRate);
          await this.journalObservation(
            internalProductId,
            variant.id,
            connectionId,
            storedVariantRate.code,
            readAt
          );
        } catch (error) {
          this.logger.warn(
            `[master-sync] variant tax-rate read failed, leaving the override unchanged: ` +
              `connectionId=${connectionId} internalProductId=${internalProductId} ` +
              `variantId=${variant.id} correlationId=${correlationId} ` +
              `error=${(error as Error).message}`
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `[master-sync] tax-rate read failed, leaving the catalogue row unchanged: ` +
          `connectionId=${connectionId} internalProductId=${internalProductId} ` +
          `correlationId=${correlationId} error=${(error as Error).message}`
      );
    }
  }

  /**
   * An answer that establishes nothing is worth a line, because it leaves the
   * catalogue row as it was and would otherwise be invisible.
   */
  private logUnpersistedRead(
    resolution: TaxRateResolution,
    connectionId: string,
    internalProductId: string,
    variantId: string | null,
    correlationId: string
  ): void {
    const detail =
      resolution.kind === 'unknown'
        ? `reason=${resolution.reason} detail=${resolution.detail ?? 'none'}`
        : `kind=${resolution.kind}`;
    this.logger.warn(
      `[master-sync] tax-rate read established nothing, leaving the row unchanged: ` +
        `connectionId=${connectionId} internalProductId=${internalProductId} ` +
        `variantId=${variantId ?? 'none'} correlationId=${correlationId} ${detail}`
    );
  }

  /**
   * Journal what the shop said (#2250).
   *
   * Best-effort and separate from the catalogue write: the journal is
   * provenance, so losing an entry costs an audit trail rather than a rate, and
   * failing the sync over it would trade the thing that matters for the thing
   * that explains it.
   */
  private async journalObservation(
    productId: string,
    variantId: string | null,
    connectionId: string,
    taxRate: string | null,
    observedAt: Date
  ): Promise<void> {
    try {
      await this.taxRateJournal.record({
        productId,
        variantId,
        connectionId,
        origin: 'shop',
        taxRate,
        observedAt,
      });
    } catch (error) {
      this.logger.warn(
        `[master-sync] tax-rate journal write failed (provenance only, catalogue is unaffected): ` +
          `productId=${productId} variantId=${variantId ?? 'none'} error=${(error as Error).message}`
      );
    }
  }

  /** A resolution becomes a stored row; `unknown` stores a null code, not a zero. */
  private toStoredTaxRate(
    resolution: TaxRateResolution,
    readAt: Date
  ): { code: string | null; countryIso2: string | null; readAt: Date } {
    return resolution.kind === 'resolved'
      ? { code: resolution.code, countryIso2: resolution.countryIso2, readAt }
      : { code: null, countryIso2: null, readAt };

  }

  /**
   * Product deleted at the master: mark every one of its variants stale (empty
   * keep-set), emit `master.product.stale`, and signal a business failure so
   * the handler does NOT retry a permanent condition (#1599, ADR-007).
   */
  async markProductDeletedAtMaster(input: {
    connectionId: string;
    externalId: string;
    internalProductId: string;
    correlationId: string;
  }): Promise<MasterProductSyncResult> {
    const { connectionId, externalId, internalProductId, correlationId } = input;
    // Same guard as the partial-prune path: a 404 from ONE master must not stale
    // rows a sibling ProductMaster still considers live (#1904).
    if (await this.isPruneBlockedByRivalMaster(connectionId, externalId, internalProductId)) {
      return {
        internalProductId,
        variantsUpserted: 0,
        masterDeleted: true,
        pruneSkipped: true,
        pruneSkippedReason: 'rival',
      };
    }

    const markedStale = await this.productsService.markVariantsStaleExcept(internalProductId, []);
    if (markedStale.length > 0) {
      await this.publishDeletionEvent(true, {
        connectionId,
        internalProductId,
        variantIds: markedStale,
        externalId,
        correlationId,
      });
    }
    this.logger.warn(
      `Master product deleted — marked variants stale (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, correlationId: ${correlationId}, markedStale=${markedStale.length})`
    );
    return {
      internalProductId,
      variantsUpserted: 0,
      masterDeleted: true,
      pruneSkipped: false,
      pruneSkippedReason: null,
    };
  }

  /**
   * Connection-ownership guard for the staleness prune (#1904).
   *
   * `product_variants` carries no connection provenance, so a prune keyed on the
   * internal product id sweeps every variant of that id regardless of which
   * connection wrote it. That is safe only while ONE connection with
   * `ProductMaster` enabled claims the id - the normal case, since
   * `getOrCreateInternalId` namespaces per `(entityType, externalId,
   * connectionId)`. If a second capable claimant exists, the prune cannot be
   * attributed, so it is withheld (never staling a sibling's live rows) and the
   * condition is logged for operator intervention.
   */
  private async isPruneBlockedByRivalMaster(
    connectionId: string,
    externalId: string,
    internalProductId: string
  ): Promise<boolean> {
    const rivals = await this.entityClaims.findRivalClaimants({
      entityType: CORE_ENTITY_TYPE.Product,
      internalId: internalProductId,
      capability: 'ProductMaster',
      excludeConnectionId: connectionId,
    });
    if (rivals.length === 0) {
      return false;
    }
    this.logger.error(
      `products_prune_skipped_rival_master_connections - internal product id is claimed by more than one ProductMaster connection, so the staleness prune cannot be attributed and was withheld (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, rivals=${rivals.join(',')})`
    );
    return true;
  }

  /**
   * Derives the event type from whether the whole product was pruned (empty
   * keep-set, `markProductDeletedAtMaster`) versus a partial variant-level prune —
   * a single derivation point so the two call sites can't drift out of sync.
   */
  private async publishDeletionEvent(
    wholeProduct: boolean,
    payload: MasterDeletionEventPayload
  ): Promise<void> {
    const eventType = wholeProduct ? MASTER_PRODUCT_STALE_EVENT : MASTER_VARIANT_STALE_EVENT;
    const now = new Date().toISOString();
    await this.eventPublisher.publish(MASTER_DELETION_EVENT_STREAM, {
      eventId: randomUUID(),
      eventType,
      payloadJson: JSON.stringify(payload),
      metadataJson: JSON.stringify({ schemaVersion: MASTER_DELETION_EVENT_SCHEMA_VERSION }),
      occurredAt: now,
      publishedAt: now,
    });
  }

  /**
   * Normalize adapter-produced product: coerce nullable fields to null.
   *
   * Adapters may omit createdAt/updatedAt — the repository populates them on
   * save via TypeORM's @CreateDateColumn/@UpdateDateColumn. Master-derived
   * fields spread through untouched; `currency` and `categories` (#1034) are
   * persisted by the repository, while `weight` remains intentionally transient
   * (no column — master-derived only).
   */
  private toDomainProduct(product: Product): Product {
    return {
      ...product,
      sku: product.sku ?? null,
      price: product.price ?? null,
      // #2198: shop-supplied HTML is untrusted - OpenLinker pulls whatever the
      // master returns, so a compromised or hostile source shop could otherwise
      // store a script vector that `RichTextView` would later render. Sanitized
      // HERE rather than in each adapter's mapper so every current and future
      // ProductMaster is covered by one call.
      description: sanitizeStoredHtml(product.description ?? null),
      images: product.images ?? null,
    };
  }

  /**
   * Normalize adapter-produced variant: coerce barcode fields and pin productId.
   *
   * Adapters may omit createdAt/updatedAt — the repository populates them on
   * save via TypeORM's @CreateDateColumn/@UpdateDateColumn.
   */
  private toDomainVariant(variant: ProductVariant, productId: string): ProductVariant {
    return {
      ...variant,
      productId,
      sku: variant.sku ?? null,
      attributes: variant.attributes ?? null,
      ean: normalizeToEan13(variant.ean ?? null),
      gtin: normalizeBarcode(variant.gtin ?? null),
    };
  }
}
