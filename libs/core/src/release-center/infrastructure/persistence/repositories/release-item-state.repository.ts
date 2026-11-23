/**
 * Release Item State Repository
 *
 * Two separate `INSERT ... ON CONFLICT` statements, one per scope, because each
 * conflict target must repeat its partial index predicate and a single
 * statement cannot name both. A batch runs in one transaction with keys already
 * in a fixed order (the service sorts them) so concurrent batches lock in one
 * order.
 *
 * The row-count limit is enforced under a lock: user scope locks the user's
 * `user_release_state` row (created first, `DO NOTHING`), installation scope
 * takes a transaction-level advisory lock. Counting without a lock enforces
 * nothing at READ COMMITTED.
 *
 * @module libs/core/src/release-center/infrastructure/persistence/repositories
 * @implements {ReleaseItemStateRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { Repository } from 'typeorm';
import { ReleaseItemState } from '../../../domain/entities/release-center.entity';
import { ReleaseStateLimitExceededError } from '../../../domain/exceptions/release-center.exceptions';
import type { ReleaseItemStateRepositoryPort } from '../../../domain/ports/release-item-state-repository.port';
import type {
  ReleaseDoneVia,
  ReleaseItemScope,
  ReleaseItemStateChange,
  ReleaseItemStatus,
} from '../../../domain/types/release-center.types';
import { ReleaseItemStateOrmEntity } from '../entities/release-item-state.orm-entity';

const INSTALLATION_LOCK_KEY = 'release_item_states:installation';

@Injectable()
export class ReleaseItemStateRepository implements ReleaseItemStateRepositoryPort {
  constructor(
    @InjectRepository(ReleaseItemStateOrmEntity)
    private readonly ormRepository: Repository<ReleaseItemStateOrmEntity>
  ) {}

  async listInstallation(): Promise<ReleaseItemState[]> {
    const rows = await this.ormRepository.find({
      where: { scope: 'installation' },
      order: { itemKey: 'ASC' },
    });
    return rows.map((row) => this.toDomain(row));
  }

  async listForUser(userId: string): Promise<ReleaseItemState[]> {
    const rows = await this.ormRepository.find({
      where: { scope: 'user', userId },
      order: { itemKey: 'ASC' },
    });
    return rows.map((row) => this.toDomain(row));
  }

  async upsertUserStates(
    userId: string,
    changes: readonly ReleaseItemStateChange[],
    limit: number
  ): Promise<ReleaseItemState[]> {
    return this.ormRepository.manager.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO "user_release_state" ("userId") VALUES ($1) ON CONFLICT ("userId") DO NOTHING`,
        [userId]
      );
      await manager.query(`SELECT 1 FROM "user_release_state" WHERE "userId" = $1 FOR UPDATE`, [
        userId,
      ]);
      await this.enforceLimit(manager, 'user', userId, changes, limit, true);

      const saved: ReleaseItemState[] = [];
      for (const change of changes) {
        const rows = await manager.query<ReleaseItemStateOrmEntity[]>(
          `INSERT INTO "release_item_states" AS t
             ("scope", "userId", "itemKey", "status", "doneVia", "snoozedUntil", "updatedAt")
           VALUES ('user', $1, $2, $3, $4, $5, now())
           ON CONFLICT ("userId", "itemKey") WHERE "scope" = 'user' DO UPDATE SET
             "status" = EXCLUDED."status",
             "doneVia" = EXCLUDED."doneVia",
             "snoozedUntil" = EXCLUDED."snoozedUntil",
             "updatedAt" = now()
           RETURNING t.*`,
          [
            userId,
            change.itemKey,
            change.status,
            change.doneVia ?? null,
            change.snoozedUntil ?? null,
          ]
        );
        saved.push(this.toDomain(rows[0]));
      }
      return saved;
    });
  }

  async upsertInstallationStates(
    actedByUserId: string | null,
    changes: readonly ReleaseItemStateChange[],
    limit: number
  ): Promise<ReleaseItemState[]> {
    return this.ormRepository.manager.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [INSTALLATION_LOCK_KEY]);
      await this.enforceLimit(manager, 'installation', null, changes, limit, false);

      const saved: ReleaseItemState[] = [];
      for (const change of changes) {
        const rows = await manager.query<ReleaseItemStateOrmEntity[]>(
          `INSERT INTO "release_item_states" AS t
             ("scope", "userId", "itemKey", "status", "doneVia", "actedByUserId", "snoozedUntil", "updatedAt")
           VALUES ('installation', NULL, $1, $2, $3, $4, $5, now())
           ON CONFLICT ("itemKey") WHERE "scope" = 'installation' DO UPDATE SET
             "status" = EXCLUDED."status",
             "doneVia" = EXCLUDED."doneVia",
             "actedByUserId" = EXCLUDED."actedByUserId",
             "snoozedUntil" = EXCLUDED."snoozedUntil",
             "updatedAt" = now()
           RETURNING t.*`,
          [
            change.itemKey,
            change.status,
            change.doneVia ?? null,
            actedByUserId,
            change.snoozedUntil ?? null,
          ]
        );
        saved.push(this.toDomain(rows[0]));
      }
      return saved;
    });
  }

  async pruneInstallationConnectionStates(liveConnectionIds: readonly string[]): Promise<number> {
    // Keys are `stepId` or `stepId:connectionId`; only the latter can go stale.
    const result = (await this.ormRepository.query(
      `DELETE FROM "release_item_states"
       WHERE "scope" = 'installation'
         AND "itemKey" ~ ':[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND right("itemKey", 36) <> ALL($1::text[])
       RETURNING "id"`,
      [[...liveConnectionIds]]
    )) as unknown[];
    return result.length;
  }

  /**
   * Runs under the caller's lock. Only keys that are not already stored count
   * toward the limit; when over, the oldest `deleted` rows go first (user scope
   * only, never a row this batch is about to write), then the write is refused.
   */
  private async enforceLimit(
    manager: EntityManager,
    scope: ReleaseItemScope,
    userId: string | null,
    changes: readonly ReleaseItemStateChange[],
    limit: number,
    evictDeleted: boolean
  ): Promise<void> {
    const owner = scope === 'user' ? `"userId" = $1` : `"userId" IS NULL`;
    const ownerParams: unknown[] = scope === 'user' ? [userId] : [];
    const offset = ownerParams.length;
    const keys = changes.map((c) => c.itemKey);

    const [{ total }] = await manager.query<{ total: number }[]>(
      `SELECT count(*)::int AS total FROM "release_item_states" WHERE "scope" = '${scope}' AND ${owner}`,
      ownerParams
    );
    const [{ existing }] = await manager.query<{ existing: number }[]>(
      `SELECT count(*)::int AS existing FROM "release_item_states"
       WHERE "scope" = '${scope}' AND ${owner} AND "itemKey" = ANY($${offset + 1}::text[])`,
      [...ownerParams, keys]
    );

    const over = total + (keys.length - existing) - limit;
    if (over <= 0) return;

    let evicted = 0;
    if (evictDeleted) {
      // Wrapped in a CTE so the driver answers with ordinary rows: a bare DELETE ... RETURNING comes back
      // from TypeORM's postgres driver as a [rows, affectedCount] tuple, whose length is always 2 and
      // would make the eviction look successful even when nothing was evictable.
      const [{ n }] = await manager.query<{ n: number }[]>(
        `WITH evicted AS (
           DELETE FROM "release_item_states" WHERE "id" IN (
             SELECT "id" FROM "release_item_states"
             WHERE "scope" = 'user' AND "userId" = $1 AND "status" = 'deleted'
               AND NOT ("itemKey" = ANY($2::text[]))
             ORDER BY "updatedAt" ASC
             LIMIT $3)
           RETURNING "id")
         SELECT count(*)::int AS n FROM evicted`,
        [userId, keys, over]
      );
      evicted = n;
    }
    if (evicted < over) {
      throw new ReleaseStateLimitExceededError(scope, limit);
    }
  }

  private toDomain(row: ReleaseItemStateOrmEntity): ReleaseItemState {
    return new ReleaseItemState(
      row.id,
      row.scope as ReleaseItemScope,
      row.userId,
      row.itemKey,
      row.status as ReleaseItemStatus,
      row.doneVia as ReleaseDoneVia | null,
      row.actedByUserId,
      row.snoozedUntil,
      row.updatedAt
    );
  }
}
