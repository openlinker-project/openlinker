/**
 * buildAuthorityAttentionUpsertSql — unit spec (#2352)
 *
 * The statement's BEHAVIOUR is proven against real Postgres in
 * `apps/api/test/integration/oms-attention.int-spec.ts`; a string-matching test
 * cannot show what SQL does. What this spec pins is the set of clauses whose
 * absence is silent — a missing `FOR UPDATE` still passes every behavioural test
 * that does not race — and that both owning tables get one statement rather than
 * two hand-maintained copies.
 */
import {
  buildAuthorityAttentionPayload,
  buildAuthorityAttentionUpsertSql,
} from './authority-attention-sql.types';

const ORDERS = { table: 'order_records', idColumn: 'internalOrderId', alias: 'rec' } as const;
const RETURNS = { table: 'returns', idColumn: 'id', alias: 'r' } as const;

describe('buildAuthorityAttentionUpsertSql', () => {
  it.each([
    ['orders', ORDERS],
    ['returns', RETURNS],
  ])(
    'should lock the row it rebuilds from for %s, so a concurrent producer cannot be dropped',
    (_label, target) => {
      // Without FOR UPDATE the read is a plain snapshot read: a peer committing
      // between the snapshot and the row lock is re-checked by EPQ against the
      // WHERE, but `next.value` is NOT recomputed — so the write lands and the
      // peer's entry is gone, permanently, because a producer only writes when
      // its own answer changes. Nothing else in the statement catches that.
      expect(buildAuthorityAttentionUpsertSql(target)).toContain('FOR UPDATE');
    },
  );

  it.each([
    ['orders', ORDERS],
    ['returns', RETURNS],
  ])('should scope the removal and the replacement to the caller for %s', (_label, target) => {
    const sql = buildAuthorityAttentionUpsertSql(target);

    expect(sql).toContain(`e->>'producer' IS DISTINCT FROM $2`);
    expect(sql).toContain(`e->>'producer' = $2`);
  });

  it.each([
    ['orders', ORDERS],
    ['returns', RETURNS],
  ])('should carry an existing since forward for %s rather than restamping it', (_label, target) => {
    expect(buildAuthorityAttentionUpsertSql(target)).toContain(
      `COALESCE(parts.mine->>'since', $4::text)`,
    );
  });

  it.each([
    ['orders', ORDERS, 'rec'],
    ['returns', RETURNS, 'r'],
  ])(
    'should guard the write for %s so an unchanged state touches no row',
    (_label, target, alias) => {
      expect(buildAuthorityAttentionUpsertSql(target)).toContain(
        `${alias}."omsAttention" IS DISTINCT FROM NULLIF(next.value, '[]'::jsonb)`,
      );
    },
  );

  it.each([
    ['orders', ORDERS],
    ['returns', RETURNS],
  ])('should normalise an emptied column back to NULL for %s', (_label, target) => {
    expect(buildAuthorityAttentionUpsertSql(target)).toContain(
      `SET "omsAttention" = NULLIF(next.value, '[]'::jsonb)`,
    );
  });

  it('should address each owning table by its own id column', () => {
    expect(buildAuthorityAttentionUpsertSql(ORDERS)).toContain(`WHERE "internalOrderId" = $1`);
    expect(buildAuthorityAttentionUpsertSql(RETURNS)).toContain(`WHERE "id" = $1`);
  });

  it('should differ between the two targets only in table, id column and alias', () => {
    // The point of sharing the builder: a fix to any clause lands on both rows
    // at once, and neither can drift.
    const normalised = buildAuthorityAttentionUpsertSql(RETURNS)
      .replace(/"returns"/g, '"order_records"')
      .replace(/"id"/g, '"internalOrderId"')
      .replace(/\br\b(?=\.|")/g, 'rec')
      .replace(/UPDATE "order_records" r\b/, 'UPDATE "order_records" rec');

    expect(normalised).toBe(buildAuthorityAttentionUpsertSql(ORDERS));
  });
});

describe('buildAuthorityAttentionPayload', () => {
  it('should return null when the producer is clearing its entry', () => {
    expect(buildAuthorityAttentionPayload('routing', null)).toBeNull();
  });

  it('should carry the reason and both optional fields when present', () => {
    expect(
      JSON.parse(
        buildAuthorityAttentionPayload('routing', {
          reason: 'line-unfulfillable',
          detail: '2 line(s)',
          subjectRef: 'line-7',
        }) as string,
      ),
    ).toEqual({
      producer: 'routing',
      reason: 'line-unfulfillable',
      detail: '2 line(s)',
      subjectRef: 'line-7',
    });
  });

  it('should omit an absent optional field rather than sending an explicit null', () => {
    expect(
      JSON.parse(
        buildAuthorityAttentionPayload('routing', { reason: 'line-unfulfillable' }) as string,
      ),
    ).toEqual({ producer: 'routing', reason: 'line-unfulfillable' });
  });

  it('should never set since — only the statement knows whether an episode is running', () => {
    expect(
      buildAuthorityAttentionPayload('routing', { reason: 'line-unfulfillable' }),
    ).not.toContain('since');
  });
});
