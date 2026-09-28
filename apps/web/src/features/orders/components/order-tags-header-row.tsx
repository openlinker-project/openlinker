/**
 * Order Tags Header Row (#3532/#3533, D34, mockup M3)
 *
 * Tags rendered as neutral pills under the order header, with a "+ Add tag"
 * picker. Viewer role: pills render, no remove button and no picker — "one
 * sentence naming the role needed", the `OrderNotesPanel` shape.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { useDemoMode } from '../../system';
import { OrderTagChip } from './order-tag-chip';
import { OrderTagPicker } from './order-tag-picker';
import { useOrderTagIdsQuery } from '../hooks/use-order-tag-ids-query';
import { useOrderTagsQuery } from '../hooks/use-order-tags-query';
import { useUnassignOrderTagMutation } from '../hooks/use-order-tag-mutations';

export interface OrderTagsHeaderRowProps {
  internalOrderId: string;
}

export function OrderTagsHeaderRow({ internalOrderId }: OrderTagsHeaderRowProps): ReactElement | null {
  const demoMode = useDemoMode();
  const write = useWriteAccess('orders:write', demoMode);
  const canWrite = write.canWrite;

  const tagIdsQuery = useOrderTagIdsQuery(internalOrderId);
  const tagsQuery = useOrderTagsQuery();
  const unassign = useUnassignOrderTagMutation(internalOrderId);

  const tagIds = tagIdsQuery.data ?? [];
  const allTags = tagsQuery.data ?? [];
  const assigned = allTags.filter((tag) => tagIds.includes(tag.id));

  if (tagIdsQuery.isLoading || tagsQuery.isLoading) {
    return null;
  }

  if (assigned.length === 0 && !canWrite) {
    return null;
  }

  return (
    <div className="order-header__tags" id="detail-tags">
      <span className="order-header__tags-label">Tags</span>
      {assigned.length === 0 ? <span className="text-muted">No tags</span> : null}
      {assigned.map((tag) => (
        <OrderTagChip
          key={tag.id}
          tag={tag}
          onRemove={canWrite ? () => { unassign.mutate(tag.id); } : undefined}
          removeDisabled={unassign.isPending}
        />
      ))}
      {canWrite ? (
        <OrderTagPicker
          internalOrderId={internalOrderId}
          assignedTagIds={tagIds}
          canWrite={canWrite}
        />
      ) : null}
    </div>
  );
}
