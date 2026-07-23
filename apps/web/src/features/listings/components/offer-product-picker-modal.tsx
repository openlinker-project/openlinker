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
 * Connection resolution happens inside the modal (R1 - the picker never
 * imports from `pages/`): active connections advertising the `OfferCreator`
 * sub-capability are eligible; exactly one auto-resolves, several render a
 * `<Select>`, none renders a warning.
 *
 * Closing via X / Cancel / esc / outside-click is routed through a discard
 * guard: a pending selection opens a `ConfirmDialog` before the modal closes.
 *
 * Continue navigates into the bulk wizard route
 * (`/listings/bulk-create/wizard?productIds=...&variantIds=...&connectionId=...`).
 * Products picked whole contribute no `variantIds` (the wizard then seeds all
 * their variants); products picked at variant granularity contribute their
 * explicit subset. Absent `variantIds` keeps the `/products` entry point
 * byte-identical.
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
import { CheckboxCell } from '../../../shared/ui/checkbox-cell';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { Input } from '../../../shared/ui/input';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { Select } from '../../../shared/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../shared/ui/tooltip';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { useConnectionsQuery } from '../../connections';
import type { Connection } from '../../connections';
import { useProductQuery, useProductsQuery } from '../../products';
import type { Product, ProductVariant } from '../../products';

/** Max distinct products per batch (mirrors the `/products` BULK_SELECTION_CAP,
 *  kept local per R1 to avoid a `features -> pages` import). */
const OFFER_PICKER_PRODUCT_CAP = 100;
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

/** Per-product selection: whole product, or an explicit variant subset. */
type SelectionEntry = 'ALL' | Set<string>;

/** Two-step wizard step (meaningful only <=1023px; desktop shows both regions). */
type PickerStep = 'products' | 'review';

interface OfferProductPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Marketplace connections eligible for offer creation. Filters by the
 * `OfferCreator` sub-capability (#1498) and active status, sorted by name.
 * Mirrors the retired launcher's `selectMarketplaceConnections`.
 */
function selectOfferCreatorConnections(all: ReadonlyArray<Connection>): Connection[] {
  return all
    .filter((c) => c.status === 'active' && c.supportedCapabilities.includes('OfferCreator'))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

function variantLabel(product: Product, variant: ProductVariant): string {
  const attrs = variant.attributes ? Object.values(variant.attributes).join(' · ') : '';
  if (attrs) return `${product.name} - ${attrs}`;
  if (variant.sku) return `${product.name} - ${variant.sku}`;
  return product.name;
}

/** Short, product-name-free label for the rail review (attrs, else SKU, else id). */
function variantShortLabel(variant: ProductVariant): string {
  const attrs = variant.attributes ? Object.values(variant.attributes).join(' · ') : '';
  return attrs || variant.sku || variant.id;
}

/** Whether a variant carries a barcode (EAN or GTIN). */
function variantHasBarcode(variant: ProductVariant): boolean {
  return (variant.ean ?? variant.gtin ?? '').trim() !== '';
}

function firstImage(images: string[] | null | undefined): string | null {
  return images && images.length > 0 ? images[0] : null;
}

/**
 * One product row. Lazily loads its variants when expanded (passing an empty
 * id keeps `useProductQuery` disabled until then). Computes its own tri-state
 * and reports its loaded variants up so the parent can total items across
 * products and render the selection rail even after paging away.
 */
interface PickerProductRowProps {
  product: Product;
  isExpanded: boolean;
  entry: SelectionEntry | undefined;
  capBlocked: boolean;
  onToggleExpand: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onToggleVariant: (variantId: string, loadedVariantIds: string[]) => void;
  onVariantsLoaded: (variants: ProductVariant[]) => void;
}

function PickerProductRow({
  product,
  isExpanded,
  entry,
  capBlocked,
  onToggleExpand,
  onSelectAll,
  onClear,
  onToggleVariant,
  onVariantsLoaded,
}: PickerProductRowProps): ReactElement {
  const detailQuery = useProductQuery(isExpanded ? product.id : '');
  const loadedVariants = useMemo(
    () => detailQuery.data?.variants ?? [],
    [detailQuery.data],
  );
  const loadedVariantIds = useMemo(() => loadedVariants.map((v) => v.id), [loadedVariants]);

  // Report loaded variants up for the item-count total + rail review.
  useEffect(() => {
    if (isExpanded && detailQuery.data) {
      onVariantsLoaded(loadedVariants);
    }
  }, [isExpanded, detailQuery.data, loadedVariants, onVariantsLoaded]);

  const selectedVariantIds = entry instanceof Set ? entry : null;
  const allLoadedSelected =
    loadedVariantIds.length > 0 &&
    selectedVariantIds !== null &&
    loadedVariantIds.every((id) => selectedVariantIds.has(id));

  const checkboxState: 'all' | 'some' | 'none' =
    entry === 'ALL' || allLoadedSelected
      ? 'all'
      : selectedVariantIds !== null && selectedVariantIds.size > 0
        ? 'some'
        : 'none';

  const handleToggleProduct = (): void => {
    if (checkboxState === 'all') onClear();
    else onSelectAll();
  };

  const variantCount = product.variantCount;
  const isSimple = typeof variantCount === 'number' && variantCount <= 1;
  const rowClasses = [
    'offer-product-picker__prow',
    isExpanded ? 'offer-product-picker__prow--open' : '',
    isSimple ? 'offer-product-picker__prow--simple' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={rowClasses}>
      <div className="offer-product-picker__prow-main">
        {/* Full 44px hit area for whole-product selection so it matches the
            variant rows' tap target on mobile (a bare checkbox is ~16px). The
            wrapping label toggles the nested checkbox natively. */}
        <label className="offer-product-picker__prow-check">
          <CheckboxCell
            state={checkboxState}
            onToggle={handleToggleProduct}
            disabled={capBlocked}
            ariaLabel={`Select ${product.name}`}
            tooltip={
              capBlocked
                ? `Maximum ${OFFER_PICKER_PRODUCT_CAP} products per batch reached`
                : undefined
            }
          />
        </label>
        <button
          type="button"
          className="offer-product-picker__prow-toggle"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${product.name}`}
        >
          <ProductThumbnail name={product.name} src={firstImage(product.images)} size="md" />
          <span className="offer-product-picker__pname">
            <b>{product.name}</b>
            <small className="mono-text">{product.sku ?? '—'}</small>
          </span>
          {typeof variantCount === 'number' ? (
            <span
              className={`offer-product-picker__vcount${
                isSimple ? ' offer-product-picker__vcount--simple' : ''
              }`}
            >
              {variantCount} {variantCount === 1 ? 'variant' : 'variants'}
            </span>
          ) : null}
          <span className="offer-product-picker__chev" aria-hidden="true">
            ▸
          </span>
        </button>
      </div>

      {isExpanded ? (
        <ul className="offer-product-picker__vrows">
          {detailQuery.isLoading ? (
            <li className="muted-text">Loading variants…</li>
          ) : detailQuery.error ? (
            <li>
              <Alert
                tone="error"
                title="Unable to load variants"
                action={
                  <Button
                    tone="secondary"
                    type="button"
                    onClick={() => void detailQuery.refetch()}
                  >
                    Retry
                  </Button>
                }
              >
                {detailQuery.error.message}
              </Alert>
            </li>
          ) : loadedVariants.length === 0 ? (
            <li className="muted-text">No variants on this product.</li>
          ) : (
            loadedVariants.map((variant) => {
              const picked = entry === 'ALL' || (selectedVariantIds?.has(variant.id) ?? false);
              const hasBarcode = variantHasBarcode(variant);
              return (
                <li key={variant.id}>
                  <label
                    className={`offer-product-picker__vrow${picked ? ' offer-product-picker__vrow--picked' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={picked}
                      disabled={capBlocked}
                      onChange={() => onToggleVariant(variant.id, loadedVariantIds)}
                    />
                    <ProductThumbnail
                      name={variantShortLabel(variant)}
                      src={null}
                      size="sm"
                    />
                    <span className="offer-product-picker__vname">
                      <b>{variantLabel(detailQuery.data ?? product, variant)}</b>
                      <small className={`mono-text${hasBarcode ? '' : ' offer-product-picker__vname-bad'}`}>
                        SKU {variant.sku ?? '—'} · {hasBarcode ? `EAN ${variant.ean ?? variant.gtin ?? '—'}` : 'no EAN'}
                      </small>
                    </span>
                  </label>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </li>
  );
}

/** Derived per-product row for the selection rail. */
interface RailGroup {
  productId: string;
  name: string;
  imageSrc: string | null;
  whole: boolean;
  totalVariants: number;
  /**
   * Barcode readiness for a whole-product pick, derived from loaded variant
   * metadata; `null` for a subset pick (which shows per-variant chips instead).
   * `loaded: false` means the product's variants have not been fetched yet, so
   * the chip must read "not checked" rather than a confident "ready".
   */
  wholeEan: { loaded: boolean; needCount: number } | null;
  /** Selected variants for a subset pick; `null` for a whole-product pick. */
  selected: { id: string; label: string; hasBarcode: boolean }[] | null;
}

export function OfferProductPickerModal({
  isOpen,
  onClose,
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

  const connectionsQuery = useConnectionsQuery();
  const eligibleConnections = useMemo(
    () => selectOfferCreatorConnections(connectionsQuery.data ?? []),
    [connectionsQuery.data],
  );

  // Auto-resolve when exactly one eligible connection exists; otherwise the
  // operator picks from the `<Select>` (or gets a warning when none exist).
  const resolvedConnectionId =
    eligibleConnections.length === 1
      ? eligibleConnections[0]!.id
      : pickedConnectionId || null;

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

  // Item total across products: an explicit set counts its size; a whole
  // product counts its known variant count, else 1.
  const itemCount = useMemo(() => {
    let sum = 0;
    for (const [productId, entry] of selection) {
      if (entry instanceof Set) sum += entry.size;
      else sum += variantCounts.get(productId) ?? 1;
    }
    return sum;
  }, [selection, variantCounts]);

  // Per-product rail rows, derived from the selection + accumulated metadata.
  const railGroups = useMemo<RailGroup[]>(() => {
    const groups: RailGroup[] = [];
    for (const [productId, entry] of selection) {
      const meta = productMeta.get(productId);
      const variants = variantMeta.get(productId) ?? meta?.variants ?? [];
      const totalVariants =
        variantCounts.get(productId) ?? meta?.variantCount ?? (variants.length || 1);
      if (entry === 'ALL') {
        const loadedVariants = variantMeta.get(productId);
        const wholeEan = loadedVariants
          ? {
              loaded: true,
              needCount: loadedVariants.filter((v) => !variantHasBarcode(v)).length,
            }
          : { loaded: false, needCount: 0 };
        groups.push({
          productId,
          name: meta?.name ?? productId,
          imageSrc: firstImage(meta?.images),
          whole: true,
          totalVariants,
          wholeEan,
          selected: null,
        });
        continue;
      }
      const selected = [...entry].map((variantId) => {
        const variant = variants.find((v) => v.id === variantId);
        return {
          id: variantId,
          label: variant ? variantShortLabel(variant) : variantId,
          hasBarcode: variant ? variantHasBarcode(variant) : true,
        };
      });
      groups.push({
        productId,
        name: meta?.name ?? productId,
        imageSrc: firstImage(meta?.images),
        whole: false,
        totalVariants,
        wholeEan: null,
        selected,
      });
    }
    return groups;
  }, [selection, productMeta, variantMeta, variantCounts]);

  // Selected variants (across groups) whose barcode is missing, best-effort
  // from loaded metadata. Whole-product picks contribute their known variants.
  const needEanCount = useMemo(() => {
    let sum = 0;
    for (const group of railGroups) {
      if (group.selected === null) {
        const variants = variantMeta.get(group.productId) ?? [];
        sum += variants.filter((v) => !variantHasBarcode(v)).length;
      } else {
        sum += group.selected.filter((s) => !s.hasBarcode).length;
      }
    }
    return sum;
  }, [railGroups, variantMeta]);

  const handleContinue = useCallback(() => {
    if (selection.size === 0 || resolvedConnectionId === null) return;
    const productIds: string[] = [];
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
  const selectionSummary = `${itemCount} ${itemCount === 1 ? 'offer' : 'offers'} selected across ${
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
            <DialogTitle className="offer-product-picker__title">Create offers</DialogTitle>
            <DialogDescription className="offer-product-picker__sub">
              Pick whole products or individual variants, mix across products - it all becomes one
              batch.
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
                      <PickerProductRow
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
                  <b>{itemCount}</b> {itemCount === 1 ? 'offer' : 'offers'} · {selection.size}{' '}
                  {selection.size === 1 ? 'product' : 'products'}
                </span>
                <Button type="button" onClick={() => setStep('review')}>
                  Review →
                </Button>
              </div>
            </section>

            <aside className="offer-product-picker__rail" aria-label="Selection">
              <div className="offer-product-picker__rail-head">
                <button
                  ref={railBackRef}
                  type="button"
                  className="offer-product-picker__rail-back"
                  aria-label="Back to products"
                  onClick={() => setStep('products')}
                >
                  ‹
                </button>
                <div className="offer-product-picker__rail-titlebar">
                  <span className="offer-product-picker__rail-title">In this batch</span>
                  <Button
                    tone="ghost"
                    type="button"
                    className="button--sm"
                    disabled={selection.size === 0}
                    onClick={clearSelection}
                  >
                    Clear all
                  </Button>
                </div>
              </div>

              <div className="offer-product-picker__rail-counts">
                <div>
                  <span className="offer-product-picker__rail-n tabular">{itemCount}</span>
                  <span className="offer-product-picker__rail-lbl">offers</span>
                </div>
                <div>
                  <span className="offer-product-picker__rail-n tabular">{selection.size}</span>
                  <span className="offer-product-picker__rail-lbl">products</span>
                </div>
                <div>
                  <span className="offer-product-picker__rail-n offer-product-picker__rail-n--warn tabular">
                    {needEanCount}
                  </span>
                  <span className="offer-product-picker__rail-lbl">need EAN</span>
                </div>
              </div>

              <div className="offer-product-picker__rail-body">
                {railGroups.length === 0 ? (
                  <p className="offer-product-picker__rail-empty">
                    Nothing selected yet. Tick products or variants on the left.
                  </p>
                ) : (
                  railGroups.map((group) => {
                    const isPartial =
                      group.selected !== null && group.selected.length < group.totalVariants;
                    return (
                      <div className="offer-product-picker__selgrp" key={group.productId}>
                        <div className="offer-product-picker__selgrp-head">
                          <ProductThumbnail
                            name={group.name}
                            src={group.imageSrc}
                            size="sm"
                          />
                          <b>{group.name}</b>
                          {group.whole ? (
                            group.wholeEan && !group.wholeEan.loaded ? (
                              <span className="bulk-chip bulk-chip--neutral">
                                <span className="bulk-chip__dot" />
                                not checked
                              </span>
                            ) : group.wholeEan && group.wholeEan.needCount > 0 ? (
                              <span className="bulk-chip bulk-chip--warning">
                                <span className="bulk-chip__dot" />
                                {group.wholeEan.needCount} need EAN
                              </span>
                            ) : (
                              <span className="bulk-chip bulk-chip--success">
                                <span className="bulk-chip__dot" />
                                ready
                              </span>
                            )
                          ) : isPartial ? (
                            <span className="bulk-chip bulk-chip--warning">
                              <span className="bulk-chip__dot" />
                              {group.selected!.length} of {group.totalVariants}
                            </span>
                          ) : (
                            <span className="bulk-chip bulk-chip--success">
                              <span className="bulk-chip__dot" />
                              ready
                            </span>
                          )}
                          <button
                            type="button"
                            className="offer-product-picker__rm"
                            aria-label={`Remove ${group.name}`}
                            onClick={() => clearProduct(group.productId)}
                          >
                            ×
                          </button>
                        </div>
                        {group.whole ? (
                          <div className="offer-product-picker__seltag offer-product-picker__seltag--muted">
                            <span className="offer-product-picker__seltag-dot" />
                            Whole product · {group.totalVariants}{' '}
                            {group.totalVariants === 1 ? 'variant' : 'variants'}
                          </div>
                        ) : (
                          group.selected!.map((variant) => (
                            <div className="offer-product-picker__seltag" key={variant.id}>
                              <span className="offer-product-picker__seltag-dot" />
                              {variant.label}
                              {variant.hasBarcode ? null : (
                                <span className="bulk-chip bulk-chip--warning">
                                  <span className="bulk-chip__dot" />
                                  no EAN
                                </span>
                              )}
                              <button
                                type="button"
                                className="offer-product-picker__rm offer-product-picker__rm--tag"
                                aria-label={`Remove ${variant.label}`}
                                onClick={() =>
                                  toggleVariant(
                                    group.productId,
                                    variant.id,
                                    (variantMeta.get(group.productId) ?? []).map((v) => v.id),
                                  )
                                }
                              >
                                ×
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="offer-product-picker__rail-foot">
                {connectionsQuery.isLoading ? (
                  <p className="muted-text">Loading marketplace connections…</p>
                ) : connectionsQuery.error ? (
                  <Alert
                    tone="error"
                    title="Unable to load connections"
                    action={
                      <Button
                        tone="secondary"
                        type="button"
                        onClick={() => void connectionsQuery.refetch()}
                      >
                        Retry
                      </Button>
                    }
                  >
                    {connectionsQuery.error.message}
                  </Alert>
                ) : eligibleConnections.length === 0 ? (
                  <Alert tone="warning" title="No marketplace connections available">
                    Add an active connection that supports offer creation before publishing offers.
                  </Alert>
                ) : (
                  <div className="offer-product-picker__rail-conn">
                    <label className="offer-product-picker__eyebrow" htmlFor="offerConnection">
                      Publish to <span className="offer-product-picker__req">*</span>
                    </label>
                    {eligibleConnections.length > 1 ? (
                      <Select
                        id="offerConnection"
                        value={pickedConnectionId}
                        onChange={(e) => setPickedConnectionId(e.target.value)}
                        aria-label="Marketplace connection"
                      >
                        <option value="">Choose a connection…</option>
                        {eligibleConnections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.platformType})
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <p className="muted-text offer-product-picker__resolved-connection">
                        Publishing to: <strong>{eligibleConnections[0]!.name}</strong> (
                        {eligibleConnections[0]!.platformType})
                      </p>
                    )}
                  </div>
                )}

                <p className="offer-product-picker__rail-summary" aria-live="polite">
                  {selectionSummary}
                </p>

                <div className="offer-product-picker__rail-actions">
                  <Button tone="ghost" type="button" onClick={requestClose}>
                    Cancel
                  </Button>
                  {canContinue ? (
                    <Button type="button" onClick={handleContinue}>
                      Continue →
                    </Button>
                  ) : (
                    // Disabled buttons swallow hover, so the span is the tooltip
                    // trigger and the button inside opts out of pointer events.
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="offer-product-picker__continue-wrap" tabIndex={0}>
                          <Button type="button" disabled>
                            Continue →
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {selection.size === 0
                          ? 'Select at least one product, then choose a connection.'
                          : eligibleConnections.length === 0
                            ? 'Add an active connection that supports offer creation before publishing.'
                            : 'Choose a connection to publish to first.'}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            </aside>
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
