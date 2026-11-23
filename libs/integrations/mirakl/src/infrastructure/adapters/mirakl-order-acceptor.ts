/**
 * Mirakl Order Acceptor
 *
 * Accepts every Mirakl order waiting for acceptance (OR21, every line
 * `accepted: true`). On Mirakl an order starts in `WAITING_ACCEPTANCE` and the
 * seller must decide each line within the operator's deadline (5 days on
 * Empik) or it lapses; no other OpenLinker source has this step, so there is no
 * core port for it and the plugin does it itself (#4275).
 *
 * Outcomes per order:
 *
 * - accepted: OR21 answered 2xx.
 * - already handled: `ORDER_INVALID_STATE`, which is what a retry after a lost
 *   response, or an order the seller accepted in the panel meanwhile, gets.
 * - failed: any other refusal (`ORDER_LINE_*`, a 4xx without a code). Logged as
 *   a defect and not retried, because the same request fails the same way; the
 *   order is retried on the next poll only if it is still waiting.
 *
 * Authentication, rate-limit and network failures propagate, so the poll job
 * fails and retries rather than reporting a partial pass as done.
 *
 * Acceptance does not check stock (the MVP assumption of #4275); a stock-checked
 * or manual acceptance needs a core sub-capability and is a follow-up.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import { Logger } from '@openlinker/shared/logging';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import type {
  MiraklAcceptanceSummary,
  MiraklAcceptOrderBody,
  MiraklOrder,
} from '../../domain/types/mirakl-order.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';
import { listAllOffset } from '../http/mirakl-pagination';

const WAITING_ACCEPTANCE = 'WAITING_ACCEPTANCE';
const ORDER_INVALID_STATE = 'ORDER_INVALID_STATE';
/** 1 000 orders per pass; anything beyond waits for the next poll. */
const ACCEPTANCE_MAX_PAGES = 10;

export class MiraklOrderAcceptor {
  private readonly logger = new Logger(MiraklOrderAcceptor.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IMiraklHttpClient,
  ) {}

  async acceptWaitingOrders(): Promise<MiraklAcceptanceSummary> {
    const { items: orders, truncated } = await listAllOffset<MiraklOrder>(
      this.httpClient,
      '/api/orders',
      {
        itemsKey: 'orders',
        queryParams: { order_state_codes: WAITING_ACCEPTANCE },
        maxPages: ACCEPTANCE_MAX_PAGES,
      },
    );
    if (truncated) {
      this.logger.warn(
        `More orders are waiting for acceptance on connection ${this.connectionId} than one pass reads; the rest are accepted on the next poll`,
      );
    }

    let accepted = 0;
    let alreadyHandled = 0;
    let failed = 0;
    for (const order of orders) {
      const outcome = await this.acceptOrder(order);
      if (outcome === 'accepted') accepted++;
      else if (outcome === 'already-handled') alreadyHandled++;
      else if (outcome === 'failed') failed++;
    }

    const summary = { accepted, alreadyHandled, failed };
    if (orders.length > 0) {
      this.logger.log(
        `Order acceptance on connection ${this.connectionId}: ${accepted} accepted, ` +
          `${alreadyHandled} already handled, ${failed} failed`,
      );
    }
    return summary;
  }

  private async acceptOrder(
    order: MiraklOrder,
  ): Promise<'accepted' | 'already-handled' | 'failed' | 'skipped'> {
    const orderId = order.order_id;
    const body = buildAcceptBody(order);
    if (!orderId || body.order_lines.length === 0) {
      return 'skipped';
    }
    try {
      await this.httpClient.put(`/api/orders/${encodeURIComponent(orderId)}/accept`, body);
      return 'accepted';
    } catch (error) {
      if (!(error instanceof MiraklApiException)) {
        throw error;
      }
      if (error.miraklCode === ORDER_INVALID_STATE) {
        return 'already-handled';
      }
      // The code and status only: the response body can echo order data.
      this.logger.error(
        `Could not accept order ${orderId} on connection ${this.connectionId}: ` +
          `${error.miraklCode ?? 'no code'} (HTTP ${error.statusCode ?? '?'})`,
      );
      return 'failed';
    }
  }
}

/**
 * A decision for every line still waiting. A line without a state is included:
 * Mirakl requires a decision for every line, and leaving one out is refused
 * with `ORDER_LINE_ACCEPTANCE_DECISION_MISSING`.
 */
export function buildAcceptBody(order: MiraklOrder): MiraklAcceptOrderBody {
  return {
    order_lines: (order.order_lines ?? [])
      .filter((line) => line.order_line_id && (line.order_line_state ?? WAITING_ACCEPTANCE) === WAITING_ACCEPTANCE)
      .map((line) => ({ id: line.order_line_id as string, accepted: true })),
  };
}
