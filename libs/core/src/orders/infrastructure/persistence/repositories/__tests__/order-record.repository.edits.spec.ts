/**
 * Order Record Repository - the overlay never reaches the channel column (#3542)
 *
 * `OrderRecord.orderSnapshot` is the EFFECTIVE (merged) view once an operator
 * has edited the order. Anything that wrote it back would persist the edit into
 * the channel original, where the next re-ingestion would treat it as the
 * source's own words. These specs pin the write side: the snapshot written is
 * always `channelSnapshot`, and neither ingestion statement names `orderEdits`.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories/__tests__
 */
import type { Repository } from 'typeorm';

import { OrderRecord } from '../../../../domain/entities/order-record.entity';
import {
  applyOrderEditsToSnapshot,
  type OrderEdits,
} from '../../../../domain/types/order-edits.types';
import type { OrderRecordOrmEntity } from '../../entities/order-record.orm-entity';
import { OrderRecordRepository } from '../order-record.repository';

const channel: Record<string, unknown> = {
  id: 'ol_order_1',
  items: [{ id: 'l1', productId: 'p', quantity: 3, price: 10 }],
  totals: { subtotal: 30, tax: 0, shipping: 0, total: 30, currency: 'PLN' },
  shippingAddress: { address1: 'Channel 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
};

const edits: OrderEdits = {
  v: 1,
  rev: 1,
  address: {
    changeId: 'c1',
    editedAt: '2026-10-26T10:00:00.000Z',
    editedBy: 'u1',
    hash: 'edited-hash',
    shipping: { address1: 'EDITED 9', city: 'Krakow', postalCode: '30-001', country: 'PL' },
  },
  lines: { l1: { changeId: 'c1', editedAt: '2026-10-26T10:00:00.000Z', editedBy: 'u1', quantity: 1 } },
};

function editedRecord(): OrderRecord {
  const now = new Date();
  return new OrderRecord(
    'ol_order_1',
    null,
    'conn-1',
    null,
    applyOrderEditsToSnapshot(channel, edits),
    [],
    'ready',
    now,
    now,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    channel,
    edits
  );
}

describe('OrderRecordRepository - operator edit overlay (#3542)', () => {
  let query: jest.Mock;
  let repository: OrderRecordRepository;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([
      { internalOrderId: 'ol_order_1', orderSnapshot: channel, recordStatus: 'ready', orderEdits: edits },
    ]);
    repository = new OrderRecordRepository({ query } as unknown as Repository<OrderRecordOrmEntity>);
  });

  it('should write the CHANNEL snapshot even when orderEdits is non-empty', async () => {
    await repository.upsert(editedRecord());

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    const written = params.find((p) => typeof p === 'string' && p.startsWith('{"id":"ol_order_1"'));
    expect(JSON.parse(written as string)).toEqual(channel);
    expect(written as string).not.toContain('EDITED 9');
    expect(sql.split('VALUES')[0]).not.toContain('"orderEdits"');
    expect(sql.split('DO UPDATE SET')[1].split('RETURNING')[0]).not.toMatch(/"orderEdits" =/);
  });

  it('should keep the stored hash and search text while the overlay holds an address', async () => {
    await repository.upsert(editedRecord());
    const sql = (query.mock.calls[0] as [string])[0];
    expect(sql).toMatch(/"searchText" = CASE WHEN "order_records"\."orderEdits" \? 'address'/);
  });

  it('should hand ingestion the overlay that applied to the write (RETURNING passes it through)', async () => {
    const saved = await repository.upsert(editedRecord());
    expect(saved.orderEdits?.rev).toBe(1);
    expect(saved.channelSnapshot.shippingAddress).toEqual(channel.shippingAddress);
    expect((saved.orderSnapshot.shippingAddress as { city: string }).city).toBe('Krakow');
  });

  it('should keep the channel and effective views apart on the record', () => {
    const record = editedRecord();
    expect(record.channelSnapshot).toBe(channel);
    expect(record.orderSnapshot).not.toBe(channel);
    expect(record.isEditedInOpenLinker).toBe(true);
  });

  it('should read nativeTotals from the channel figure, not the edited one', () => {
    expect(editedRecord().nativeTotals).toEqual({ amount: 30, currency: 'PLN' });
  });

  describe('tax-rate backfill path (patchSnapshotTaxRates)', () => {
    it('should patch the channel column by the channel line index and never name orderEdits', async () => {
      query.mockResolvedValue([]);

      await repository.patchSnapshotTaxRates('ol_order_1', 0, {
        taxRate: '23',
        taxSource: 'backfill',
        taxRateReadAt: new Date('2026-10-26T10:00:00.000Z'),
      });

      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      // It writes the persisted column, which is the channel original, addressed by
      // the same `order_line_items.lineNumber` index the backfill read it from.
      expect(sql).toMatch(/SET "orderSnapshot" = jsonb_set/);
      expect(sql.split('WHERE')[0]).not.toContain('orderEdits');
      expect(sql).not.toMatch(/"orderEdits"\s*=/);
      expect(params).toEqual(['0', '23', 'backfill', '2026-10-26T10:00:00.000Z', 'ol_order_1']);
    });

    it('should leave an edited record untouched: the backfill takes no record, so no effective view can reach the column', () => {
      // The method's signature is (orderId, lineNumber, patch): there is no
      // snapshot argument through which the merged view could be written back.
      expect(repository.patchSnapshotTaxRates.length).toBe(3);
      expect(editedRecord().channelSnapshot).toBe(channel);
    });
  });
});
