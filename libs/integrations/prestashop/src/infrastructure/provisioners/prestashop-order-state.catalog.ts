/**
 * PrestaShop Order-State Catalog
 *
 * Reads the shop's own `ps_order_state` rows once and answers both status
 * questions from them, so no code path has to guess an id (#2607).
 *
 * Two directions, one catalogue:
 *
 *   - inbound, `statusOf(stateId)` - what a PrestaShop order's
 *     `current_state` MEANS, for the order feed and for hydration;
 *   - outbound, `stateIdFor(status)` - which state to write when OpenLinker
 *     moves an order to a neutral status.
 *
 * The read therefore takes EVERY state, including soft-deleted ones, and the
 * `deleted` flag is applied only to the outbound direction (#2627 review).
 * PrestaShop soft-deletes a state rather than removing it, precisely because
 * orders keep pointing at it - so filtering the read left a merchant's retired
 * "Anulowane" state unresolvable, `statusOf` answered `null`,
 * `resolveFeedEventType` fell through to `'updated'`, and a cancelled order was
 * re-entered on the create/update path and resurrected as active (#1161).
 * Hydration reported the same order as `pending` by the same route. The filter
 * is right for the outbound direction, where writing an order into a state the
 * merchant retired would strand it, and wrong for the inbound one, where the
 * state is a fact about an order that already exists.
 *
 * Both go through `deriveOrderStatusFromState`, so the two directions cannot
 * disagree about what a state row stands for.
 *
 * The outbound tie-break is the LOWEST id whose meaning matches. That is not
 * arbitrary: on a default PrestaShop install it resolves to exactly the ids
 * the removed hardcoded table used (1 pending, 2 processing, 4 shipped,
 * 5 delivered, 6 cancelled, 7 refunded), so a vanilla shop keeps writing the
 * same states it always did. A shop that added its own states gets a state
 * that actually means what OpenLinker asked for, instead of state number 4.
 *
 * The read is cached for the lifetime of the resolver instance, which the
 * adapters scope to one connection. Order states change when a merchant edits
 * them in the back office, which is rare, and a per-instance cache means a
 * poll pays for the read once rather than per order.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import type { OrderStatus } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import {
  deriveOrderState,
  deriveOrderStatusFromState,
  extractOrderStateLabels,
} from '../mappers/prestashop-order-state-semantics';
import type { PrestashopOrderState } from '../../domain/types/prestashop-options.types';
import { readAllPrestashopResourcePages } from '../http/prestashop-paged-read';

/**
 * Whether the merchant soft-deleted this state.
 *
 * PrestaShop never removes an `order_state` row, because orders point at it;
 * it flags it. So a deleted state is invisible in the back office and still
 * carries live orders.
 */
function isSoftDeletedOrderState(state: PrestashopOrderState): boolean {
  return String(state.deleted) === '1';
}

/**
 * Row ceiling for the catalogue read. A shop with more order states than this
 * has a problem OpenLinker cannot paginate its way out of, and past the ceiling
 * the paged read refuses rather than handing back a short list.
 */
const ORDER_STATE_READ_LIMIT = 1000;

/**
 * An immutable answer set derived from one read of the shop's order states.
 */
export class PrestashopOrderStateSnapshot {
  private readonly byId: ReadonlyMap<string, PrestashopOrderState>;

  /** Ascending by numeric id, so the outbound tie-break is deterministic. */
  private readonly ordered: readonly PrestashopOrderState[];

  constructor(rows: readonly PrestashopOrderState[]) {
    const byId = new Map<string, PrestashopOrderState>();
    for (const row of rows) {
      byId.set(String(row.id), row);
    }
    this.byId = byId;
    this.ordered = [...rows].sort((a, b) => Number(a.id) - Number(b.id));
  }

  /** Every state the shop has, ascending by id - soft-deleted ones included. */
  all(): readonly PrestashopOrderState[] {
    return this.ordered;
  }

  /**
   * Every state the merchant has NOT retired, ascending by id.
   *
   * What an operator-facing list should offer: a soft-deleted state is gone
   * from the back office, and `stateIdFor` refuses to target one, so offering
   * it to be mapped to would offer a choice the write path will not honour.
   */
  active(): readonly PrestashopOrderState[] {
    return this.ordered.filter((state) => !isSoftDeletedOrderState(state));
  }

  /** The raw state row, or `null` when the shop has no such state. */
  find(stateId: string | number | undefined): PrestashopOrderState | null {
    if (stateId === undefined || stateId === null) {
      return null;
    }
    return this.byId.get(String(stateId)) ?? null;
  }

  /**
   * What this state means, or `null` when the id is not a state on this shop.
   *
   * `null` rather than `'pending'` because an unknown id is a different fact
   * from an unstarted order, and the caller decides what to do with it.
   */
  statusOf(stateId: string | number | undefined): OrderStatus | null {
    const state = this.find(stateId);
    return state === null ? null : deriveOrderStatusFromState(state);
  }

  /**
   * The states nothing could be read from: no flag set, and no label that reads
   * as a cancellation or a refund.
   *
   * On a clean install these are the awaiting states, where `pending` is the
   * right answer. On a shop in a language the label vocabulary does not cover
   * they can include the cancellation or the refund state, and then `pending`
   * is a false statement about money - which is why the catalogue reports them
   * instead of letting them pass unremarked (#2607 review).
   */
  statesWithoutEvidence(): readonly PrestashopOrderState[] {
    return this.ordered.filter((state) => deriveOrderState(state).basis === 'no-evidence');
  }

  /**
   * The lowest-id state on this shop that means `status`, or `null` when the
   * shop has none.
   */
  stateIdFor(status: OrderStatus): number | null {
    for (const state of this.ordered) {
      // Never target a soft-deleted state: the merchant removed it from the
      // back office and an order written into it is stranded somewhere no UI
      // offers. The INBOUND direction deliberately still resolves those rows -
      // see the class docblock.
      if (isSoftDeletedOrderState(state)) {
        continue;
      }
      if (deriveOrderStatusFromState(state) === status) {
        const id = Number(state.id);
        if (Number.isFinite(id) && id > 0) {
          return id;
        }
      }
    }
    return null;
  }
}

/**
 * Lazily loads and caches one connection's order-state catalogue.
 */
export class PrestashopOrderStateCatalog {
  private readonly logger = new Logger(PrestashopOrderStateCatalog.name);

  /**
   * The in-flight or settled load. Held as the promise rather than the result
   * so two concurrent callers share one WebService read instead of racing two.
   */
  private pending: Promise<PrestashopOrderStateSnapshot> | null = null;

  constructor(
    private readonly httpClient: IPrestashopWebserviceClient,
    private readonly connectionId: string
  ) {}

  async load(): Promise<PrestashopOrderStateSnapshot> {
    if (this.pending === null) {
      this.pending = this.read();
    }
    try {
      return await this.pending;
    } catch (error) {
      // A failed read must not be cached as a permanent empty catalogue: the
      // next poll would then map every order to an unknown state without ever
      // retrying the shop.
      this.pending = null;
      throw error;
    }
  }

  private async read(): Promise<PrestashopOrderStateSnapshot> {
    // Paged, not a bare `limit=1000` (#2627 review): a shop past the limit
    // answered a short list that read as the whole catalogue, and every state
    // past the cut resolved to `null` - which is exactly the resurrection this
    // read now exists to prevent, arriving by truncation instead of by a
    // filter.
    const rows = await readAllPrestashopResourcePages<PrestashopOrderState>(
      this.httpClient,
      'order_states',
      undefined,
      {
        connectionId: this.connectionId,
        detail: 'every order state on the shop',
        maxRows: ORDER_STATE_READ_LIMIT,
      }
    );
    this.logger.debug(
      `Read ${rows.length} PrestaShop order states (connection: ${this.connectionId})`
    );
    const snapshot = new PrestashopOrderStateSnapshot(rows);
    this.reportStatesWithoutEvidence(snapshot);
    return snapshot;
  }

  /**
   * One line per read, not per order: the read is cached for the connection's
   * lifetime, so this is the cheapest place to say it once.
   */
  private reportStatesWithoutEvidence(snapshot: PrestashopOrderStateSnapshot): void {
    const unread = snapshot.statesWithoutEvidence();
    if (unread.length === 0) {
      return;
    }
    const described = unread
      .map((state) => `id=${state.id} "${extractOrderStateLabels(state.name).join(' / ')}"`)
      .join(', ');
    this.logger.warn(
      `${unread.length} PrestaShop order states carry no flag and no label OpenLinker recognises, ` +
        `so orders sitting in them read as 'pending': ${described}. That is correct for an ` +
        `awaiting-payment state. If one of them means cancelled or refunded, OpenLinker cannot ` +
        `tell from the name and the label needs reporting so the vocabulary can cover it ` +
        `(connection: ${this.connectionId}).`
    );
  }
}
