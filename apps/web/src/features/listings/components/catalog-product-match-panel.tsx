/**
 * Catalog Product Match Panel
 *
 * Renders the Allegro-catalog match result above the create-offer wizard's
 * Step 2 parameters list (#635). Three branches:
 *
 *   - unique (linked)   → thumbnail + name + "{N} fields auto-filled" + Unlink
 *   - unique (unlinked) → compact "Relink" affordance (state held by parent)
 *   - ambiguous         → header + radio-list of summaries (text-only —
 *                          Allegro's /sale/products?phrase summaries do not
 *                          carry image URLs) + Skip
 *   - no_match          → renders nothing
 *
 * The parent (`AllegroCreateOfferWizard`) owns the `unlinked` flag, the
 * selected ambiguous-pick id, and the prefill effect. This component is a
 * pure presentational fork over `result.kind`.
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import type { CatalogProductMatchResult, CatalogProductSummary } from '../api/listings.types';

export interface CatalogProductMatchPanelProps {
  result: CatalogProductMatchResult | undefined;
  /** When true and `result.kind === 'unique'`, render the unlinked affordance. */
  unlinked: boolean;
  /** Count of parameters the catalog match wrote into Step 2's form state. */
  prefilledCount: number;
  /** Loading state from `useCatalogProductMatchQuery`. */
  isLoading: boolean;
  /** EAN that triggered the lookup — shown in the panel header. */
  barcode: string;
  onUnlink: () => void;
  onRelink: () => void;
  onPickAmbiguous: (productId: string) => void;
  onSkipAmbiguous: () => void;
}

export function CatalogProductMatchPanel(props: CatalogProductMatchPanelProps): ReactElement | null {
  if (props.isLoading) {
    return (
      <div className="catalog-match-panel catalog-match-panel--loading" aria-live="polite">
        <span className="catalog-match-panel__skeleton" aria-hidden="true" />
        <span className="catalog-match-panel__hint">Checking Allegro catalog…</span>
      </div>
    );
  }

  const result = props.result;
  if (!result) return null;

  if (result.kind === 'no_match') return null;

  if (result.kind === 'unique') {
    return renderUnique(result.product, props);
  }

  return renderAmbiguous(result.products, props) ?? null;
}

function renderUnique(
  product: { id: string; name: string; ean?: string; imageUrl?: string },
  props: CatalogProductMatchPanelProps,
): ReactElement {
  if (props.unlinked) {
    return (
      <div className="catalog-match-panel catalog-match-panel--unlinked">
        <span className="catalog-match-panel__hint">
          Catalog match available for EAN <span className="mono-text">{props.barcode}</span> — unlinked.
        </span>
        <Button tone="ghost" type="button" onClick={props.onRelink}>
          Relink
        </Button>
      </div>
    );
  }

  return (
    <div className="catalog-match-panel catalog-match-panel--linked" role="status">
      <ProductThumbnail
        src={product.imageUrl ?? null}
        name={product.name}
        size="md"
        alt={`Allegro catalog product: ${product.name}`}
      />
      <div className="catalog-match-panel__body">
        <span className="catalog-match-panel__title">
          Matched to Allegro catalog product{' '}
          <span className="catalog-match-panel__product-name">{product.name}</span>
        </span>
        <span className="catalog-match-panel__hint">
          From EAN <span className="mono-text">{props.barcode}</span> ·{' '}
          {props.prefilledCount === 0
            ? 'no fields auto-filled (you already edited everything overlapping)'
            : `${props.prefilledCount} field${props.prefilledCount === 1 ? '' : 's'} auto-filled`}
        </span>
      </div>
      <Button tone="ghost" type="button" onClick={props.onUnlink}>
        Unlink
      </Button>
    </div>
  );
}

function renderAmbiguous(
  products: CatalogProductSummary[],
  props: CatalogProductMatchPanelProps,
): ReactElement | null {
  // Skip / Unlink dismisses the picker until the operator changes the
  // (variant, category) tuple — keep the panel mounted but render nothing.
  if (props.unlinked) return null;
  return (
    <div className="catalog-match-panel catalog-match-panel--ambiguous" role="region" aria-label="Allegro catalog matches">
      <div className="catalog-match-panel__title">
        Multiple Allegro catalog products match EAN{' '}
        <span className="mono-text">{props.barcode}</span>. Pick one to auto-fill product details.
      </div>
      <ul className="catalog-match-panel__list">
        {products.map((p) => (
          <li key={p.id} className="catalog-match-panel__item">
            <button
              type="button"
              className="catalog-match-panel__pick"
              onClick={() => props.onPickAmbiguous(p.id)}
            >
              <ProductThumbnail src={p.imageUrl ?? null} name={p.name} size="sm" alt="" />
              <span className="catalog-match-panel__pick-body">
                <span className="catalog-match-panel__pick-name">{p.name}</span>
                {p.ean ? (
                  <span className="catalog-match-panel__pick-ean">
                    EAN <span className="mono-text">{p.ean}</span>
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="catalog-match-panel__actions">
        <Button tone="ghost" type="button" onClick={props.onSkipAmbiguous}>
          Skip
        </Button>
      </div>
    </div>
  );
}
