/**
 * Shoper Product Reader
 *
 * `GET /products/:id`, shared by every adapter of one connection resolution and
 * THE place a master-side deletion becomes the neutral error core stales
 * variants on (#1599, #1688). `ProductMaster` and `InventoryMaster` both read
 * through here, so whichever of them core reaches a deleted product through
 * first reports it identically - and the request is made once.
 *
 * Only a 404 Shoper itself reported counts (`ShoperApiError.isResourceNotFound`);
 * a bare 404, a 401/403, a 429, a 5xx and a network failure pass through
 * untouched, because reading any of those as a deletion would stale a whole
 * catalogue on a configuration or availability problem.
 *
 * Promise-memoised per reader instance (concurrent callers share one request),
 * a failure is dropped so the next call retries. The instance lives for one
 * resolution, so a cached payload cannot go meaningfully stale.
 *
 * @module libs/integrations/shoper/src/infrastructure/readers
 */
import { MasterProductNotFoundError } from '@openlinker/core/products';

import { ShoperApiError } from '../../domain/exceptions/shoper-api.error';
import type { ShoperProduct } from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../http/shoper-http-client';

export class ShoperProductReader {
  private readonly reads = new Map<string, Promise<ShoperProduct>>();

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly connectionId: string,
  ) {}

  /**
   * @param externalId - the Shoper product id to read
   * @param productId - the OpenLinker internal id, carried on the neutral error
   */
  read(externalId: string, productId: string): Promise<ShoperProduct> {
    let read = this.reads.get(externalId);
    if (read === undefined) {
      read = this.client.get<ShoperProduct>(`/products/${externalId}`).then(
        (r) => r.data,
        (error: unknown): never => {
          if (error instanceof ShoperApiError && error.isResourceNotFound()) {
            throw new MasterProductNotFoundError(productId, this.connectionId, error);
          }
          throw error instanceof Error ? error : new Error(String(error));
        },
      );
      this.reads.set(externalId, read);
      read.catch(() => this.reads.delete(externalId));
    }
    return read;
  }
}
