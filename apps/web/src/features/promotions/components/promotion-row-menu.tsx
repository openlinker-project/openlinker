/**
 * PromotionRowMenu (#3935, mockup `promotions-list` row menu)
 *
 * The "..." menu of a promotion row: move it up or down, duplicate it, turn it
 * off (or on) and delete it. Moves are offered only when the list shows every
 * promotion in order, and an end of the list disables the move that cannot
 * happen.
 *
 * @module apps/web/src/features/promotions/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../shared/ui/dropdown-menu';
import type { Promotion } from '../api/promotions.types';
import { promotionStateKey } from '../lib/promotion-view';

/** Vertical-ellipsis glyph on the trigger; the accessible name is the aria-label. */
const MENU_GLYPH = '⋯';

export interface PromotionRowMenuProps {
  promotion: Promotion;
  canWrite: boolean;
  canReorder: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: 'up' | 'down') => void;
  onDuplicate: () => void;
  onSetActive: (active: boolean) => void;
  onDelete: () => void;
}

export function PromotionRowMenu({
  promotion,
  canWrite,
  canReorder,
  isFirst,
  isLast,
  onMove,
  onDuplicate,
  onSetActive,
  onDelete,
}: PromotionRowMenuProps): ReactElement {
  const copy = useMessages('promotions');
  const key = promotionStateKey(promotion);
  const on = key === 'active' || key === 'scheduled';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="tl-more"
          aria-haspopup="menu"
          aria-label={interpolate(copy.table.moreAria, { name: promotion.name })}
          onClick={(event) => {
            event.stopPropagation();
          }}
          data-testid={`promotion-menu-${promotion.id}`}
        >
          {MENU_GLYPH}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label={copy.menu.aria}>
        {canWrite && canReorder ? (
          <>
            <DropdownMenuItem disabled={isFirst} onSelect={() => { onMove('up'); }}>
              {copy.table.moveUp}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isLast} onSelect={() => { onMove('down'); }}>
              {copy.table.moveDown}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem disabled={!canWrite} onSelect={onDuplicate} data-testid="promotion-row-duplicate">
          {copy.menu.duplicate}
        </DropdownMenuItem>
        {key !== 'ended' && key !== 'pausedStock' && key !== 'pausedLimit' ? (
          <DropdownMenuItem disabled={!canWrite} onSelect={() => { onSetActive(!on); }}>
            {on ? copy.menu.pause : copy.menu.resume}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!canWrite} onSelect={onDelete} data-testid="promotion-row-delete">
          {copy.menu.delete}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
