/**
 * Shopify Id Pager
 *
 * Serves an `{offset, limit}` window (what `ProductMasterPort.listExternalIds`
 * is asked for) over the Admin API, which pages by opaque cursor only.
 *
 * Walking from the start on every call (the prototype) costs O(offset) per
 * window, so a cycle over N products costs O(N^2 / budget) page reads - fine
 * at 1000 products, not at 100 000. A sweep's windows advance monotonically,
 * so the pager keeps ONE checkpoint per connection and kind in the host cache:
 * the cursor at the start of the last page it read and that page's position.
 * A window that starts at or past the checkpoint resumes there; any other
 * window (a new cycle, a restart) walks from the start.
 *
 * The checkpoint is an optimisation only. A cache miss, a cache failure or a
 * cursor Shopify no longer accepts walks from the start; nothing is refused.
 * Positions count the ids the caller KEEPS (`keep`), so a product archived
 * mid-cycle shifts later positions by one - the same exposure any offset paging
 * has, which the deletion reconcile and the next cycle cover.
 *
 * @module libs/integrations/shopify/src/infrastructure/readers
 */
import type { CachePort } from '@openlinker/shared';

import { ShopifyGraphqlError } from '../../domain/exceptions/shopify-graphql.error';
import type { ShopifyConnection } from '../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../http/shopify-graphql-client';

const CHECKPOINT_TTL_SECONDS = 3_600;

interface Checkpoint {
  readonly position: number;
  readonly cursor: string;
}

export interface ShopifyIdPage<N> {
  readonly nodes: readonly N[];
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

export interface ShopifyIdPagerSpec<N> {
  /** Cache namespace, e.g. `catalogue`. */
  readonly kind: string;
  readonly document: string;
  readonly pageSize: number;
  /** The connection field holding the page, e.g. `products`. */
  readonly field: string;
  /** Extra variables of the document. */
  readonly variables?: Readonly<Record<string, unknown>>;
  /** Id of a node the window keeps, or null to leave it out. */
  readonly idOf: (node: N) => string | null;
}

/**
 * Shopify answers a cursor it does not accept with a GraphQL error on the
 * document (no transport failure, no throttle, no auth code), so that shape is
 * the one a stale checkpoint produces.
 */
function isRejectedCursor(error: unknown): boolean {
  return (
    error instanceof ShopifyGraphqlError &&
    !error.isThrottled() &&
    !error.isAccessDenied() &&
    !error.isInvalidToken() &&
    !error.isMaxCostExceeded()
  );
}

export class ShopifyIdPager {
  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly cache: CachePort | undefined,
    private readonly connectionId: string,
  ) {}

  async window<N>(spec: ShopifyIdPagerSpec<N>, offset: number, limit: number): Promise<string[]> {
    if (limit <= 0) {
      return [];
    }
    const key = `shopify:id-pager:${this.connectionId}:${spec.kind}`;
    const checkpoint = await this.readCheckpoint(key);
    if (checkpoint !== null && checkpoint.position <= offset) {
      try {
        return await this.walk(spec, key, checkpoint.position, checkpoint.cursor, offset, limit);
      } catch (error) {
        // Only a cursor Shopify no longer accepts starts over. A throttle, an
        // auth failure or an outage would fail the walk from the start the same
        // way, after paying for every page up to the checkpoint again.
        if (!isRejectedCursor(error)) {
          throw error;
        }
      }
    }
    return this.walk(spec, key, 0, null, offset, limit);
  }

  private async walk<N>(
    spec: ShopifyIdPagerSpec<N>,
    key: string,
    startPosition: number,
    startCursor: string | null,
    offset: number,
    limit: number,
  ): Promise<string[]> {
    const end = offset + limit;
    const ids: string[] = [];
    const position = startPosition;
    let after = startCursor;
    let lastPageStart: Checkpoint | null = null;
    while (position + ids.length < end) {
      const pageStart = position + ids.length;
      const page = await this.page(spec, after);
      if (after !== null) {
        lastPageStart = { position: pageStart, cursor: after };
      }
      for (const node of page.nodes) {
        const id = spec.idOf(node);
        if (id !== null) {
          ids.push(id);
        }
      }
      if (!page.hasNextPage || page.endCursor === null) {
        break;
      }
      after = page.endCursor;
    }
    if (lastPageStart !== null) {
      await this.writeCheckpoint(key, lastPageStart);
    }
    const from = offset - position;
    return ids.slice(Math.max(0, from), Math.max(0, from) + limit);
  }

  private async page<N>(spec: ShopifyIdPagerSpec<N>, after: string | null): Promise<ShopifyIdPage<N>> {
    const data = await this.client.query<Record<string, ShopifyConnection<N>>>(spec.document, {
      ...spec.variables,
      first: spec.pageSize,
      after,
    });
    const connection = data[spec.field];
    return {
      nodes: connection?.nodes ?? [],
      hasNextPage: connection?.pageInfo?.hasNextPage === true,
      endCursor: connection?.pageInfo?.endCursor ?? null,
    };
  }

  private async readCheckpoint(key: string): Promise<Checkpoint | null> {
    if (this.cache === undefined) {
      return null;
    }
    const value = await this.cache.get<Checkpoint>(key).catch(() => null);
    return value !== null &&
      typeof value.position === 'number' &&
      typeof value.cursor === 'string' &&
      value.cursor.length > 0
      ? value
      : null;
  }

  private async writeCheckpoint(key: string, checkpoint: Checkpoint): Promise<void> {
    if (this.cache !== undefined) {
      await this.cache.set(key, checkpoint, CHECKPOINT_TTL_SECONDS).catch(() => undefined);
    }
  }
}
