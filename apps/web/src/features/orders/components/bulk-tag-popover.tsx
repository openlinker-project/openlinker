/**
 * Bulk Tag Popover (#3532/#3533, mockup M3 `bulk`)
 *
 * The orders-list bulk action bar's "Tags" button — assigns one tag to every
 * selected order via `POST /order-tags/:tagId/bulk-assign`. Each candidate
 * shows how many of the SELECTED orders already carry it ("1 of 3 has it"),
 * from the rows already loaded on the page — no extra read.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover';
import { Button } from '../../../shared/ui/button';
import { Alert } from '../../../shared/ui/alert';
import type { OrderRecord } from '../api/orders.types';
import { useOrderTagsQuery } from '../hooks/use-order-tags-query';
import { useBulkAssignOrderTagMutation } from '../hooks/use-order-tag-mutations';

export interface BulkTagPopoverProps {
  selectedOrders: readonly OrderRecord[];
}

export function BulkTagPopover({ selectedOrders }: BulkTagPopoverProps): ReactElement {
  const [open, setOpen] = useState(false);
  const tagsQuery = useOrderTagsQuery();
  const bulkAssign = useBulkAssignOrderTagMutation();
  const [result, setResult] = useState<{ tagName: string; added: number; alreadyTagged: number } | null>(
    null,
  );

  const tags = tagsQuery.data ?? [];
  const orderIds = selectedOrders.map((o) => o.internalOrderId);

  function apply(tagId: string, tagName: string): void {
    setResult(null);
    bulkAssign.mutate(
      { tagId, orderIds },
      {
        onSuccess: (r) => {
          setResult({ tagName, added: r.added, alreadyTagged: r.alreadyTagged });
        },
      },
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button tone="secondary">Tags</Button>
      </PopoverTrigger>
      <PopoverContent className="bulk-menu" align="end">
        {tags.length === 0 ? (
          <p className="tag-picker__empty">No tags yet. Create one from an order's tag picker.</p>
        ) : (
          tags.map((tag) => {
            const hasCount = selectedOrders.filter((o) => (o.tagIds ?? []).includes(tag.id)).length;
            return (
              <div
                key={tag.id}
                className="dropdown-menu__item"
                role="menuitem"
                tabIndex={0}
                data-apply={tag.name}
                data-color={tag.color}
                onClick={() => { apply(tag.id, tag.name); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') apply(tag.id, tag.name);
                }}
              >
                <span className="order-tag order-tag--sm" data-tag-color={tag.color}>
                  <span className="order-tag__dot" aria-hidden="true" />
                  {tag.name}
                </span>
                <span className="bulk-menu__hint">
                  {hasCount} of {selectedOrders.length} has it
                </span>
              </div>
            );
          })
        )}
        {bulkAssign.isError ? (
          <Alert tone="error">{bulkAssign.error.message || 'Could not apply the tag.'}</Alert>
        ) : null}
        {result ? (
          <p className="muted-text" role="status">
            Added "{result.tagName}" to {result.added} order{result.added === 1 ? '' : 's'}
            {result.alreadyTagged > 0 ? ` (${result.alreadyTagged} already had it)` : ''}.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
