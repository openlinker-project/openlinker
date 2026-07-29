/**
 * Webhook Delivery Repository - unit spec
 *
 * Guards the #1916 fix: the `ON CONFLICT DO UPDATE` set-list must resolve
 * `status` by lifecycle rank rather than by arrival order, because the ingress
 * API and the stream consumer write the same row without any ordering
 * guarantee. The guard is SQL, so this spec asserts the emitted statement (the
 * semantics are proved against real Postgres in
 * `apps/api/test/integration/webhook-delivery-status-monotonic.int-spec.ts`).
 *
 * @module libs/core/src/webhooks/infrastructure/persistence/repositories/__tests__
 */
import type { Repository } from 'typeorm';

import { WebhookDeliveryRepository } from '../webhook-delivery.repository';
import type { WebhookDeliveryOrmEntity } from '../../entities/webhook-delivery.orm-entity';
import {
  WEBHOOK_DELIVERY_STATUS_RANK,
  WebhookDeliveryStatusValues,
} from '../../../../domain/types/webhook-delivery.types';

function makeRepo(): { repo: WebhookDeliveryRepository; query: jest.Mock } {
  const query = jest.fn().mockResolvedValue([]);
  const ormRepository = {
    query,
    findOne: jest.fn().mockResolvedValue({
      id: 'd1',
      eventId: 'e1',
      provider: 'prestashop',
      connectionId: 'c1',
      eventType: null,
      objectType: null,
      externalId: null,
      receivedAt: new Date(),
      signatureValid: null,
      dedupResult: null,
      status: 'job_enqueued',
      rejectionReason: null,
      publishedMessageId: null,
      downstreamJobId: null,
      downstreamJobType: null,
      dlqReason: null,
      payload: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  } as unknown as Repository<WebhookDeliveryOrmEntity>;

  return { repo: new WebhookDeliveryRepository(ormRepository), query };
}

async function upsertSql(input: Parameters<WebhookDeliveryRepository['upsert']>[0]): Promise<string> {
  const { repo, query } = makeRepo();
  await repo.upsert(input);
  const [sql] = query.mock.calls[0] as [string, unknown[]];
  return sql.replace(/\s+/g, ' ');
}

const baseInput = { eventId: 'e1', provider: 'prestashop', connectionId: 'c1' };

describe('WebhookDeliveryRepository', () => {
  describe('upsert - status conflict guard (#1916)', () => {
    it('should guard the status assignment by rank instead of assigning EXCLUDED directly', async () => {
      const sql = await upsertSql({ ...baseInput, status: 'published' });

      expect(sql).toContain('"status" = CASE WHEN');
      expect(sql).toContain('THEN EXCLUDED."status" ELSE webhook_deliveries."status" END');
      expect(sql).not.toContain('"status" = EXCLUDED."status"');
    });

    it('should compare the incoming rank against the stored rank with >= (same-status rewrites still apply)', async () => {
      const sql = await upsertSql({ ...baseInput, status: 'job_enqueued' });

      expect(sql).toMatch(
        /CASE EXCLUDED\."status".*END >= CASE webhook_deliveries\."status".*END THEN EXCLUDED\."status"/
      );
    });

    it('should rank every status in the union on both sides of the comparison (drift guard)', async () => {
      const sql = await upsertSql({ ...baseInput, status: 'received' });

      for (const status of WebhookDeliveryStatusValues) {
        const when = `WHEN '${status}' THEN ${WEBHOOK_DELIVERY_STATUS_RANK[status]}`;
        // Once for the EXCLUDED side, once for the stored side.
        expect(sql.split(when)).toHaveLength(3);
      }
    });

    it('should rank an unrecognised stored value below every known status so a row can never wedge', async () => {
      const sql = await upsertSql({ ...baseInput, status: 'published' });

      expect(sql.split('ELSE -1 END')).toHaveLength(3);
    });

    it('should keep non-status overlay columns on plain last-write-wins assignment', async () => {
      const sql = await upsertSql({
        ...baseInput,
        status: 'job_enqueued',
        downstreamJobId: 'job-1',
        downstreamJobType: 'marketplace.order.sync',
      });

      expect(sql).toContain('"downstreamJobId" = EXCLUDED."downstreamJobId"');
      expect(sql).toContain('"downstreamJobType" = EXCLUDED."downstreamJobType"');
      expect(sql).toContain('"updatedAt" = now()');
    });

    it('should omit any status assignment when the caller supplies no status (never clobber on conflict)', async () => {
      const sql = await upsertSql({ ...baseInput, downstreamJobId: 'job-1' });

      expect(sql).not.toContain('"status" = ');
      expect(sql).toContain('"downstreamJobId" = EXCLUDED."downstreamJobId"');
    });
  });

  describe('WEBHOOK_DELIVERY_STATUS_RANK', () => {
    it('should order the lifecycle received < published < job_enqueued < terminal states', () => {
      expect(WEBHOOK_DELIVERY_STATUS_RANK.received).toBeLessThan(
        WEBHOOK_DELIVERY_STATUS_RANK.published
      );
      expect(WEBHOOK_DELIVERY_STATUS_RANK.published).toBeLessThan(
        WEBHOOK_DELIVERY_STATUS_RANK.job_enqueued
      );
      for (const terminal of ['deadlettered', 'failed', 'rejected'] as const) {
        expect(WEBHOOK_DELIVERY_STATUS_RANK[terminal]).toBeGreaterThan(
          WEBHOOK_DELIVERY_STATUS_RANK.job_enqueued
        );
      }
    });
  });
});
