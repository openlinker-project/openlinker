/**
 * Buyer note icon (#3539)
 *
 * The speech bubble the mockup uses for "the buyer wrote this". Decorative:
 * every place it appears carries a text label beside it.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

export function BuyerNoteIcon({ size = 14 }: { size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 3h11v7.5h-6.5l-3 2.5v-2.5h-1.5z" />
    </svg>
  );
}
