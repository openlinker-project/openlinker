/**
 * Bulk Tag Menu (#3532/#3533/#3619, mockup M3 `bulk`)
 *
 * The orders-list bulk action bar's "Tags" menu. Assigns one tag to every
 * selected order (`POST /order-tags/:tagId/bulk-assign`) or, from "Remove a tag
 * from N orders…", removes one (`.../bulk-remove`, #3545). Each tag says how
 * many of the SELECTED orders already carry it ("1 of 3 has it"), computed from
 * the rows already loaded - no extra read.
 *
 * The result is a toast with counts. Both endpoints answer per row, so when any
 * row failed the toast says so and a details dialog lists every order's outcome
 * (the menu closes on select, so nothing inside it would ever be seen).
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../shared/ui/dropdown-menu';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { useToast } from '../../../shared/ui/toast-provider';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import type { BulkOrderTagRowResult } from '../api/order-bulk-actions.types';
import type { OrderRecord, OrderTag } from '../api/orders.types';
import { useOrderTagsQuery } from '../hooks/use-order-tags-query';
import {
  useBulkAssignOrderTagMutation,
  useBulkRemoveOrderTagMutation,
} from '../hooks/use-order-tag-mutations';
import { BULK_ACTIONS_COPY, BULK_TAG_ROW } from '../lib/bulk-order-actions.copy';
import { ORDER_TAGS_COPY } from '../lib/order-tags.copy';
import { BulkResultRows } from './bulk-result-rows';
import { OrderTagChip } from './order-tag-chip';

const COPY = ORDER_TAGS_COPY.bulk;
const REMOVE_COPY = BULK_ACTIONS_COPY.tags;

export interface BulkTagPopoverProps {
  selectedOrders: readonly OrderRecord[];
  /** Why the action is unavailable for this selection (e.g. over the 100 cap), or null. */
  disabledReason?: string | null;
}

interface TagDetails {
  tagName: string;
  results: BulkOrderTagRowResult[];
}

export function BulkTagPopover({
  selectedOrders,
  disabledReason = null,
}: BulkTagPopoverProps): ReactElement {
  const tagsQuery = useOrderTagsQuery();
  const bulkAssign = useBulkAssignOrderTagMutation();
  const bulkRemove = useBulkRemoveOrderTagMutation();
  const isAdmin = useIsAdmin();
  const { showToast } = useToast();
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [details, setDetails] = useState<TagDetails | null>(null);

  const tags = tagsQuery.data ?? [];
  const selectedCount = selectedOrders.length;
  const orderIds = selectedOrders.map((o) => o.internalOrderId);
  const busy = bulkAssign.isPending || bulkRemove.isPending;

  const countWith = (tag: OrderTag): number =>
    selectedOrders.filter((o) => (o.tagIds ?? []).includes(tag.id)).length;

  function report(
    tag: OrderTag,
    failed: number,
    results: BulkOrderTagRowResult[] | undefined,
    success: { title: string; description: string },
  ): void {
    if (failed > 0) {
      showToast({
        tone: 'warning',
        title: REMOVE_COPY.partialTitle(tag.name),
        description: REMOVE_COPY.partialDescription(failed),
      });
      if (results) setDetails({ tagName: tag.name, results });
      return;
    }
    showToast({ tone: 'success', ...success });
  }

  function apply(tag: OrderTag): void {
    bulkAssign.mutate(
      { tagId: tag.id, orderIds },
      {
        onSuccess: (result) => {
          report(tag, result.failed ?? 0, result.results, {
            title: COPY.resultTitle,
            description: COPY.resultDescription(tag.name, result.added, result.alreadyTagged),
          });
        },
        onError: (error) => {
          showToast({
            tone: 'error',
            title: COPY.errorTitle,
            description: error.message || COPY.errorFallback,
          });
        },
      },
    );
  }

  function remove(tag: OrderTag): void {
    bulkRemove.mutate(
      { tagId: tag.id, orderIds },
      {
        onSuccess: (result) => {
          report(tag, result.failed, result.results, {
            title: REMOVE_COPY.removeResultTitle,
            description: REMOVE_COPY.removeResultDescription(tag.name, result.removed, result.notTagged),
          });
        },
        onError: (error) => {
          showToast({
            tone: 'error',
            title: REMOVE_COPY.removeErrorTitle,
            description: error.message || REMOVE_COPY.removeErrorFallback,
          });
        },
      },
    );
  }

  const removable = tags.filter((tag) => countWith(tag) > 0);

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) setMode('add');
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            tone="secondary"
            data-testid="orders-bulk-tags"
            disabled={disabledReason !== null}
            title={disabledReason ?? undefined}
          >
            {COPY.trigger}
            <span aria-hidden="true">▾</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="bulk-menu"
          side="top"
          align="end"
          aria-label={COPY.menuLabel}
          data-testid="orders-bulk-tags-menu"
        >
          {mode === 'add' ? (
            <>
              <DropdownMenuLabel>{COPY.heading(selectedCount)}</DropdownMenuLabel>
              {tags.length === 0 ? (
                <DropdownMenuItem disabled>{COPY.emptyVocabulary}</DropdownMenuItem>
              ) : (
                tags.map((tag) => {
                  const hasCount = countWith(tag);
                  const allHaveIt = selectedCount > 0 && hasCount === selectedCount;
                  return (
                    <DropdownMenuItem
                      key={tag.id}
                      disabled={allHaveIt || busy}
                      data-apply={tag.name}
                      data-testid="orders-bulk-tag-apply"
                      onSelect={() => {
                        apply(tag);
                      }}
                    >
                      <OrderTagChip tag={tag} small />
                      {allHaveIt ? (
                        <span className="bulk-menu__hint">{COPY.allHaveIt}</span>
                      ) : hasCount > 0 ? (
                        <span className="bulk-menu__hint" data-testid="orders-bulk-tag-has-it">
                          {COPY.hasIt(hasCount, selectedCount)}
                        </span>
                      ) : null}
                    </DropdownMenuItem>
                  );
                })
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="orders-bulk-tag-remove-open"
                onSelect={(event) => {
                  event.preventDefault();
                  setMode('remove');
                }}
              >
                {REMOVE_COPY.removeOpen(selectedCount)}
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuLabel>{REMOVE_COPY.removeHeading(selectedCount)}</DropdownMenuLabel>
              {removable.length === 0 ? (
                <DropdownMenuItem disabled>{REMOVE_COPY.removeNone}</DropdownMenuItem>
              ) : (
                removable.map((tag) => (
                  <DropdownMenuItem
                    key={tag.id}
                    disabled={busy}
                    data-testid="orders-bulk-tag-remove"
                    onSelect={() => {
                      remove(tag);
                    }}
                  >
                    <OrderTagChip tag={tag} small />
                    <span className="bulk-menu__hint">{COPY.hasIt(countWith(tag), selectedCount)}</span>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setMode('add');
                }}
              >
                {REMOVE_COPY.removeBack}
              </DropdownMenuItem>
            </>
          )}
          {isAdmin ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild data-testid="orders-bulk-tag-manage">
                <Link to="/settings/order-tags">{COPY.manageTags}</Link>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={details !== null}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
      >
        <DialogContent className="bulk-dispatch" data-testid="orders-bulk-tag-details">
          {details ? (
            <>
              <DialogTitle>{REMOVE_COPY.detailsTitle(details.tagName)}</DialogTitle>
              <DialogDescription>
                {REMOVE_COPY.detailsDescription(
                  details.results.filter((r) => r.outcome !== 'failed').length,
                  details.results.filter((r) => r.outcome === 'failed').length,
                )}
              </DialogDescription>
              <BulkResultRows
                testId="orders-bulk-tag-details-rows"
                rows={details.results.map((r) => ({
                  orderId: r.orderId,
                  tone: BULK_TAG_ROW[r.outcome].tone,
                  label: BULK_TAG_ROW[r.outcome].label,
                  detail: r.code === 'ORDER_NOT_FOUND' ? 'Order not found' : (r.reason ?? null),
                }))}
              />
              <DialogFooter>
                <Button
                  tone="primary"
                  onClick={() => {
                    setDetails(null);
                  }}
                >
                  {REMOVE_COPY.detailsClose}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
