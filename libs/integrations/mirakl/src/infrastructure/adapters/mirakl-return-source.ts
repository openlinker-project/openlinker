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
 * - **One return**: RT11 by `return_id`, plus its order (OR11) for the line
 *   SKUs and prices RT11 lines do not carry. A missing order does not fail the
 *   read; a missing return answers 404, which core counts as not found.
 *   `return_id` is taken from Mirakl's documentation, not yet seen working on
 *   Empik (staging has no return); the read matches the answer by `id`, so a
 *   parameter Mirakl ignored ends in a 404, never in the wrong return.
 *
 * ## How often RT11 is called
 *
 * Mirakl recommends RT11 at most every 5 minutes. Core reads one return at a
 * time after the feed (one `marketplace.return.sync` job per item), so a feed
 * of N returns would otherwise cost N more RT11 calls within seconds. The feed
 * therefore keeps every return it read in the host cache for
 * {@link FEED_CACHE_TTL_SECONDS}, and `getReturn` answers from it, calling
 * RT11 only for a return the feed did not just read (the status sync's
 * re-reads, a manual re-sync). The feed's copy is as fresh as RT11 itself at
 * that moment, so nothing is lost. The status sync re-reads a small page per
 * pass (see the scheduler tasks), and the client honours `Retry-After` if
 * Mirakl answers 429 anyway. Without a cache every read calls RT11, as before.
 * - **Terminal states** (`CLOSED`, `REFUSED`, `CANCELED`) are declared so the
 *   status sync stops re-reading them.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import type { CachePort } from '@openlinker/shared/cache';
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
/**
 * How long a return read by the feed answers `getReturn`: past the 15-minute
 * poll and the sync jobs it enqueues, short enough that a later re-read goes
 * back to RT11.
 */
const FEED_CACHE_TTL_SECONDS = 20 * 60;

export class MiraklReturnSource {
  private readonly logger = new Logger(MiraklReturnSource.name);
  readonly terminalRawStatuses: readonly string[] = TERMINAL_RETURN_STATES;

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IMiraklHttpClient,
    private readonly now: () => Date,
    private readonly cache?: CachePort
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
          `after ${MAX_WINDOW_HALVINGS} halvings; advancing past it, so returns changed in it may ` +
          `be missed (a return OpenLinker already holds is still re-read by the status sync; a new ` +
          `one is not)`
      );
    }
    const seen = new Set<string>();
    const items: ReturnFeedItem[] = [];
    for (const miraklReturn of page.items) {
      if (!miraklReturn.id) continue;
      const eventKey = buildReturnEventKey(miraklReturn.id, miraklReturn.last_updated);
      if (seen.has(eventKey)) continue;
      seen.add(eventKey);
      await this.remember(miraklReturn);
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
    const miraklReturn =
      (await this.recall(input.externalReturnId)) ?? (await this.readOne(input.externalReturnId));
    if (!miraklReturn) {
      throw new MiraklApiException(
        `Mirakl return ${input.externalReturnId} not found`,
        404,
        'RETURN_NOT_FOUND'
      );
    }
    return mapMiraklReturn(miraklReturn, await this.readOrder(miraklReturn.order_id));
  }

  private async readOne(returnId: string): Promise<MiraklReturn | undefined> {
    const { data } = await this.httpClient.get<{ data?: readonly MiraklReturn[] }>(RETURNS_PATH, {
      queryParams: { return_id: returnId },
    });
    return (data?.data ?? []).find((candidate) => candidate.id === returnId);
  }

  private cacheKey(returnId: string): string {
    return `mirakl:return:${this.connectionId}:${returnId}`;
  }

  /** Keeps a return the feed read; a cache fault only costs an RT11 call later. */
  private async remember(miraklReturn: MiraklReturn): Promise<void> {
    if (!this.cache || !miraklReturn.id) return;
    try {
      await this.cache.set(this.cacheKey(miraklReturn.id), miraklReturn, FEED_CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(
        `Could not keep return ${miraklReturn.id} in the cache (connection: ${this.connectionId}): ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async recall(returnId: string): Promise<MiraklReturn | undefined> {
    if (!this.cache) return undefined;
    try {
      const cached = await this.cache.get<MiraklReturn>(this.cacheKey(returnId));
      return cached?.id === returnId ? cached : undefined;
    } catch (error) {
      this.logger.warn(
        `Could not read return ${returnId} from the cache (connection: ${this.connectionId}): ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
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
