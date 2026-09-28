/**
 * Order Tag Picker (#3532/#3533, D34, mockup M3)
 *
 * "+ Add tag" opens a search + checklist popover; picking a tag saves
 * immediately (no separate "Apply" step — mockup: "zapis od razu po
 * zaznaczeniu"). Admins and operators may create a new tag straight from the
 * picker (D34) when nothing matches the query; the workspace limit of 50 is
 * a server-side refusal rendered verbatim, never re-derived client-side.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover';
import { Input } from '../../../shared/ui/input';
import { Button } from '../../../shared/ui/button';
import { Alert } from '../../../shared/ui/alert';
import { OrderTagColorValues, type OrderTag, type OrderTagColorValue } from '../api/orders.types';
import { useOrderTagsQuery } from '../hooks/use-order-tags-query';
import {
  useAssignOrderTagMutation,
  useCreateOrderTagMutation,
  useUnassignOrderTagMutation,
} from '../hooks/use-order-tag-mutations';

/** Deterministic colour for a freshly created tag — cycles through the closed set. */
function pickNextColor(existing: readonly OrderTag[]): OrderTagColorValue {
  return OrderTagColorValues[existing.length % OrderTagColorValues.length];
}

export interface OrderTagPickerProps {
  internalOrderId: string;
  /** Tag ids currently assigned to the order. */
  assignedTagIds: readonly string[];
  /** D34: admin or operator, same gate as every other `/orders` write. */
  canWrite: boolean;
  trigger?: ReactNode;
}

export function OrderTagPicker({
  internalOrderId,
  assignedTagIds,
  canWrite,
  trigger,
}: OrderTagPickerProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const tagsQuery = useOrderTagsQuery();
  const assignTag = useAssignOrderTagMutation(internalOrderId);
  const unassignTag = useUnassignOrderTagMutation(internalOrderId);
  const createTag = useCreateOrderTagMutation();

  if (!canWrite) {
    return null;
  }

  const allTags = tagsQuery.data ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? allTags.filter((tag) => tag.name.toLowerCase().includes(normalizedQuery))
    : allTags;
  const exactMatch = allTags.some((tag) => tag.name.toLowerCase() === normalizedQuery);
  const canOfferCreate = normalizedQuery.length > 0 && !exactMatch;

  function toggle(tag: OrderTag): void {
    if (assignedTagIds.includes(tag.id)) {
      unassignTag.mutate(tag.id);
    } else {
      assignTag.mutate(tag.id);
    }
  }

  function createAndAssign(): void {
    const name = query.trim();
    if (!name) return;
    createTag.mutate(
      { name, color: pickNextColor(allTags) },
      {
        onSuccess: (tag) => {
          assignTag.mutate(tag.id);
          setQuery('');
        },
      },
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen} dismissOnViewportChange>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button tone="ghost" className="button--xs">
            + Add tag
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="tag-picker" align="start">
        <Input
          className="tag-picker__search"
          aria-label="Search tags"
          placeholder="Search or create a tag"
          value={query}
          onChange={(event) => { setQuery(event.target.value); }}
          autoFocus
        />
        <div className="tag-picker__list" role="listbox" aria-label="Tags">
          {filtered.length === 0 && !canOfferCreate ? (
            <p className="tag-picker__empty">No tags yet.</p>
          ) : (
            filtered.map((tag) => (
              <label key={tag.id} className="tag-picker__item">
                <input
                  type="checkbox"
                  checked={assignedTagIds.includes(tag.id)}
                  onChange={() => { toggle(tag); }}
                />
                <span className="order-tag order-tag--sm" data-tag-color={tag.color}>
                  <span className="order-tag__dot" aria-hidden="true" />
                  {tag.name}
                </span>
                <span className="tag-picker__hint">{tag.orderCount}</span>
              </label>
            ))
          )}
        </div>
        {canOfferCreate ? (
          <div className="tag-picker__foot">
            <span>Create "{query.trim()}"</span>
            <Button
              tone="ghost"
              className="button--xs"
              onClick={createAndAssign}
              disabled={createTag.isPending}
            >
              Create &amp; add
            </Button>
          </div>
        ) : null}
        {createTag.isError ? (
          <Alert tone="error">
            {createTag.error.message || 'Could not create the tag. Try again.'}
          </Alert>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
