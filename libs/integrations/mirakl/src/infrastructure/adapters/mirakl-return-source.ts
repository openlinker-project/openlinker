/**
 * Mirakl Return Source
 *
 * The `ReturnSourceReader` half of the Mirakl order source (#4279), over RT11
 * (`GET /api/returns`, seek-paginated).
 *
 * - **Feed**: closed `return_last_updated_from` / `_to` windows from the
 *   cursor, the same window rules as the orders feed (overlap, read lag,
 *   halving when a window does not fit the page budget). A return that
 *   changes comes back with a new `last_updated`, so the feed also carries
 *   transitions; the status sync re-reading open returns is the backstop.
 *   Mirakl allows RT11 at most every 5 minutes, so the poll runs every 15.
 * - **One return**: RT11 by `return_id`, plus its order (OR11) for the line
 *   SKUs and prices RT11 lines do not carry. A missing order does not fail the
 *   read; a missing return answers 404, which core counts as not found.
 * - **Terminal states** (`CLOSED`, `REFUSED`, `CANCELED`) are declared so the
 *   status sync stops re-reading them.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import type {
  IncomingReturn,
  ReturnFeedInput,
  ReturnFeedItem,
  ReturnFeedOutput,
} from '@openlinker/core/returns';
import { Logger } from '@openlinker/shared/logging';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import {
  computeFeedWindow,
  halveFeedWindow,
  type MiraklFeedWindow,
} from '../../domain/policies/mirakl-order-feed.policy';
import {
  buildReturnEventKey,
  TERMINAL_RETURN_STATES,
} from '../../domain/policies/mirakl-return.policy';
import type { MiraklReturn } from '../../domain/types/mirakl-return.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';
import { listAllSeek, MIRAKL_MAX_PAGE_SIZE } from '../http/mirakl-pagination';
import { readMiraklOrder } from './mirakl-order-reader';
import { mapMiraklReturn } from './mirakl-return.mapper';

const RETURNS_PATH = '/api/returns';
const MAX_WINDOW_HALVINGS = 16;

export class MiraklReturnSource {
  private readonly logger = new Logger(MiraklReturnSource.name);
  readonly terminalRawStatuses: readonly string[] = TERMINAL_RETURN_STATES;

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IMiraklHttpClient,
    private readonly now: () => Date
  ) {}

  async listReturnFeed(input: ReturnFeedInput): Promise<ReturnFeedOutput> {
    const maxPages = Math.max(1, Math.ceil(input.limit / MIRAKL_MAX_PAGE_SIZE));
    let window = computeFeedWindow(input.fromCursor, this.now());
    let page = await this.readWindow(window, maxPages);
    for (let halvings = 0; page.truncated && halvings < MAX_WINDOW_HALVINGS; halvings++) {
      window = halveFeedWindow(window);
      page = await this.readWindow(window, maxPages);
    }
    if (page.truncated) {
      this.logger.error(
        `Return feed on connection ${this.connectionId} still did not fit ${maxPages} page(s) ` +
          `after ${MAX_WINDOW_HALVINGS} halvings; advancing past it, so returns in it may be missed ` +
          `until the status sync re-reads them`
      );
    }
    const seen = new Set<string>();
    const items: ReturnFeedItem[] = [];
    for (const miraklReturn of page.items) {
      if (!miraklReturn.id) continue;
      const eventKey = buildReturnEventKey(miraklReturn.id, miraklReturn.last_updated);
      if (seen.has(eventKey)) continue;
      seen.add(eventKey);
      items.push({
        externalReturnId: miraklReturn.id,
        externalOrderId: miraklReturn.order_id ?? null,
        occurredAt: miraklReturn.last_updated ?? window.to.toISOString(),
        eventKey,
      });
    }
    return { items, nextCursor: window.to.toISOString() };
  }

  async getReturn(input: { externalReturnId: string }): Promise<IncomingReturn> {
    const { data } = await this.httpClient.get<{ data?: readonly MiraklReturn[] }>(RETURNS_PATH, {
      queryParams: { return_id: input.externalReturnId },
    });
    const miraklReturn = (data?.data ?? []).find(
      (candidate) => candidate.id === input.externalReturnId
    );
    if (!miraklReturn) {
      throw new MiraklApiException(
        `Mirakl return ${input.externalReturnId} not found`,
        404,
        'RETURN_NOT_FOUND'
      );
    }
    return mapMiraklReturn(miraklReturn, await this.readOrder(miraklReturn.order_id));
  }

  private readWindow(
    window: MiraklFeedWindow,
    maxPages: number
  ): Promise<{ items: MiraklReturn[]; truncated: boolean }> {
    return listAllSeek<MiraklReturn>(this.httpClient, RETURNS_PATH, {
      maxPages,
      queryParams: {
        return_last_updated_from: window.from.toISOString(),
        return_last_updated_to: window.to.toISOString(),
      },
    });
  }

  /** The return's order, for line SKUs and prices; `null` when unreadable. */
  private async readOrder(
    orderId: string | undefined
  ): Promise<Awaited<ReturnType<typeof readMiraklOrder>>> {
    if (!orderId) return null;
    try {
      return await readMiraklOrder(this.httpClient, orderId);
    } catch (error) {
      this.logger.warn(
        `Order ${orderId} of a return on connection ${this.connectionId} could not be read: ` +
          `${error instanceof Error ? error.name : 'error'}`
      );
      return null;
    }
  }
}
