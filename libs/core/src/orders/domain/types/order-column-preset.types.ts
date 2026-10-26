/**
 * Order Column Preset Types (#3530)
 *
 * A per-user, named, ordered set of `/orders` list columns — shared by the
 * list itself and the export UI (#3534/#3535), so a saved preset applies to
 * both (mockup M5 note 7).
 *
 * **Personal, with one workspace default (D32).** A preset row with
 * `userId === null` IS the workspace default — at most one such row exists,
 * enforced by a partial unique index — and it is never one of a user's OWN
 * presets: it is what a user with none of their own starts from, resolved
 * separately by the read API rather than mixed into a user's preset array.
 *
 * Column keys are free-form strings rather than a closed `as const` union:
 * the set of renderable list/export columns is owned by the frontend
 * (`docs/frontend-architecture.md`) and this context has no business knowing
 * it. An unrecognised key is the FE's problem to skip, not this context's to
 * validate.
 *
 * @module libs/core/src/orders/domain/types
 */

export interface OrderColumnPreset {
  id: string;
  /** `null` marks the single workspace-default row (D32) — never a personal preset. */
  userId: string | null;
  name: string;
  columns: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrderColumnPresetInput {
  userId: string;
  name: string;
  columns: string[];
}

export interface UpdateOrderColumnPresetInput {
  name?: string;
  columns?: string[];
}
