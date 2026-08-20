/**
 * Bulk listing wizard (#740 / #792 / #1741 per-variant)
 *
 * Multi-step controller: Config -> Resolve -> Review (with two-pane Edit modal)
 * -> Confirm -> submit. Owns the rows[] state + batch config + per-variant
 * overrides. Each selected product fans out client-side into one
 * `BulkVariantRow` per real variant (#1741); the Resolve step resolves each
 * sibling's category/card/master values and computes a per-variant blocker set,
 * and the Review step gates submit on the included, ready siblings. On submit
 * the wizard emits `perVariantOverrides` (keyed by variant id) + the
 * `excludedVariantIds` the operator switched off; the BE stays the single
 * fan-out source.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, ConfirmDialog, PageLayout, SetupStepper } from '../../../../shared/ui';
import { useToast } from '../../../../shared/ui/toast-provider';
import { usePlatforms, type OfferRowValidationInput } from '../../../../shared/plugins';
import { resolvePlatformLabel } from '../../../mappings';
import { useWriteAccess } from '../../../../shared/auth/use-permission';
import { useDemoMode } from '../../../system';
import { useConnectionsQuery } from '../../../connections';
import { captureDemoEvent } from '../../../demo';
import { useBulkSubmitMutation } from '../../hooks/use-bulk-submit-mutation';
import { useBulkShopPublishMutation } from '../../hooks/use-bulk-shop-publish-mutation';
import { useBulkRequiredProductParams } from '../../hooks/use-bulk-required-product-params';
import { usePublishedVariantsQuery } from '../../hooks/use-published-variants-query';
import { publishDestinationKind } from '../../lib/publish-destinations';
import { DuplicateGuardModal } from '../duplicate-guard-modal';
import type {
  BulkOfferCreateRequest,
  BulkPerProductOverride,
} from '../../api/bulk-listings.types';
import type { BulkShopPublishItemRequest } from '../../api/listings.types';
import type { Product, ProductVariant } from '../../../products';
import { BulkConfigStep } from './bulk-config-step';
import { BulkDestinationBar } from './bulk-destination-bar';
import {
  BulkResolveStep,
  type BulkResolveCompletion,
  type BulkResolveOutcome,
} from './bulk-resolve-step';
import { BulkReviewStep } from './bulk-review-step';
import {
  BulkShopReviewStep,
  type ShopPublishVisibility,
} from './bulk-shop-review-step';
import { ShopPublishTracker } from '../shop-publish-tracker';
import { BulkConfirmModal } from './bulk-confirm-modal';
import {
  computeResolvedPrice,
  computeResolvedStock,
  effectivePricingPolicy,
  effectiveStockPolicy,
  effectiveVariantEan,
  recomputeVariantBlockers,
} from './bulk-policy';
import type {
  BulkRowBlocker,
  BulkVariantRow,
  BulkWizardConfig,
  BulkWizardRow,
  BulkWizardStep,
  PricingPolicy,
  StockPolicy,
} from './bulk-wizard.types';

interface BulkWizardProps {
  /** Selected products from the Products page (already hydrated with variants). */
  products: Product[];
  /** Connection name displayed in the confirm modal once config is known. */
  resolveConnectionName: (connectionId: string) => string;
  /** Connection preselected from the entry-point picker / URL (#1096). */
  preselectedConnectionId?: string;
  /**
   * Variant ids pre-checked from the `/listings` picker (#1754). When a product
   * has ANY of its variants in this set, ALL its variants are still seeded (so
   * the product stays a multi-variant, expandable row and siblings can be
   * re-included in Review) but only the set members start `included`; the rest
   * seed excluded. A product with none of its variants in the set (whole-product
   * pick, or an empty/absent set) seeds every variant included - byte-identical
   * to the `/products` entry point.
   */
  preSelectedVariantIds?: ReadonlySet<string>;
  /**
   * Set when the wizard was reopened from a failed bulk batch's "Fix and
   * resubmit" action (#2234). Renders a banner naming the batch so the
   * pre-filled selection reads as intentional rather than as a bug. Purely
   * informational - nothing in the submit path consumes it.
   */
  resumedFromBatchId?: string;
}

const WIZARD_STEPS: { id: BulkWizardStep; label: string }[] = [
  { id: 'config', label: 'Config' },
  { id: 'resolve', label: 'Resolving' },
  { id: 'review', label: 'Review' },
  { id: 'confirm', label: 'Confirm' },
];

// Shops (#1829) skip the marketplace Resolve step (no category/EAN matching)
// and publish straight from Review: Config -> Review.
const SHOP_WIZARD_STEPS: { id: BulkWizardStep; label: string }[] = [
  { id: 'config', label: 'Config' },
  { id: 'review', label: 'Review' },
];

/** Stable empty list so a param-schema opt-out platform keeps a constant deps identity. */
const EMPTY_CATEGORY_IDS: readonly string[] = [];

/** Stable empty set so a render without published-variant data keeps a constant ref. */
const EMPTY_ALREADY_LISTED: ReadonlySet<string> = new Set<string>();

export function BulkWizard({
  products,
  resolveConnectionName,
  preselectedConnectionId,
  preSelectedVariantIds,
  resumedFromBatchId,
}: BulkWizardProps): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const mutation = useBulkSubmitMutation();
  const shopMutation = useBulkShopPublishMutation();
  const platforms = usePlatforms();
  const connectionsQuery = useConnectionsQuery();

  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const demoMode = useDemoMode();
  const write = useWriteAccess('listings:write', demoMode);
  const canGenerateDescription = write.canWrite;
  const [step, setStep] = useState<BulkWizardStep>('config');
  const [config, setConfig] = useState<BulkWizardConfig | null>(null);
  const [rows, setRows] = useState<BulkWizardRow[]>(() => seedRows(products, preSelectedVariantIds));
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Live-selected connection id (before config is committed) so the stepper +
  // flow can branch by destination capability from the start (#1829). Seeded
  // from the picker/URL preselect; updated by the Config step's selector.
  const [liveConnectionId, setLiveConnectionId] = useState<string>(
    preselectedConnectionId ?? '',
  );
  // Set once a shop batch submits, to swap the body for the publish tracker.
  const [shopBatchId, setShopBatchId] = useState<string | null>(null);

  // Capability-driven destination kind - never a platformType literal (#1829).
  // Resolves from the committed config once known, else the live selection.
  const activeConnectionId = config?.connectionId ?? liveConnectionId;
  const activeConnection = useMemo(
    () => (connectionsQuery.data ?? []).find((c) => c.id === activeConnectionId) ?? null,
    [connectionsQuery.data, activeConnectionId],
  );
  const isShop = activeConnection ? publishDestinationKind(activeConnection) === 'shop' : false;
  const wizardSteps = isShop ? SHOP_WIZARD_STEPS : WIZARD_STEPS;

  // #2227: name the destination in the browser tab too, so a screenshot that
  // includes browser chrome identifies the batch. Deliberately a local effect -
  // `apps/web` has no document-title convention, and one surface does not yet
  // justify introducing a shared hook.
  useEffect(() => {
    if (!activeConnection) return;
    const previousTitle = document.title;
    document.title = `${isShop ? 'Bulk publish' : 'Bulk offers'} · ${activeConnection.name}`;
    return () => {
      document.title = previousTitle;
    };
  }, [activeConnection, isShop]);

  // #1837 duplicate guard: soft-warn when included variants are already
  // published on the destination (a duplicate offer on a marketplace, an
  // upsert on a shop). Never blocks - surfaced as a chip + a confirm before the
  // publish action commits.
  const [dupGuardOpen, setDupGuardOpen] = useState(false);
  const pendingShopPublishRef = useRef<{
    items: BulkShopPublishItemRequest[];
    status: ShopPublishVisibility;
  } | null>(null);

  // #2227 destination context bar. Both pieces of state live here rather than in
  // the bar: the wizard re-renders its body on every step change, so a
  // bar-owned disclosure would snap shut, and the confirm dialog has to outlive
  // the bar it was opened from (confirming unmounts it by returning to Config).
  const [destSettingsOpen, setDestSettingsOpen] = useState(false);
  const [changeDestOpen, setChangeDestOpen] = useState(false);

  // Sync row state when the products list changes (dedup by product id so a
  // product surfaced twice yields one row / one fan-out, mirroring the BE seen
  // dedup, plan §8). Compare against the id signature so a passive cache refresh
  // doesn't clobber row state.
  const dedupedProducts = useMemo(() => dedupById(products), [products]);
  const productsSignature = dedupedProducts.map((p) => p.id).join(',');
  useEffect(() => {
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.productId, r]));
      return dedupedProducts.map((p) => byId.get(p.id) ?? seedRow(p, preSelectedVariantIds));
    });
  }, [productsSignature, dedupedProducts, preSelectedVariantIds]);

  // Distinct categories of INCLUDED variants that submit WITHOUT a card link
  // (#810 / #1741). Only these can hit the missing-product-parameters 422.
  const noCardCategoryIds = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      for (const variant of row.variants) {
        if (!variant.included) continue;
        const hasCard =
          variant.resolvedProductCardId !== null ||
          Boolean(variant.override.overrides?.productCardId);
        if (hasCard) continue;
        const categoryId = variant.override.overrides?.categoryId ?? variant.resolvedCategoryId;
        if (categoryId) set.add(categoryId);
      }
    }
    return Array.from(set);
  }, [rows]);

  const batchConnection = useMemo(
    () => (connectionsQuery.data ?? []).find((c) => c.id === config?.connectionId) ?? null,
    [connectionsQuery.data, config?.connectionId],
  );
  const batchPlatform = useMemo(
    () => platforms.find((p) => p.platformType === batchConnection?.platformType) ?? null,
    [platforms, batchConnection],
  );

  const categoryIdsForParamSchema = batchPlatform?.offerValidation?.needsCategoryParameterSchema
    ? noCardCategoryIds
    : EMPTY_CATEGORY_IDS;
  const { requiredByCategory, isResolving: paramsResolving } = useBulkRequiredProductParams(
    config?.connectionId,
    categoryIdsForParamSchema,
  );

  const platformValidate = useMemo<
    ((input: OfferRowValidationInput) => string[]) | undefined
  >(() => batchPlatform?.offerValidation?.validateRow, [batchPlatform]);
  const platformBlockerChips = batchPlatform?.offerValidation?.blockers ?? [];

  const destinationBrowsesCategories =
    (batchConnection?.supportedCapabilities.includes('CategoryBrowser') ?? false) ||
    (batchConnection
      ? (batchPlatform?.bulkCategoryBrowsingEnabled?.(batchConnection) ?? false)
      : false);

  // Mirrors the builder's `requiresResolvedCategory = isCategoryBrowser ||
  // isEanCategoryMatcher` (#1934/F10). This used to test only the second half,
  // off the STATIC manifest, so a destination that browses categories per
  // connection (Erli with Allegro category access) read as "resolves it at
  // submit": every category blocker was suppressed, the row went green, and
  // then every child died on `overrides.categoryId / REQUIRED`. The browse
  // predicate below already knows the per-connection truth - it just was not
  // consulted here.
  const destinationResolvesCategoryFromManifest = batchConnection
    ? !destinationBrowsesCategories &&
      !batchConnection.supportedCapabilities.includes('EanCategoryMatcher')
    : false;

  // What the Resolve step's own stream reported (#2211). `false` means no
  // catalogue was consulted for these barcodes, which the manifest cannot
  // express - a destination that BORROWS a matcher advertises none of its own
  // (#1045). Without this the manifest reading stands, every `no-match` becomes
  // a category blocker, and the operator is told to pick a category for rows the
  // destination never looked up. `null` = not resolved yet, so the manifest
  // reading holds until the stream says otherwise.
  const [catalogueLookupPerformed, setCatalogueLookupPerformed] = useState<boolean | null>(null);

  const destinationResolvesCategoryAtSubmit =
    destinationResolvesCategoryFromManifest || catalogueLookupPerformed === false;

  // Reconcile per-variant `needs-product-parameters` (and any policy-derived)
  // blockers whenever a category's schema resolves. Gated to Review so only
  // rows with resolved master data recompute.
  useEffect(() => {
    // Marketplace-only: shops carry no category/param blockers (#1829).
    if (!config || step !== 'review' || isShop) return;
    setRows((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (row.variants.length === 0) return row;
        const isMulti = row.variants.length > 1;
        let rowChanged = false;
        const variants = row.variants.map((variant) => {
          const blockers = recomputeVariantBlockers(
            row,
            variant,
            config,
            requiredByCategory,
            platformValidate,
            destinationResolvesCategoryAtSubmit,
            isMulti,
          );
          if (sameBlockers(blockers, variant.blockers)) return variant;
          rowChanged = true;
          return { ...variant, blockers };
        });
        if (!rowChanged) return row;
        changed = true;
        return { ...row, variants };
      });
      return changed ? next : prev;
    });
  }, [config, step, isShop, requiredByCategory, platformValidate, destinationResolvesCategoryAtSubmit]);

  const handleConfigProceed = useCallback(
    (next: BulkWizardConfig) => {
      setConfig(next);
      // A new destination has not been observed yet, so the manifest reading
      // takes over again until its stream reports.
      setCatalogueLookupPerformed(null);
      // Shops skip Resolve (no category/EAN matching) and go straight to
      // Review; marketplaces resolve categories first (#1829). Derived from
      // the committed connection so a switch in Config is honoured.
      const nextConnection = (connectionsQuery.data ?? []).find(
        (c) => c.id === next.connectionId,
      );
      captureDemoEvent('demo_offer_wizard_step_advanced', {
        platform: nextConnection?.platformType ?? 'unknown',
        step: 'config',
      });
      const nextIsShop =
        nextConnection !== undefined && publishDestinationKind(nextConnection) === 'shop';
      setStep(nextIsShop ? 'review' : 'resolve');
    },
    [connectionsQuery.data],
  );

  const handleResolveComplete = useCallback(
    (outcomes: BulkResolveOutcome[], completion: BulkResolveCompletion) => {
      captureDemoEvent('demo_offer_wizard_review_reached', {
        platform: batchConnection?.platformType ?? 'unknown',
      });
      setCatalogueLookupPerformed(completion.catalogueLookupPerformed);
      setRows((prev) => mergeResolveOutcomes(prev, outcomes));
      setStep('review');
    },
    [batchConnection],
  );

  // Toggle one variant's inclusion (single source of truth). Blockers recompute
  // so an excluded blocked variant doesn't keep gating and an included one does.
  const setVariantIncluded = useCallback(
    (productId: string, variantId: string, included: boolean) => {
      if (!config) return;
      setRows((prev) => reblockRows(prev, config, requiredByCategory, platformValidate, destinationResolvesCategoryAtSubmit, (row) =>
        row.productId !== productId
          ? row
          : {
              ...row,
              variants: row.variants.map((v) =>
                v.variantId === variantId ? { ...v, included } : v,
              ),
            },
      ));
    },
    [config, requiredByCategory, platformValidate, destinationResolvesCategoryAtSubmit],
  );

  // Tri-state parent: clicking includes/excludes ALL variants of the product.
  const setProductIncluded = useCallback(
    (productId: string, included: boolean) => {
      if (!config) return;
      setRows((prev) => reblockRows(prev, config, requiredByCategory, platformValidate, destinationResolvesCategoryAtSubmit, (row) =>
        row.productId !== productId
          ? row
          : { ...row, variants: row.variants.map((v) => ({ ...v, included })) },
      ));
    },
    [config, requiredByCategory, platformValidate, destinationResolvesCategoryAtSubmit],
  );

  // Commit the whole-product editor session: base override + per-variant
  // overrides + inclusion, then recompute every sibling's blockers.
  const handleSaveEditor = useCallback(
    (
      productId: string,
      baseOverride: BulkPerProductOverride,
      perVariantOverrides: Record<string, BulkPerProductOverride>,
      includedByVariantId: Record<string, boolean>,
      editFormValues: Record<string, unknown>,
    ) => {
      if (!config) return;
      setRows((prev) => reblockRows(prev, config, requiredByCategory, platformValidate, destinationResolvesCategoryAtSubmit, (row) => {
        if (row.productId !== productId) return row;
        // A simple product has no per-variant scope: its offer-level fields
        // (barcode, price, ...) live on the base override. Fold that base into
        // the lone variant's override so `effectiveVariantEan` sees the entered
        // EAN and the `no-ean` blocker clears on Save (#1741).
        const isSimpleProduct = row.variants.length === 1;
        return {
          ...row,
          override: baseOverride,
          editFormValues,
          variants: row.variants.map((v) => {
            const nextOverride =
              perVariantOverrides[v.variantId] ?? (isSimpleProduct ? baseOverride : v.override);
            return {
              ...v,
              override: nextOverride,
              included: includedByVariantId[v.variantId] ?? v.included,
              ean: effectiveVariantEan({ ...v, override: nextOverride }),
            };
          }),
        };
      }));
    },
    [config, requiredByCategory, platformValidate, destinationResolvesCategoryAtSubmit],
  );

  const handleSubmit = useCallback(
    async (publishImmediately: boolean) => {
      if (!config) return;

      // Fresh idempotency key per confirm-click (#1741 review). A retry after a
      // partial/failed submit must be a distinct request, otherwise the batch
      // dedup gate would return the earlier partial batch instead of re-running.
      // The confirm button is disabled while a submit is in flight, so this can
      // never split a single deliberate click into two batches.
      idempotencyKeyRef.current = crypto.randomUUID();

      // productIds = one primary/seed variant id per product that has >=1
      // included, ready sibling. The BE fans each out; per-variant data + the
      // exclusions drive the exact set (#1741).
      const productIds: string[] = [];
      const perProductOverrides: Record<string, BulkPerProductOverride> = {};
      const perVariantOverrides: Record<string, BulkPerProductOverride> = {};
      const excludedVariantIds: string[] = [];

      for (const row of rows) {
        if (row.variants.length === 0) continue;
        const includedReady = row.variants.filter(
          (v) => v.included && v.blockers.length === 0,
        );
        // The product's shared-base policy (if diverged) wins over the batch.
        const rowPricingPolicy = effectivePricingPolicy(row.override, config.pricingPolicy);
        const rowStockPolicy = effectiveStockPolicy(row.override, config.stockPolicy);
        for (const v of row.variants) {
          if (!v.included) {
            excludedVariantIds.push(v.variantId);
            continue;
          }
          if (v.blockers.length > 0) {
            // A blocked-but-included sibling must be EXCLUDED, not merely
            // skipped (#1934/F13). Skipping alone leaves it in neither map, and
            // the backend then re-expands it as a sibling with no per-variant
            // override at all - so it reaches the builder with no price and
            // fails the very gate the wizard blocked it for. `canApprove` is a
            // `disabled` attribute, not a guard, so this is the only real fence.
            excludedVariantIds.push(v.variantId);
            continue;
          }
          perVariantOverrides[v.variantId] = buildVariantOverride(v, config, rowPricingPolicy, rowStockPolicy);
        }
        if (includedReady.length === 0) continue;
        const primaryId = (row.primaryVariant ?? row.variants[0].variant).id;
        productIds.push(primaryId);

        // #1741 review #1: for a multi-variant product, pin the shared category
        // at the family tier so every sibling groups under the SAME category.
        // Allegro only groups same-category siblings; without this pin each
        // sibling would resolve its category independently by its own barcode
        // and two divergent resolutions would split the very listing this flow
        // unifies. Operator-pinned base category wins, else the resolved primary
        // category. Single-variant products list standalone, so no pin.
        const isMulti = row.variants.length > 1;
        const familyCategoryId =
          row.override.overrides?.categoryId ?? row.resolvedCategoryId ?? undefined;
        const familyOverride: BulkPerProductOverride =
          isMulti && familyCategoryId
            ? {
                ...row.override,
                overrides: { ...(row.override.overrides ?? {}), categoryId: familyCategoryId },
              }
            : row.override;
        if (
          familyOverride.overrides ||
          familyOverride.price ||
          familyOverride.publishImmediately !== undefined
        ) {
          perProductOverrides[primaryId] = toWireOverride(familyOverride);
        }
      }

      if (productIds.length === 0) {
        showToast({
          tone: 'error',
          description: 'No variants are ready to submit. Resolve the flagged variants first.',
        });
        return;
      }

      const request: BulkOfferCreateRequest = {
        connectionId: config.connectionId,
        productIds,
        sharedConfig: {
          // Nominal batch-wide floor only. Every emitted offer carries its own
          // resolved stock: multi-variant siblings use master inventory (BE,
          // #823/#824) and single-variant offers carry a per-variant `stock`
          // override, so this value is never the effective stock today. Kept as
          // a safe non-zero default so a future passthrough path can't publish 0
          // (#1741 review suggestion).
          stock: 1,
          publishImmediately,
          generateDescription: canGenerateDescription ? config.generateDescription : false,
          overrides: {
            platformParams: config.platformParams,
          },
        },
        perProductOverrides,
        perVariantOverrides,
        excludedVariantIds,
      };

      try {
        const result = await mutation.mutateAsync({
          idempotencyKey: idempotencyKeyRef.current,
          request,
        });
        const selectedCount = Object.keys(perVariantOverrides).length;
        const skipped = result.skippedAlreadyListedCount;
        const queuedCount = selectedCount - skipped;
        showToast({
          tone: 'success',
          title: 'Batch submitted',
          description:
            skipped > 0
              ? `${queuedCount.toLocaleString()} offers queued for creation (${skipped.toLocaleString()} already listed, skipped).`
              : `${queuedCount.toLocaleString()} offers queued for creation.`,
        });
        void navigate(`/listings/bulk-batches/${result.batchId}`);
      } catch {
        // Surfaced via mutation.error in the modal.
      }
    },
    [config, rows, mutation, navigate, showToast, canGenerateDescription],
  );

  // Shop branch submit (#1829): POST /listings/bulk-shop-publish, one item per
  // included variant. On success the body swaps to the publish tracker.
  const handleShopPublish = useCallback(
    async (items: BulkShopPublishItemRequest[], status: ShopPublishVisibility) => {
      if (!config || items.length === 0) return;
      try {
        const result = await shopMutation.mutateAsync({
          request: {
            connectionId: config.connectionId,
            items,
            status,
            // #1840 - same Config-step toggle the marketplace branch reads
            // (canGenerateDescription gates on write access, mirroring the
            // marketplace request below).
            ...(canGenerateDescription && config.generateDescription
              ? { generateDescription: true }
              : {}),
          },
        });
        showToast({
          tone: 'success',
          title: 'Bulk publish started',
          description: `${items.length.toLocaleString()} product ${items.length === 1 ? 'listing' : 'listings'} queued.`,
        });
        setShopBatchId(result.batchId);
      } catch {
        // Surfaced via shopMutation.error in the review step.
      }
    },
    [config, shopMutation, showToast, canGenerateDescription],
  );

  const counts = useMemo(() => countBatch(rows), [rows]);
  // `'marketplace'` stays the fallback for "no destination chosen yet"; once a
  // connection IS chosen its label comes from the registry like everywhere else,
  // so an unregistered platform reads as its raw type rather than the generic
  // word (#2088).
  const marketplaceName = batchConnection
    ? resolvePlatformLabel(platforms, batchConnection)
    : 'marketplace';

  // Every seeded variant id, checked against the destination in one call.
  const allSeededVariantIds = useMemo(() => {
    const ids: string[] = [];
    for (const row of rows) {
      for (const variant of row.variants) ids.push(variant.variantId);
    }
    return ids;
  }, [rows]);

  const publishedVariantsQuery = usePublishedVariantsQuery(
    activeConnectionId || null,
    allSeededVariantIds,
  );
  const alreadyListedSet = publishedVariantsQuery.data ?? EMPTY_ALREADY_LISTED;

  // Included variants that are already published there - drives the guard gate.
  const duplicateIncludedCount = useMemo(() => {
    if (alreadyListedSet.size === 0) return 0;
    let n = 0;
    for (const row of rows) {
      for (const variant of row.variants) {
        if (variant.included && alreadyListedSet.has(variant.variantId)) n += 1;
      }
    }
    return n;
  }, [rows, alreadyListedSet]);

  const dupGuardKind = isShop ? 'shop' : 'marketplace';
  const dupGuardDestinationName = activeConnection?.name ?? marketplaceName;

  // Marketplace publish gate: a duplicate opens the soft confirm first, which on
  // confirm hands off to the existing submit-confirm modal.
  const handleApproveAll = useCallback(() => {
    if (duplicateIncludedCount > 0) {
      setDupGuardOpen(true);
      return;
    }
    setConfirmOpen(true);
  }, [duplicateIncludedCount]);

  // Shop publish gate: stash the built items, soft-confirm on a duplicate, else
  // publish straight away.
  const handleShopPublishRequested = useCallback(
    (items: BulkShopPublishItemRequest[], status: ShopPublishVisibility) => {
      if (duplicateIncludedCount > 0) {
        pendingShopPublishRef.current = { items, status };
        setDupGuardOpen(true);
        return;
      }
      void handleShopPublish(items, status);
    },
    [duplicateIncludedCount, handleShopPublish],
  );

  const handleDupGuardConfirm = useCallback(() => {
    setDupGuardOpen(false);
    if (isShop) {
      const pending = pendingShopPublishRef.current;
      pendingShopPublishRef.current = null;
      if (pending) void handleShopPublish(pending.items, pending.status);
    } else {
      setConfirmOpen(true);
    }
  }, [isShop, handleShopPublish]);

  const currentStepIndex = Math.max(
    0,
    wizardSteps.findIndex((s) => s.id === step),
  );
  const stepperCurrent = shopBatchId !== null ? wizardSteps.length : currentStepIndex;

  // #2227: name the destination in the heading, so even a screenshot cropped to
  // the top of the page identifies the batch. Only after Config - on Config the
  // destination is still being chosen, and the picker itself carries the name.
  // The action verb matches the step's primary button ("Create offers" /
  // "Publish"), so the flow keeps one vocabulary.
  const baseTitle = isShop ? 'Bulk shop product publishing' : 'Bulk marketplace offer creation';
  const pageTitle =
    step !== 'config' && activeConnection !== null
      ? `${isShop ? 'Publish products to' : 'Create offers on'} ${activeConnection.name}`
      : baseTitle;

  return (
    <PageLayout
      eyebrow="Operations · Listings"
      title={pageTitle}
      description={
        isShop
          ? `Publishing ${rows.length} ${rows.length === 1 ? 'product' : 'products'} · ${counts.totalVariants} variants to a shop.`
          : `Creating offers for ${rows.length} ${rows.length === 1 ? 'product' : 'products'} · ${counts.totalVariants} variants.`
      }
    >
      <div className="bulk-wizard">
        {/* #2227: every step but Config, which IS the destination form. Also
            not once a shop batch has submitted - `step` still reads 'review'
            there while the body is the publish tracker, and offering
            `Change destination` on an already-submitted batch is a false
            affordance. Post-submit identity is the tracker's + the batch
            progress page's job. */}
        {step !== 'config' && shopBatchId === null && activeConnection ? (
          <BulkDestinationBar
            connection={activeConnection}
            config={config}
            settingsOpen={destSettingsOpen}
            onToggleSettings={() => setDestSettingsOpen((open) => !open)}
            onChangeDestination={() => setChangeDestOpen(true)}
          />
        ) : null}

        <div className="bulk-wizard__stepper">
          <SetupStepper
            steps={wizardSteps.map((s) => s.label)}
            currentStep={stepperCurrent}
            completedSteps={new Set(Array.from({ length: stepperCurrent }, (_, i) => i))}
          />
        </div>

        {resumedFromBatchId !== undefined && resumedFromBatchId !== '' ? (
          <Alert tone="info">
            Resuming from batch <span className="mono-text">{resumedFromBatchId.slice(0, 8)}</span>
            {' - '}the variants that failed there are pre-selected. Offers already live
            are not included.
          </Alert>
        ) : null}

        {counts.noVariants > 0 ? (
          <Alert tone="warning">
            {counts.noVariants} of {rows.length} products have no variants and cannot be listed.
            They'll be skipped on submit.
          </Alert>
        ) : null}

        {shopBatchId !== null && config ? (
          <div className="bulk-wizard__body">
            <ShopPublishTracker connectionId={config.connectionId} batchId={shopBatchId} />
            <div className="bulk-wizard__footer">
              <div className="bulk-wizard__footer-spacer" />
              <Button tone="primary" onClick={() => { void navigate('/listings'); }}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className={step === 'resolve' ? '' : 'bulk-wizard__body'}>
            {step === 'config' && (
              <BulkConfigStep
                initial={config ?? {}}
                preselectedConnectionId={preselectedConnectionId}
                onConnectionChange={setLiveConnectionId}
                onProceed={handleConfigProceed}
                onCancel={() => { void navigate(-1); }}
              />
            )}
            {step === 'resolve' && config && !isShop && (
              <BulkResolveStep
                rows={rows}
                connectionId={config.connectionId}
                pricingPolicy={config.pricingPolicy}
                stockPolicy={config.stockPolicy}
                currency={config.currency}
                platformValidate={platformValidate}
                destinationResolvesCategoryAtSubmit={destinationResolvesCategoryFromManifest}
                onBack={() => {
                  setStep('config');
                }}
                onComplete={handleResolveComplete}
              />
            )}
            {step === 'review' && config && isShop && (
              <BulkShopReviewStep
                rows={rows}
                connection={activeConnection}
                config={config}
                demoReadOnly={write.demoReadOnly}
                isSubmitting={shopMutation.isPending}
                errorMessage={shopMutation.error ? shopMutation.error.message : null}
                alreadyListedVariantIds={alreadyListedSet}
                destinationName={dupGuardDestinationName}
                onSetVariantIncluded={setVariantIncluded}
                onSaveEditor={handleSaveEditor}
                onBack={() => { setStep('config'); }}
                onPublish={handleShopPublishRequested}
              />
            )}
            {step === 'review' && config && !isShop && (
              <BulkReviewStep
                rows={rows}
                connection={batchConnection}
                config={config}
                paramsResolving={paramsResolving}
                platformBlockerChips={platformBlockerChips}
                canBrowseCategories={destinationBrowsesCategories}
                batchDeliveryPriceList={
                  typeof config.platformParams.deliveryPriceList === 'string'
                    ? config.platformParams.deliveryPriceList
                    : ''
                }
                demoReadOnly={write.demoReadOnly}
                alreadyListedVariantIds={alreadyListedSet}
                destinationName={dupGuardDestinationName}
                onSetVariantIncluded={setVariantIncluded}
                onSetProductIncluded={setProductIncluded}
                onSaveEditor={handleSaveEditor}
                onApproveAll={handleApproveAll}
                onBack={() => { setStep('config'); }}
              />
            )}
          </div>
        )}

        {config && !isShop ? (
          <BulkConfirmModal
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            offerCount={counts.includedReady}
            productCount={counts.productsWithIncluded}
            excludedCount={counts.excluded}
            mixedPublishWarning={counts.mixedPublish}
            connectionName={resolveConnectionName(config.connectionId)}
            marketplaceName={marketplaceName}
            initialPublishImmediately={config.publishImmediately}
            isSubmitting={mutation.isPending}
            demoReadOnly={write.demoReadOnly}
            errorMessage={mutation.error ? mutation.error.message : null}
            onConfirm={(publishImmediately) => {
              void handleSubmit(publishImmediately);
            }}
          />
        ) : null}

        <ConfirmDialog
          open={changeDestOpen}
          onOpenChange={setChangeDestOpen}
          title="Change destination?"
          description={
            activeConnection
              ? `This batch has matched categories and row edits that only apply to ${activeConnection.name}. Going back to step 1 discards them.`
              : 'Going back to step 1 discards the matched categories and row edits for this batch.'
          }
          confirmLabel="Change destination"
          cancelLabel="Keep this batch"
          tone="danger"
          onConfirm={() => {
            setChangeDestOpen(false);
            setStep('config');
          }}
        />

        {config ? (
          <DuplicateGuardModal
            open={dupGuardOpen}
            onOpenChange={setDupGuardOpen}
            kind={dupGuardKind}
            destinationName={dupGuardDestinationName}
            duplicateCount={duplicateIncludedCount}
            onConfirm={handleDupGuardConfirm}
          />
        ) : null}
      </div>
    </PageLayout>
  );
}

/** Order-sensitive blocker-list equality. */
function sameBlockers(a: readonly BulkRowBlocker[], b: readonly BulkRowBlocker[]): boolean {
  return a.length === b.length && a.every((blocker, i) => blocker === b[i]);
}

function dedupById(products: Product[]): Product[] {
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const p of products) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * Apply a row transform then recompute every touched product's per-variant
 * blockers so inclusion/override edits keep the readiness gate honest.
 */
function reblockRows(
  rows: BulkWizardRow[],
  config: BulkWizardConfig,
  requiredByCategory: Map<string, readonly string[]>,
  platformValidate: ((input: OfferRowValidationInput) => string[]) | undefined,
  destinationResolvesCategoryAtSubmit: boolean,
  transform: (row: BulkWizardRow) => BulkWizardRow,
): BulkWizardRow[] {
  return rows.map((row) => {
    const next = transform(row);
    if (next === row) return row;
    const isMulti = next.variants.length > 1;
    return {
      ...next,
      variants: next.variants.map((variant) => ({
        ...variant,
        blockers: recomputeVariantBlockers(
          next,
          variant,
          config,
          requiredByCategory,
          platformValidate,
          destinationResolvesCategoryAtSubmit,
          isMulti,
        ),
      })),
    };
  });
}

/**
 * Assemble a variant's wire override from its edit override + policy-resolved
 * price/stock. `pricingPolicy` / `stockPolicy` are the ROW-effective policies
 * (the product's shared-base override wins over the batch default, #1741).
 */
/**
 * Drop the FE-only resolution inputs before an override goes on the wire
 * (#1934/F15).
 *
 * `pricingPolicy` / `stockPolicy` exist so the editor can express "this product
 * diverges from the batch policy"; the wizard resolves them into concrete
 * price/stock here. The API's per-override DTO declares only
 * `stock` / `publishImmediately` / `price` / `overrides` and validates each map
 * value with `forbidNonWhitelisted`, so leaving either field on the payload
 * rejects the WHOLE request with `property pricingPolicy should not exist` -
 * after the wizard has already shown the row as ready.
 */
function toWireOverride(override: BulkPerProductOverride): BulkPerProductOverride {
  // Built by allow-list rather than by omission, so a future FE-only field
  // added to `BulkPerProductOverride` cannot silently reach the wire and
  // reintroduce this class of whole-request rejection.
  const wire: BulkPerProductOverride = {};
  if (override.stock !== undefined) wire.stock = override.stock;
  if (override.publishImmediately !== undefined) {
    wire.publishImmediately = override.publishImmediately;
  }
  if (override.price !== undefined) wire.price = override.price;
  if (override.overrides !== undefined) wire.overrides = override.overrides;
  return wire;
}

function buildVariantOverride(
  variant: BulkVariantRow,
  config: BulkWizardConfig,
  pricingPolicy: PricingPolicy,
  stockPolicy: StockPolicy,
): BulkPerProductOverride {
  const price = computeResolvedPrice(pricingPolicy, variant.masterPrice, variant.override);
  const stock = computeResolvedStock(stockPolicy, variant.masterStock, variant.override);
  return toWireOverride({
    ...variant.override,
    stock: stock.value ?? undefined,
    price:
      variant.override.price ??
      (price.value !== null ? { amount: price.value, currency: config.currency } : undefined),
    overrides: {
      ...(variant.override.overrides ?? {}),
      // categoryId is grouping-determining + product-level; the BE strips it
      // from the per-variant map. Keep the resolved card so a self-linking
      // sibling still points at its own catalog product (#824).
      productCardId:
        variant.override.overrides?.productCardId ?? variant.resolvedProductCardId ?? undefined,
      ...(effectiveVariantEan(variant) ? { ean: effectiveVariantEan(variant)! } : {}),
    },
  });
}

interface BatchCounts {
  totalVariants: number;
  includedReady: number;
  includedNeedsAttention: number;
  excluded: number;
  noVariants: number;
  productsWithIncluded: number;
  mixedPublish: boolean;
}

function countBatch(rows: BulkWizardRow[]): BatchCounts {
  let totalVariants = 0;
  let includedReady = 0;
  let includedNeedsAttention = 0;
  let excluded = 0;
  let noVariants = 0;
  let productsWithIncluded = 0;
  let mixedPublish = false;

  for (const row of rows) {
    if (row.variants.length === 0) {
      noVariants += 1;
      continue;
    }
    let hasIncluded = false;
    let sawPublish = false;
    let sawDraft = false;
    for (const v of row.variants) {
      totalVariants += 1;
      if (!v.included) {
        excluded += 1;
        continue;
      }
      hasIncluded = true;
      if (v.blockers.length === 0) includedReady += 1;
      else includedNeedsAttention += 1;
      const publish = v.override.publishImmediately;
      if (publish === false) sawDraft = true;
      else sawPublish = true;
    }
    if (hasIncluded) productsWithIncluded += 1;
    if (sawPublish && sawDraft) mixedPublish = true;
  }

  return {
    totalVariants,
    includedReady,
    includedNeedsAttention,
    excluded,
    noVariants,
    productsWithIncluded,
    mixedPublish,
  };
}

/**
 * Merge resolve-step outcomes into the wizard's rows by product id, then by
 * variant id, preserving each variant's operator `override` + `editFormValues`
 * (re-resolve must not discard edits, plan §8).
 */
export function mergeResolveOutcomes(
  rows: BulkWizardRow[],
  outcomes: BulkResolveOutcome[],
): BulkWizardRow[] {
  const byId = new Map(outcomes.map((o) => [o.productId, o]));
  return rows.map((row) => {
    const o = byId.get(row.productId);
    if (!o) return row;
    const outcomeByVariant = new Map(o.variants.map((v) => [v.variantId, v]));
    const primaryOutcome = row.primaryVariant
      ? outcomeByVariant.get(row.primaryVariant.id)
      : undefined;
    return {
      ...row,
      blockers: primaryOutcome?.blockers ?? row.blockers,
      resolvedCategoryId: primaryOutcome?.resolvedCategoryId ?? row.resolvedCategoryId,
      masterPrice: primaryOutcome?.masterPrice ?? row.masterPrice,
      masterStock: primaryOutcome?.masterStock ?? row.masterStock,
      masterCurrency: primaryOutcome?.masterCurrency ?? row.masterCurrency,
      variants: row.variants.map((variant) => {
        const vo = outcomeByVariant.get(variant.variantId);
        if (!vo) return variant;
        return {
          ...variant,
          blockers: vo.blockers,
          resolvedCategoryId: vo.resolvedCategoryId,
          resolvedProductCardId: vo.resolvedProductCardId,
          resolutionMethod: vo.resolutionMethod,
          masterStock: vo.masterStock,
          masterPrice: vo.masterPrice,
          masterCurrency: vo.masterCurrency,
          categoryCandidates: vo.categoryCandidates,
          ean: vo.ean,
        };
      }),
    };
  });
}

export function seedRows(
  products: Product[],
  preSelectedVariantIds?: ReadonlySet<string>,
): BulkWizardRow[] {
  return dedupById(products).map((product) => seedRow(product, preSelectedVariantIds));
}

function seedVariantRow(
  variant: ProductVariant,
  product: Product,
  included: boolean,
): BulkVariantRow {
  const barcode = variant.ean ?? variant.gtin ?? null;
  return {
    variantId: variant.id,
    variant,
    ean: barcode && barcode.trim() !== '' ? barcode.trim() : null,
    distinguishingAttributes: variant.attributes,
    masterStock: null,
    masterPrice: variant.price,
    masterCurrency: product.currency ?? null,
    included,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    categoryCandidates: [],
    override: {},
  };
}

function seedRow(product: Product, preSelectedVariantIds?: ReadonlySet<string>): BulkWizardRow {
  const variants = product.variants ?? [];
  // A product is "variant-scoped" only when the picker checked SOME of its
  // variants (#1754). Whole-product picks (and the /products entry point) leave
  // the set empty for this product, so every variant seeds included.
  // Capture the set only when the product is variant-scoped (else null for a
  // whole-product pick), so the closure narrows without a non-null assertion.
  const scopedIds =
    preSelectedVariantIds !== undefined &&
    preSelectedVariantIds.size > 0 &&
    variants.some((v) => preSelectedVariantIds.has(v.id))
      ? preSelectedVariantIds
      : null;
  const isIncluded = (v: ProductVariant): boolean => scopedIds === null || scopedIds.has(v.id);
  // The primary is a representative for row-level resolve mapping - prefer the
  // first INCLUDED variant so a variant-scoped product represents a checked one.
  const primaryVariant: ProductVariant | null =
    variants.find(isIncluded) ?? variants[0] ?? null;
  return {
    productId: product.id,
    product,
    primaryVariant,
    variants: variants.map((v) => seedVariantRow(v, product, isIncluded(v))),
    blockers: primaryVariant ? [] : ['no-variant'],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: null,
    masterStock: null,
    masterCurrency: null,
    categoryCandidates: [],
    override: {},
  };
}
