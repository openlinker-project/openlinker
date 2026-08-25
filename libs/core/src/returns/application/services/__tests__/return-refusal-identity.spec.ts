/**
 * Return Refusal Identity (merge reconciliation of #2332 and #2333)
 *
 * **What this spec is defending, and why it is worth a file of its own.**
 *
 * #2332 (the orphan bucket + downstream-trigger block) and #2333 (`return.decline`
 * as an ADR-044 action) were built concurrently off the same base, and each
 * independently defined a `ReturnNotFoundError` and a `ReturnNotAttributedError`
 * — in different files, with different messages, and (for the latter) different
 * arity. That is not a cosmetic duplication:
 *
 *  - `instanceof` silently returns `false` across two same-named classes, so the
 *    HTTP filter's `@Catch(ReturnNotAttributedError)` would miss the refusal the
 *    decline service raised and answer **500** for a state OL refused on purpose;
 *  - a Wave-2 trigger (#2334/#2335/#2336) catching one would sail straight past
 *    the other, with nothing louder than a stack trace to say so.
 *
 * The reconciliation kept ONE definition of each — the per-file #2332 pair — and
 * repointed the decline write onto the single attribution seam. These assertions
 * fail the build if anyone re-splits either half.
 *
 * @module libs/core/src/returns/application/services/__tests__
 */
import { ReturnRecord } from '../../../domain/entities/return-record.entity';
import * as declineRefusals from '../../../domain/exceptions/return-decline-unsupported.error';
import { ReturnNotAttributedError } from '../../../domain/exceptions/return-not-attributed.error';
import { ReturnNotFoundError } from '../../../domain/exceptions/return-not-found.error';
import type { ReturnRepositoryPort } from '../../../domain/ports/return-repository.port';
import { ReturnDownstreamTriggerValues } from '../../../domain/types/return-trigger.types';
import * as returnsBarrel from '../../../index';
import { ReturnDeclineService } from '../return-decline.service';
import { ReturnsService } from '../returns.service';

const RETURN_ID = 'ol_return_identity';

function orphan(): ReturnRecord {
  return new ReturnRecord(
    RETURN_ID,
    'conn-1',
    'ext-return-1',
    null, // internalOrderId — the orphan
    'ext-order-1', // externalOrderId — present, which is what makes it re-attributable
    'source_ingested',
    'DELIVERED',
    null,
    null,
    null,
    null,
    null,
    new Date(),
    new Date(),
    []
  );
}

describe('return refusal identity (#2332 x #2333)', () => {
  it('should expose exactly one ReturnNotAttributedError and one ReturnNotFoundError from the barrel', () => {
    expect(returnsBarrel.ReturnNotAttributedError).toBe(ReturnNotAttributedError);
    expect(returnsBarrel.ReturnNotFoundError).toBe(ReturnNotFoundError);
  });

  it('should not re-define the shared refusals in the decline-specific exception module', () => {
    // Asserted as ABSENCE of the two shared names, not as an exact key set: a
    // future decline-SPECIFIC refusal may legitimately join this module, and only
    // a re-definition of the shared pair is the regression.
    const exported = Object.keys(declineRefusals);
    expect(exported).not.toContain('ReturnNotAttributedError');
    expect(exported).not.toContain('ReturnNotFoundError');
    expect(exported).toContain('ReturnDeclineUnsupportedError');
  });

  it('should carry the refused trigger on ReturnNotAttributedError', () => {
    const error = new ReturnNotAttributedError(RETURN_ID, 'restock');
    expect(error.returnId).toBe(RETURN_ID);
    // Readonly and structured, never message-parsed — #2334's filter renders it.
    expect(error.trigger).toBe('restock');
  });

  it('should treat decline as a member of the attribution-guard vocabulary', () => {
    expect(ReturnDownstreamTriggerValues).toContain('decline');
  });

  it('should refuse an orphan decline with the SAME class the trigger guard raises', async () => {
    const repository = {
      findById: jest.fn().mockResolvedValue(orphan()),
      claimDeclinedAt: jest.fn(),
    } as unknown as ReturnRepositoryPort;

    const returns = new ReturnsService(repository, { getInternalId: jest.fn() } as never, {
      getAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    } as never);
    const integrations = { getCapabilityAdapter: jest.fn() };
    const decline = new ReturnDeclineService(
      repository,
      returns,
      { openOrReuse: jest.fn() } as never,
      integrations as never
    );

    // The guard's own refusal...
    const fromGuard = await returns
      .assertAttributedForTrigger(RETURN_ID, 'restock')
      .catch((error: unknown) => error);
    // ...and the decline write's refusal...
    const fromDecline = await decline
      .decline({ returnId: RETURN_ID, reasonCode: 'R', comment: null, requestedBy: 'u' })
      .catch((error: unknown) => error);

    // ...must be the same class, or a `catch (e) { if (e instanceof ...) }` in a
    // Wave-2 trigger is a coin flip.
    expect(fromGuard).toBeInstanceOf(ReturnNotAttributedError);
    expect(fromDecline).toBeInstanceOf(ReturnNotAttributedError);
    expect((fromDecline as object).constructor).toBe((fromGuard as object).constructor);

    // And the decline refusal names ITS OWN trigger, not the guard's caller.
    expect((fromDecline as ReturnNotAttributedError).trigger).toBe('decline');

    // The orphan costs nothing: refused before any adapter is resolved.
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
  });
});
