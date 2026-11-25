/**
 * Saved View Repository
 *
 * TypeORM implementation of `SavedViewRepositoryPort`.
 *
 * Name uniqueness is enforced by the two partial unique indexes and surfaced by
 * catching `23505` on THOSE constraint names - at READ COMMITTED a prior
 * existence check enforces nothing. The revision guard is one conditional
 * UPDATE (`WHERE id AND revision = expected`, `RETURNING`), the same
 * claim-style write the repo uses elsewhere, so two concurrent edits cannot
 * both win.
 *
 * Making a shared view the workspace default demotes the previous one in the
 * SAME transaction, ahead of the write, so the partial unique index on
 * `(page_key) WHERE shared default` is never violated by a legitimate swap.
 *
 * @module libs/core/src/saved-views/infrastructure/persistence/repositories
 * @implements {SavedViewRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager} from 'typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { SavedView, SavedViewDefault } from '../../../domain/entities/saved-view.entity';
import { SavedViewNameTakenError } from '../../../domain/exceptions/saved-view.exceptions';
import type {
  InsertSavedViewInput,
  SavedViewPatch,
  SavedViewRepositoryPort,
} from '../../../domain/ports/saved-view-repository.port';
import { SavedViewScopeValues } from '../../../domain/types/saved-view.types';
import type { SavedViewScope } from '../../../domain/types/saved-view.types';
import { SavedViewDefaultOrmEntity } from '../entities/saved-view-default.orm-entity';
import { SavedViewOrmEntity } from '../entities/saved-view.orm-entity';

/** Hard ceiling on shared views returned for one page. */
const SHARED_VIEWS_LIST_CAP = 100;
const UNIQUE_VIOLATION = '23505';
const NAME_CONSTRAINTS = new Set(['UQ_saved_views_personal_name', 'UQ_saved_views_shared_name']);

function isNameViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driver = error.driverError as { code?: string; constraint?: string } | undefined;
  return (
    driver?.code === UNIQUE_VIOLATION &&
    driver.constraint !== undefined &&
    NAME_CONSTRAINTS.has(driver.constraint)
  );
}

@Injectable()
export class SavedViewRepository implements SavedViewRepositoryPort {
  constructor(
    @InjectRepository(SavedViewOrmEntity)
    private readonly views: Repository<SavedViewOrmEntity>,
    @InjectRepository(SavedViewDefaultOrmEntity)
    private readonly defaults: Repository<SavedViewDefaultOrmEntity>,
    private readonly dataSource: DataSource
  ) {}

  async findById(id: string): Promise<SavedView | null> {
    const row = await this.views.findOne({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async listVisible(userId: string, pageKey: string): Promise<SavedView[]> {
    // Two bounded reads rather than one OR: personal views are capped per user
    // and page by the service, and shared views are capped here so one page
    // with a runaway shared list cannot make every list request unbounded.
    const [shared, personal] = await Promise.all([
      this.views.find({
        where: { scope: 'shared', pageKey },
        order: { name: 'ASC' },
        take: SHARED_VIEWS_LIST_CAP,
      }),
      this.views.find({
        where: { scope: 'personal', pageKey, ownerUserId: userId },
        order: { name: 'ASC' },
      }),
    ]);
    return [...shared, ...personal].map((row) => this.toDomain(row));
  }

  async countPersonal(userId: string, pageKey: string): Promise<number> {
    return this.views.count({ where: { scope: 'personal', ownerUserId: userId, pageKey } });
  }

  async insert(input: InsertSavedViewInput): Promise<SavedView> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        if (input.isWorkspaceDefault) {
          await this.demoteWorkspaceDefaults(manager, input.pageKey, null);
        }
        const repo = manager.getRepository(SavedViewOrmEntity);
        const saved = await repo.save(
          repo.create({
            scope: input.scope,
            ownerUserId: input.ownerUserId,
            createdByUserId: input.createdByUserId,
            pageKey: input.pageKey,
            name: input.name,
            definition: input.definition,
            isWorkspaceDefault: input.isWorkspaceDefault,
          })
        );
        return this.toDomain(saved);
      });
    } catch (error) {
      if (isNameViolation(error)) throw new SavedViewNameTakenError(input.pageKey, input.name);
      throw error;
    }
  }

  async updateIfRevision(
    id: string,
    expectedRevision: number,
    patch: SavedViewPatch
  ): Promise<SavedView | null> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const current = await manager.getRepository(SavedViewOrmEntity).findOne({ where: { id } });
        if (current === null) return null;

        if (patch.isWorkspaceDefault === true) {
          await this.demoteWorkspaceDefaults(manager, current.pageKey, id);
        }

        const set: QueryDeepPartialEntity<SavedViewOrmEntity> = {
          revision: () => '"revision" + 1',
          updatedAt: () => 'now()',
        };
        if (patch.name !== undefined) set.name = patch.name;
        if (patch.definition !== undefined) {
          set.definition = patch.definition as QueryDeepPartialEntity<SavedViewOrmEntity>['definition'];
        }
        if (patch.isWorkspaceDefault !== undefined) set.isWorkspaceDefault = patch.isWorkspaceDefault;

        const result = await manager
          .createQueryBuilder()
          .update(SavedViewOrmEntity)
          .set(set)
          .where('"id" = :id AND "revision" = :expectedRevision', { id, expectedRevision })
          .returning('*')
          .execute();
        const rows = result.raw as Record<string, unknown>[];
        if (rows.length === 0) return null;
        return this.fromRawRow(rows[0]);
      });
    } catch (error) {
      if (isNameViolation(error)) {
        const existing = await this.views.findOne({ where: { id } });
        throw new SavedViewNameTakenError(existing?.pageKey ?? '', patch.name ?? existing?.name ?? '');
      }
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.views.delete({ id });
    return (result.affected ?? 0) > 0;
  }

  async findDefault(userId: string, pageKey: string): Promise<SavedViewDefault | null> {
    const row = await this.defaults.findOne({ where: { userId, pageKey } });
    return row ? new SavedViewDefault(row.userId, row.pageKey, row.savedViewId) : null;
  }

  async upsertDefault(userId: string, pageKey: string, savedViewId: string | null): Promise<void> {
    await this.defaults.upsert(
      { userId, pageKey, savedViewId, updatedAt: new Date() },
      ['userId', 'pageKey']
    );
  }

  async clearDefault(userId: string, pageKey: string): Promise<void> {
    await this.defaults.delete({ userId, pageKey });
  }

  private async demoteWorkspaceDefaults(
    manager: EntityManager,
    pageKey: string,
    exceptId: string | null
  ): Promise<void> {
    await manager.query(
      `UPDATE "saved_views" SET "is_workspace_default" = false
       WHERE "page_key" = $1 AND "scope" = 'shared' AND "is_workspace_default" = true
         AND ($2::uuid IS NULL OR "id" <> $2::uuid)`,
      [pageKey, exceptId]
    );
  }

  private toScope(value: string): SavedViewScope {
    // A value outside the vocabulary cannot be written (the CHECK refuses it),
    // so this only narrows; it never silently re-labels a row.
    return (SavedViewScopeValues as readonly string[]).includes(value)
      ? (value as SavedViewScope)
      : 'personal';
  }

  private toDomain(row: SavedViewOrmEntity): SavedView {
    return new SavedView(
      row.id,
      this.toScope(row.scope),
      row.ownerUserId,
      row.createdByUserId,
      row.pageKey,
      row.name,
      row.definition,
      row.revision,
      row.isWorkspaceDefault,
      row.createdAt,
      row.updatedAt
    );
  }

  private fromRawRow(row: Record<string, unknown>): SavedView {
    return new SavedView(
      row.id as string,
      this.toScope(row.scope as string),
      (row.owner_user_id as string | null) ?? null,
      (row.created_by_user_id as string | null) ?? null,
      row.page_key as string,
      row.name as string,
      row.definition,
      Number(row.revision),
      row.is_workspace_default === true,
      new Date(row.created_at as string | Date),
      new Date(row.updated_at as string | Date)
    );
  }
}
