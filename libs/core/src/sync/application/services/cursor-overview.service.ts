/**
 * Cursor Overview Service (#4023)
 *
 * Read side and the one guarded write behind the "Sync progress" page.
 *
 * Rewind is limited to two targets the catalogue owns end to end:
 * - `restart-pass` clears an OPEN catalogue pass so the next run starts a new
 *   one. It takes the sweep's own run lock for the write, so it can never land
 *   in the middle of a run (the run would write the cursor straight back).
 * - `restart-check` puts a rolling re-check back at item 0. No lock: a run that
 *   overlaps simply writes its next offset, which leaves the check where it
 *   would have been anyway.
 *
 * @module libs/core/src/sync/application/services
 * @implements {ICursorOverviewService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
  SYNC_JOB_REPOSITORY_TOKEN,
  SYNC_LOCK_TOKEN,
} from '../../sync.tokens';
import { ConnectionCursorRepositoryPort } from '../../domain/ports/connection-cursor-repository.port';
import { SyncJobRepositoryPort } from '../../domain/ports/sync-job-repository.port';
import { SyncLockPort } from '../ports/sync-lock.port';
import type { ICursorOverviewService } from './cursor-overview.service.interface';
import {
  catalogueWriterJobTypes,
  OFFER_QUANTITY_WRITE_MARK_PREFIX,
  resolveCursorCatalogueEntry,
} from '../../domain/types/cursor-key-catalogue.types';
import {
  MasterSweepKindValues,
  masterSweepLockKey,
} from '../../domain/types/master-sweep-cursor.types';
import type { MasterSweepKind } from '../../domain/types/master-sweep-cursor.types';
import type {
  CursorLastRun,
  CursorOverview,
  CursorOverviewConnection,
  CursorRewindInput,
  CursorRewindResult,
} from '../../domain/types/cursor-overview.types';
import { CursorRewindRefusedError } from '../../domain/exceptions/cursor-rewind-refused.error';
import type { SyncJob } from '../../domain/entities/sync-job.entity';

/** Upper bound on cursors read for the overview. Write marks are excluded, so a real install sits far below it. */
export const CURSOR_OVERVIEW_LIMIT = 1000;
/** Long enough for one UPDATE, short enough that a crashed request never blocks a sweep for long. */
const REWIND_LOCK_TTL_MS = 15_000;

@Injectable()
export class CursorOverviewService implements ICursorOverviewService {
  private readonly logger = new Logger(CursorOverviewService.name);

  constructor(
    @Inject(CONNECTION_CURSOR_REPOSITORY_TOKEN)
    private readonly cursors: ConnectionCursorRepositoryPort,
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly jobs: SyncJobRepositoryPort,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly locks: SyncLockPort
  ) {}

  async getOverview(filter: { connectionId?: string } = {}): Promise<CursorOverview> {
    const [page, allMarks] = await Promise.all([
      this.cursors.findMany(
        { connectionId: filter.connectionId, excludeKeyPrefix: OFFER_QUANTITY_WRITE_MARK_PREFIX },
        { limit: CURSOR_OVERVIEW_LIMIT, offset: 0 }
      ),
      this.cursors.summarizeByKeyPrefix(OFFER_QUANTITY_WRITE_MARK_PREFIX),
    ]);
    const marks = filter.connectionId
      ? allMarks.filter((m) => m.connectionId === filter.connectionId)
      : allMarks;

    const connectionIds = [
      ...new Set([...page.items.map((c) => c.connectionId), ...marks.map((m) => m.connectionId)]),
    ];
    const latest = await this.jobs.findLatestByConnectionsAndJobTypes(
      connectionIds,
      catalogueWriterJobTypes()
    );
    const runByPair = new Map(latest.map((job) => [`${job.connectionId}|${job.jobType}`, job]));

    const byConnection = new Map<string, CursorOverviewConnection>();
    const group = (connectionId: string): CursorOverviewConnection => {
      let g = byConnection.get(connectionId);
      if (!g) {
        g = { connectionId, cursors: [], writeMarks: null };
        byConnection.set(connectionId, g);
      }
      return g;
    };

    for (const cursor of page.items) {
      const entry = resolveCursorCatalogueEntry(cursor.cursorKey);
      const job = entry?.writerJobType
        ? runByPair.get(`${cursor.connectionId}|${entry.writerJobType}`)
        : undefined;
      group(cursor.connectionId).cursors.push({
        cursorKey: cursor.cursorKey,
        value: cursor.value,
        createdAt: toDate(cursor.createdAt),
        updatedAt: toDate(cursor.updatedAt),
        family: entry?.family ?? null,
        rewind: entry?.rewind ?? null,
        lastRun: job ? toLastRun(job) : null,
      });
    }
    for (const m of marks) {
      group(m.connectionId).writeMarks = {
        keyPrefix: OFFER_QUANTITY_WRITE_MARK_PREFIX,
        count: m.count,
        oldestValue: m.oldestValue,
        newestValue: m.newestValue,
        lastUpdatedAt: m.lastUpdatedAt,
      };
    }

    return { connections: [...byConnection.values()], truncated: page.total > page.items.length };
  }

  async rewind(input: CursorRewindInput): Promise<CursorRewindResult> {
    const { connectionId, cursorKey, target } = input;
    const entry = resolveCursorCatalogueEntry(cursorKey);
    if (!entry || entry.rewind === null) {
      throw new CursorRewindRefusedError(
        'not-rewindable',
        cursorKey,
        `Cursor ${cursorKey} cannot be moved back.`
      );
    }
    if (entry.rewind !== target) {
      throw new CursorRewindRefusedError(
        'target-mismatch',
        cursorKey,
        `Cursor ${cursorKey} only supports ${entry.rewind}.`
      );
    }
    const current = await this.cursors.findOne(connectionId, cursorKey);
    if (!current) {
      throw new CursorRewindRefusedError(
        'cursor-not-found',
        cursorKey,
        `Cursor ${cursorKey} not found on connection ${connectionId}.`
      );
    }

    if (target === 'restart-check') {
      await this.cursors.set(connectionId, cursorKey, '0');
      this.logger.log(
        `Cursor ${cursorKey} on ${connectionId} reset from "${current.value}" to "0" (restart-check)`
      );
      return { connectionId, cursorKey, previousValue: current.value, value: '0' };
    }

    if (current.value === '') {
      throw new CursorRewindRefusedError(
        'pass-not-open',
        cursorKey,
        'The last pass already finished. Use Run now to start the next one.'
      );
    }
    const kind = sweepKindOf(cursorKey);
    const lockKey = masterSweepLockKey(kind, connectionId);
    const token = await this.locks.acquire(lockKey, REWIND_LOCK_TTL_MS);
    if (!token) {
      throw new CursorRewindRefusedError(
        'run-in-progress',
        cursorKey,
        'A run is in progress. Try again when it finishes.'
      );
    }
    try {
      await this.cursors.set(connectionId, cursorKey, '');
    } finally {
      await this.locks.release(lockKey, token);
    }
    this.logger.log(
      `Cursor ${cursorKey} on ${connectionId} cleared from "${current.value}" (restart-pass)`
    );
    return { connectionId, cursorKey, previousValue: current.value, value: '' };
  }
}

function sweepKindOf(cursorKey: string): MasterSweepKind {
  const kind = cursorKey.slice('master.'.length, cursorKey.indexOf('.sweep:'));
  if (!(MasterSweepKindValues as readonly string[]).includes(kind)) {
    throw new CursorRewindRefusedError(
      'not-rewindable',
      cursorKey,
      `Cursor ${cursorKey} is not a catalogue pass.`
    );
  }
  return kind as MasterSweepKind;
}

function toLastRun(job: SyncJob): CursorLastRun {
  return {
    jobId: job.id,
    jobType: job.jobType,
    status: job.status,
    outcome: job.outcome ?? null,
    at: toDate(job.updatedAt),
    lastError: job.lastError ?? null,
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
