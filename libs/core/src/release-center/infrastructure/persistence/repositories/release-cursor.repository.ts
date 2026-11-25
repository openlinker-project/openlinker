/**
 * Release Cursor Repository
 *
 * `advanceCursor` is one `INSERT ... ON CONFLICT DO UPDATE ... WHERE` so the
 * "only move forward" rule is decided by Postgres on the stored row, not by a
 * read-then-write that a concurrent lower write could slip between. The row
 * comparison is the SQL twin of `compareReleaseVersions`; a first write (no
 * stored version yet) is always accepted.
 *
 * @module libs/core/src/release-center/infrastructure/persistence/repositories
 * @implements {ReleaseCursorRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserReleaseState } from '../../../domain/entities/release-center.entity';
import type {
  AdvanceReleaseCursorResult,
  ReleaseCursorRepositoryPort,
} from '../../../domain/ports/release-cursor-repository.port';
import type { ParsedReleaseVersion } from '../../../domain/types/release-center.types';
import { UserReleaseStateOrmEntity } from '../entities/user-release-state.orm-entity';

@Injectable()
export class ReleaseCursorRepository implements ReleaseCursorRepositoryPort {
  constructor(
    @InjectRepository(UserReleaseStateOrmEntity)
    private readonly ormRepository: Repository<UserReleaseStateOrmEntity>
  ) {}

  async findByUserId(userId: string): Promise<UserReleaseState | null> {
    const row = await this.ormRepository.findOne({ where: { userId } });
    return row ? this.toDomain(row) : null;
  }

  async advanceCursor(
    userId: string,
    version: ParsedReleaseVersion
  ): Promise<AdvanceReleaseCursorResult> {
    const rows = (await this.ormRepository.query(
      `INSERT INTO "user_release_state" AS t
         ("userId", "lastSeenVersion", "major", "minor", "patch", "rank", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT ("userId") DO UPDATE SET
         "lastSeenVersion" = EXCLUDED."lastSeenVersion",
         "major" = EXCLUDED."major",
         "minor" = EXCLUDED."minor",
         "patch" = EXCLUDED."patch",
         "rank" = EXCLUDED."rank",
         "updatedAt" = now()
       WHERE t."major" IS NULL
          OR (t."major", t."minor", t."patch", t."rank")
           < (EXCLUDED."major", EXCLUDED."minor", EXCLUDED."patch", EXCLUDED."rank")
       RETURNING t.*`,
      [userId, version.text, version.major, version.minor, version.patch, version.rank]
    )) as UserReleaseStateOrmEntity[];

    if (rows.length > 0) {
      return { applied: true, state: this.toDomain(rows[0]) };
    }
    // A rejected write is a normal answer: hand back what is stored.
    const current = await this.findByUserId(userId);
    if (!current) {
      throw new Error(`Release cursor row for ${userId} vanished during a rejected write`);
    }
    return { applied: false, state: current };
  }

  async setSkipDialog(userId: string, skipDialog: boolean): Promise<UserReleaseState> {
    const rows = (await this.ormRepository.query(
      `INSERT INTO "user_release_state" AS t ("userId", "skipDialog", "updatedAt")
       VALUES ($1, $2, now())
       ON CONFLICT ("userId") DO UPDATE SET "skipDialog" = EXCLUDED."skipDialog", "updatedAt" = now()
       RETURNING t.*`,
      [userId, skipDialog]
    )) as UserReleaseStateOrmEntity[];
    return this.toDomain(rows[0]);
  }

  private toDomain(row: UserReleaseStateOrmEntity): UserReleaseState {
    const version =
      row.lastSeenVersion !== null &&
      row.major !== null &&
      row.minor !== null &&
      row.patch !== null &&
      row.rank !== null
        ? {
            text: row.lastSeenVersion,
            major: row.major,
            minor: row.minor,
            patch: row.patch,
            rank: row.rank,
          }
        : null;
    return new UserReleaseState(row.userId, version, row.skipDialog, row.updatedAt);
  }
}
