/**
 * Product Content Field — Domain Entity
 *
 * Per-product, per-channel (or master) draft buffer for a single content
 * field (e.g. `description`). Implements the "draft write-through with
 * conflict detection" model documented in #338: a draft sits in front of
 * the last-known platform value (`baseValue`/`baseVersion`); publishing
 * pushes through to the platform; inbound reconcile updates the base
 * silently when no draft exists, or marks `hasConflict` when a draft and
 * an external divergence collide.
 *
 * The entity is plain — no NestJS/TypeORM decorators. ORM mapping lives
 * in `infrastructure/persistence/entities/product-content-field.orm-entity.ts`.
 *
 * @module libs/core/src/content/domain/entities
 */
import type { FieldKey } from '../types/content.types';

export class ProductContentField {
  constructor(
    public readonly id: string,
    public readonly productId: string,
    /** `null` means master (platform-agnostic). Non-null = channel override scoped to that connection. */
    public readonly connectionId: string | null,
    public readonly fieldKey: FieldKey,
    public readonly draftValue: string | null,
    public readonly baseValue: string | null,
    public readonly baseVersion: string | null,
    public readonly hasConflict: boolean,
    public readonly updatedAt: Date,
    public readonly updatedBy: string | null,
  ) {}

  /**
   * Derived: a row "has a pending draft" when draftValue is set AND it differs
   * from baseValue. A draftValue equal to baseValue is meaningless and treated
   * as no-draft; callers shouldn't construct such rows but this guard makes
   * publish/discard idempotent against accidental same-value writes.
   */
  get hasPendingDraft(): boolean {
    return this.draftValue !== null && this.draftValue !== this.baseValue;
  }
}
