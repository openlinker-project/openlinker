/**
 * Offer Status Poll Service
 *
 * Owns the full orchestration policy for #447: poll Allegro until a record
 * stuck at `'validating'` reaches a terminal `OfferCreationStatus`. See
 * `docs/plans/implementation-plan-447-allegro-offer-poll-creation-status.md`.
 *
 * Two-counter model (§5.3):
 *   - `pollAttempt` (in payload): polling cadence (1..maxAttempts).
 *   - `sync_jobs.attempts` (runner-owned): transient HTTP retry per iteration,
 *     capped at `RUNNER_RETRY_BUDGET` per row (=3 — absorbs 1–2 blips).
 *
 * Bypasses Redis Streams: enqueues directly via `SyncJobRepositoryPort` so we
 * can set a future `nextRunAt`. The poll job is internal-orchestration only;
 * fan-out semantics aren't needed.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferStatusPollService}
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { OfferManagerPort } from '@openlinker/core/listings';
import {
  isOfferStatusReader,
  OFFER_CREATION_STATUS,
  OfferNotFoundOnMarketplaceException,
  OfferPollNotSupportedException,
  type OfferStatusReadResult,
} from '@openlinker/core/listings';
import {
  type MarketplaceOfferPollCreationStatusPayloadV1,
  SYNC_JOB_REPOSITORY_TOKEN,
  type SyncJobRepositoryPort,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import { OFFER_CREATION_RECORD_REPOSITORY_TOKEN } from '../../listings.tokens';
import { OfferCreationRecordRepositoryPort } from '../../domain/ports/offer-creation-record-repository.port';
import type {
  OfferCreationError,
  OfferCreationStatus,
} from '../../domain/types/offer-creation-record.types';
import type { IOfferStatusPollService } from '../interfaces/offer-status-poll.service.interface';
import type {
  OfferPollCadenceConfig,
  PollOnceInput,
  PollOnceResult,
  ScheduleFirstPollInput,
} from '../types/offer-status-poll.types';

const POLL_JOB_TYPE = 'marketplace.offer.pollCreationStatus';

/**
 * Per-iteration runner-retry budget. The runner's transient-HTTP-blip cushion;
 * orthogonal to `pollAttempt`. Kept as a constant rather than env-tunable —
 * 3 is the right answer for any HTTP-poll-based job.
 */
const RUNNER_RETRY_BUDGET = 3;

@Injectable()
export class OfferStatusPollService implements IOfferStatusPollService {
  private readonly logger = new Logger(OfferStatusPollService.name);
  private readonly cadence: OfferPollCadenceConfig;

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(OFFER_CREATION_RECORD_REPOSITORY_TOKEN)
    private readonly offerCreationRecords: OfferCreationRecordRepositoryPort,
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly syncJobRepository: SyncJobRepositoryPort,
    configService: ConfigService
  ) {
    this.cadence = {
      initialDelaySeconds:
        configService.get<number>('OL_ALLEGRO_OFFER_POLL_INITIAL_DELAY_SECONDS') ?? 5,
      backoffMultiplier: configService.get<number>('OL_ALLEGRO_OFFER_POLL_BACKOFF_MULTIPLIER') ?? 2,
      maxDelaySeconds: configService.get<number>('OL_ALLEGRO_OFFER_POLL_MAX_DELAY_SECONDS') ?? 60,
      maxAttempts: configService.get<number>('OL_ALLEGRO_OFFER_POLL_MAX_ATTEMPTS') ?? 12,
    };
  }

  async scheduleFirstPoll(input: ScheduleFirstPollInput): Promise<void> {
    await this.enqueuePoll({
      offerCreationRecordId: input.offerCreationRecordId,
      externalOfferId: input.externalOfferId,
      connectionId: input.connectionId,
      pollAttempt: 1,
    });
  }

  async pollOnce(input: PollOnceInput): Promise<PollOnceResult> {
    // Defensive: if the record already moved out of `'validating'` (e.g. an
    // operator dismissed it, or a parallel path completed it), no-op.
    const record = await this.offerCreationRecords.findById(input.offerCreationRecordId);
    if (!record) {
      this.logger.warn(
        `Poll iteration ${input.pollAttempt} found no record ${input.offerCreationRecordId} — dropping.`
      );
      return { outcome: 'ok' };
    }
    if (record.status !== 'validating') {
      this.logger.debug(
        `Poll iteration ${input.pollAttempt} sees record ${input.offerCreationRecordId} already at terminal '${record.status}' — no-op.`
      );
      return { outcome: 'ok' };
    }

    // Enforce poll-attempt cap. `pollAttempt > maxAttempts` is a forward
    // guard against payload manipulation; the next-iteration enqueue already
    // bails when iteration N would exceed the cap (see scheduleNext below).
    if (input.pollAttempt > this.cadence.maxAttempts) {
      await this.markFailedAtomically(
        input.offerCreationRecordId,
        `POLL_TIMEOUT after ${this.cadence.maxAttempts} attempts`,
        'POLL_TIMEOUT'
      );
      return { outcome: 'business_failure' };
    }

    // Resolve the adapter and ensure it implements OfferStatusReader.
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      input.connectionId,
      'OfferManager'
    );
    if (!isOfferStatusReader(adapter)) {
      const reason = new OfferPollNotSupportedException(input.connectionId);
      this.logger.error(reason.message);
      await this.markFailedAtomically(
        input.offerCreationRecordId,
        reason.message,
        'OFFER_POLL_NOT_SUPPORTED'
      );
      return { outcome: 'business_failure' };
    }

    // Hit the marketplace. 404 → terminal failure; transport errors propagate.
    let result: OfferStatusReadResult;
    try {
      result = await adapter.getOfferStatus(input.externalOfferId);
    } catch (err) {
      if (err instanceof OfferNotFoundOnMarketplaceException) {
        await this.markFailedAtomically(
          input.offerCreationRecordId,
          err.message,
          'OFFER_NOT_FOUND'
        );
        return { outcome: 'business_failure' };
      }
      throw err;
    }

    // Terminal-vs-validating decision. See §5.1 of the implementation plan.
    const decision = this.decideTerminalState(result);
    if (decision.terminal) {
      await this.offerCreationRecords.updateStatus(
        input.offerCreationRecordId,
        decision.recordStatus,
        decision.errors
      );
      return { outcome: decision.outcome };
    }

    // Still validating — schedule the next iteration if we haven't hit the cap.
    await this.scheduleNext(input);
    return { outcome: 'ok' };
  }

  /** Map the marketplace observation (§5.1 plan) to a record-side decision. */
  private decideTerminalState(result: OfferStatusReadResult):
    | { terminal: false }
    | {
        terminal: true;
        recordStatus: OfferCreationStatus;
        errors: OfferCreationError[] | null;
        outcome: PollOnceResult['outcome'];
      } {
    switch (result.publicationStatus) {
      case 'active':
        return { terminal: true, recordStatus: OFFER_CREATION_STATUS.Active, errors: null, outcome: 'ok' };
      case 'activating':
      case 'inactivating':
        return { terminal: false };
      case 'inactive':
        if (result.validationErrors.length > 0) {
          return {
            terminal: true,
            recordStatus: OFFER_CREATION_STATUS.Failed,
            errors: result.validationErrors.map((v) => ({
              code: v.code,
              message: v.message,
              field: v.field,
            })),
            outcome: 'business_failure',
          };
        }
        return { terminal: true, recordStatus: 'draft', errors: null, outcome: 'ok' };
      case 'ended':
        return { terminal: true, recordStatus: 'draft', errors: null, outcome: 'ok' };
    }
  }

  private async scheduleNext(current: PollOnceInput): Promise<void> {
    const nextAttempt = current.pollAttempt + 1;
    if (nextAttempt > this.cadence.maxAttempts) {
      // We've exhausted the cadence budget. Mark the record failed with a
      // POLL_TIMEOUT code and don't enqueue another iteration.
      await this.markFailedAtomically(
        current.offerCreationRecordId,
        `Allegro never finished validating offer ${current.externalOfferId} after ` +
          `${this.cadence.maxAttempts} poll iterations`,
        'POLL_TIMEOUT'
      );
      this.logger.warn(
        `Poll cadence exhausted for record ${current.offerCreationRecordId} (offer ${current.externalOfferId}) — marked failed.`
      );
      return;
    }

    await this.enqueuePoll({
      offerCreationRecordId: current.offerCreationRecordId,
      externalOfferId: current.externalOfferId,
      connectionId: current.connectionId,
      pollAttempt: nextAttempt,
    });
  }

  /**
   * Build the cadence-specific delay and the iteration-keyed sync-job row.
   * Used by both `scheduleFirstPoll` and the in-flight re-enqueue path.
   */
  private async enqueuePoll(input: PollOnceInput): Promise<void> {
    const delaySeconds = this.computeDelaySeconds(input.pollAttempt);
    const runAfter = new Date(Date.now() + delaySeconds * 1000);

    const payload: MarketplaceOfferPollCreationStatusPayloadV1 = {
      schemaVersion: 1,
      offerCreationRecordId: input.offerCreationRecordId,
      externalOfferId: input.externalOfferId,
      pollAttempt: input.pollAttempt,
    };
    const idempotencyKey = `pollCreationStatus:${input.offerCreationRecordId}:${input.pollAttempt}`;

    await this.syncJobRepository.createIfNotExistsByIdempotencyKey(
      {
        jobType: POLL_JOB_TYPE,
        connectionId: input.connectionId,
        payload: payload as unknown as Record<string, unknown>,
        idempotencyKey,
        maxAttempts: RUNNER_RETRY_BUDGET,
      },
      { runAfter }
    );

    this.logger.debug(
      `Scheduled poll iteration ${input.pollAttempt} for record ${input.offerCreationRecordId} ` +
        `at +${delaySeconds}s (offer ${input.externalOfferId}).`
    );
  }

  /**
   * Cadence: `initialDelay × multiplier^(attempt-1)`, clamped to `maxDelay`.
   * Pure function of `pollAttempt`; no side effects.
   */
  private computeDelaySeconds(pollAttempt: number): number {
    const exp = pollAttempt - 1;
    const raw = this.cadence.initialDelaySeconds * Math.pow(this.cadence.backoffMultiplier, exp);
    return Math.min(raw, this.cadence.maxDelaySeconds);
  }

  /**
   * Atomic record update: status='failed' + a single structured error. We
   * use `updateStatus` which already supports the `(status, errors)` write
   * in one repo call — so a crash between two writes is impossible.
   */
  private async markFailedAtomically(
    recordId: string,
    message: string,
    code: string
  ): Promise<void> {
    const error: OfferCreationError = { code, message };
    await this.offerCreationRecords.updateStatus(recordId, OFFER_CREATION_STATUS.Failed, [error]);
  }
}
