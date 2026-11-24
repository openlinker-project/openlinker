/**
 * Sync Cursors Service
 *
 * Application-layer entry point for cursor reads/writes from
 * cross-context callers (#718). Thin pass-through over
 * `ConnectionCursorRepositoryPort` — the service is the seam, not a
 * place for new policy. Monotonicity is the caller's responsibility
 * (see interface docstring).
 *
 * @module libs/core/src/sync/application/services
 * @implements {ISyncCursorsService}
 * @see {@link ISyncCursorsService} for the contract
 */
import { Inject, Injectable } from '@nestjs/common';
import { CONNECTION_CURSOR_REPOSITORY_TOKEN } from '../../sync.tokens';
import { ConnectionCursorRepositoryPort } from '../../domain/ports/connection-cursor-repository.port';
import { isOrderFeedCursorKey } from '../../domain/types/order-feed-seed-cursor.types';
import type { ISyncCursorsService } from './sync-cursors.service.interface';

@Injectable()
export class SyncCursorsService implements ISyncCursorsService {
  constructor(
    @Inject(CONNECTION_CURSOR_REPOSITORY_TOKEN)
    private readonly cursorRepository: ConnectionCursorRepositoryPort
  ) {}

  async getCursor(connectionId: string, cursorKey: string): Promise<string | null> {
    return this.cursorRepository.get(connectionId, cursorKey);
  }

  async advanceCursor(
    connectionId: string,
    cursorKey: string,
    value: string
  ): Promise<void> {
    await this.cursorRepository.set(connectionId, cursorKey, value);
  }

  async deleteCursor(connectionId: string, cursorKey: string): Promise<void> {
    await this.cursorRepository.delete(connectionId, cursorKey);
  }

  async advanceCursorIfNewer(
    connectionId: string,
    cursorKey: string,
    value: string
  ): Promise<boolean> {
    return this.cursorRepository.advanceIfGreater(connectionId, cursorKey, value);
  }

  async getMostRecentCursorUpdate(connectionId: string): Promise<Date | null> {
    return this.cursorRepository.findMostRecentUpdate(connectionId);
  }

  async getCursorValuesByKeySuffix(connectionId: string, keySuffix: string): Promise<string[]> {
    const page = await this.cursorRepository.findMany(
      { connectionId, keySuffix },
      { limit: 20, offset: 0 }
    );
    return page.items.map((item) => item.value);
  }

  async hasOrderFeedCursor(connectionId: string): Promise<boolean> {
    return (await this.listAllCursorKeys(connectionId)).some(isOrderFeedCursorKey);
  }

  async deleteOrderFeedCursors(connectionId: string): Promise<string[]> {
    // Collect first, delete after: deleting while paging would shift the offsets
    // of a result ordered by update time and skip rows.
    const keys = (await this.listAllCursorKeys(connectionId)).filter(isOrderFeedCursorKey);
    for (const key of keys) {
      await this.cursorRepository.delete(connectionId, key);
    }
    return keys;
  }

  /**
   * Every cursor key of the connection. A single page would miss an order cursor
   * that sits past it on a connection with many sweep cursors.
   */
  private async listAllCursorKeys(connectionId: string): Promise<string[]> {
    const pageSize = 200;
    const keys: string[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.cursorRepository.findMany(
        { connectionId },
        { limit: pageSize, offset }
      );
      keys.push(...page.items.map((item) => item.cursorKey));
      if (page.items.length < pageSize) {
        return keys;
      }
    }
  }
}
