/**
 * Return Re-attribution Service
 *
 * The orphan re-attribution reconcile (#2332, ADR-060) — the pass that makes an ORPHAN
 * return self-healing.
 *
 * ## Why a background pass, and not just re-resolution on ingestion
 *
 * `upsertFromSource` already COALESCE-fills `internalOrderId`, so a return the source
 * happens to re-report does get attributed for free. That only covers the returns the
 * source re-reports: the #2330 lifecycle sweep is age-bounded (`openedSince`) and
 * terminal-status-bounded, so a return whose source status went terminal — or whose
 * order was ingested a week after the return arrived — is never re-read again and stays
 * orphaned forever. Ingestion cannot be the trigger for a fact that arrives from the
 * OTHER direction (the order showing up), which is exactly why this inverts it: it
 * enumerates OL's own orphans and asks the mapping table, rather than asking the source
 * anything at all.
 *
 * ## It contacts no marketplace
 *
 * One `identifier_mappings` lookup and one local conditional UPDATE per candidate. That
 * is why the job is namespaced `returns.*` rather than `marketplace.*`, why the
 * scheduler entry can default ON where the two #2330 ingestion passes are opt-in, and
 * why there is no rate-limit or adapter-resolution concern anywhere below.
 *
 * ## Bounds
 *
 * One page per run, rolling scan offset wrapping at the total — the
 * `marketplace.offer.statusSync` (#816) shape the sibling passes already use. A claim
 * that succeeds removes its row from the filtered set, so the offset can step over a
 * candidate; that is the same accepted property `findForSourceSweep` has, and the wrap
 * means a skipped row is reached on the next cycle.
 *
 * @module libs/core/src/returns/application/services
 * @implements {IReturnReattributionService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { ReturnRepositoryPort } from '../../domain/ports/return-repository.port';
import type {
  ReturnReattributionCandidate,
  ReturnReattributionOptions,
  ReturnReattributionResult,
} from '../../domain/types/return-reattribution.types';
import { RETURN_REPOSITORY_TOKEN } from '../../returns.tokens';
import type { IReturnReattributionService } from './return-reattribution.service.interface';

@Injectable()
export class ReturnReattributionService implements IReturnReattributionService {
  private readonly logger = new Logger(ReturnReattributionService.name);

  constructor(
    @Inject(RETURN_REPOSITORY_TOKEN)
    private readonly repository: ReturnRepositoryPort,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService
  ) {}

  async reconcile(
    connectionId: string,
    options: ReturnReattributionOptions
  ): Promise<ReturnReattributionResult> {
    const total = await this.repository.countOrphansForReattribution(connectionId);
    const offset = total === 0 || options.offset >= total ? 0 : options.offset;

    const candidates = await this.repository.findOrphansForReattribution(
      connectionId,
      options.limit,
      offset
    );

    let reattributed = 0;
    let alreadyAttributed = 0;
    let unresolved = 0;
    let failed = 0;

    for (const candidate of candidates) {
      // NOT inside the try below, deliberately — a connection-resolution failure
      // propagates out of the loop. See the interface docblock.
      const internalOrderId = await this.identifierMapping.getInternalId(
        CORE_ENTITY_TYPE.Order,
        candidate.externalOrderId,
        connectionId
      );

      if (internalOrderId === null) {
        unresolved += 1;
        continue;
      }

      const outcome = await this.claim(candidate, internalOrderId);
      if (outcome === 'reattributed') reattributed += 1;
      else if (outcome === 'already') alreadyAttributed += 1;
      else failed += 1;
    }

    const nextOffset = this.nextOffset(offset, candidates.length, total);

    return {
      scanned: candidates.length,
      reattributed,
      alreadyAttributed,
      unresolved,
      failed,
      nextOffset,
      total,
    };
  }

  /**
   * The per-row write, and the ONLY thing this pass catches.
   *
   * A row-shaped persistence fault must not abandon the rest of the page — the other
   * candidates are unrelated returns. A `false` claim is not a fault at all: a concurrent
   * writer attributed the return first, which is the outcome we wanted, reached by
   * somebody else.
   */
  private async claim(
    candidate: ReturnReattributionCandidate,
    internalOrderId: string
  ): Promise<'reattributed' | 'already' | 'failed'> {
    try {
      const claimed = await this.repository.claimAttribution(candidate.id, internalOrderId);
      if (claimed) {
        this.logger.log(
          `Return ${candidate.id} re-attributed to order ${internalOrderId} (source order ${candidate.externalOrderId})`
        );
        return 'reattributed';
      }
      this.logger.debug(
        `Return ${candidate.id} was attributed by a concurrent writer before this run's claim — no-op`
      );
      return 'already';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to re-attribute return ${candidate.id}: ${message}`);
      return 'failed';
    }
  }

  /**
   * Wrap to 0 once the page reached the end of the filtered set, so a connection's
   * orphans are re-checked in a continuous cycle rather than the offset running past
   * `total` and returning empty pages forever.
   */
  private nextOffset(offset: number, scanned: number, total: number): number {
    const advanced = offset + scanned;
    return advanced >= total ? 0 : advanced;
  }
}
