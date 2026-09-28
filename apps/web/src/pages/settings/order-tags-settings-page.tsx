/**
 * Order Tags Settings Page (#3532/#3533, D34, mockup M3)
 *
 * The Settings tag manager — admin only ("rename/recolor/delete stay
 * `@Roles('admin')`", the backend controller's own words). Reachable at
 * `/settings/order-tags`, no sidebar entry — the `SourcingRulesPage` /
 * `InventoryLocationsPage` shape: the Settings tile is the only way in.
 *
 * Creation happens from the PICKER (D34, admin or operator); this page edits
 * colour, renames, and deletes — with the order count shown per row and a
 * confirm naming how many orders a delete affects.
 *
 * @module apps/web/src/pages/settings
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Button } from '../../shared/ui/button';
import { Input } from '../../shared/ui/input';
import { Alert } from '../../shared/ui/alert';
import { useSession } from '../../shared/auth/use-session';
import { OrderTagColorValues, type OrderTag, type OrderTagColorValue } from '../../features/orders/api/orders.types';
import { OrderTagChip } from '../../features/orders/components/order-tag-chip';
import { useOrderTagsQuery } from '../../features/orders/hooks/use-order-tags-query';
import {
  useDeleteOrderTagMutation,
  useUpdateOrderTagMutation,
} from '../../features/orders/hooks/use-order-tag-mutations';

function TagRow({ tag }: { tag: OrderTag }): ReactElement {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(tag.name);
  const [colorDraft, setColorDraft] = useState<OrderTagColorValue>(tag.color);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const update = useUpdateOrderTagMutation();
  const del = useDeleteOrderTagMutation();

  function save(): void {
    if (!nameDraft.trim()) return;
    update.mutate(
      { tagId: tag.id, patch: { name: nameDraft.trim(), color: colorDraft } },
      { onSuccess: () => { setEditing(false); } },
    );
  }

  return (
    <tr>
      <td>
        {editing ? (
          <Input
            aria-label="Tag name"
            value={nameDraft}
            maxLength={40}
            onChange={(e) => { setNameDraft(e.target.value); }}
          />
        ) : (
          <OrderTagChip tag={tag} />
        )}
      </td>
      <td className="data-table__cell--hide-below-768">
        {editing ? (
          <fieldset className="tag-swatches">
            <legend className="sr-only">Colour</legend>
            {OrderTagColorValues.map((color) => (
              <label key={color} className="tag-swatch" data-tag-color={color}>
                <input
                  type="radio"
                  name={`tag-colour-${tag.id}`}
                  value={color}
                  checked={colorDraft === color}
                  onChange={() => { setColorDraft(color); }}
                />
                <span className="order-tag__dot" aria-hidden="true" />
                {color}
              </label>
            ))}
          </fieldset>
        ) : (
          tag.color
        )}
      </td>
      <td className="data-table__cell--right">
        <Link className="mono-text tabular" to={`/orders?tag=${encodeURIComponent(tag.id)}`}>
          {tag.orderCount}
        </Link>
      </td>
      <td className="data-table__cell--right">
        <span className="toolbar__group" style={{ justifyContent: 'flex-end' }}>
          {editing ? (
            <>
              <Button className="button--xs" onClick={save} disabled={update.isPending}>
                Save
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
                Cancel
              </Button>
            </>
          ) : confirmingDelete ? (
            <>
              <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                Removes it from {tag.orderCount} order{tag.orderCount === 1 ? '' : 's'}.
              </span>
              <Button
                tone="danger"
                className="button--xs"
                onClick={() => { del.mutate(tag.id); }}
                disabled={del.isPending}
              >
                Confirm delete
              </Button>
              <Button tone="ghost" className="button--xs" onClick={() => { setConfirmingDelete(false); }}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button tone="ghost" className="button--xs" onClick={() => { setEditing(true); }}>
                Edit
              </Button>
              <Button
                tone="ghost"
                className="button--xs"
                data-delete-tag={tag.name}
                data-count={tag.orderCount}
                onClick={() => { setConfirmingDelete(true); }}
              >
                Delete
              </Button>
            </>
          )}
        </span>
      </td>
    </tr>
  );
}

export function OrderTagsSettingsPage(): ReactElement {
  const { isReady, session } = useSession();
  const isAdmin = isReady && session.status === 'authenticated' && session.user?.role === 'admin';
  const tagsQuery = useOrderTagsQuery();
  const del = useDeleteOrderTagMutation();

  if (isReady && !isAdmin) {
    return (
      <PageLayout backTo={{ to: '/settings', label: 'Settings' }} eyebrow="Settings" title="Order tags">
        <Alert tone="info">This page needs the admin role.</Alert>
      </PageLayout>
    );
  }

  const tags = tagsQuery.data ?? [];

  return (
    <PageLayout
      backTo={{ to: '/settings', label: 'Settings' }}
      eyebrow="Settings"
      title="Order tags"
      description="The workspace's tag vocabulary — colour, rename and delete. Admins and operators create a new tag from the picker on an order; new tags are created there, not here."
    >
      {del.isError ? (
        <Alert tone="error">{del.error.message || 'Could not delete the tag.'}</Alert>
      ) : null}

      {tagsQuery.isLoading ? (
        <p className="muted-text">Loading tags…</p>
      ) : tags.length === 0 ? (
        <p className="muted-text">
          No tags yet. Create one from the tag picker on any order.
        </p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="data-table__cell--hide-below-768">Colour</th>
              <th className="data-table__cell--right">Orders</th>
              <th className="data-table__cell--right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tags.map((tag) => (
              <TagRow key={tag.id} tag={tag} />
            ))}
          </tbody>
        </table>
      )}
      <p className="muted-text" style={{ marginTop: 'var(--space-3)' }}>
        The workspace holds at most 50 tags.
      </p>
    </PageLayout>
  );
}
