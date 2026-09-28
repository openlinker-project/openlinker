/**
 * Order Tag Chip (#3532/#3533, mockup M3)
 *
 * The `.order-tag` pattern (`apps/web/src/index.css`): a neutral pill with a
 * coloured dot from the closed `--tag-*` set. Colour is never the only
 * signal — a tag chip always renders its name.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import type { OrderTag } from '../api/orders.types';

export interface OrderTagChipProps {
  tag: Pick<OrderTag, 'name' | 'color'>;
  /** Small variant for the list row's tags line (max 2 + "+N"). */
  small?: boolean;
  /** Renders a remove (×) button when present — the order header's own chip. */
  onRemove?: () => void;
  removeDisabled?: boolean;
}

export function OrderTagChip({ tag, small, onRemove, removeDisabled }: OrderTagChipProps): ReactElement {
  return (
    <span
      className={`order-tag${small ? ' order-tag--sm' : ''}`}
      data-tag-color={tag.color}
      data-tag={tag.name}
    >
      <span className="order-tag__dot" aria-hidden="true" />
      <span className="order-tag__label">{tag.name}</span>
      {onRemove ? (
        <button
          type="button"
          className="order-tag__remove"
          aria-label={`Remove tag ${tag.name}`}
          disabled={removeDisabled}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
