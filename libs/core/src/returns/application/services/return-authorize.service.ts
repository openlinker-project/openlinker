/**
 * Return Authorize Service (#2372, ADR-060 / ADR-044)
 *
 * The second return WRITE, and the mirror image of `ReturnDeclineService`: same
 * ADR-044 proposal record, same attribution seam, and **no adapter call at all**.
 *
 * ## Why there is no source to ask
 *
 * `return.authorize` is restricted to `origin: 'operator_authored'` — a return an
 * operator opened in OL because the source has no returns surface. There is
 * therefore no marketplace holding an opinion about it, and OL is the authority.
 * The `order_changes` row is the AUDIT RECORD of the operator's act, not a request
 * awaiting an answer, which is why it is opened and confirmed in the same breath.
 * Reusing that table rather than growing a second proposal mechanism is the
 * issue's own acceptance criterion.
 *
 * ## The cycle, and the four decisions in it
 *
 * 1. Load and refuse an ORPHAN through the single seam
 *    `IReturnsService.assertAttributedForTrigger('authorize')` (#2332) — before
 *    anything is written, and never re-implemented locally, because a second orphan
 *    rule is how the bucket, the block and this write start disagreeing about one row.
 * 2. **Refuse a `source_ingested` return.** The whole point of the slice: the
 *    marketplace already decided, and OL restating that decision would put words in
 *    its mouth. A NAMED error, never a silent no-op — an operator clicking Authorize
 *    must learn why nothing happened.
 * 3. Short-circuit an already-stamped `authorizedAt` — idempotent, one read.
 * 4. Open (or reuse) the proposal, confirm it, claim `appliedAt`, stamp the header.
 *
 * **`authorizedAt` is OL's own clock, and that is correct here.** The #2336 /
 * #2367 / #2371 rule is that OL's clock may not stand in for a CHANNEL-reported
 * fact. An operator authorizing a return OL itself authored is OL's own act with
 * OL as the sensor — the same side of the line as `ReturnLineEvent.occurredAt`,
 * and the opposite side from `claimDeclinedAt`, which must carry the source's
 * instant.
 *
 * **A reused open proposal does NOT abort, deliberately unlike decline.** The
 * ADR-044 slot exists to stop a duplicate REMOTE request; this action makes none,
 * so there is nothing to duplicate, and refusing would let one crash between
 * `openOrReuse` and `confirm` wedge the return behind a full TTL for no safety
 * gain. The at-most-once guarantee is `claimAuthorizedAt`'s `IS NULL` predicate —
 * a single conditional UPDATE — exactly as `claimDeclinedAt` is for decline.
 *
 * *Tripwire*: that branch works only because `openOrReuse` opens rows through
 * `insertRequested` (status `'requested'`) and `confirm` guards on exactly that
 * status. If `openOrReuse` ever returns a `'pending'` row, the confirm silently
 * stops landing while the stamp still happens.
 *
 * **No guard on `declinedAt` or `closedAt`.** ADR-044/ADR-060: the four timestamps
 * are four independent facts and none excludes another. A guard here would quietly
 * reinstate the status ladder the model refuses. (It is unreachable in practice
 * anyway — declining needs a source-native id, which such a return has not got.)
 *
 * @module libs/core/src/returns/application/services
 * @implements {IReturnAuthorizeService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ORDER_CHANGE_SERVICE_TOKEN, type IOrderChangeService } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';
import { ReturnAuthorizeRefusedError } from '../../domain/exceptions/return-authorize-refused.error';
import { ReturnNotAttributedError } from '../../domain/exceptions/return-not-attributed.error';
import { ReturnRepositoryPort } from '../../domain/ports/return-repository.port';
import type { ReturnDownstreamTrigger } from '../../domain/types/return-trigger.types';
import { RETURN_REPOSITORY_TOKEN, RETURNS_SERVICE_TOKEN } from '../../returns.tokens';
import { IReturnsService } from './returns.service.interface';
import type {
  AuthorizeReturnInput,
  AuthorizeReturnResult,
  IReturnAuthorizeService,
} from './return-authorize.service.interface';

/** The ADR-044 kind this service proposes. */
const RETURN_AUTHORIZE_KIND = 'return.authorize';

/** The attribution-guard vocabulary this write is refused by (#2332). */
const RETURN_AUTHORIZE_TRIGGER: ReturnDownstreamTrigger = 'authorize';

@Injectable()
export class ReturnAuthorizeService implements IReturnAuthorizeService {
  private readonly logger = new Logger(ReturnAuthorizeService.name);

  constructor(
    @Inject(RETURN_REPOSITORY_TOKEN)
    private readonly repository: ReturnRepositoryPort,
    @Inject(RETURNS_SERVICE_TOKEN)
    private readonly returns: IReturnsService,
    @Inject(ORDER_CHANGE_SERVICE_TOKEN)
    private readonly orderChanges: IOrderChangeService
  ) {}

  async authorize(input: AuthorizeReturnInput): Promise<AuthorizeReturnResult> {
    const record = await this.returns.assertAttributedForTrigger(
      input.returnId,
      RETURN_AUTHORIZE_TRIGGER
    );

    if (record.origin !== 'operator_authored') {
      this.logger.warn(
        `Refusing to authorize return ${record.id}: it was ingested from connection ` +
          `${record.sourceConnectionId}, which already decided it`
      );
      throw new ReturnAuthorizeRefusedError(record.id, 'source-ingested');
    }

    // The guard is what makes this non-null. Re-asserted rather than `!`-ed: if a
    // future change to the guard let an orphan through, this raises the same refusal
    // instead of writing a NULL into `order_changes.internalOrderId`, which is NOT
    // NULL. Unreachable today, by construction.
    const internalOrderId = record.internalOrderId;
    if (internalOrderId === null) {
      throw new ReturnNotAttributedError(record.id, RETURN_AUTHORIZE_TRIGGER);
    }

    if (record.authorizedAt !== null) {
      this.logger.debug(
        `Return ${record.id} is already authorized (${record.authorizedAt.toISOString()})`
      );
      const previous = await this.orderChanges.findLatestByTarget(
        internalOrderId,
        record.id,
        RETURN_AUTHORIZE_KIND
      );
      return {
        outcome: 'already-authorized',
        changeId: previous?.id ?? null,
        authorizedAt: record.authorizedAt,
      };
    }

    const authorizedAt = new Date();

    const { change, opened } = await this.orderChanges.openOrReuse({
      internalOrderId,
      kind: RETURN_AUTHORIZE_KIND,
      targetRef: record.id,
      payload: null,
      requestedBy: input.actorUserId,
      requestedAt: authorizedAt,
    });

    if (!opened) {
      // Not an abort — see the header. Nothing was sent anywhere, so there is
      // nothing a second caller could duplicate, and `claimAuthorizedAt` below is
      // what keeps the stamp at-most-once.
      this.logger.debug(
        `Reusing open change ${change.id} to authorize return ${record.id}; ` +
          `no request was ever sent, so there is nothing to duplicate`
      );
    }

    const confirmed = await this.orderChanges.confirm(
      change.id,
      `operator:${input.actorUserId ?? 'system'}`
    );
    if (!confirmed) {
      // Someone terminalised the proposal between the open and now. The stamp below
      // is itself conditional so nothing is corrupted, but the race is reported
      // rather than dropped.
      this.logger.warn(
        `Change ${change.id} was no longer open when authorizing return ${record.id}; ` +
          `the operator's act may not be recorded on it`
      );
    }

    if (await this.orderChanges.claimApplied(change.id)) {
      await this.repository.claimAuthorizedAt(record.id, authorizedAt);
    }

    this.logger.log(
      `Return ${record.id} authorized by ${input.actorUserId ?? 'system'} ` +
        `at ${authorizedAt.toISOString()} (change ${change.id})`
    );

    return { outcome: 'authorized', changeId: change.id, authorizedAt };
  }
}
