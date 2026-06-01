/**
 * Dispatch Payment-Status Policy
 *
 * The set of neutral payment statuses (#928) that BLOCK dispatch, enforced
 * server-side by `ShipmentDispatchService` (#938). Block-list polarity, not
 * allow-list: only these explicitly block; `paid`, `cod`, `undefined`
 * (payment unknown — PrestaShop / legacy orders), and any future union member
 * not listed here all PERMIT dispatch, so a new payment value never silently
 * blocks shipping until consciously added here.
 *
 * Lives in the application layer (not domain) because "which payment statuses
 * block dispatch" is a shipping *policy* decision that depends on a sibling
 * context's value (`PAYMENT_STATUS`); keeping it here leaves the shipping
 * domain free of runtime cross-context coupling.
 *
 * MIRRORS the FE gate `PAYMENT_BLOCKS_DISPATCH` in
 * `apps/web/src/features/orders/components/shipment-action-buttons.tsx` —
 * keep the two in sync (they can't share a const across the apps/web ↔
 * libs/core boundary). This is the authoritative server-side copy.
 *
 * @module libs/core/src/shipping/application/types
 */

import type { PaymentStatus } from '@openlinker/core/orders';
import { PAYMENT_STATUS } from '@openlinker/core/orders';

export const DISPATCH_BLOCKING_PAYMENT_STATUSES = [
  PAYMENT_STATUS.Awaiting,
  PAYMENT_STATUS.Refunded,
] as const satisfies readonly PaymentStatus[];
