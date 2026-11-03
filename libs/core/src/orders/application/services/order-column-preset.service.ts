/**
 * Order Column Preset Service (#3530)
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderColumnPresetService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { OrderColumnPresetRepositoryPort } from '../../domain/ports/order-column-preset-repository.port';
import { OrderColumnPresetNotFoundError } from '../../domain/exceptions/order-column-preset-not-found.error';
import type {
  OrderColumnPreset,
  UpdateOrderColumnPresetInput,
} from '../../domain/types/order-column-preset.types';
import type { IOrderColumnPresetService } from './order-column-preset.service.interface';
import { ORDER_COLUMN_PRESET_REPOSITORY_TOKEN } from '../../orders.tokens';

@Injectable()
export class OrderColumnPresetService implements IOrderColumnPresetService {
  constructor(
    @Inject(ORDER_COLUMN_PRESET_REPOSITORY_TOKEN)
    private readonly repository: OrderColumnPresetRepositoryPort
  ) {}

  async listForUser(userId: string): Promise<OrderColumnPreset[]> {
    return this.repository.findByUserId(userId);
  }

  async getWorkspaceDefault(): Promise<OrderColumnPreset | null> {
    return this.repository.findWorkspaceDefault();
  }

  async create(userId: string, name: string, columns: string[]): Promise<OrderColumnPreset> {
    return this.repository.create({ userId, name, columns });
  }

  async update(
    userId: string,
    id: string,
    patch: UpdateOrderColumnPresetInput
  ): Promise<OrderColumnPreset> {
    await this.assertOwnedByUser(userId, id);
    return this.repository.update(id, patch);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.assertOwnedByUser(userId, id);
    await this.repository.delete(id);
  }

  async setWorkspaceDefault(columns: string[]): Promise<OrderColumnPreset> {
    return this.repository.upsertWorkspaceDefault(columns);
  }

  private async assertOwnedByUser(userId: string, id: string): Promise<OrderColumnPreset> {
    const preset = await this.repository.findById(id);
    // Collapsed refusal (see OrderColumnPresetNotFoundError's docblock): a
    // missing id and someone else's preset answer identically, so a caller
    // probing ids learns nothing.
    if (!preset || preset.userId !== userId) {
      throw new OrderColumnPresetNotFoundError(id);
    }
    return preset;
  }
}
