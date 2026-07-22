/**
 * OfferProductPickerModal
 *
 * Single entry point for offer creation on `/listings` (#1754). A modal that
 * lets the operator multi-select across products at two granularities:
 *   - whole product (all variants), via a tri-state product checkbox, or
 *   - individual variants, via per-variant checkboxes revealed by expanding
 *     a product row (variants lazy-load on expand),
 * or any mix across many products - all resolved into one bulk batch.
 *
 * Selection persists across pagination and search changes, keyed by product
 * id to `'ALL'` (whole product) or a `Set<variantId>` (explicit subset).
 *
 * Connection resolution happens inside the modal (R1 - the picker never
 * imports from `pages/`): active connections advertising the `OfferCreator`
 * sub-capability are eligible; exactly one auto-resolves, several render a
 * `<Select>`, none renders a warning.
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
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { CheckboxCell } from '../../../shared/ui/checkbox-cell';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { useConnectionsQuery } from '../../connections';
import type { Connection } from '../../connections';
import { useProductQuery, useProductsQuery } from '../../products';
import type { Product, ProductVariant } from '../../products';

/** Max distinct products per batch (mirrors the `/products` BULK_SELECTION_CAP,
 *  kept local per R1 to avoid a `features -> pages` import). */
const OFFER_PICKER_PRODUCT_CAP = 100;
const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

/** Per-product selection: whole product, or an explicit variant subset. */
type SelectionEntry = 'ALL' | Set<string>;

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

/**
 * One product row. Lazily loads its variants when expanded (passing an empty
 * id keeps `useProductQuery` disabled until then). Computes its own tri-state
 * and reports its loaded variant count up so the selection bar can total items
 * across products.
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
  onVariantsLoaded: (count: number) => void;
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

  // Report loaded variant count up for the item-count total.
  useEffect(() => {
    if (isExpanded && detailQuery.data) {
      onVariantsLoaded(loadedVariants.length);
    }
  }, [isExpanded, detailQuery.data, loadedVariants.length, onVariantsLoaded]);

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

  return (
    <li className="create-offer-variant-picker__product">
      <div className="offer-product-picker__product-row">
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
        <button
          type="button"
          className="offer-product-picker__expand"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${product.name}`}
        >
          <span className="offer-product-picker__caret" aria-hidden="true">
            {isExpanded ? '▾' : '▸'}
          </span>
          <span className="offer-product-picker__name">{product.name}</span>
          <span className="mono-text muted-text">{product.sku ?? '—'}</span>
          {typeof product.variantCount === 'number' ? (
            <span className="muted-text offer-product-picker__variant-count">
              {product.variantCount} {product.variantCount === 1 ? 'variant' : 'variants'}
            </span>
          ) : null}
        </button>
      </div>

      {isExpanded ? (
        <ul className="create-offer-variant-picker__variants">
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
              return (
                <li key={variant.id}>
                  <label
                    className={`create-offer-variant-picker__variant${picked ? ' create-offer-variant-picker__variant--picked' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={picked}
                      disabled={capBlocked}
                      onChange={() => onToggleVariant(variant.id, loadedVariantIds)}
                    />
                    <span className="create-offer-variant-picker__variant-name">
                      {variantLabel(detailQuery.data ?? product, variant)}
                    </span>
                    <span className="mono-text muted-text">
                      SKU {variant.sku ?? '—'} · EAN {variant.ean ?? '—'}
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
  const products = productsQuery.data?.items ?? [];
  const total = productsQuery.data?.total ?? 0;

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

  const reportVariantsLoaded = useCallback((productId: string, count: number) => {
    setVariantCounts((prev) => {
      if (prev.get(productId) === count) return prev;
      const next = new Map(prev);
      next.set(productId, count);
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

  if (!isOpen) return null;

  const pageEnd = Math.min(offset + PAGE_SIZE, total);
  const canContinue = selection.size > 0 && resolvedConnectionId !== null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogTitle>Create offers</DialogTitle>
        <DialogDescription>
          Select whole products or individual variants to publish - mix across products in one
          batch.
        </DialogDescription>

        <FormField
          label="Search products"
          name="offerProductSearch"
          description="Search by product name, SKU, or EAN."
        >
          <Input
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              // Reset offset synchronously so the next debounced query lands on
              // page 1 rather than a now-empty page.
              setOffset(0);
            }}
            placeholder="e.g. T-shirt, SKU-123, 5901234567890"
          />
        </FormField>

        <div className="create-offer-variant-picker">
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
            <p className="muted-text">No products match.</p>
          ) : (
            <ul className="create-offer-variant-picker__list">
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
                  onVariantsLoaded={(count) => reportVariantsLoaded(product.id, count)}
                />
              ))}
            </ul>
          )}

          {total > PAGE_SIZE ? (
            <div className="create-offer-variant-picker__pagination">
              <span className="muted-text">
                {offset + 1}–{pageEnd} of {total}
              </span>
              <div className="create-offer-variant-picker__pagination-actions">
                <Button
                  tone="secondary"
                  type="button"
                  aria-label="Previous page of products"
                  disabled={offset === 0}
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  tone="secondary"
                  type="button"
                  aria-label="Next page of products"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="offer-product-picker__selection-bar" aria-live="polite">
          <span className="tabular">
            {`${itemCount} ${itemCount === 1 ? 'item' : 'items'} selected across ${selection.size} ${
              selection.size === 1 ? 'product' : 'products'
            }`}
          </span>
          <Button
            tone="ghost"
            type="button"
            disabled={selection.size === 0}
            onClick={clearSelection}
          >
            Clear
          </Button>
        </div>

        {capReached ? (
          <p className="muted-text offer-product-picker__cap-hint" aria-live="polite">
            Maximum {OFFER_PICKER_PRODUCT_CAP} products per batch reached - clear a product to add
            another.
          </p>
        ) : null}

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
        ) : eligibleConnections.length > 1 ? (
          <FormField label="Connection" name="offerConnection">
            <Select
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
          </FormField>
        ) : (
          <p className="muted-text offer-product-picker__resolved-connection">
            Publishing to: <strong>{eligibleConnections[0]!.name}</strong> (
            {eligibleConnections[0]!.platformType})
          </p>
        )}

        <div className="wizard-actions">
          <div className="wizard-actions__group">
            <Button tone="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
          </div>
          <div className="wizard-actions__group">
            <Button type="button" disabled={!canContinue} onClick={handleContinue}>
              Continue →
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
