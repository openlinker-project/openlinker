/**
 * Order Column Preset Repository Port (#3530)
 *
 * Persistence contract for `/orders` list column presets — personal, plus
 * one workspace default (`userId IS NULL`). See `OrderColumnPreset`'s own
 * docblock for the D32 model.
 *
 * @module libs/core/src/orders/domain/ports
 */
import type {
  CreateOrderColumnPresetInput,
  OrderColumnPreset,
  UpdateOrderColumnPresetInput,
} from '../types/order-column-preset.types';

export interface OrderColumnPresetRepositoryPort {
  /** A user's own saved presets, oldest first. */
  findByUserId(userId: string): Promise<OrderColumnPreset[]>;

  /** The single workspace-default row, or `null` if an admin never set one. */
  findWorkspaceDefault(): Promise<OrderColumnPreset | null>;

  findById(id: string): Promise<OrderColumnPreset | null>;

  create(input: CreateOrderColumnPresetInput): Promise<OrderColumnPreset>;

  update(id: string, patch: UpdateOrderColumnPresetInput): Promise<OrderColumnPreset>;

  /**
   * Upserts the SINGLE workspace-default row (D32) — the admin-facing write.
   * `columns` replaces the whole set; `name` is fixed ("Workspace default")
   * rather than operator-chosen, since there is exactly one such row and
   * nothing ever lists it beside a name a user picked.
   */
  upsertWorkspaceDefault(columns: string[]): Promise<OrderColumnPreset>;

  delete(id: string): Promise<void>;
}
