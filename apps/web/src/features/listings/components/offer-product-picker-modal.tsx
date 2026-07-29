/**
 * OfferProductPickerModal
 *
 * Single entry point for offer creation on `/listings` (#1754). A wide,
 * two-region modal that lets the operator multi-select across products at two
 * granularities:
 *   - whole product (all variants), via a tri-state product checkbox, or
 *   - individual variants, via per-variant checkboxes revealed by expanding
 *     a product row (variants lazy-load on expand),
 * or any mix across many products - all resolved into one bulk batch.
 *
 * Layout (#1779 redesign): on desktop (>=1024px) a left list region (search +
 * product list + sticky pager) sits beside a right rail (~340px) that reviews
 * the running selection ("In this batch" counts + per-product groups with
 * status chips + per-item / per-product remove + "Clear all") and pins the
 * connection picker above Cancel / Continue. Below 1024px the same regions
 * become a two-step wizard (step 1 = list, step 2 = review) driven by a
 * `data-mstep` attribute; below 600px the modal is a full-screen sheet.
 *
 * Selection persists across pagination and search changes, keyed by product
 * id to `'ALL'` (whole product) or a `Set<variantId>` (explicit subset).
 *
 * Destination resolution happens inside the modal (R1 - the picker never
 * imports from `pages/`): active connections that are either an offer
 * marketplace (`OfferCreator`) or an online shop (`ProductPublisher`) are
 * eligible (#1828). The right rail groups them by kind (Marketplaces /
 * Online shops) with a capability-driven hint - never a `platformType`
 * literal - as a single-select radio list. Exactly one destination
 * auto-resolves; none renders a warning.
 *
 * Closing via X / Cancel / esc / outside-click is routed through a discard
 * guard: a pending selection opens a `ConfirmDialog` before the modal closes.
 *
 * Continue navigates into the bulk wizard route for BOTH destination kinds
 * (`/listings/bulk-create/wizard?productIds=...&variantIds=...&connectionId=...`,
 * #1829): the wizard branches on the destination's capability - a marketplace
 * (`OfferCreator`) runs Config -> Resolve -> Review, a shop (`ProductPublisher`)
 * runs Config -> Review. Products picked whole contribute no `variantIds` (the
 * wizard then seeds all their variants), products picked at variant granularity
 * contribute their explicit subset.
 *
 * Split (#1819) into this orchestrator + `offer-product-picker-row.tsx` (the
 * per-product / per-variant list rows) + `offer-product-picker-rail.tsx` (the
 * selection review rail) + pure derivation helpers in
 * `../lib/offer-product-picker-selectors.ts` and
 * `../lib/publish-destinations.ts`. This file owns all state, queries, and
 * callbacks; the two sub-components are presentational.
 *
 * @module apps/web/src/features/listings/components
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { Input } from '../../../shared/ui/input';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { useConnectionsQuery } from '../../connections';
import { useProductsQuery } from '../../products';
import type { Product, ProductVariant } from '../../products';
import {
  computeItemCount,
  computeNeedEanCount,
  computeRailGroups,
} from '../lib/offer-product-picker-selectors';
import { resolvePublishDestination, selectPublishDestinations } from '../lib/publish-destinations';
import { OfferProductPickerRail } from './offer-product-picker-rail';
import { OfferProductPickerRow } from './offer-product-picker-row';
import {
  OFFER_PICKER_PRODUCT_CAP,
  type PickerStep,
  type SelectionEntry,
} from './offer-product-picker.types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

interface OfferProductPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Whole-product ids to preselect on open (#1838 unification: the Products
   * page's bulk-select CTA feeds its checkbox selection in here instead of
   * opening a separate destination-only picker). Optional — omit for a
   * fresh, empty selection.
   */
  initialProductIds?: readonly string[];
  /** Product objects for `initialProductIds`, so the rail can render names/images immediately without waiting on this picker's own paginated query to reach them. */
  initialProductMeta?: readonly Product[];
}

export function OfferProductPickerModal({
  isOpen,
  onClose,
  initialProductIds,
  initialProductMeta,
}: OfferProductPickerModalProps): ReactElement | null {
  const navigate = useNavigate();

  const [searchInput, setSearchInput] = useState('');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Map<string, SelectionEntry>>(new Map());
  const [variantCounts, setVariantCounts] = useState<Map<string, number>>(new Map());
  const [pickedConnectionId, setPickedConnectionId] = useState<string>('');
  const [step, setStep] = useState<PickerStep>('products');
  const [discardOpen, setDiscardOpen] = useState(false);
  // Accumulated product / variant metadata for the rail review, so a product
  // selected then paged away still renders its name, image, and variant labels.
  const [productMeta, setProductMeta] = useState<Map<string, Product>>(new Map());
  const [variantMeta, setVariantMeta] = useState<Map<string, ProductVariant[]>>(new Map());

  // Focus targets for the two-step wizard (<=1023px): moving focus on step
  // change keeps keyboard / screen-reader users oriented.
  const searchInputRef = useRef<HTMLInputElement>(null);
  const railBackRef = useRef<HTMLButtonElement>(null);

  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  // Fresh state on every open - a reopened dialog starts empty, matching the
  // retired launcher's close-reset behaviour.
  useEffect(() => {
    if (!isOpen) {
      setSearchInput('');
      setOffset(0);
      setExpanded(new Set());
      setSelection(new Map());
      setVariantCounts(new Map());
      setPickedConnectionId('');
      setStep('products');
      setDiscardOpen(false);
      setProductMeta(new Map());
      setVariantMeta(new Map());
    }
  }, [isOpen]);

  // Seed a preselected whole-product set on open (#1838) - the Products page
  // bulk-select CTA hands its checkbox selection in here instead of opening a
  // separate destination-only picker, so the operator sees the same product
  // list + rail they'd get from /listings, with their picks already checked.
  useEffect(() => {
    if (!isOpen || !initialProductIds || initialProductIds.length === 0) return;
    setSelection((prev) => {
      if (prev.size > 0) return prev;
      const next = new Map(prev);
      for (const id of initialProductIds) next.set(id, 'ALL');
      return next;
    });
    if (initialProductMeta && initialProductMeta.length > 0) {
      setProductMeta((prev) => {
        const next = new Map(prev);
        for (const p of initialProductMeta) next.set(p.id, p);
        return next;
      });
    }
  }, [isOpen, initialProductIds, initialProductMeta]);

  const connectionsQuery = useConnectionsQuery();
  // Both destination kinds are eligible - Continue routes each into the bulk
  // wizard, which branches by capability (#1829).
  const eligibleDestinations = useMemo(
    () => selectPublishDestinations(connectionsQuery.data ?? []),
    [connectionsQuery.data],
  );

  // Auto-resolve when exactly one eligible destination exists; otherwise the
  // operator picks one from the grouped rail (or gets a warning when none exist).
  const { resolvedConnectionId, resolvedKind } = resolvePublishDestination(
    eligibleDestinations,
    pickedConnectionId,
  );

  const productsQuery = useProductsQuery(
    { search: debouncedSearch || undefined },
    { limit: PAGE_SIZE, offset },
  );
  const productItems = productsQuery.data?.items;
  const products = useMemo(() => productItems ?? [], [productItems]);
  const total = productsQuery.data?.total ?? 0;

  // Accumulate metadata for every product the operator has seen.
  useEffect(() => {
    if (!productItems || productItems.length === 0) return;
    setProductMeta((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const p of productItems) {
        if (!next.has(p.id)) {
          next.set(p.id, p);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [productItems]);

  const capReached = selection.size >= OFFER_PICKER_PRODUCT_CAP;

  const toggleExpand = useCallback((productId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }, []);

  const selectAllProduct = useCallback((productId: string, variantCount?: number) => {
    setSelection((prev) => {
      const next = new Map(prev);
      next.set(productId, 'ALL');
      return next;
    });
    // Seed the item-count total with the product's known variant count so the
    // selection bar is accurate for a whole product picked without expanding
    // it (expansion later overwrites this with the exact loaded count).
    if (typeof variantCount === 'number') {
      setVariantCounts((prev) => {
        if (prev.get(productId) === variantCount) return prev;
        const next = new Map(prev);
        next.set(productId, variantCount);
        return next;
      });
    }
  }, []);

  const clearProduct = useCallback((productId: string) => {
    setSelection((prev) => {
      const next = new Map(prev);
      next.delete(productId);
      return next;
    });
  }, []);

  const toggleVariant = useCallback(
    (productId: string, variantId: string, loadedVariantIds: string[]) => {
      setSelection((prev) => {
        const next = new Map(prev);
        const entry = next.get(productId);
        // Materialize 'ALL' into an explicit set (all loaded selected) before
        // toggling; an absent entry starts empty.
        const set =
          entry === 'ALL'
            ? new Set(loadedVariantIds)
            : entry instanceof Set
              ? new Set(entry)
              : new Set<string>();
        if (set.has(variantId)) set.delete(variantId);
        else set.add(variantId);
        if (set.size === 0) next.delete(productId);
        else next.set(productId, set);
        return next;
      });
    },
    [],
  );

  const reportVariantsLoaded = useCallback((productId: string, variants: ProductVariant[]) => {
    setVariantCounts((prev) => {
      if (prev.get(productId) === variants.length) return prev;
      const next = new Map(prev);
      next.set(productId, variants.length);
      return next;
    });
    setVariantMeta((prev) => {
      // Guard against re-storing an unchanged list: the source `variants` ref
      // is not stable across renders (react-query), so an unconditional write
      // would loop the reporting effect. Compare by variant ids.
      const existing = prev.get(productId);
      if (
        existing &&
        existing.length === variants.length &&
        existing.every((v, i) => v.id === variants[i]!.id)
      ) {
        return prev;
      }
      const next = new Map(prev);
      next.set(productId, variants);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(new Map());
  }, []);

  // Remove a single selected variant from the rail; looks up this product's
  // loaded variant ids so `toggleVariant` can materialize an 'ALL' entry
  // before removing, same as toggling from the product row.
  const removeVariant = useCallback(
    (productId: string, variantId: string) => {
      toggleVariant(
        productId,
        variantId,
        (variantMeta.get(productId) ?? []).map((v) => v.id),
      );
    },
    [toggleVariant, variantMeta],
  );

  // Item total across products: an explicit set counts its size; a whole
  // product counts its known variant count (loaded count, else the list
  // query's own variantCount, else 1 for a genuinely-unknown product).
  const itemCount = useMemo(
    () => computeItemCount(selection, variantCounts, productMeta),
    [selection, variantCounts, productMeta],
  );

  // Per-product rail rows, derived from the selection + accumulated metadata.
  const railGroups = useMemo(
    () => computeRailGroups(selection, productMeta, variantMeta, variantCounts),
    [selection, productMeta, variantMeta, variantCounts],
  );

  // Selected variants (across groups) whose barcode is missing, best-effort
  // from loaded metadata. Whole-product picks contribute their known variants.
  const needEanCount = useMemo(
    () => computeNeedEanCount(railGroups, variantMeta),
    [railGroups, variantMeta],
  );

  const handleContinue = useCallback(() => {
    if (selection.size === 0 || resolvedConnectionId === null) return;
    const productIds: string[] = [];
    // Explicit variant-subset picks contribute their ids; whole-product picks
    // contribute none, so the wizard seeds all their variants (#1829 - same
    // semantics for marketplace and shop destinations).
    const variantIds: string[] = [];
    for (const [productId, entry] of selection) {
      productIds.push(productId);
      if (entry instanceof Set) {
        for (const variantId of entry) variantIds.push(variantId);
      }
    }

    const params = new URLSearchParams({ productIds: productIds.join(',') });
    if (variantIds.length > 0) params.set('variantIds', variantIds.join(','));
    params.set('connectionId', resolvedConnectionId);
    void navigate(`/listings/bulk-create/wizard?${params.toString()}`);
  }, [selection, resolvedConnectionId, navigate]);

  // Discard guard: a pending selection intercepts every close path (X, Cancel,
  // esc, outside-click) with a confirm; an empty selection closes directly.
  const requestClose = useCallback(() => {
    if (selection.size > 0) setDiscardOpen(true);
    else onClose();
  }, [selection.size, onClose]);

  // Move focus to the region that just became active on a wizard step change
  // (only meaningful <=1023px; on desktop `step` stays 'products'). Runs after
  // the DOM updates so the focus target is present.
  useEffect(() => {
    if (!isOpen) return;
    if (step === 'review') railBackRef.current?.focus();
    else searchInputRef.current?.focus();
  }, [step, isOpen]);

  if (!isOpen) return null;

  const pageEnd = Math.min(offset + PAGE_SIZE, total);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const canContinue = selection.size > 0 && resolvedConnectionId !== null;
  const itemNoun = resolvedKind === 'shop' ? 'product listing' : 'offer';
  const selectionSummary = `${itemCount} ${itemCount === 1 ? itemNoun : `${itemNoun}s`} selected across ${
    selection.size
  } ${selection.size === 1 ? 'product' : 'products'}`;

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent
          className="offer-product-picker"
          data-mstep={step === 'products' ? '1' : '2'}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            requestClose();
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
            requestClose();
          }}
        >
          <button
            type="button"
            className="offer-product-picker__x"
            aria-label="Close"
            onClick={requestClose}
          >
            ×
          </button>

          <span className="sr-only" aria-live="polite">
            {step === 'review'
              ? 'Step 2 of 2: review your selection'
              : 'Step 1 of 2: choose products'}
          </span>

          <header className="offer-product-picker__head">
            <DialogTitle className="offer-product-picker__title">Publish products</DialogTitle>
            <DialogDescription className="offer-product-picker__sub">
              Pick whole products or individual variants, mix across products, then choose a
              marketplace or shop to publish to - it all becomes one batch.
            </DialogDescription>
          </header>

          <div className="offer-product-picker__body">
            <section className="offer-product-picker__list-region" aria-label="Product picker">
              <div className="offer-product-picker__search">
                <Input
                  ref={searchInputRef}
                  value={searchInput}
                  onChange={(e) => {
                    setSearchInput(e.target.value);
                    // Reset offset synchronously so the next debounced query
                    // lands on page 1 rather than a now-empty page.
                    setOffset(0);
                  }}
                  placeholder="Search by name, SKU or EAN"
                  aria-label="Search products"
                />
                <p className="offer-product-picker__hint">
                  Tick a product to add every variant, or expand it to choose specific ones.
                </p>
              </div>

              <div className="offer-product-picker__list">
                {productsQuery.isLoading ? (
                  <p className="muted-text">Loading products…</p>
                ) : productsQuery.error ? (
                  <Alert
                    tone="error"
                    title="Unable to load products"
                    action={
                      <Button
                        tone="secondary"
                        type="button"
                        onClick={() => void productsQuery.refetch()}
                      >
                        Retry
                      </Button>
                    }
                  >
                    {productsQuery.error.message}
                  </Alert>
                ) : products.length === 0 ? (
                  <p className="muted-text">
                    {debouncedSearch.trim()
                      ? `No products match "${debouncedSearch.trim()}".`
                      : 'No products yet.'}
                  </p>
                ) : (
                  <ul className="offer-product-picker__prows">
                    {products.map((product) => (
                      <OfferProductPickerRow
                        key={product.id}
                        product={product}
                        isExpanded={expanded.has(product.id)}
                        entry={selection.get(product.id)}
                        capBlocked={capReached && !selection.has(product.id)}
                        onToggleExpand={() => toggleExpand(product.id)}
                        onSelectAll={() => selectAllProduct(product.id, product.variantCount)}
                        onClear={() => clearProduct(product.id)}
                        onToggleVariant={(variantId, loadedVariantIds) =>
                          toggleVariant(product.id, variantId, loadedVariantIds)
                        }
                        onVariantsLoaded={(variants) => reportVariantsLoaded(product.id, variants)}
                      />
                    ))}
                  </ul>
                )}

                {capReached ? (
                  <p className="muted-text offer-product-picker__cap-hint" aria-live="polite">
                    Maximum {OFFER_PICKER_PRODUCT_CAP} products per batch reached - clear a product
                    to add another.
                  </p>
                ) : null}
              </div>

              {total > 0 ? (
                <div className="offer-product-picker__pager">
                  <span className="offer-product-picker__pager-count tabular">
                    {offset + 1}–{pageEnd} of {total}
                  </span>
                  <div className="offer-product-picker__pager-nav">
                    <Button
                      tone="secondary"
                      type="button"
                      className="button--sm"
                      aria-label="Previous page of products"
                      disabled={offset === 0}
                      onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                    >
                      Previous
                    </Button>
                    <span className="offer-product-picker__pager-page tabular">
                      {currentPage} / {pageCount}
                    </span>
                    <Button
                      tone="secondary"
                      type="button"
                      className="button--sm"
                      aria-label="Next page of products"
                      disabled={offset + PAGE_SIZE >= total}
                      onClick={() => setOffset((o) => o + PAGE_SIZE)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}

              {/* Step-1 action bar - visible only on the <=1023px two-step layout. */}
              <div className="offer-product-picker__mstep-next">
                <span className="offer-product-picker__mstep-count">
                  <b>{itemCount}</b> {itemCount === 1 ? itemNoun : `${itemNoun}s`} · {selection.size}{' '}
                  {selection.size === 1 ? 'product' : 'products'}
                </span>
                <Button type="button" onClick={() => setStep('review')}>
                  Review →
                </Button>
              </div>
            </section>

            <OfferProductPickerRail
              railBackRef={railBackRef}
              onBack={() => setStep('products')}
              railGroups={railGroups}
              itemCount={itemCount}
              needEanCount={needEanCount}
              selectionSize={selection.size}
              onClearSelection={clearSelection}
              onRemoveProduct={clearProduct}
              onRemoveVariant={removeVariant}
              connectionsLoading={connectionsQuery.isLoading}
              connectionsError={connectionsQuery.error}
              onRetryConnections={() => void connectionsQuery.refetch()}
              eligibleDestinations={eligibleDestinations}
              resolvedConnectionId={resolvedConnectionId}
              resolvedKind={resolvedKind}
              onSelectConnection={setPickedConnectionId}
              canContinue={canContinue}
              onContinue={handleContinue}
              onCancel={requestClose}
              selectionSummary={selectionSummary}
            />
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        className="dialog__content--elevated"
        overlayClassName="dialog__overlay--elevated"
        title="Discard changes?"
        description="You have unsaved product selections. Closing now will discard them."
        cancelLabel="Keep editing"
        confirmLabel="Discard changes"
        tone="danger"
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
      />
    </>
  );
}
