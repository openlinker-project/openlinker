/**
 * Order Tag Picker (#3532/#3533, D34, mockup M3)
 *
 * "+ Add tag" opens a search + checklist; ticking a tag saves immediately (no
 * separate "Apply" step — mockup: "zapis od razu po zaznaczeniu"). Admins and
 * operators may create a new tag straight from the picker (D34): when the query
 * matches no existing name exactly, the FIRST row offers `+ Create “x”`, and
 * Enter in the search box takes it. The workspace limit of 50 is a server-side
 * refusal rendered verbatim, never re-derived client-side.
 *
 * Keyboard: ↓ from the search box enters the list, ↑/↓ move between rows,
 * Enter or Space toggles the focused tag, Esc closes (Radix). On a phone the
 * same panel renders in a bottom sheet — a 300 px popover anchored to a small
 * ghost button leaves no room for the on-screen keyboard.
 *
 * @module apps/web/src/features/orders/components
 */
import {
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '../../../shared/ui/dialog';
import { Input } from '../../../shared/ui/input';
import { Button } from '../../../shared/ui/button';
import { Alert } from '../../../shared/ui/alert';
import { useToast } from '../../../shared/ui/toast-provider';
import { useMediaQuery } from '../../../shared/ui/use-media-query';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import type { OrderTag } from '../api/orders.types';
import { useOrderTagsQuery } from '../hooks/use-order-tags-query';
import {
  useAssignOrderTagMutation,
  useCreateOrderTagMutation,
  useUnassignOrderTagMutation,
} from '../hooks/use-order-tag-mutations';
import { pickNextColor } from '../lib/order-tag-color';
import { ORDER_TAG_NAME_MAX_LENGTH, ORDER_TAGS_COPY } from '../lib/order-tags.copy';
import { OrderTagChip } from './order-tag-chip';

const COPY = ORDER_TAGS_COPY.picker;
/** The `<768` band, as the fractional complement of `min-width: 768px` (lessons). */
const PHONE_QUERY = '(max-width: 767.98px)';
const ROW_SELECTOR = '[data-picker-row]';

export interface OrderTagPickerProps {
  internalOrderId: string;
  /** Tag ids currently assigned to the order. */
  assignedTagIds: readonly string[];
  /** D34: admin or operator, same gate as every other `/orders` write. */
  canWrite: boolean;
  trigger?: ReactNode;
}

interface TagPickerPanelProps {
  internalOrderId: string;
  assignedTagIds: readonly string[];
}

function TagPickerPanel({ internalOrderId, assignedTagIds }: TagPickerPanelProps): ReactElement {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isAdmin = useIsAdmin();
  const { showToast } = useToast();
  const tagsQuery = useOrderTagsQuery();
  const assignTag = useAssignOrderTagMutation(internalOrderId);
  const unassignTag = useUnassignOrderTagMutation(internalOrderId);
  const createTag = useCreateOrderTagMutation();

  const allTags = tagsQuery.data ?? [];
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const filtered = normalizedQuery
    ? allTags.filter((tag) => tag.name.toLowerCase().includes(normalizedQuery))
    : allTags;
  const exactMatch = allTags.some((tag) => tag.name.toLowerCase() === normalizedQuery);
  const canOfferCreate = normalizedQuery.length > 0 && !exactMatch;

  function reportSaveError(error: Error): void {
    showToast({
      tone: 'error',
      title: COPY.saveErrorTitle,
      description: error.message || COPY.saveErrorFallback,
    });
  }

  function toggle(tag: OrderTag): void {
    if (assignedTagIds.includes(tag.id)) {
      unassignTag.mutate(tag.id, { onError: reportSaveError });
    } else {
      assignTag.mutate(tag.id, { onError: reportSaveError });
    }
  }

  function createAndAssign(): void {
    if (!trimmedQuery || createTag.isPending) return;
    createTag.mutate(
      { name: trimmedQuery, color: pickNextColor(allTags) },
      {
        onSuccess: (tag) => {
          setQuery('');
          searchRef.current?.focus();
          assignTag.mutate(tag.id, {
            onSuccess: () => {
              showToast({
                tone: 'success',
                title: COPY.createdToastTitle,
                description: COPY.createdToastDescription(tag.name),
              });
            },
            onError: reportSaveError,
          });
        },
      },
    );
  }

  function rows(): HTMLElement[] {
    return Array.from(listRef.current?.querySelectorAll<HTMLElement>(ROW_SELECTOR) ?? []);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      rows()[0]?.focus();
    } else if (event.key === 'Enter') {
      // A bare Enter in a search box would otherwise do nothing at all.
      event.preventDefault();
      if (canOfferCreate) createAndAssign();
    }
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const all = rows();
    const index = all.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    event.preventDefault();
    if (event.key === 'ArrowDown') {
      all[Math.min(index + 1, all.length - 1)]?.focus();
    } else if (index === 0) {
      searchRef.current?.focus();
    } else {
      all[index - 1]?.focus();
    }
  }

  const showEmptyVocabulary = !tagsQuery.isLoading && allTags.length === 0 && !canOfferCreate;

  return (
    <>
      <Input
        ref={searchRef}
        className="tag-picker__search"
        aria-label={COPY.searchPlaceholder}
        placeholder={COPY.searchPlaceholder}
        value={query}
        maxLength={ORDER_TAG_NAME_MAX_LENGTH}
        onChange={(event) => { setQuery(event.target.value); }}
        onKeyDown={handleSearchKeyDown}
        autoFocus
      />
      {createTag.isError ? (
        <Alert tone="error" title={COPY.createErrorTitle}>
          {createTag.error.message || COPY.createErrorFallback}
        </Alert>
      ) : null}
      <div
        ref={listRef}
        className="tag-picker__list"
        role="group"
        aria-label={COPY.listLabel}
        onKeyDown={handleListKeyDown}
      >
        {canOfferCreate ? (
          <button
            type="button"
            className="dropdown-menu__item tag-picker__item tag-picker__create"
            data-picker-row=""
            onClick={createAndAssign}
            disabled={createTag.isPending}
          >
            {COPY.createRow(trimmedQuery)}
          </button>
        ) : null}
        {tagsQuery.isLoading ? <p className="tag-picker__empty">Loading tags…</p> : null}
        {showEmptyVocabulary ? <p className="tag-picker__empty">{COPY.emptyVocabulary}</p> : null}
        {filtered.map((tag) => (
          <label key={tag.id} className="dropdown-menu__item tag-picker__item">
            <input
              type="checkbox"
              data-picker-row=""
              checked={assignedTagIds.includes(tag.id)}
              onChange={() => { toggle(tag); }}
              onKeyDown={(event) => {
                // Space toggles a checkbox natively; Enter does not.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  toggle(tag);
                }
              }}
            />
            <OrderTagChip tag={tag} small />
            <span className="tag-picker__hint">
              {tag.orderCount}
              <span className="sr-only"> orders</span>
            </span>
          </label>
        ))}
      </div>
      <div className="tag-picker__foot">
        {isAdmin ? <Link to="/settings/order-tags">{COPY.manageTags}</Link> : null}
        <span className="text-muted tag-picker__saved">{COPY.savedHint}</span>
      </div>
    </>
  );
}

export function OrderTagPicker({
  internalOrderId,
  assignedTagIds,
  canWrite,
  trigger,
}: OrderTagPickerProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const isPhone = useMediaQuery(PHONE_QUERY);

  if (!canWrite) {
    return null;
  }

  const triggerElement = trigger ?? (
    <Button tone="ghost" className="button--xs" aria-haspopup="dialog">
      {ORDER_TAGS_COPY.addTag}
    </Button>
  );

  if (isPhone) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{triggerElement}</DialogTrigger>
        <DialogContent className="dialog__content--sheet tag-picker-sheet" aria-describedby={undefined}>
          <div className="sheet__grabber" aria-hidden="true" />
          <div className="sheet__header">
            <DialogTitle>{COPY.dialogLabel}</DialogTitle>
          </div>
          <div className="sheet__body tag-picker tag-picker--sheet">
            <TagPickerPanel internalOrderId={internalOrderId} assignedTagIds={assignedTagIds} />
          </div>
          <div className="sheet__footer">
            <DialogClose asChild>
              <Button tone="secondary">{COPY.done}</Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen} dismissOnViewportChange>
      <PopoverTrigger asChild>{triggerElement}</PopoverTrigger>
      <PopoverContent className="tag-picker" align="start" aria-label={COPY.dialogLabel}>
        <TagPickerPanel internalOrderId={internalOrderId} assignedTagIds={assignedTagIds} />
      </PopoverContent>
    </Popover>
  );
}
