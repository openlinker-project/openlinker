/**
 * Order Tags Header Row (#3532/#3533, D34, mockup M3)
 *
 * The order header's tags line — rendered INSIDE `.order-header` through
 * `OrderDetailHeader`'s `tags` slot, between the id/route line and the
 * contents summary (mockup M3 `default`). Tags are neutral pills with a
 * remove `×` and a "+ Add tag" picker. Viewer role: pills render, no `×` and
 * no picker (mockup M3 `viewer`); a viewer looking at an untagged order gets
 * no row at all rather than an empty "Tags" label.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { useToast } from '../../../shared/ui/toast-provider';
import { useDemoMode } from '../../system';
import { OrderTagChip } from './order-tag-chip';
import { OrderTagPicker } from './order-tag-picker';
import { useOrderTagIdsQuery } from '../hooks/use-order-tag-ids-query';
import { useOrderTagsQuery } from '../hooks/use-order-tags-query';
import { useUnassignOrderTagMutation } from '../hooks/use-order-tag-mutations';
import { ORDER_TAGS_COPY } from '../lib/order-tags.copy';

export interface OrderTagsHeaderRowProps {
  internalOrderId: string;
}

export function OrderTagsHeaderRow({ internalOrderId }: OrderTagsHeaderRowProps): ReactElement | null {
  const demoMode = useDemoMode();
  const write = useWriteAccess('orders:write', demoMode);
  const canWrite = write.canWrite;
  const { showToast } = useToast();

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
      <span className="order-header__tags-label">{ORDER_TAGS_COPY.headerLabel}</span>
      {assigned.length === 0 ? <span className="text-muted">{ORDER_TAGS_COPY.noTags}</span> : null}
      {assigned.map((tag) => (
        <OrderTagChip
          key={tag.id}
          tag={tag}
          onRemove={
            canWrite
              ? (): void => {
                  unassign.mutate(tag.id, {
                    onError: (error) => {
                      showToast({
                        tone: 'error',
                        title: ORDER_TAGS_COPY.picker.saveErrorTitle,
                        description: error.message || ORDER_TAGS_COPY.picker.saveErrorFallback,
                      });
                    },
                  });
                }
              : undefined
          }
          removeDisabled={unassign.isPending}
        />
      ))}
      {canWrite ? (
        <OrderTagPicker internalOrderId={internalOrderId} assignedTagIds={tagIds} canWrite={canWrite} />
      ) : null}
    </div>
  );
}
