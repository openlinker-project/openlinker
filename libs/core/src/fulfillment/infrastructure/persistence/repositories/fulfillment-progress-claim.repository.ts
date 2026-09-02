/**
 * Fulfillment Progress Claim Repository (#2400)
 *
 * `INSERT ... ON CONFLICT DO NOTHING` against the composite primary key,
 * reporting `raw.length > 0` as the answer to "did I win?". The
 * `AutomationTriggerFiringRepository.claim` (#2360) idiom, copied deliberately
 * rather than reinvented.
 *
 * **The emitted SQL is a bare `ON CONFLICT DO NOTHING`, knowingly.** TypeORM
 * 0.3.17's `orIgnore(statement)` DISCARDS its argument (`onIgnore = !!statement`)
 * and always emits the bare form, so naming a conflict target here would be
 * prose describing SQL that is not generated.
 *
 * That is safe **only because this table has exactly ONE uniqueness
 * declaration** — the composite primary key `(workId, idempotencyKey)`. If a
 * second unique index is ever added, this must first become an explicit
 * column-list target: otherwise an unrelated conflict silently reports "already
 * claimed", and "already claimed" is the answer that suppresses a progress
 * write and its relay **forever**. That is a permanent, silent data-loss mode,
 * which is why the precondition is stated here rather than assumed.
 *
 * There is deliberately no `SELECT`-then-`INSERT` anywhere in this file: under
 * READ COMMITTED a plain `SELECT` takes no locks and the conflicting row is a
 * phantom that cannot be locked before it exists, so an application-level check
 * enforces nothing at all.
 *
 * @module libs/core/src/fulfillment/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type {
  FulfillmentProgressClaimInput,
  FulfillmentProgressClaimRepositoryPort,
} from '../../../domain/ports/fulfillment-progress-claim-repository.port';
import { FulfillmentProgressClaimOrmEntity } from '../entities/fulfillment-progress-claim.orm-entity';

@Injectable()
export class FulfillmentProgressClaimRepository implements FulfillmentProgressClaimRepositoryPort {
  constructor(
    @InjectRepository(FulfillmentProgressClaimOrmEntity)
    private readonly repository: Repository<FulfillmentProgressClaimOrmEntity>
  ) {}

  async claim(input: FulfillmentProgressClaimInput): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .insert()
      .into(FulfillmentProgressClaimOrmEntity)
      .values({
        workId: input.workId,
        idempotencyKey: input.idempotencyKey,
        connectionId: input.connectionId,
        eventKind: input.eventKind,
        claimedAt: input.claimedAt,
      })
      .orIgnore()
      // EXPLICIT `RETURNING`, and it is load-bearing rather than decorative.
      //
      // `raw.length > 0` only answers "did I insert?" when the statement
      // actually carries a RETURNING clause. TypeORM adds one automatically for
      // GENERATED columns — which is why #2360's version needs no `.returning()`:
      // `automation_trigger_firings` has a `@PrimaryGeneratedColumn('uuid')`.
      // Every column on THIS table is caller-supplied, so nothing is generated,
      // no RETURNING is emitted, and `raw` comes back `[]` on success exactly as
      // it does on conflict.
      //
      // Without this line `claim()` returns `false` unconditionally: every
      // progress event reads as a duplicate, and the seam silently discards all
      // of them forever while looking perfectly healthy. Caught by
      // `fulfillment-progress-dedup.int-spec.ts`, which is the reason that spec
      // asserts the FIRST claim wins and not merely that a replay loses.
      .returning('"workId"')
      .execute();

    return (result.raw as unknown[]).length > 0;
  }
}
