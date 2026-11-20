/**
 * Buyer Data Retention SQL Integration Test (#4178)
 *
 * Proves against real Postgres the statements the retention pass relies on,
 * which unit tests only mock: the candidate read (per source, by the
 * `COALESCE(dispatchByAt, placedAt, createdAt)` anchor, unredacted only), the
 * one-shot order redaction (snapshot, columns, the operator's address edit),
 * the recipient clears on both email delivery tables, and the two-table
 * customer projection redaction with its batch and stop condition.
 *
 * @module apps/api/test/integration/orders
 */
import { CustomerAddressProjectionOrmEntity } from '@openlinker/core/customers/infrastructure/persistence/entities/customer-address-projection.orm-entity';
import { CustomerProjectionOrmEntity } from '@openlinker/core/customers/infrastructure/persistence/entities/customer-projection.orm-entity';
import { DestinationAddressMappingOrmEntity } from '@openlinker/core/customers/infrastructure/persistence/entities/destination-address-mapping.orm-entity';
import { CustomerProjectionRepository } from '@openlinker/core/customers/infrastructure/persistence/repositories/customer-projection.repository';
import { BuyerEmailDeliveryOrmEntity } from '@openlinker/core/orders/infrastructure/persistence/entities/buyer-email-delivery.orm-entity';
import { OrderRecordOrmEntity } from '@openlinker/core/orders/infrastructure/persistence/entities/order-record.orm-entity';
import { BuyerEmailDeliveryRepository } from '@openlinker/core/orders/infrastructure/persistence/repositories/buyer-email-delivery.repository';
import { OrderRecordRepository } from '@openlinker/core/orders/infrastructure/persistence/repositories/order-record.repository';
import { DocumentEmailDeliveryOrmEntity } from '@openlinker/core/sales-documents/infrastructure/persistence/entities/document-email-delivery.orm-entity';
import { DocumentEmailDeliveryRepository } from '@openlinker/core/sales-documents/infrastructure/persistence/repositories/document-email-delivery.repository';

import { createTestOrderRecord } from '../fixtures/order.fixtures';
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  type IntegrationTestHarness,
} from '../setup';

const AMAZON = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const CUTOFF = new Date('2026-10-18T12:00:00.000Z');
const BEFORE = new Date('2026-10-01T12:00:00.000Z');
const AFTER = new Date('2026-11-10T12:00:00.000Z');

const SNAPSHOT = {
  items: [],
  orderNumber: '302-1',
  customerEmail: 'abc@marketplace.amazon.de',
  buyerNote: 'leave at the door',
  shippingAddress: {
    firstName: 'Anna',
    lastName: 'Schmidt',
    address1: 'Allee 1',
    city: 'Berlin',
    postalCode: '10115',
    country: 'DE',
  },
};

describe('buyer data retention SQL (integration)', () => {
  let harness: IntegrationTestHarness;
  let orders: OrderRecordRepository;
  let customers: CustomerProjectionRepository;
  let buyerEmails: BuyerEmailDeliveryRepository;
  let documentEmails: DocumentEmailDeliveryRepository;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
    const ds = harness.getDataSource();
    orders = new OrderRecordRepository(ds.getRepository(OrderRecordOrmEntity));
    customers = new CustomerProjectionRepository(
      ds.getRepository(CustomerProjectionOrmEntity),
      ds.getRepository(CustomerAddressProjectionOrmEntity),
      ds.getRepository(DestinationAddressMappingOrmEntity)
    );
    buyerEmails = new BuyerEmailDeliveryRepository(ds.getRepository(BuyerEmailDeliveryOrmEntity));
    documentEmails = new DocumentEmailDeliveryRepository(
      ds.getRepository(DocumentEmailDeliveryOrmEntity)
    );
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  function seedOrder(overrides: Partial<OrderRecordOrmEntity>): Promise<OrderRecordOrmEntity> {
    return createTestOrderRecord(harness.getDataSource(), {
      sourceConnectionId: AMAZON,
      orderSnapshot: SNAPSHOT,
      ...overrides,
    });
  }

  describe('order candidates and redaction', () => {
    it('should read only unredacted orders of the source whose anchor is before the cutoff', async () => {
      const shipBy = await seedOrder({ dispatchByAt: BEFORE, placedAt: AFTER });
      const placed = await seedOrder({ placedAt: BEFORE });
      await seedOrder({ dispatchByAt: AFTER, placedAt: BEFORE });
      await seedOrder({ placedAt: BEFORE, sourceConnectionId: OTHER });
      await seedOrder({ placedAt: BEFORE, buyerDataRedactedAt: BEFORE });

      const candidates = await orders.findBuyerDataRetentionCandidates({
        sourceConnectionId: AMAZON,
        anchorBefore: CUTOFF,
        limit: 10,
      });

      expect(candidates.map((c) => c.internalOrderId).sort()).toEqual(
        [shipBy.internalOrderId, placed.internalOrderId].sort()
      );
      expect(candidates[0]?.orderSnapshot).toMatchObject({ orderNumber: '302-1' });
    });

    it('should honour the limit, oldest anchor first', async () => {
      const oldest = await seedOrder({ placedAt: new Date('2026-09-01T00:00:00.000Z') });
      await seedOrder({ placedAt: BEFORE });

      const candidates = await orders.findBuyerDataRetentionCandidates({
        sourceConnectionId: AMAZON,
        anchorBefore: CUTOFF,
        limit: 1,
      });

      expect(candidates.map((c) => c.internalOrderId)).toEqual([oldest.internalOrderId]);
    });

    it('should redact once, keep updatedAt, and drop the operator address edit', async () => {
      const seeded = await seedOrder({
        placedAt: BEFORE,
        buyerNote: 'leave at the door',
        buyerTaxId: 'DE123',
        orderEdits: { address: { address1: 'Edited 2' }, rev: 1 },
      });
      const before = await harness
        .getDataSource()
        .getRepository(OrderRecordOrmEntity)
        .findOneByOrFail({
          internalOrderId: seeded.internalOrderId,
        });

      const first = await orders.redactBuyerData({
        internalOrderId: seeded.internalOrderId,
        orderSnapshot: { items: [], orderNumber: '302-1', shippingAddress: { country: 'DE' } },
        searchText: '302-1',
      });
      const second = await orders.redactBuyerData({
        internalOrderId: seeded.internalOrderId,
        orderSnapshot: { items: [] },
        searchText: '',
      });

      const row = await harness
        .getDataSource()
        .getRepository(OrderRecordOrmEntity)
        .findOneByOrFail({
          internalOrderId: seeded.internalOrderId,
        });
      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(row.orderSnapshot).toEqual({
        items: [],
        orderNumber: '302-1',
        shippingAddress: { country: 'DE' },
      });
      expect(row.searchText).toBe('302-1');
      expect(row.buyerNote).toBeNull();
      expect(row.buyerTaxId).toBeNull();
      expect(row.orderEdits).toEqual({ rev: 1 });
      expect(row.buyerDataRedactedAt).not.toBeNull();
      expect(row.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      expect(await orders.isBuyerDataRedacted(seeded.internalOrderId)).toBe(true);
    });

    it('should report an order that was never redacted, or does not exist, as not redacted', async () => {
      const seeded = await seedOrder({ placedAt: BEFORE });

      expect(await orders.isBuyerDataRedacted(seeded.internalOrderId)).toBe(false);
      expect(await orders.isBuyerDataRedacted('ol_order_missing')).toBe(false);
    });
  });

  describe('email delivery recipients', () => {
    it('should clear the recipient on both delivery tables for the order only, keeping the rows', async () => {
      await buyerEmails.recordSuppression({
        internalOrderId: 'ol_order_1',
        connectionId: AMAZON,
        templateKey: 'shipped',
        subjectRef: 'ol_order_1',
        recipient: 'abc@marketplace.amazon.de',
        suppressionReason: 'template-not-enabled',
      });
      await buyerEmails.recordSuppression({
        internalOrderId: 'ol_order_2',
        connectionId: AMAZON,
        templateKey: 'shipped',
        subjectRef: 'ol_order_2',
        recipient: 'other@example.com',
        suppressionReason: 'template-not-enabled',
      });
      await documentEmails.record({
        internalOrderId: 'ol_order_1',
        documentKind: 'invoice',
        documentId: 'inv-1',
        sentVia: 'openlinker',
        outcome: 'sent',
        failureReason: null,
        recipient: 'abc@marketplace.amazon.de',
        actorUserId: null,
      });

      expect(await buyerEmails.clearRecipientsForOrder('ol_order_1')).toBe(1);
      expect(await documentEmails.clearRecipientsForOrder('ol_order_1')).toBe(1);
      expect(await buyerEmails.clearRecipientsForOrder('ol_order_1')).toBe(0);

      const ds = harness.getDataSource();
      const buyerRows = await ds.getRepository(BuyerEmailDeliveryOrmEntity).find();
      const documentRows = await ds.getRepository(DocumentEmailDeliveryOrmEntity).find();
      expect(buyerRows.find((r) => r.internalOrderId === 'ol_order_1')?.recipient).toBeNull();
      expect(buyerRows.find((r) => r.internalOrderId === 'ol_order_2')?.recipient).toBe(
        'other@example.com'
      );
      expect(documentRows).toHaveLength(1);
      expect(documentRows[0]?.recipient).toBeNull();
    });
  });

  describe('customer projections', () => {
    async function seedCustomer(id: string, source: string, lastSeenAt: Date): Promise<void> {
      const ds = harness.getDataSource();
      await ds.getRepository(CustomerProjectionOrmEntity).insert({
        internalCustomerId: id,
        emailHash: 'a'.repeat(64),
        normalizedEmail: `${id}@example.com`,
        firstName: 'Anna',
        lastName: 'Schmidt',
        lastSeenAt,
        lastSourceConnectionId: source,
      });
      await ds.getRepository(CustomerAddressProjectionOrmEntity).insert({
        internalCustomerId: id,
        addressHash: 'b'.repeat(64),
        addressType: 'shipping',
        address1: 'Allee 1',
        address2: null,
        city: 'Berlin',
        postcode: '10115',
        countryIso2: 'DE',
        lastSeenAt,
      });
    }

    it('should clear names, email and street address of customers last seen through the source before the cutoff', async () => {
      await seedCustomer('cust_old', AMAZON, BEFORE);
      await seedCustomer('cust_recent', AMAZON, AFTER);
      await seedCustomer('cust_other', OTHER, BEFORE);

      const cleared = await customers.redactPersonalDataLastSeenBefore({
        sourceConnectionId: AMAZON,
        lastSeenBefore: CUTOFF,
        limit: 10,
      });

      const ds = harness.getDataSource();
      const old = await ds
        .getRepository(CustomerProjectionOrmEntity)
        .findOneByOrFail({ internalCustomerId: 'cust_old' });
      const oldAddress = await ds
        .getRepository(CustomerAddressProjectionOrmEntity)
        .findOneByOrFail({ internalCustomerId: 'cust_old' });
      const recent = await ds
        .getRepository(CustomerProjectionOrmEntity)
        .findOneByOrFail({ internalCustomerId: 'cust_recent' });
      const other = await ds
        .getRepository(CustomerProjectionOrmEntity)
        .findOneByOrFail({ internalCustomerId: 'cust_other' });

      expect(cleared).toBe(1);
      expect(old).toMatchObject({
        normalizedEmail: null,
        firstName: null,
        lastName: null,
        emailHash: 'a'.repeat(64),
      });
      expect(oldAddress).toMatchObject({
        address1: null,
        city: null,
        postcode: null,
        countryIso2: 'DE',
      });
      expect(recent.normalizedEmail).toBe('cust_recent@example.com');
      expect(other.normalizedEmail).toBe('cust_other@example.com');
    });

    it('should work in batches and find nothing left once everything is cleared', async () => {
      await seedCustomer('cust_1', AMAZON, new Date('2026-09-01T00:00:00.000Z'));
      await seedCustomer('cust_2', AMAZON, BEFORE);

      const input = { sourceConnectionId: AMAZON, lastSeenBefore: CUTOFF, limit: 1 };
      const first = await customers.redactPersonalDataLastSeenBefore(input);
      const second = await customers.redactPersonalDataLastSeenBefore(input);
      const third = await customers.redactPersonalDataLastSeenBefore(input);

      expect([first, second, third]).toEqual([1, 1, 0]);
    });
  });
});
