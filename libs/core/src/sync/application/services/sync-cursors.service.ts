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

  async deleteOrderFeedCursors(connectionId: string): Promise<string[]> {
    const page = await this.cursorRepository.findMany({ connectionId }, { limit: 200, offset: 0 });
    const keys = page.items.map((item) => item.cursorKey).filter(isOrderFeedCursorKey);
    for (const key of keys) {
      await this.cursorRepository.delete(connectionId, key);
    }
    return keys;
  }
}
