/**
 * Order Export Run Domain Entity (#3534, D35)
 *
 * One row of the `order_exports` audit + result ledger. Anemic per ADR-011:
 * every field is `readonly`, state transitions go through explicit
 * repository methods.
 *
 * @module libs/core/src/orders/domain/entities
 */
import type {
  OrderExportFile,
  OrderExportFormat,
  OrderExportScope,
  OrderExportStatus,
} from '../types/order-export.types';

export class OrderExportRun {
  constructor(
    public readonly id: string,
    public readonly requestedByUserId: string,
    public readonly status: OrderExportStatus,
    public readonly format: OrderExportFormat,
    public readonly scope: OrderExportScope,
    public readonly filters: Record<string, unknown>,
    public readonly selectedOrderIds: string[],
    public readonly columns: string[],
    public readonly rowCount: number | null,
    public readonly containsPii: boolean | null,
    public readonly errorMessage: string | null,
    public readonly file: OrderExportFile | null,
    public readonly expiresAt: Date,
    public readonly createdAt: Date,
    public readonly updatedAt: Date
  ) {}

  /** Whether the file is still within its download window — the download route's own gate. */
  isExpired(now: Date = new Date()): boolean {
    return this.expiresAt.getTime() <= now.getTime();
  }
}
