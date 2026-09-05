/**
 * Parcel Verification Service (#2418, `W3b-5`, spec § 2.5)
 *
 * Implements {@link IFulfillmentVerificationService}.
 *
 * ## The whole of `verifyUnit` runs under a row lock, and that is not caution
 *
 * The over-pack cap (story E3) is per line and greater than one, so no unique
 * index can express it. At READ COMMITTED, two concurrent verifications on one
 * line each count `n`, each insert, and the line lands at `n + 2` against a cap
 * of `n + 1` — *"the recorded quantity never exceeds the line's requirement"*
 * violated with nothing raised anywhere. The row that would conflict is a
 * phantom, so it cannot be locked before it exists and a `SELECT` guard
 * enforces nothing. Only the parent row serialises count-then-insert. That is
 * the identical adjudication `fulfillment_holds` already carries for its ≤10
 * active-hold cap, one table over, and a trigger was rejected there for a reason
 * that binds here too: the integration harness builds schema by `synchronize`,
 * which emits none.
 *
 * The same lock is the serialisation point between a completing verification and
 * a concurrent reopen, which would otherwise re-shut a box the reopener had
 * just opened.
 *
 * ## "Required" is `totalQuantity − cancelledQuantity`, re-read inside the lock
 *
 * The same expression the bench's own list already publishes as `unitsToVerify`
 * (#2416) — one definition, so a packer is never shown a target the close
 * predicate disagrees with. `totalQuantity` alone would make a partially
 * cancelled parcel impossible to close; and because `cancelledQuantity` moves
 * independently of packing, the lines are re-read inside the lock rather than
 * carried in from an earlier read.
 *
 * A requirement that SHRINKS below what is already verified is treated as
 * complete rather than as over-packed: the units are physically in the box, and
 * refusing to close a box that is already full would strand it.
 *
 * ## What this service refuses to know
 *
 * Whether the parcel has SHIPPED arrives as a required argument. `fulfillment`
 * is a registered zero-sibling-edge leaf (ADR-053) and may not read `shipping`,
 * so the *rule* lives here — in one place, refusing — while the *fact* comes
 * from the caller that is allowed to know it. Required rather than optional: a
 * flag defaulting to `false` would silently reopen a shipped parcel the day a
 * second caller forgot it.
 *
 * @module libs/core/src/fulfillment/application/services
 * @implements {IFulfillmentVerificationService}
 */
import { Inject, Injectable } from '@nestjs/common';

import { FulfillmentWorkNotFoundError } from '../../domain/exceptions/fulfillment-work-not-found.error';
import {
  FulfillmentWorkRepositoryPort} from '../../domain/ports/fulfillment-work-repository.port';
import type {
  FulfillmentWorkTransaction,
} from '../../domain/ports/fulfillment-work-repository.port';
import {
  requiredUnitsForLine,
  type ParcelVerificationLineState,
  type ParcelVerificationState,
  type ReopenParcelInput,
  type ReopenParcelResult,
  type VerifyUnitInput,
  type VerifyUnitResult,
} from '../../domain/types/fulfillment-verification.types';
import type { FulfillmentWork } from '../../domain/types/fulfillment-work.types';
import { FULFILLMENT_WORK_REPOSITORY_TOKEN } from '../../fulfillment.tokens';
import type { IFulfillmentVerificationService } from '../interfaces/fulfillment-verification.service.interface';

@Injectable()
export class FulfillmentVerificationService implements IFulfillmentVerificationService {
  constructor(
    @Inject(FULFILLMENT_WORK_REPOSITORY_TOKEN)
    private readonly works: FulfillmentWorkRepositoryPort
  ) {}

  async getState(workId: string): Promise<ParcelVerificationState> {
    const work = await this.works.findById(workId);
    if (work === null) throw new FulfillmentWorkNotFoundError(workId);
    const counts = await this.works.countParcelVerifications(workId);
    return this.toState(work, counts);
  }

  async verifyUnit(input: VerifyUnitInput): Promise<VerifyUnitResult> {
    return this.works.runInTransaction(async (transaction) => {
      const work = await this.works.lockWorkForVerification(input.workId, transaction);
      if (work === null) throw new FulfillmentWorkNotFoundError(input.workId);

      const counts = await this.works.countParcelVerifications(input.workId, transaction);

      // A closed box takes nothing more. Checked before the line lookup so that
      // scanning at a finished parcel says "this box is closed" rather than
      // "no such line", which is a different instruction.
      if (work.parcelClosedAt !== null) {
        return {
          outcome: 'refused',
          reason: 'parcel-closed',
          state: this.toState(work, counts),
        } as const;
      }

      const line = work.lines.find((candidate) => candidate.id === input.workLineId);
      if (line === undefined) {
        return {
          outcome: 'refused',
          reason: 'no-such-line',
          state: this.toState(work, counts),
        } as const;
      }

      const required = requiredUnitsForLine(line);
      const verified = counts.find((c) => c.workLineId === line.id)?.verifiedQuantity ?? 0;
      // Story E3, enforced under the lock. `>=` rather than `===` so a
      // requirement that shrank below what is already in the box refuses the
      // NEXT unit rather than admitting one.
      if (verified >= required) {
        return {
          outcome: 'refused',
          reason: 'over-packed',
          state: this.toState(work, counts),
        } as const;
      }

      const verifiedAt = new Date();
      const inserted = await this.works.recordParcelVerification(
        {
          workId: input.workId,
          workLineId: line.id,
          gestureId: input.gestureId,
          verifiedByUserId: input.verifiedByUserId,
          verifiedAt,
        },
        transaction
      );

      if (!inserted) {
        // ONE physical action, offered twice — a retry, a sleeping tablet, a
        // reflex double-trigger. Nothing changed; the current state is the
        // answer. A genuinely second scan carries a different gesture id and
        // never lands here.
        return { outcome: 'deduplicated', state: this.toState(work, counts) } as const;
      }

      const nextCounts = await this.works.countParcelVerifications(input.workId, transaction);
      let closedWork = work;

      if (this.isComplete(work, nextCounts)) {
        // D18: the box shuts itself, here, as a consequence of this
        // verification — never through a control the packer presses.
        const claimed = await this.works.claimParcelClose(
          {
            workId: input.workId,
            closedAt: verifiedAt,
            // D13: the LAST verifier owns the parcel. Under roaming benches
            // that may be someone who checked one item of five, which is
            // recorded as a limitation on the column rather than dressed up.
            packedByUserId: input.verifiedByUserId,
          },
          transaction
        );
        if (claimed) {
          closedWork = {
            ...work,
            parcelClosedAt: verifiedAt,
            packedByUserId: input.verifiedByUserId,
            version: work.version + 1,
          };
        }
      }

      return { outcome: 'verified', state: this.toState(closedWork, nextCounts) } as const;
    });
  }

  async reopenParcel(input: ReopenParcelInput): Promise<ReopenParcelResult> {
    // The refusal that must come first, because it is the one no later state
    // can undo: the box has left the building, and reopening it in software is
    // a fiction (D19).
    if (input.hasShipped) {
      return { outcome: 'refused', reason: 'shipped', state: await this.getState(input.workId) };
    }

    return this.works.runInTransaction(async (transaction: FulfillmentWorkTransaction) => {
      const work = await this.works.lockWorkForVerification(input.workId, transaction);
      if (work === null) throw new FulfillmentWorkNotFoundError(input.workId);

      const reopened = await this.works.reopenParcel(
        {
          workId: input.workId,
          reopenedByUserId: input.reopenedByUserId,
          reopenedAt: new Date(),
          expectedVersion: input.expectedVersion,
        },
        transaction
      );

      const counts = await this.works.countParcelVerifications(input.workId, transaction);
      if (!reopened) {
        return {
          outcome: 'refused',
          reason: 'not-closed',
          state: this.toState(work, counts),
        } as const;
      }

      return {
        outcome: 'reopened',
        state: this.toState(
          { ...work, parcelClosedAt: null, packedByUserId: null, version: work.version + 1 },
          counts
        ),
      } as const;
    });
  }

  /** Every line full. An empty work is deliberately NOT complete — see below. */
  private isComplete(
    work: FulfillmentWork,
    counts: readonly { readonly workLineId: string; readonly verifiedQuantity: number }[]
  ): boolean {
    // A work with no lines, or one whose every line requires zero units, must
    // never close on a verification — there is nothing to have verified, and
    // `every` over an empty array is vacuously true, so without this such a
    // parcel would shut on a scan that recorded nothing.
    //
    // It is reachable only when every line is fully cancelled while the work
    // itself is not, which is a routing fault rather than a packing one. The
    // bench renders it as "0 of 0" and it can never close; NOTHING reports it
    // as a fault today, and that gap is stated here rather than implied away.
    const outstanding = work.lines.filter((line) => requiredUnitsForLine(line) > 0);
    if (outstanding.length === 0) return false;

    return outstanding.every((line) => {
      const verified = counts.find((c) => c.workLineId === line.id)?.verifiedQuantity ?? 0;
      return verified >= requiredUnitsForLine(line);
    });
  }

  private toState(
    work: FulfillmentWork,
    counts: readonly { readonly workLineId: string; readonly verifiedQuantity: number }[]
  ): ParcelVerificationState {
    const lines: ParcelVerificationLineState[] = work.lines.map((line) => ({
      workLineId: line.id,
      requiredQuantity: requiredUnitsForLine(line),
      // Clamped, because a requirement can shrink under an already-verified
      // line and a surface must never render "3 of 2".
      verifiedQuantity: Math.min(
        counts.find((c) => c.workLineId === line.id)?.verifiedQuantity ?? 0,
        requiredUnitsForLine(line)
      ),
    }));

    return {
      workId: work.id,
      // The POST-write token. `claimParcelClose` and `reopenParcel` both bump
      // `version` in SQL, and both callers above hand this method the work with
      // that bump already applied — so a client reopening a box it just watched
      // close holds a token that still matches the row.
      version: work.version,
      lines,
      closedAt: work.parcelClosedAt,
      packedByUserId: work.packedByUserId,
    };
  }
}
