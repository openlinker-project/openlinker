/**
 * Bulk wizard Review - catalogue product vs category mapping (#3994)
 *
 * Opened from the conflict line in the Category cell. The barcode matched a
 * catalogue product in a different category than the operator's mapping; the
 * mapping already won, so this dialog explains the disagreement and lets the
 * operator adopt the catalogue category deliberately.
 *
 * The comparison is drawn as a FORK of the category tree: the ancestors both
 * paths share appear once, then the tree splits into the two candidates. That
 * answers the operator's real question - "how far apart are these?" - at a
 * glance: a split at the leaf is a near miss, no shared trunk at all means the
 * barcode belongs to a different kind of product.
 *
 * Adopting is offered for a single-variant product only. A multi-variant family
 * lists under ONE shared category (the server strips a per-variant one), so a
 * sibling's catalogue product cannot be taken on its own - the dialog says so
 * and points to the product editor instead.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { ReactElement } from 'react';
import { interpolate, renderRich, useMessages } from '../../../../shared/i18n';
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

interface PathNode {
  id: string;
  name: string;
}

interface BulkCardCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  destinationName: string;
  /** Product (and variant) name for the description line. */
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

/**
 * Split two root-first paths at the first differing node. Exported for tests:
 * the shared trunk is what the whole dialog is built around.
 */
export function forkPaths(
  a: readonly PathNode[],
  b: readonly PathNode[],
): { shared: PathNode[]; restA: PathNode[]; restB: PathNode[] } {
  let i = 0;
  while (i < a.length && i < b.length && a[i].id === b[i].id) i += 1;
  return { shared: a.slice(0, i), restA: a.slice(i), restB: b.slice(i) };
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
  const copy = useMessages('listings').bulkCardCategoryDialog;
  const mapped = useCategoryPathQuery(connectionId, mappedCategoryId);
  const cardPath = useCategoryPathQuery(connectionId, card.allegroCategoryId);
  const loading = mapped.isPending || cardPath.isPending;
  const fallbackName = (id: string): string => interpolate(copy.categoryFallback, { id });
  const mappedNodes = withFallback(mapped.data, mappedCategoryId, fallbackName);
  const cardNodes = withFallback(cardPath.data, card.allegroCategoryId, fallbackName);
  // Only compare paths that are actually known: an unsynced path is a single
  // fallback node and would always "share nothing", which is not a finding.
  const comparable = (mapped.data?.length ?? 0) > 0 && (cardPath.data?.length ?? 0) > 0;
  const { shared, restA, restB } = forkPaths(mappedNodes, cardNodes);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cat-fork-dialog" aria-describedby="cat-fork-dialog-desc">
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription id="cat-fork-dialog-desc" className="cat-fork-dialog__lede">
          {renderRich(
            ean ? copy.lede : copy.ledeNoEan,
            {
              subject: (chunk) => <strong>{chunk}</strong>,
              ean: (chunk) => <span className="cat-fork-dialog__ean">{chunk}</span>,
            },
            { subject, ean: ean ?? '', destination: destinationName },
          )}
        </DialogDescription>

        <figure className="cat-fork" aria-busy={loading}>
          <div className={shared.length > 0 ? 'cat-fork__trunk' : 'cat-fork__trunk cat-fork__trunk--none'}>
            {loading
              ? copy.loading
              : shared.length > 0
                ? shared.map((n) => n.name).join(' › ')
                : comparable
                  ? copy.noSharedBranch
                  : copy.notSynced}
          </div>
          <ul className="cat-fork__branches">
            <Branch
              nodes={restA}
              kind="used"
              tag={copy.inUse}
              note={copy.yourMapping}
              leafIdLabel={copy.leafId}
            />
            <Branch
              nodes={restB}
              kind="other"
              tag={copy.barcodeMatch}
              note={interpolate(copy.catalogProduct, { destination: destinationName })}
              leafIdLabel={copy.leafId}
            />
          </ul>
        </figure>

        <p className="cat-fork-dialog__note">
          {canAdoptCard ? copy.adoptNote : copy.siblingNote}
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
              {copy.useCard}
            </Button>
          ) : (
            <Button
              tone="secondary"
              onClick={() => {
                onOpenChange(false);
                onEditProduct();
              }}
            >
              {copy.editProduct}
            </Button>
          )}
          <Button tone="primary" onClick={() => onOpenChange(false)}>
            {copy.keepMapping}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function withFallback(
  nodes: readonly PathNode[] | undefined,
  id: string,
  fallbackName: (id: string) => string,
): PathNode[] {
  return nodes && nodes.length > 0 ? [...nodes] : [{ id, name: fallbackName(id) }];
}

function Branch({
  nodes,
  kind,
  tag,
  note,
  leafIdLabel,
}: {
  nodes: readonly PathNode[];
  kind: 'used' | 'other';
  tag: string;
  note: string;
  /** "ID {id}" template for the leaf's id. */
  leafIdLabel: string;
}): ReactElement {
  const leaf = nodes[nodes.length - 1];
  const between = nodes.slice(0, -1);
  return (
    <li className={`cat-fork__branch cat-fork__branch--${kind}`}>
      <div className="cat-fork__path">
        {between.length > 0 ? (
          <span className="cat-fork__between">{between.map((n) => n.name).join(' › ')} › </span>
        ) : null}
        <span className="cat-fork__leaf">{leaf?.name}</span>
      </div>
      <div className="cat-fork__meta">
        <span className="cat-fork__tag">{tag}</span>
        <span className="cat-fork__note">{note}</span>
        {leaf ? <span className="cat-fork__id">{interpolate(leafIdLabel, { id: leaf.id })}</span> : null}
      </div>
    </li>
  );
}
