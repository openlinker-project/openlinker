/**
 * Order Tags Settings Page (#3532/#3533, D34, mockup M3 `tags`)
 *
 * The Settings tag manager — admin only ("rename/recolor/delete stay
 * `@Roles('admin')`", the backend controller's own words). Reachable at
 * `/settings/order-tags`, no sidebar entry — the `SourcingRulesPage` /
 * `InventoryLocationsPage` shape: the Settings tile is the only way in.
 *
 * A "New tag" card creates a tag with a chosen colour and a live preview
 * (`POST /order-tags`, the same route the order's tag picker uses, D34). The
 * table renames, recolours and deletes; delete asks first and names how many
 * orders lose the tag.
 *
 * @module apps/web/src/pages/settings
 */
import { useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Button } from '../../shared/ui/button';
import { Input } from '../../shared/ui/input';
import { Alert } from '../../shared/ui/alert';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { EmptyState, LoadingState } from '../../shared/ui/feedback-state';
import { FormField } from '../../shared/ui/form-field';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useToast } from '../../shared/ui/toast-provider';
import { useSession } from '../../shared/auth/use-session';
import { useIsAdmin } from '../../shared/auth/use-permission';
import {
  OrderTagColorValues,
  type OrderTag,
  type OrderTagColorValue,
} from '../../features/orders/api/orders.types';
import { OrderTagChip } from '../../features/orders/components/order-tag-chip';
import { useOrderTagsQuery } from '../../features/orders/hooks/use-order-tags-query';
import {
  useCreateOrderTagMutation,
  useDeleteOrderTagMutation,
  useUpdateOrderTagMutation,
} from '../../features/orders/hooks/use-order-tag-mutations';
import { pickNextColor } from '../../features/orders/lib/order-tag-color';
import {
  ORDER_TAG_COLOR_LABELS,
  ORDER_TAG_NAME_MAX_LENGTH,
  ORDER_TAGS_COPY,
} from '../../features/orders/lib/order-tags.copy';

const COPY = ORDER_TAGS_COPY.manager;

function ColourSwatches({
  name,
  value,
  onChange,
  legendHidden = false,
}: {
  name: string;
  value: OrderTagColorValue;
  onChange: (color: OrderTagColorValue) => void;
  legendHidden?: boolean;
}): ReactElement {
  return (
    <fieldset className="tag-swatches">
      <legend className={legendHidden ? 'sr-only' : undefined}>{COPY.colourLegend}</legend>
      {OrderTagColorValues.map((color) => (
        <label key={color} className="tag-swatch" data-tag-color={color}>
          <input
            type="radio"
            name={name}
            value={color}
            checked={value === color}
            onChange={() => { onChange(color); }}
          />
          <span className="order-tag__dot" aria-hidden="true" />
          {ORDER_TAG_COLOR_LABELS[color]}
        </label>
      ))}
    </fieldset>
  );
}

function NewTagCard({
  existing,
  onClose,
}: {
  existing: readonly OrderTag[];
  onClose: () => void;
}): ReactElement {
  const [name, setName] = useState('');
  const [color, setColor] = useState<OrderTagColorValue>(() => pickNextColor(existing));
  const swatchName = useId();
  const create = useCreateOrderTagMutation();
  const { showToast } = useToast();

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, color },
      {
        onSuccess: (tag) => {
          showToast({
            tone: 'success',
            title: COPY.createdToastTitle,
            description: COPY.createdToastDescription(tag.name),
          });
          onClose();
        },
      },
    );
  }

  return (
    <form className="panel tag-new" onSubmit={handleSubmit} aria-label={COPY.newTag}>
      <div className="panel__header">
        <h3>{COPY.newTag}</h3>
        <span className="panel__meta">{COPY.newTagMeta}</span>
      </div>
      <div className="tag-new__row">
        <FormField
          name="tag-name"
          label={COPY.nameLabel}
          description={
            <>
              {COPY.nameHint}{' '}
              <span className="tag-new__counter">{COPY.nameCounter(name.length)}</span>
            </>
          }
        >
          <Input
            value={name}
            maxLength={ORDER_TAG_NAME_MAX_LENGTH}
            onChange={(e) => { setName(e.target.value); }}
            autoFocus
          />
        </FormField>
        <ColourSwatches name={`tag-colour-${swatchName}`} value={color} onChange={setColor} />
      </div>
      {create.isError ? (
        <Alert tone="error" title={COPY.createErrorTitle}>
          {create.error.message}
        </Alert>
      ) : null}
      <div className="tag-new__foot">
        <span className="tag-new__preview-label">{COPY.preview}</span>
        <OrderTagChip tag={{ name: name.trim() || COPY.previewPlaceholder, color }} />
        <span className="toolbar__group tag-new__actions">
          <Button tone="ghost" onClick={onClose}>
            {COPY.cancel}
          </Button>
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            {COPY.create}
          </Button>
        </span>
      </div>
    </form>
  );
}

function TagRow({
  tag,
  onRequestDelete,
}: {
  tag: OrderTag;
  onRequestDelete: (tag: OrderTag) => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(tag.name);
  const [colorDraft, setColorDraft] = useState<OrderTagColorValue>(tag.color);
  const update = useUpdateOrderTagMutation();
  const { showToast } = useToast();

  function save(): void {
    if (!nameDraft.trim()) return;
    update.mutate(
      { tagId: tag.id, patch: { name: nameDraft.trim(), color: colorDraft } },
      {
        onSuccess: () => { setEditing(false); },
        onError: (error) => {
          showToast({ tone: 'error', title: COPY.saveErrorTitle, description: error.message });
        },
      },
    );
  }

  return (
    <tr>
      <td>
        {editing ? (
          <Input
            aria-label={COPY.nameLabel}
            value={nameDraft}
            maxLength={ORDER_TAG_NAME_MAX_LENGTH}
            onChange={(e) => { setNameDraft(e.target.value); }}
          />
        ) : (
          <OrderTagChip tag={tag} />
        )}
      </td>
      <td className="data-table__cell--hide-below-768">
        {editing ? (
          <ColourSwatches
            name={`tag-colour-${tag.id}`}
            value={colorDraft}
            onChange={setColorDraft}
            legendHidden
          />
        ) : (
          ORDER_TAG_COLOR_LABELS[tag.color]
        )}
      </td>
      <td className="data-table__cell--right">
        <Link className="mono-text tabular" to={`/orders?tag=${encodeURIComponent(tag.id)}`}>
          {tag.orderCount}
        </Link>
      </td>
      <td className="data-table__cell--hide-below-768">
        {tag.createdAt ? <TimeDisplay iso={tag.createdAt} format="date" className="mono-text" /> : null}
      </td>
      <td className="data-table__cell--right">
        <span className="toolbar__group tag-manager__actions">
          {editing ? (
            <>
              <Button className="button--xs" onClick={save} disabled={update.isPending}>
                {COPY.save}
              </Button>
              <Button
                tone="ghost"
                className="button--xs"
                onClick={() => {
                  setEditing(false);
                  setNameDraft(tag.name);
                  setColorDraft(tag.color);
                }}
              >
                {COPY.cancel}
              </Button>
            </>
          ) : (
            <>
              <Button tone="ghost" className="button--xs" onClick={() => { setEditing(true); }}>
                {COPY.edit}
              </Button>
              <Button
                tone="ghost"
                className="button--xs"
                data-delete-tag={tag.name}
                data-count={tag.orderCount}
                onClick={() => { onRequestDelete(tag); }}
              >
                {COPY.delete}
              </Button>
            </>
          )}
        </span>
      </td>
    </tr>
  );
}

export function OrderTagsSettingsPage(): ReactElement {
  const { isReady } = useSession();
  const isAdmin = useIsAdmin();
  const tagsQuery = useOrderTagsQuery();
  const del = useDeleteOrderTagMutation();
  const { showToast } = useToast();
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<OrderTag | null>(null);
  const newTagButtonRef = useRef<HTMLButtonElement>(null);

  if (isReady && !isAdmin) {
    return (
      <PageLayout backTo={{ to: '/settings', label: 'Settings' }} eyebrow={COPY.eyebrow} title={COPY.title}>
        <Alert tone="info">{COPY.adminOnly}</Alert>
      </PageLayout>
    );
  }

  const tags = tagsQuery.data ?? [];

  function closeNewTag(): void {
    setCreating(false);
    newTagButtonRef.current?.focus();
  }

  function confirmDelete(): void {
    if (!pendingDelete) return;
    del.mutate(pendingDelete.id, {
      onSuccess: () => { setPendingDelete(null); },
      onError: (error) => {
        setPendingDelete(null);
        showToast({ tone: 'error', title: COPY.deleteErrorTitle, description: error.message });
      },
    });
  }

  return (
    <PageLayout
      backTo={{ to: '/settings', label: 'Settings' }}
      eyebrow={COPY.eyebrow}
      title={COPY.title}
      description={COPY.description}
      actions={
        <div className="toolbar__group">
          <Button
            ref={newTagButtonRef}
            aria-expanded={creating}
            onClick={() => {
              setCreating(true);
              // Already open: take the operator to it rather than doing nothing.
              document.querySelector<HTMLInputElement>('.tag-new input')?.focus();
            }}
          >
            {COPY.newTag}
          </Button>
        </div>
      }
    >
      {creating ? <NewTagCard existing={tags} onClose={closeNewTag} /> : null}

      {tagsQuery.isLoading ? (
        <LoadingState liveRegion="off" title={COPY.loading} message={COPY.loadingMessage} />
      ) : tagsQuery.isError ? (
        <Alert tone="error">{tagsQuery.error.message}</Alert>
      ) : tags.length === 0 ? (
        <EmptyState liveRegion="off" title={COPY.emptyTitle} message={COPY.emptyMessage} />
      ) : (
        <div className="data-table__container">
          <table className="data-table">
            <caption className="sr-only">{COPY.tableCaption}</caption>
            <thead>
              <tr>
                <th>{COPY.columnTag}</th>
                <th className="data-table__cell--hide-below-768">{COPY.columnColour}</th>
                <th className="data-table__cell--right">{COPY.columnOrders}</th>
                <th className="data-table__cell--hide-below-768">{COPY.columnCreated}</th>
                <th className="data-table__cell--right">
                  <span className="sr-only">{COPY.columnActions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => (
                <TagRow key={tag.id} tag={tag} onRequestDelete={setPendingDelete} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted-text tag-manager__usage">{COPY.usage(tags.length)}</p>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title={COPY.deleteTitle(pendingDelete?.name ?? '')}
        description={
          <>
            {COPY.deleteDescriptionLead} <strong>{pendingDelete?.orderCount ?? 0}</strong>{' '}
            {COPY.deleteDescriptionTail(pendingDelete?.orderCount ?? 0)}
          </>
        }
        cancelLabel={COPY.keepTag}
        confirmLabel={COPY.deleteTag}
        tone="danger"
        initialFocus="cancel"
        isConfirming={del.isPending}
        onConfirm={confirmDelete}
      />
    </PageLayout>
  );
}
