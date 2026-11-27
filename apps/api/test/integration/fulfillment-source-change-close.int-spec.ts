/**
 * A box the shop's lowered quantity leaves exactly full (#3961)
 *
 * Two things against real Postgres, because both rest on SQL a unit spec can
 * only mock:
 *
 *  1. `findLatestActiveVerificationForLine` - the read "Done, I took it out"
 *     voids from, and the read that names who owns a box closed by a lowered
 *     quantity. It must skip voided rows, keep to its ONE line, order by the
 *     scan instant, and carry the scanner's id.
 *  2. `lowerLineQuantity` closing such a box records it as `shipped`
 *     progress, which is what the #2728 relay sweep finds a parcel by. Without
 *     that row the parcel would be closed in OpenLinker and never reported as
 *     dispatched to the order's channel.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_ORDER_EDIT_SERVICE_TOKEN,
  FULFILLMENT_VERIFICATION_SERVICE_TOKEN,
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  type CreateFulfillmentWorkInput,
  type FulfillmentWork,
  type IFulfillmentOrderEditService,
  type IFulfillmentVerificationService,
} from '@openlinker/core/fulfillment';
import { OMS_PLATFORM_TYPE } from '@openlinker/oms';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';

/** The repository port is off the barrel; see `bench-work.int-spec.ts`. */
interface WorkRepositoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
  findLatestActiveVerificationForLine(
    workId: string,
    workLineId: string
  ): Promise<{ id: string; workLineId: string; verifiedByUserId: string | null } | null>;
  voidVerificationById(
    verificationId: string,
    input: { workId: string; voidedByUserId: string | null; voidedAt: Date }
  ): Promise<boolean>;
}

const ORDER_ID = 'ol_order_source_change_close';
const PACKER_A = '11111111-1111-1111-1111-111111111111';
const PACKER_B = '22222222-2222-2222-2222-222222222222';

describe('A box the lowered quantity leaves full (#3961)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });
  afterEach(async () => {
    await resetTestHarness();
  });
  afterAll(async () => {
    await teardownTestHarness();
  });

  const repository = (): WorkRepositoryView =>
    harness.getApp().get<WorkRepositoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);
  const verification = (): IFulfillmentVerificationService =>
    harness.getApp().get<IFulfillmentVerificationService>(FULFILLMENT_VERIFICATION_SERVICE_TOKEN);
  const orderEdit = (): IFulfillmentOrderEditService =>
    harness.getApp().get<IFulfillmentOrderEditService>(FULFILLMENT_ORDER_EDIT_SERVICE_TOKEN);

  /** Two lines: three mugs and one teapot. */
  async function seedWork(
    lines: CreateFulfillmentWorkInput['lines'] = [
      { orderLineId: 'l-mug', productVariantId: 'ol_variant_mug', totalQuantity: 3 },
      { orderLineId: 'l-pot', productVariantId: 'ol_variant_pot', totalQuantity: 1 },
    ]
  ): Promise<FulfillmentWork> {
    const dataSource = harness.getDataSource();
    const oms = await createTestConnection(dataSource, {
      platformType: OMS_PLATFORM_TYPE,
      name: 'Warehouse packing',
      status: 'active',
      adapterKey: null as unknown as undefined,
      credentialsRef: '',
      enabledCapabilities: ['FulfillmentExecutor'],
      config: {},
    });
    const work = await repository().create({
      orderId: ORDER_ID,
      locationId: 'ol_location_1',
      deliveryMethod: 'courier',
      assignedConnectionId: oms.id,
      lines,
    });
    await dataSource.query(
      `UPDATE "fulfillment_works" SET "requestStatus" = 'accepted' WHERE "id" = $1`,
      [work.id]
    );
    return work;
  }

  const lineId = (work: FulfillmentWork, orderLineId: string): string =>
    work.lines.find((line) => line.orderLineId === orderLineId)?.id ?? '';

  /** Record one scan and pin its instant, so "latest" never rests on a tie. */
  async function scan(
    work: FulfillmentWork,
    orderLineId: string,
    gestureId: string,
    by: string,
    at: string
  ): Promise<void> {
    await verification().verifyUnit({
      workId: work.id,
      workLineId: lineId(work, orderLineId),
      gestureId,
      verifiedByUserId: by,
    });
    await harness
      .getDataSource()
      .query(
        `UPDATE "fulfillment_work_verifications" SET "verifiedAt" = $1 WHERE "gestureId" = $2`,
        [at, gestureId]
      );
  }

  describe('findLatestActiveVerificationForLine', () => {
    it('should answer the newest active scan on that ONE line, with who scanned it', async () => {
      const work = await seedWork();
      await scan(work, 'l-mug', 'g-1', PACKER_A, '2026-11-09T10:00:00Z');
      await scan(work, 'l-mug', 'g-2', PACKER_B, '2026-11-09T10:01:00Z');
      // A later scan on ANOTHER line must not be the answer for this one.
      await scan(work, 'l-pot', 'g-3', PACKER_A, '2026-11-09T10:02:00Z');

      const latest = await repository().findLatestActiveVerificationForLine(
        work.id,
        lineId(work, 'l-mug')
      );

      expect(latest).toMatchObject({
        workLineId: lineId(work, 'l-mug'),
        verifiedByUserId: PACKER_B,
      });
    });

    it('should skip a voided scan and fall back to the one before it', async () => {
      const work = await seedWork();
      await scan(work, 'l-mug', 'g-1', PACKER_A, '2026-11-09T10:00:00Z');
      await scan(work, 'l-mug', 'g-2', PACKER_B, '2026-11-09T10:01:00Z');
      const newest = await repository().findLatestActiveVerificationForLine(
        work.id,
        lineId(work, 'l-mug')
      );
      await repository().voidVerificationById(newest?.id ?? '', {
        workId: work.id,
        voidedByUserId: PACKER_B,
        voidedAt: new Date(),
      });

      const latest = await repository().findLatestActiveVerificationForLine(
        work.id,
        lineId(work, 'l-mug')
      );

      expect(latest).toMatchObject({ verifiedByUserId: PACKER_A });
    });

    it('should keep to its own work when two works carry the same order line', async () => {
      // A split order: the mugs sit in two boxes, so one order line has a work
      // line in each. A scan in the second box must never count for the first.
      const first = await seedWork([
        { orderLineId: 'l-mug', productVariantId: 'ol_variant_mug', totalQuantity: 2 },
      ]);
      const second = await seedWork([
        { orderLineId: 'l-mug', productVariantId: 'ol_variant_mug', totalQuantity: 1 },
      ]);
      await scan(first, 'l-mug', 'g-1', PACKER_A, '2026-11-09T10:00:00Z');
      await scan(second, 'l-mug', 'g-2', PACKER_B, '2026-11-09T10:05:00Z');

      const latest = await repository().findLatestActiveVerificationForLine(
        first.id,
        lineId(first, 'l-mug')
      );

      expect(latest).toMatchObject({
        workLineId: lineId(first, 'l-mug'),
        verifiedByUserId: PACKER_A,
      });
    });

    it('should still answer for a closed box, whose scans a close never voids', async () => {
      // The last scan closes the box (D18). The read must keep answering, so
      // the take-out step and its refusal decide on the real count.
      const work = await seedWork([
        { orderLineId: 'l-mug', productVariantId: 'ol_variant_mug', totalQuantity: 1 },
      ]);
      await scan(work, 'l-mug', 'g-1', PACKER_A, '2026-11-09T10:00:00Z');
      const state = await verification().getState(work.id);
      expect(state.closedAt).not.toBeNull();

      const latest = await repository().findLatestActiveVerificationForLine(
        work.id,
        lineId(work, 'l-mug')
      );
      const refused = await verification().voidSurplusOnLine({
        workId: work.id,
        workLineId: lineId(work, 'l-mug'),
        keep: 0,
        actorUserId: PACKER_A,
      });

      expect(latest).toMatchObject({ verifiedByUserId: PACKER_A });
      expect(refused).toMatchObject({ outcome: 'refused', reason: 'parcel-closed' });
    });

    it('should answer null for a line with no active scan', async () => {
      const work = await seedWork();
      await scan(work, 'l-pot', 'g-1', PACKER_A, '2026-11-09T10:00:00Z');

      await expect(
        repository().findLatestActiveVerificationForLine(work.id, lineId(work, 'l-mug'))
      ).resolves.toBeNull();
    });
  });

  describe('lowerLineQuantity closing a full box', () => {
    it('should close the box as its last scanner and record it as shipped for the relay sweep', async () => {
      const work = await seedWork();
      await scan(work, 'l-mug', 'g-1', PACKER_A, '2026-11-09T10:00:00Z');
      await scan(work, 'l-pot', 'g-2', PACKER_B, '2026-11-09T10:01:00Z');

      // The shop lowers the mugs 3 -> 1: the box already holds exactly that.
      const result = await orderEdit().lowerLineQuantity({
        orderId: ORDER_ID,
        orderLineId: 'l-mug',
        newQuantity: 1,
      });

      expect(result.closedParcels).toHaveLength(1);
      const rows = (await harness
        .getDataSource()
        .query(
          `SELECT "parcelClosedAt", "packedByUserId" FROM "fulfillment_works" WHERE "id" = $1`,
          [work.id]
        )) as Array<{ parcelClosedAt: Date | null; packedByUserId: string | null }>;
      expect(rows[0].parcelClosedAt).not.toBeNull();
      expect(rows[0].packedByUserId).toBe(PACKER_B);

      const claims = (await harness
        .getDataSource()
        .query(
          `SELECT "eventKind", "connectionId" FROM "fulfillment_progress_claims" WHERE "workId" = $1`,
          [work.id]
        )) as Array<{ eventKind: string; connectionId: string }>;
      expect(claims).toEqual([{ eventKind: 'shipped', connectionId: work.assignedConnectionId }]);
    });

    it('should leave a box open, and record nothing, while it still holds fewer units than asked', async () => {
      const work = await seedWork();
      await scan(work, 'l-mug', 'g-1', PACKER_A, '2026-11-09T10:00:00Z');

      const result = await orderEdit().lowerLineQuantity({
        orderId: ORDER_ID,
        orderLineId: 'l-mug',
        newQuantity: 1,
      });

      expect(result.closedParcels).toEqual([]);
      const claims = (await harness
        .getDataSource()
        .query(`SELECT 1 FROM "fulfillment_progress_claims" WHERE "workId" = $1`, [
          work.id,
        ])) as unknown[];
      expect(claims).toHaveLength(0);
    });
  });
});
