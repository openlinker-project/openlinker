/**
 * Prompt Template Repository
 *
 * TypeORM-backed implementation of `PromptTemplateRepositoryPort`. The
 * `publishTransition` method wraps the archive-previous + promote-draft
 * flip in a serialisable DB transaction and surfaces partial-unique-index
 * violations as `PromptTemplateStateException` (concurrent-publish race).
 *
 * ORM ↔ domain mapping is private to this class.
 *
 * @module libs/core/src/ai/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, QueryFailedError, Repository } from 'typeorm';
import { PromptTemplate } from '../../../domain/entities/prompt-template.entity';
import { PromptTemplateNotFoundException } from '../../../domain/exceptions/prompt-template-not-found.exception';
import { PromptTemplateStateException } from '../../../domain/exceptions/prompt-template-state.exception';
import type {
  PromptTemplateContentUpdate,
  PromptTemplateInsert,
  PromptTemplateListFilters,
  PromptTemplateRepositoryPort,
  PromptTemplateSummary,
} from '../../../domain/ports/prompt-template-repository.port';
import {
  PromptTemplateStateValues,
  type PromptTemplateChannel,
  type PromptTemplateState,
  type PromptTemplateVariable,
} from '../../../domain/types/prompt-template.types';
import { PromptTemplateOrmEntity } from '../entities/prompt-template.orm-entity';

interface RawListRow {
  key: string;
  channel: string | null;
  latest_version: string | number;
  latest_id: string;
  latest_state: string;
  published_version: string | number | null;
  published_id: string | null;
  has_draft: boolean;
  updated_at: string | Date;
}

@Injectable()
export class PromptTemplateRepository implements PromptTemplateRepositoryPort {
  constructor(
    @InjectRepository(PromptTemplateOrmEntity)
    private readonly ormRepository: Repository<PromptTemplateOrmEntity>,
  ) {}

  async findById(id: string): Promise<PromptTemplate | null> {
    const entity = await this.ormRepository.findOne({ where: { id } });
    return entity === null ? null : this.toDomain(entity);
  }

  async findByKeyChannelVersion(
    key: string,
    channel: PromptTemplateChannel | null,
    version: number,
  ): Promise<PromptTemplate | null> {
    const entity = await this.ormRepository.findOne({
      where: {
        key,
        channel: channel === null ? IsNull() : channel,
        version,
      },
    });
    return entity === null ? null : this.toDomain(entity);
  }

  async findLatestPublished(
    key: string,
    channel: PromptTemplateChannel | null,
  ): Promise<PromptTemplate | null> {
    const entity = await this.ormRepository.findOne({
      where: {
        key,
        channel: channel === null ? IsNull() : channel,
        state: 'published',
      },
    });
    return entity === null ? null : this.toDomain(entity);
  }

  async findVersions(
    key: string,
    channel: PromptTemplateChannel | null,
  ): Promise<PromptTemplate[]> {
    const entities = await this.ormRepository.find({
      where: {
        key,
        channel: channel === null ? IsNull() : channel,
      },
      order: { version: 'DESC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async listLatestByKey(filters?: PromptTemplateListFilters): Promise<PromptTemplateSummary[]> {
    // One row per (key, channel): the latest version wins for `latestVersion`,
    // the most recent published row supplies `publishedVersion`. Built via a
    // single SQL statement so the UI doesn't need per-row follow-ups.
    const params: unknown[] = [];
    const whereClauses: string[] = [];

    if (filters?.key !== undefined) {
      params.push(filters.key);
      whereClauses.push(`key = $${params.length}`);
    }
    if (filters?.channel !== undefined) {
      if (filters.channel === null) {
        whereClauses.push(`channel IS NULL`);
      } else {
        params.push(filters.channel);
        whereClauses.push(`channel = $${params.length}`);
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const sql = `
      WITH base AS (
        SELECT
          key,
          channel,
          id,
          version,
          state,
          updated_at
        FROM prompt_templates
        ${whereSql}
      ),
      latest AS (
        SELECT DISTINCT ON (key, channel)
          key, channel, id, version, state, updated_at
        FROM base
        ORDER BY key, channel, version DESC
      ),
      pub AS (
        SELECT DISTINCT ON (key, channel)
          key, channel, id AS published_id, version AS published_version
        FROM base
        WHERE state = 'published'
        ORDER BY key, channel, version DESC
      ),
      drafted AS (
        SELECT key, channel, true AS has_draft
        FROM base
        WHERE state = 'draft'
        GROUP BY key, channel
      )
      SELECT
        latest.key                                      AS key,
        latest.channel                                  AS channel,
        latest.version                                  AS latest_version,
        latest.id                                       AS latest_id,
        latest.state                                    AS latest_state,
        pub.published_version                           AS published_version,
        pub.published_id                                AS published_id,
        COALESCE(drafted.has_draft, false)              AS has_draft,
        latest.updated_at                               AS updated_at
      FROM latest
      LEFT JOIN pub
        ON pub.key = latest.key
        AND pub.channel IS NOT DISTINCT FROM latest.channel
      LEFT JOIN drafted
        ON drafted.key = latest.key
        AND drafted.channel IS NOT DISTINCT FROM latest.channel
      ORDER BY latest.key ASC, latest.channel ASC NULLS FIRST
    `;

    const rows = (await this.ormRepository.query(sql, params)) as RawListRow[];
    return rows.map((row) => this.toSummary(row));
  }

  async insert(payload: PromptTemplateInsert): Promise<PromptTemplate> {
    const entity = this.ormRepository.create({
      key: payload.key,
      channel: payload.channel,
      version: payload.version,
      systemPrompt: payload.systemPrompt,
      userPromptTemplate: payload.userPromptTemplate,
      variables: [...payload.variables],
      state: payload.state,
      publishedAt: payload.publishedAt,
      createdBy: payload.createdBy,
    });
    const saved = await this.ormRepository.save(entity);
    return this.toDomain(saved);
  }

  async updateContent(
    id: string,
    patch: PromptTemplateContentUpdate,
  ): Promise<PromptTemplate> {
    const partial: Partial<PromptTemplateOrmEntity> = {};
    if (patch.systemPrompt !== undefined) partial.systemPrompt = patch.systemPrompt;
    if (patch.userPromptTemplate !== undefined) {
      partial.userPromptTemplate = patch.userPromptTemplate;
    }
    if (patch.variables !== undefined) {
      // Variables are stored as JSONB; TypeORM serialises via JSON.stringify.
      // Copy into a mutable array to satisfy TypeORM's DeepPartial typing
      // without widening the domain port's `readonly` contract.
      partial.variables = [...patch.variables];
    }

    // Only allow updates while the row is a draft — the WHERE clause is the
    // last line of defence against a stale caller who missed a state check.
    const result = await this.ormRepository
      .createQueryBuilder()
      .update(PromptTemplateOrmEntity)
      .set(partial)
      .where('id = :id AND state = :state', { id, state: 'draft' })
      .returning('*')
      .execute();

    if (result.affected === 0) {
      throw new PromptTemplateStateException({
        templateId: id,
        actualState: null,
        requiredState: 'draft',
        operation: 'be edited',
      });
    }

    // `result.raw` is `PromptTemplateOrmEntity[]` from TypeORM's RETURNING —
    // but the column names come back in snake_case and need a re-select.
    const refreshed = await this.ormRepository.findOne({ where: { id } });
    if (refreshed === null) {
      throw new PromptTemplateNotFoundException({ templateId: id });
    }
    return this.toDomain(refreshed);
  }

  async publishTransition(id: string): Promise<PromptTemplate> {
    return this.ormRepository.manager.transaction(async (manager) => {
      const target = await manager
        .createQueryBuilder(PromptTemplateOrmEntity, 't')
        .setLock('pessimistic_write')
        .where('t.id = :id', { id })
        .getOne();

      if (target === null) {
        throw new PromptTemplateNotFoundException({ templateId: id });
      }
      if (target.state !== 'draft') {
        throw new PromptTemplateStateException({
          templateId: id,
          actualState: target.state as PromptTemplateState,
          requiredState: 'draft',
          operation: 'be published',
        });
      }

      // Archive the current published row for (key, channel) if any.
      await manager
        .createQueryBuilder()
        .update(PromptTemplateOrmEntity)
        .set({ state: 'archived' })
        .where(
          'key = :key AND channel IS NOT DISTINCT FROM :channel AND state = :state AND id <> :id',
          {
            key: target.key,
            channel: target.channel,
            state: 'published',
            id,
          },
        )
        .execute();

      // Flip the target draft to published. The partial unique index on
      // (key, [channel], state='published') would reject a concurrent
      // double-publish; we catch `QueryFailedError` and surface a state
      // exception so the caller can re-fetch.
      try {
        await manager
          .createQueryBuilder()
          .update(PromptTemplateOrmEntity)
          .set({ state: 'published', publishedAt: () => 'now()' })
          .where('id = :id AND state = :state', { id, state: 'draft' })
          .execute();
      } catch (error) {
        if (error instanceof QueryFailedError) {
          throw new PromptTemplateStateException({
            templateId: id,
            actualState: target.state as PromptTemplateState,
            requiredState: 'draft',
            operation: 'be published (concurrent publish detected — refresh and retry)',
          });
        }
        throw error;
      }

      const refreshed = await manager.findOne(PromptTemplateOrmEntity, { where: { id } });
      if (refreshed === null) {
        throw new PromptTemplateNotFoundException({ templateId: id });
      }
      return this.toDomain(refreshed);
    });
  }

  async archiveById(
    id: string,
    expectedPriorState: PromptTemplateState,
  ): Promise<PromptTemplate> {
    // State-conditional UPDATE — closes the race-window between the
    // service-level guard and the write. If the row's state changed (e.g.
    // a concurrent publish), `affected` is 0 and we surface a state
    // exception so the caller refreshes and retries.
    const result = await this.ormRepository
      .createQueryBuilder()
      .update(PromptTemplateOrmEntity)
      .set({ state: 'archived' })
      .where('id = :id AND state = :expectedPriorState', {
        id,
        expectedPriorState,
      })
      .execute();

    if (result.affected === 0) {
      const refreshed = await this.ormRepository.findOne({ where: { id } });
      if (refreshed === null) {
        throw new PromptTemplateNotFoundException({ templateId: id });
      }
      throw new PromptTemplateStateException({
        templateId: id,
        actualState: refreshed.state as PromptTemplateState,
        requiredState: expectedPriorState,
        operation: 'be archived (concurrent modification — refresh and retry)',
      });
    }

    const updated = await this.ormRepository.findOne({ where: { id } });
    if (updated === null) {
      throw new PromptTemplateNotFoundException({ templateId: id });
    }
    return this.toDomain(updated);
  }

  async nextVersion(
    key: string,
    channel: PromptTemplateChannel | null,
  ): Promise<number> {
    const rows = (await this.ormRepository.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM prompt_templates WHERE key = $1 AND channel IS NOT DISTINCT FROM $2`,
      [key, channel],
    )) as Array<{ next: string | number }>;
    const next = rows[0]?.next ?? 1;
    return typeof next === 'number' ? next : Number.parseInt(next, 10);
  }

  async deleteById(id: string): Promise<void> {
    await this.ormRepository.delete({ id });
  }

  private toDomain(entity: PromptTemplateOrmEntity): PromptTemplate {
    return new PromptTemplate(
      entity.id,
      entity.key,
      entity.channel,
      entity.version,
      entity.systemPrompt,
      entity.userPromptTemplate,
      this.asVariables(entity.variables),
      this.asState(entity.state),
      entity.publishedAt,
      entity.createdBy,
      entity.createdAt,
      entity.updatedAt,
    );
  }

  private toSummary(row: RawListRow): PromptTemplateSummary {
    return {
      key: row.key,
      channel: row.channel,
      latestVersion:
        typeof row.latest_version === 'number'
          ? row.latest_version
          : Number.parseInt(row.latest_version, 10),
      latestId: row.latest_id,
      latestState: this.asState(row.latest_state),
      publishedVersion:
        row.published_version === null
          ? null
          : typeof row.published_version === 'number'
            ? row.published_version
            : Number.parseInt(row.published_version, 10),
      publishedId: row.published_id,
      hasDraft: row.has_draft,
      updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    };
  }

  private asState(value: string): PromptTemplateState {
    if (PromptTemplateStateValues.includes(value as PromptTemplateState)) {
      return value as PromptTemplateState;
    }
    // Should be unreachable — the CHECK constraint forbids unknown states.
    throw new Error(`Unexpected prompt_templates.state value: ${value}`);
  }

  private asVariables(
    value: PromptTemplateVariable[] | null | undefined,
  ): readonly PromptTemplateVariable[] {
    if (!Array.isArray(value)) return [];
    return value;
  }
}
