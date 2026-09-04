/**
 * Parcel verification (#2418, spec § 2.5)
 *
 * Stories E1 (a unit is verified), E3 (over-packing is refused at the moment it
 * happens), E5/D18 (the box closes itself on the last verification), E6/D19
 * (reopening, refused once the goods have gone) and the gesture-id dedupe that
 * makes one physical action count once.
 *
 * @module libs/core/src/fulfillment/application/services/__tests__
 */
import type {
  FulfillmentWorkRepositoryPort,
  ParcelVerifiedCount,
} from '../../../domain/ports/fulfillment-work-repository.port';
import type { FulfillmentWork } from '../../../domain/types/fulfillment-work.types';
import { FulfillmentVerificationService } from '../fulfillment-verification.service';

const line = (over: Partial<FulfillmentWork['lines'][number]> = {}) => ({
  id: 'line-1',
  orderLineId: 'ol_line_1',
  productVariantId: 'ol_variant_1',
  totalQuantity: 2,
  fulfilledQuantity: 0,
  cancelledQuantity: 0,
  ...over,
});

const work = (over: Partial<FulfillmentWork> = {}): FulfillmentWork => ({
  id: 'work-1',
  orderId: 'ol_order_1',
  locationId: null,
  deliveryMethod: null,
  assignedConnectionId: 'conn-1',
  status: 'open',
  requestStatus: 'accepted',
  assignmentAttempt: 0,
  cancellationReason: null,
  version: 3,
  cancelledAt: null,
  dispatchRelayedAt: null,
  expeditedAt: null,
  acceptedAt: null,
  externalWorkId: null,
  parcelClosedAt: null,
  packedByUserId: null,
  packedByService: null,
  lines: [line()],
  createdAt: new Date('2026-09-01T09:00:00Z'),
  updatedAt: new Date('2026-09-01T09:00:00Z'),
  ...over,
});

interface Harness {
  readonly service: FulfillmentVerificationService;
  readonly repo: jest.Mocked<
    Pick<
      FulfillmentWorkRepositoryPort,
      | 'runInTransaction'
      | 'findById'
      | 'lockWorkForVerification'
      | 'recordParcelVerification'
      | 'countParcelVerifications'
      | 'claimParcelClose'
      | 'reopenParcel'
    >
  >;
}

function harness(options: {
  work?: FulfillmentWork;
  /** Counts returned in order, so a call before and after an insert can differ. */
  counts?: ParcelVerifiedCount[][];
  inserted?: boolean;
  closed?: boolean;
  reopened?: boolean;
}): Harness {
  const queue = [...(options.counts ?? [[], []])];
  const repo = {
    // A real pass-through, so a test that forgets the transaction still exercises
    // the same code path the database does.
    runInTransaction: jest.fn((fn: (t: unknown) => unknown) => fn({})),
    findById: jest.fn().mockResolvedValue(options.work ?? work()),
    lockWorkForVerification: jest.fn().mockResolvedValue(options.work ?? work()),
    recordParcelVerification: jest.fn().mockResolvedValue(options.inserted ?? true),
    countParcelVerifications: jest.fn(() =>
      Promise.resolve(queue.length > 1 ? (queue.shift() as ParcelVerifiedCount[]) : queue[0] ?? [])
    ),
    claimParcelClose: jest.fn().mockResolvedValue(options.closed ?? true),
    reopenParcel: jest.fn().mockResolvedValue(options.reopened ?? true),
  } as unknown as Harness['repo'];

  return {
    service: new FulfillmentVerificationService(repo as unknown as FulfillmentWorkRepositoryPort),
    repo,
  };
}

describe('FulfillmentVerificationService (#2418)', () => {
  describe('story E1 — a unit is verified in', () => {
    it('records the unit and reports the new count', async () => {
      const { service, repo } = harness({
        work: work({ lines: [line({ totalQuantity: 2 })] }),
        counts: [[], [{ workLineId: 'line-1', verifiedQuantity: 1 }]],
      });

      const result = await service.verifyUnit({
        workId: 'work-1',
        workLineId: 'line-1',
        gestureId: 'g1',
        verifiedByUserId: 'user-1',
      });

      expect(result.outcome).toBe('verified');
      expect(result.state.lines[0]).toEqual({
        workLineId: 'line-1',
        requiredQuantity: 2,
        verifiedQuantity: 1,
      });
      expect(repo.recordParcelVerification).toHaveBeenCalledWith(
        expect.objectContaining({ workLineId: 'line-1', gestureId: 'g1' }),
        expect.anything()
      );
    });

    it('takes the row lock BEFORE counting — the over-pack cap depends on it', async () => {
      const { service, repo } = harness({ counts: [[], []] });
      await service.verifyUnit({
        workId: 'work-1',
        workLineId: 'line-1',
        gestureId: 'g1',
        verifiedByUserId: null,
      });
      // The cap is per line and greater than one, so no unique index expresses
      // it and the conflicting row is a phantom. Only the parent row serialises
      // count-then-insert.
      expect(repo.lockWorkForVerification).toHaveBeenCalled();
      const lockOrder = repo.lockWorkForVerification.mock.invocationCallOrder[0];
      const countOrder = repo.countParcelVerifications.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(countOrder);
    });
  });

  describe('story E3 — over-packing is refused at the moment it happens', () => {
    it('refuses the extra unit and records NOTHING', async () => {
      const { service, repo } = harness({
        work: work({ lines: [line({ totalQuantity: 2 })] }),
        counts: [[{ workLineId: 'line-1', verifiedQuantity: 2 }]],
      });

      const result = await service.verifyUnit({
        workId: 'work-1',
        workLineId: 'line-1',
        gestureId: 'g3',
        verifiedByUserId: 'user-1',
      });

      expect(result).toMatchObject({ outcome: 'refused', reason: 'over-packed' });
      // "Records nothing" includes not consuming the gesture id, so the packer's
      // next CORRECT scan of the same physical action is not deduplicated away.
      expect(repo.recordParcelVerification).not.toHaveBeenCalled();
      expect(result.state.lines[0].verifiedQuantity).toBe(2);
    });

    it('counts a line as full when cancellation shrank what it requires', async () => {
      // `requiredQuantity` is `totalQuantity − cancelledQuantity`, the same
      // expression the work list publishes as `unitsToVerify`. Reading
      // `totalQuantity` alone would make a partially cancelled parcel
      // impossible to close.
      const { service } = harness({
        work: work({ lines: [line({ totalQuantity: 3, cancelledQuantity: 2 })] }),
        counts: [[{ workLineId: 'line-1', verifiedQuantity: 1 }]],
      });

      const result = await service.verifyUnit({
        workId: 'work-1',
        workLineId: 'line-1',
        gestureId: 'g4',
        verifiedByUserId: null,
      });

      expect(result).toMatchObject({ outcome: 'refused', reason: 'over-packed' });
    });
  });

  describe('stories E2/D2 — a line that is not on this parcel', () => {
    it('refuses and records nothing', async () => {
      const { service, repo } = harness({ counts: [[]] });
      const result = await service.verifyUnit({
        workId: 'work-1',
        workLineId: 'line-nope',
        gestureId: 'g5',
        verifiedByUserId: null,
      });
      expect(result).toMatchObject({ outcome: 'refused', reason: 'no-such-line' });
      expect(repo.recordParcelVerification).not.toHaveBeenCalled();
    });
  });

  describe('story E5 / decision D18 — the box closes itself', () => {
    it('claims the close on the verification that fills the last line', async () => {
      const { service, repo } = harness({
        work: work({ lines: [line({ totalQuantity: 1 })] }),
        counts: [[], [{ workLineId: 'line-1', verifiedQuantity: 1 }]],
      });

      const result = await service.verifyUnit({
        workId: 'work-1',
        workLineId: 'line-1',
        gestureId: 'g6',
        verifiedByUserId: 'user-9',
      });

      expect(repo.claimParcelClose).toHaveBeenCalledWith(
        // D13: the LAST verifier owns the parcel.
        expect.objectContaining({ workId: 'work-1', packedByUserId: 'user-9' }),
        expect.anything()
      );
      expect(result.state.closedAt).not.toBeNull();
      expect(result.state.packedByUserId).toBe('user-9');
    });

    it('does not close while a second line is outstanding', async () => {
      const { service, repo } = harness({
        work: work({ lines: [line({ id: 'a', totalQuantity: 1 }), line({ id: 'b', totalQuantity: 1 })] }),
        counts: [[], [{ workLineId: 'a', verifiedQuantity: 1 }]],
      });

      await service.verifyUnit({
        workId: 'work-1',
        workLineId: 'a',
        gestureId: 'g7',
        verifiedByUserId: null,
      });

      expect(repo.claimParcelClose).not.toHaveBeenCalled();
    });

    it('never closes a parcel that requires nothing', async () => {
      // `every` over an empty array is vacuously true, so a work with no lines —
      // or one whose every line is fully cancelled — would otherwise close on a
      // scan that verified nothing. That is a routing fault to report, not a box
      // to silently finish.
      const { service, repo } = harness({
        work: work({ lines: [line({ totalQuantity: 1, cancelledQuantity: 1 })] }),
        counts: [[], []],
      });

      await service.verifyUnit({
        workId: 'work-1',
        workLineId: 'line-1',
        gestureId: 'g8',
        verifiedByUserId: null,
      });

      expect(repo.claimParcelClose).not.toHaveBeenCalled();
    });

    it('refuses a scan at an already-closed box', async () => {
      const { service, repo } = harness({
        work: work({ parcelClosedAt: new Date('2026-09-01T14:32:00Z') }),
        counts: [[{ workLineId: 'line-1', verifiedQuantity: 2 }]],
      });

      const result = await service.verifyUnit({
        workId: 'work-1',
        workLineId: 'line-1',
        gestureId: 'g9',
        verifiedByUserId: null,
      });

      expect(result).toMatchObject({ outcome: 'refused', reason: 'parcel-closed' });
      expect(repo.recordParcelVerification).not.toHaveBeenCalled();
    });
  });

  describe('the per-gesture id (story G3, consumed here)', () => {
    it('reports a repeat of ONE physical action as deduplicated, changing nothing', async () => {
      const { service, repo } = harness({
        inserted: false,
        counts: [[{ workLineId: 'line-1', verifiedQuantity: 1 }]],
      });

      const result = await service.verifyUnit({
        workId: 'work-1',
        workLineId: 'line-1',
        gestureId: 'g-same',
        verifiedByUserId: null,
      });

      expect(result.outcome).toBe('deduplicated');
      expect(repo.claimParcelClose).not.toHaveBeenCalled();
    });

    /**
     * The other half of G3, and the one that cannot be inferred from the first
     * (#2420, `W3b-7`).
     *
     * *"Two units of the same SKU on one line, scanned twice, are two units,
     * while a retry of one scan is one unit."* At the wire level those are the
     * SAME gesture — one `POST` naming one line, twice — and the only thing
     * separating them is the per-gesture id. So asserting the dedupe half alone
     * proves nothing about the half a packer meets far more often: a two-unit
     * line is ordinary, and a service that deduped on the LINE would silently
     * shut the box one unit light while reading as perfectly verified.
     *
     * Until now the property was asserted only over HTTP
     * (`bench-parcel.int-spec.ts`), so a core regression needed Docker to
     * surface.
     */
    it('records a genuinely SECOND unit of the same line as a second unit', async () => {
      const { service, repo } = harness({
        work: work({ lines: [line({ totalQuantity: 2 })] }),
        // One unit already in the box; the count after the insert is two.
        counts: [
          [{ workLineId: 'line-1', verifiedQuantity: 1 }],
          [{ workLineId: 'line-1', verifiedQuantity: 2 }],
        ],
      });

      const result = await service.verifyUnit({
        workId: 'work-1',
        workLineId: 'line-1',
        // A DIFFERENT id for the same line — a second physical scan, not a retry.
        gestureId: 'g-second',
        verifiedByUserId: 'user-1',
      });

      expect(result.outcome).toBe('verified');
      expect(result.state.lines[0]).toEqual({
        workLineId: 'line-1',
        requiredQuantity: 2,
        verifiedQuantity: 2,
      });
      // The over-pack guard must read `verified >= required`, never "this line
      // already has one" — the latter is what makes a two-unit line unpackable.
      expect(repo.recordParcelVerification).toHaveBeenCalledTimes(1);
    });

    it('passes the CALLER’s gesture id through verbatim as the dedup key', async () => {
      // Dedup is the database's `(fulfillmentWorkId, gestureId)` index, and the
      // key is the browser's. A key the service derived from the work and line
      // instead would collapse the two cases above into one: the second unit of
      // a line would conflict with the first and be reported `deduplicated`.
      const { service, repo } = harness({
        work: work({ lines: [line({ totalQuantity: 2 })] }),
        counts: [[], [{ workLineId: 'line-1', verifiedQuantity: 1 }]],
      });

      await service.verifyUnit({
        workId: 'work-1',
        workLineId: 'line-1',
        gestureId: 'gesture-minted-by-the-browser',
        verifiedByUserId: 'user-1',
      });

      expect(repo.recordParcelVerification).toHaveBeenCalledWith(
        expect.objectContaining({ gestureId: 'gesture-minted-by-the-browser' }),
        expect.anything()
      );
    });
  });

  describe('story E6 / decision D19 — reopening', () => {
    it('refuses once the goods have left the building, without touching storage', async () => {
      const { service, repo } = harness({
        work: work({ parcelClosedAt: new Date() }),
        counts: [[{ workLineId: 'line-1', verifiedQuantity: 2 }]],
      });

      const result = await service.reopenParcel({
        workId: 'work-1',
        reopenedByUserId: 'user-1',
        hasShipped: true,
      });

      expect(result).toMatchObject({ outcome: 'refused', reason: 'shipped' });
      expect(repo.reopenParcel).not.toHaveBeenCalled();
    });

    it('reopens a closed parcel and carries the optimistic token through', async () => {
      const { service, repo } = harness({
        work: work({ parcelClosedAt: new Date() }),
        counts: [[]],
      });

      const result = await service.reopenParcel({
        workId: 'work-1',
        reopenedByUserId: 'user-2',
        hasShipped: false,
        expectedVersion: 3,
      });

      expect(result.outcome).toBe('reopened');
      expect(result.state.closedAt).toBeNull();
      expect(result.state.packedByUserId).toBeNull();
      expect(repo.reopenParcel).toHaveBeenCalledWith(
        expect.objectContaining({ reopenedByUserId: 'user-2', expectedVersion: 3 }),
        expect.anything()
      );
    });

    it('reports `not-closed` when the guarded write applied nothing', async () => {
      const { service } = harness({ reopened: false, counts: [[]] });
      const result = await service.reopenParcel({
        workId: 'work-1',
        reopenedByUserId: null,
        hasShipped: false,
      });
      expect(result).toMatchObject({ outcome: 'refused', reason: 'not-closed' });
    });
  });
});
