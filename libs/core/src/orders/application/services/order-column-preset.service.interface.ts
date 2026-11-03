/**
 * Order Column Preset Service Interface (#3530)
 *
 * @module libs/core/src/orders/application/services
 */
import type {
  OrderColumnPreset,
  UpdateOrderColumnPresetInput,
} from '../../domain/types/order-column-preset.types';

export interface IOrderColumnPresetService {
  /** The caller's own saved presets. */
  listForUser(userId: string): Promise<OrderColumnPreset[]>;

  /** The single workspace default (D32), or `null` if an admin never set one. */
  getWorkspaceDefault(): Promise<OrderColumnPreset | null>;

  create(userId: string, name: string, columns: string[]): Promise<OrderColumnPreset>;

  /**
   * @throws {OrderColumnPresetNotFoundError} when `id` does not exist OR
   *   belongs to a different user — "personal" is enforced HERE, not at the
   *   repository, which has no notion of a caller.
   */
  update(
    userId: string,
    id: string,
    patch: UpdateOrderColumnPresetInput
  ): Promise<OrderColumnPreset>;

  /** @throws {OrderColumnPresetNotFoundError} same ownership rule as {@link update}. */
  delete(userId: string, id: string): Promise<void>;

  /**
   * Admin-only write (enforced by the controller's `@Roles('admin')`, not
   * here — this context carries no roles). Replaces the workspace default's
   * whole column set.
   */
  setWorkspaceDefault(columns: string[]): Promise<OrderColumnPreset>;
}
