/**
 * `OrderImportDto` validation (#4228)
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { OrderImportDto } from './order-import.dto';
import { OrderSyncStartDto } from './order-sync-start.dto';
import { UpdateConnectionDto } from './update-connection.dto';

const errorsFor = (payload: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(OrderImportDto, payload)).flatMap((e) =>
    Object.values(e.constraints ?? {})
  );

describe('OrderImportDto', () => {
  it.each([
    [{ direction: 'oldest-first' }],
    [{ from: '2026-10-01', to: '2026-10-31', direction: 'newest-first' }],
    [{ from: '2026-10-01T08:30:00Z', direction: 'oldest-first' }],
    [{ to: '2026-10-31T23:59:59.999+02:00', direction: 'oldest-first' }],
  ])('should accept %j', (payload) => {
    expect(errorsFor(payload)).toEqual([]);
  });

  it.each([
    [{ direction: 'sideways' }],
    [{}],
    [{ from: '01.10.2026', direction: 'oldest-first' }],
    [{ from: 'yesterday', direction: 'oldest-first' }],
    [{ to: '2026-13-45x', direction: 'oldest-first' }],
    [{ from: `2026-10-01T00:00:00${'0'.repeat(60)}Z`, direction: 'oldest-first' }],
    [{ from: 20261001, direction: 'oldest-first' }],
  ])('should refuse %j', (payload) => {
    expect(errorsFor(payload).length).toBeGreaterThan(0);
  });
});

describe('UpdateConnectionDto orderSyncStart (#4228)', () => {
  const errors = (payload: Record<string, unknown>) =>
    validateSync(plainToInstance(UpdateConnectionDto, payload));

  it('should accept a valid start', () => {
    expect(errors({ orderSyncStart: { mode: 'from', from: '2026-10-01' } })).toEqual([]);
  });

  it('should refuse an unknown mode and a from start with no date', () => {
    expect(errors({ orderSyncStart: { mode: 'later' } }).length).toBeGreaterThan(0);
    expect(errors({ orderSyncStart: { mode: 'from' } }).length).toBeGreaterThan(0);
  });
});

describe('OrderSyncStartDto from (#4228)', () => {
  const fromErrors = (from: unknown): number =>
    validateSync(plainToInstance(OrderSyncStartDto, { mode: 'from', from })).length;

  it.each(['2026-10-01', '2026-10-01T08:30:00Z'])('should accept %s', (from) => {
    expect(fromErrors(from)).toBe(0);
  });

  it.each(['yesterday', '01.10.2026', `2026-10-01T00:00:00${'0'.repeat(60)}Z`])(
    'should refuse %s',
    (from) => {
      expect(fromErrors(from)).toBeGreaterThan(0);
    }
  );
});
