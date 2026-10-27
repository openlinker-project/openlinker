/**
 * PrestaShop Order Stock Effect Resolver
 *
 * Answers `OrderCreateStockEffect` for one order the adapter has just created:
 * did PrestaShop lower its own `stock_available.quantity` for it?
 *
 * What PrestaShop does (8.x / 9.x, `PaymentModule::validateOrder` ->
 * `OrderDetail::createList` -> `OrderDetail::updateProductQuantityInStock`): it
 * decrements every line's `stock_available` row as the order is created,
 * UNLESS the order is created in `PS_OS_CANCELED` or `PS_OS_ERROR`. Notably the
 * decrement is NOT gated on `PS_STOCK_MANAGEMENT` - that setting only decides
 * whether an out-of-stock line is flagged - so there is no shop-wide switch to
 * read here, and reading one would answer the wrong question.
 *
 * The state is therefore the deciding fact, and it is a fact about the ORDER,
 * not the shop: `validateOrder` silently replaces the requested state with
 * `PS_OS_ERROR` when the amount paid does not match the cart total of a
 * "logable" state, and that downgraded state is the one the lines are created
 * under. So the answer reads the order's FIRST `order_histories` row (the state
 * `validateOrder` created it in) rather than trusting the state OpenLinker
 * asked for, and rather than `current_state`, which the back-order switch may
 * already have moved on.
 *
 * Two product-level cases are answered `false` on purpose, because what
 * OpenLinker then publishes for the line is not simply the row PrestaShop
 * decremented:
 *
 *   - a legacy `depends_on_stock = 1` row, which PrestaShop 8.x skips entirely;
 *   - a pack, whose decrement lands on the pack row, its components, or both,
 *     depending on its pack stock type (#2598).
 *
 * Every read failure answers `false`. That keeps the order's holds until
 * dispatch - an under-sell, never an oversell - which is the direction the
 * capability is built to fail in.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import { readAllPrestashopResourcePages } from '../http/prestashop-paged-read';

/** The configuration keys naming the two states PrestaShop creates an order in without touching stock. */
export const PRESTASHOP_STOCK_SKIPPING_STATE_KEYS = ['PS_OS_CANCELED', 'PS_OS_ERROR'] as const;

interface ConfigurationRow {
  name?: string;
  value?: string | number | null;
}

interface OrderHistoryRow {
  id?: string | number;
  id_order_state?: string | number;
}

interface StockAvailableRow {
  id?: string | number;
  depends_on_stock?: string | number;
}

interface ProductIdRow {
  id?: string | number;
}

function idOf(value: string | number | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text === '' ? null : text;
}

export class PrestashopOrderStockEffectResolver {
  private readonly logger = new Logger(PrestashopOrderStockEffectResolver.name);

  /**
   * The ids of the stock-skipping states, read once per instance. The adapter
   * owning this resolver is built per resolution, so the cache lives as long as
   * one order sync and a back-office edit is never missed for long.
   */
  private skippingStateIds: Promise<ReadonlySet<string> | null> | null = null;

  constructor(
    private readonly client: IPrestashopWebserviceClient,
    private readonly connectionId: string
  ) {}

  /**
   * Whether PrestaShop lowered its stock when it created `orderId`, whose lines
   * are the PrestaShop products `productIds`.
   */
  async lowersStock(orderId: string, productIds: readonly string[]): Promise<boolean> {
    const products = [...new Set(productIds.map((id) => id.trim()).filter((id) => id !== ''))];
    if (products.length === 0) {
      return false;
    }
    try {
      const initialState = await this.readInitialState(orderId);
      if (initialState === null) {
        this.logger.warn(
          `PrestaShop order ${orderId} has no readable order history, so whether creating it ` +
            `lowered stock is unknown; its holds stay until dispatch (connection: ${this.connectionId})`
        );
        return false;
      }

      const skipping = await this.readSkippingStateIds();
      if (skipping === null) {
        return false;
      }
      if (skipping.has(initialState)) {
        this.logger.debug(
          `PrestaShop order ${orderId} was created in state ${initialState}, which PrestaShop books ` +
            `without lowering stock (connection: ${this.connectionId})`
        );
        return false;
      }

      if (await this.anyStockDependsOnWarehouse(products)) {
        return false;
      }
      return !(await this.anyPack(products));
    } catch (error) {
      this.logger.warn(
        `Could not tell whether creating PrestaShop order ${orderId} lowered stock; its holds stay ` +
          `until dispatch (connection: ${this.connectionId}): ${(error as Error).message}`
      );
      return false;
    }
  }

  /** The state of the order's first history row - the one `validateOrder` created it in. */
  private async readInitialState(orderId: string): Promise<string | null> {
    const rows = await readAllPrestashopResourcePages<OrderHistoryRow>(
      this.client,
      'order_histories',
      { custom: { id_order: orderId } },
      { connectionId: this.connectionId, detail: `id_order=${orderId}` }
    );
    let first: OrderHistoryRow | null = null;
    for (const row of rows) {
      const id = Number(row.id);
      if (!Number.isFinite(id)) {
        continue;
      }
      if (first === null || id < Number(first.id)) {
        first = row;
      }
    }
    return first === null ? null : idOf(first.id_order_state);
  }

  private readSkippingStateIds(): Promise<ReadonlySet<string> | null> {
    this.skippingStateIds ??= this.fetchSkippingStateIds();
    return this.skippingStateIds;
  }

  private async fetchSkippingStateIds(): Promise<ReadonlySet<string> | null> {
    const rows = await readAllPrestashopResourcePages<ConfigurationRow>(
      this.client,
      'configurations',
      { custom: { name: [...PRESTASHOP_STOCK_SKIPPING_STATE_KEYS] } },
      { connectionId: this.connectionId, detail: PRESTASHOP_STOCK_SKIPPING_STATE_KEYS.join('|') }
    );
    // A multistore shop may carry one row per shop; every value counts, because
    // an order created in any of them was created without lowering stock.
    const ids = new Set<string>();
    const seen = new Set<string>();
    for (const row of rows) {
      const value = idOf(row.value);
      if (row.name !== undefined && value !== null) {
        seen.add(row.name);
        ids.add(value);
      }
    }
    const missing = PRESTASHOP_STOCK_SKIPPING_STATE_KEYS.filter((key) => !seen.has(key));
    if (missing.length > 0) {
      this.logger.warn(
        `PrestaShop configuration ${missing.join(', ')} is not readable, so an order created in that ` +
          `state cannot be told apart; holds stay until dispatch (connection: ${this.connectionId})`
      );
      return null;
    }
    return ids;
  }

  /** A legacy `depends_on_stock = 1` product: PrestaShop 8.x creates the order without decrementing it. */
  private async anyStockDependsOnWarehouse(productIds: readonly string[]): Promise<boolean> {
    const rows = await readAllPrestashopResourcePages<StockAvailableRow>(
      this.client,
      'stock_availables',
      {
        custom: { id_product: [...productIds], id_product_attribute: 0 },
        display: '[id,depends_on_stock]',
      },
      { connectionId: this.connectionId, detail: `id_product=${productIds.join('|')}` }
    );
    return rows.some((row) => Number(row.depends_on_stock) === 1);
  }

  /** A pack: where its decrement lands depends on its pack stock type, so it is not answered. */
  private async anyPack(productIds: readonly string[]): Promise<boolean> {
    const rows = await readAllPrestashopResourcePages<ProductIdRow>(
      this.client,
      'products',
      { ids: [...productIds], custom: { cache_is_pack: 1 }, display: '[id]' },
      { connectionId: this.connectionId, detail: 'cache_is_pack=1' }
    );
    return rows.length > 0;
  }
}
