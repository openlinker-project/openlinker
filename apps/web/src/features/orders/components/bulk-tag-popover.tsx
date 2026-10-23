/**
 * Bulk Tag Menu (#3532/#3533, mockup M3 `bulk`)
 *
 * The orders-list bulk action bar's "Tags ▾" menu — assigns one tag to every
 * selected order via `POST /order-tags/:tagId/bulk-assign`. Built on the shared
 * Radix `DropdownMenu`, so arrow keys, typeahead and Esc come with it. Each tag
 * says how many of the SELECTED orders already carry it ("1 of 3 has it", only
 * when that is more than none), from the rows already loaded on the page — no
 * extra read. A tag every selected order already has is disabled, since
 * applying it would change nothing.
 *
 * The result is a toast, not text inside the menu: the menu closes on select,
 * so anything rendered in it would never be seen.
 *
 * "Remove a tag from N orders…" (mockup) is deferred — the backend has no
 * bulk-unassign route (`order-tags.controller.ts` exposes bulk-assign only).
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
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
import { useToast } from '../../../shared/ui/toast-provider';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import type { OrderRecord, OrderTag } from '../api/orders.types';
import { useOrderTagsQuery } from '../hooks/use-order-tags-query';
import { useBulkAssignOrderTagMutation } from '../hooks/use-order-tag-mutations';
import { ORDER_TAGS_COPY } from '../lib/order-tags.copy';
import { OrderTagChip } from './order-tag-chip';

const COPY = ORDER_TAGS_COPY.bulk;

export interface BulkTagPopoverProps {
  selectedOrders: readonly OrderRecord[];
}

export function BulkTagPopover({ selectedOrders }: BulkTagPopoverProps): ReactElement {
  const tagsQuery = useOrderTagsQuery();
  const bulkAssign = useBulkAssignOrderTagMutation();
  const isAdmin = useIsAdmin();
  const { showToast } = useToast();

  const tags = tagsQuery.data ?? [];
  const selectedCount = selectedOrders.length;
  const orderIds = selectedOrders.map((o) => o.internalOrderId);

  function apply(tag: OrderTag): void {
    bulkAssign.mutate(
      { tagId: tag.id, orderIds },
      {
        onSuccess: (result) => {
          showToast({
            tone: 'success',
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button tone="secondary">
          {COPY.trigger}
          <span aria-hidden="true">▾</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="bulk-menu"
        side="top"
        align="end"
        aria-label={COPY.menuLabel}
      >
        <DropdownMenuLabel>{COPY.heading(selectedCount)}</DropdownMenuLabel>
        {tags.length === 0 ? (
          <DropdownMenuItem disabled>{COPY.emptyVocabulary}</DropdownMenuItem>
        ) : (
          tags.map((tag) => {
            const hasCount = selectedOrders.filter((o) => (o.tagIds ?? []).includes(tag.id)).length;
            const allHaveIt = selectedCount > 0 && hasCount === selectedCount;
            return (
              <DropdownMenuItem
                key={tag.id}
                disabled={allHaveIt || bulkAssign.isPending}
                data-apply={tag.name}
                onSelect={() => { apply(tag); }}
              >
                <OrderTagChip tag={tag} small />
                {allHaveIt ? (
                  <span className="bulk-menu__hint">{COPY.allHaveIt}</span>
                ) : hasCount > 0 ? (
                  <span className="bulk-menu__hint">{COPY.hasIt(hasCount, selectedCount)}</span>
                ) : null}
              </DropdownMenuItem>
            );
          })
        )}
        {isAdmin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings/order-tags">{COPY.manageTags}</Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
