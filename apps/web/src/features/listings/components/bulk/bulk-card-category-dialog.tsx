/**
 * Bulk wizard Review - catalogue card vs category mapping (#3994)
 *
 * Opened from the advisory `card-category-differs` chip. The barcode matched a
 * catalogue card in a different category than the operator's mapping; the
 * mapping already won, so this dialog only explains the disagreement and lets
 * the operator adopt the card deliberately.
 *
 * Adopting is offered for a single-variant product only. A multi-variant family
 * lists under ONE shared category (the server strips a per-variant one), so a
 * sibling's card cannot be taken on its own - the dialog says so and points to
 * the product editor instead.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { ReactElement } from 'react';
import { Button } from '../../../../shared/ui';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../../shared/ui/dialog';
import { useCategoryPathQuery } from '../../../mappings';
import type { EanMatchCardRef } from '../../api/listings.types';

interface BulkCardCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  destinationName: string;
  /** Product + variant label for the title line. */
  subject: string;
  ean: string | null;
  /** The category in use - the operator's mapping. */
  mappedCategoryId: string;
  card: EanMatchCardRef;
  /** False for a sibling of a multi-variant product. */
  canAdoptCard: boolean;
  demoReadOnly: boolean;
  onUseCard: () => void;
  onEditProduct: () => void;
}

export function BulkCardCategoryDialog({
  open,
  onOpenChange,
  connectionId,
  destinationName,
  subject,
  ean,
  mappedCategoryId,
  card,
  canAdoptCard,
  demoReadOnly,
  onUseCard,
  onEditProduct,
}: BulkCardCategoryDialogProps): ReactElement {
  const mapped = useCategoryPathQuery(connectionId, mappedCategoryId);
  const cardPath = useCategoryPathQuery(connectionId, card.allegroCategoryId);
  const mappedRoot = mapped.data?.[0]?.id;
  const cardRoot = cardPath.data?.[0]?.id;
  // Only claim "a different branch" when both paths are known; an unsynced path
  // is not evidence of anything.
  const differentBranch = mappedRoot !== undefined && cardRoot !== undefined && mappedRoot !== cardRoot;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="card-category-dialog" aria-describedby="card-category-dialog-desc">
        <DialogTitle>
          {differentBranch
            ? 'The catalog product is in a different part of the catalog'
            : 'The catalog product is in another category'}
        </DialogTitle>
        <DialogDescription id="card-category-dialog-desc">
          <span className="card-category-dialog__subject">{subject}</span>
          {ean ? (
            <>
              {' '}
              · barcode <span className="card-category-dialog__ean">{ean}</span>
            </>
          ) : null}
          . The barcode matched a {destinationName} catalog product, but your category mapping names a
          different category. Your mapping is used and the catalog product is not linked.
        </DialogDescription>

        <div className="card-category-dialog__compare">
          <CategoryPanel
            tag="In use · your mapping"
            categoryId={mappedCategoryId}
            path={mapped.data}
            loading={mapped.isPending}
            active
          />
          <CategoryPanel
            tag={`${destinationName} catalog product`}
            categoryId={card.allegroCategoryId}
            path={cardPath.data}
            loading={cardPath.isPending}
            active={false}
          />
        </div>

        <p className="card-category-dialog__note">
          {canAdoptCard
            ? 'Use the catalog category only if this barcode really belongs to this product. The offer then links the catalog product and takes its name, parameters and photos.'
            : 'All variants of this product list under one category, so this variant cannot take the catalog category on its own. To list the whole product elsewhere, change its category in the editor.'}
        </p>

        <DialogFooter>
          {canAdoptCard ? (
            <Button
              tone="secondary"
              disabled={demoReadOnly}
              onClick={() => {
                onUseCard();
                onOpenChange(false);
              }}
            >
              Use catalog category
            </Button>
          ) : (
            <Button
              tone="secondary"
              onClick={() => {
                onOpenChange(false);
                onEditProduct();
              }}
            >
              Edit product
            </Button>
          )}
          <Button tone="primary" onClick={() => onOpenChange(false)}>
            Keep my mapping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoryPanel({
  tag,
  categoryId,
  path,
  loading,
  active,
}: {
  tag: string;
  categoryId: string;
  path: readonly { id: string; name: string }[] | undefined;
  loading: boolean;
  active: boolean;
}): ReactElement {
  const nodes = path ?? [];
  const leaf = nodes.length > 0 ? nodes[nodes.length - 1].name : null;
  return (
    <section
      className={
        active
          ? 'card-category-dialog__panel card-category-dialog__panel--active'
          : 'card-category-dialog__panel'
      }
    >
      <span className="card-category-dialog__tag">{tag}</span>
      <span className="card-category-dialog__leaf">
        {loading ? 'Loading…' : (leaf ?? `Category ${categoryId}`)}
      </span>
      {nodes.length > 1 ? (
        <ol className="card-category-dialog__trail" aria-label="Category path">
          {nodes.slice(0, -1).map((n) => (
            <li key={n.id}>{n.name}</li>
          ))}
        </ol>
      ) : !loading && leaf === null ? (
        <span className="card-category-dialog__muted">Path not synced yet</span>
      ) : null}
      <span className="card-category-dialog__id">ID {categoryId}</span>
    </section>
  );
}
