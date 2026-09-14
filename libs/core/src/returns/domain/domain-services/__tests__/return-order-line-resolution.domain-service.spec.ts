/**
 * Return order-line resolution — table-driven spec (#3171)
 *
 * The rule decides which order line a returned item came from, and the value it
 * produces ends up as `NrWierszaFa` on a document filed with the tax office. So
 * every arm is pinned rather than sampled, and the arms that must REFUSE are
 * pinned hardest: a wrong resolution is unretractable, a missing one is not.
 *
 * @module libs/core/src/returns/domain/domain-services/__tests__
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ReturnOrderLineMatchAxisValues,
  ReturnOrderLineUnresolvedReasonValues,
  resolveReturnLineOrderLine,
} from '../return-order-line-resolution.domain-service';
import type {
  ResolvableOrderLine,
  ResolvableReturnLine,
} from '../return-order-line-resolution.domain-service';

const line = (over: Partial<ResolvableReturnLine> = {}): ResolvableReturnLine => ({
  sku: 'EARB-01',
  offerId: null,
  unitPrice: null,
  ...over,
});

const order = (over: Partial<ResolvableOrderLine> & { id: string }): ResolvableOrderLine => ({
  quantity: 1,
  price: 189,
  sku: 'EARB-01',
  ...over,
});

describe('resolveReturnLineOrderLine', () => {
  describe('resolving', () => {
    it('should resolve on sku alone when exactly one order line carries it', () => {
      const result = resolveReturnLineOrderLine(line(), [
        order({ id: 'oi_1' }),
        order({ id: 'oi_2', sku: 'CBL-1' }),
      ]);

      expect(result).toEqual({ status: 'resolved', orderLineId: 'oi_1', matchedOn: 'sku' });
    });

    it('should resolve a same-sku tie on the reported unit price', () => {
      const result = resolveReturnLineOrderLine(line({ unitPrice: 179 }), [
        order({ id: 'oi_1', price: 189 }),
        order({ id: 'oi_2', price: 179 }),
      ]);

      expect(result).toEqual({ status: 'resolved', orderLineId: 'oi_2', matchedOn: 'sku+price' });
    });

    it('should compare price at minor units so 189 and 189.00 are the same price', () => {
      const result = resolveReturnLineOrderLine(line({ unitPrice: 189.0 }), [
        order({ id: 'oi_1', price: 189 }),
        order({ id: 'oi_2', price: 179 }),
      ]);

      expect(result).toEqual({ status: 'resolved', orderLineId: 'oi_1', matchedOn: 'sku+price' });
    });

    it('should trim a sku before matching', () => {
      const result = resolveReturnLineOrderLine(line({ sku: '  EARB-01 ' }), [
        order({ id: 'oi_1' }),
      ]);

      expect(result).toEqual({ status: 'resolved', orderLineId: 'oi_1', matchedOn: 'sku' });
    });

    it('should resolve on price alone when the return line carries no sku and no offerId', () => {
      const result = resolveReturnLineOrderLine(line({ sku: null, unitPrice: 179 }), [
        order({ id: 'oi_1', price: 189 }),
        order({ id: 'oi_2', price: 179 }),
      ]);

      expect(result).toEqual({ status: 'resolved', orderLineId: 'oi_2', matchedOn: 'price' });
    });

    // The reachable path on the only shipped `ReturnSourceReader` (Allegro):
    // its return payload carries no `sku` at all, only `offerId`, so this axis
    // — not `sku` — is what actually resolves an Allegro return line. See
    // `allegro-customer-returns.spec.ts` for the end-to-end version driven
    // through the real mapper output.
    it('should resolve on offerId alone when the return line carries no sku', () => {
      const result = resolveReturnLineOrderLine(
        line({ sku: null, offerId: 'offer-abc', unitPrice: null }),
        [order({ id: 'oi_1', sku: 'offer-abc' }), order({ id: 'oi_2', sku: 'offer-xyz' })]
      );

      expect(result).toEqual({ status: 'resolved', orderLineId: 'oi_1', matchedOn: 'offerId' });
    });

    it('should resolve a same-offerId tie on the reported unit price', () => {
      const result = resolveReturnLineOrderLine(
        line({ sku: null, offerId: 'offer-abc', unitPrice: 179 }),
        [
          order({ id: 'oi_1', sku: 'offer-abc', price: 189 }),
          order({ id: 'oi_2', sku: 'offer-abc', price: 179 }),
        ]
      );

      expect(result).toEqual({
        status: 'resolved',
        orderLineId: 'oi_2',
        matchedOn: 'offerId+price',
      });
    });
  });

  describe('refusing', () => {
    it('should refuse when the return line carries neither a sku, an offerId, nor a unit price', () => {
      const result = resolveReturnLineOrderLine(line({ sku: null, unitPrice: null }), [
        order({ id: 'oi_1' }),
      ]);

      expect(result).toEqual({ status: 'unresolved', reason: 'no-axis' });
    });

    it('should refuse when two order lines are identical on sku AND price', () => {
      const result = resolveReturnLineOrderLine(line({ unitPrice: 189 }), [
        order({ id: 'oi_1', price: 189 }),
        order({ id: 'oi_2', price: 189 }),
      ]);

      expect(result).toEqual({ status: 'unresolved', reason: 'ambiguous' });
    });

    it('should refuse a same-sku tie when no unit price was reported', () => {
      const result = resolveReturnLineOrderLine(line({ unitPrice: null }), [
        order({ id: 'oi_1', price: 189 }),
        order({ id: 'oi_2', price: 179 }),
      ]);

      expect(result).toEqual({ status: 'unresolved', reason: 'ambiguous' });
    });

    it('should refuse when the sku matches nothing', () => {
      const result = resolveReturnLineOrderLine(line({ sku: 'GHOST-1' }), [order({ id: 'oi_1' })]);

      expect(result).toEqual({ status: 'unresolved', reason: 'no-candidate' });
    });

    it('should NOT fall back to price when the sku positively excluded every line', () => {
      // The axis order is a NARROWING, never a retry. Falling back here would
      // resolve a line the sku excluded — a wrong answer rather than a missing
      // one, and the whole reason this rule exists.
      const result = resolveReturnLineOrderLine(line({ sku: 'GHOST-1', unitPrice: 189 }), [
        order({ id: 'oi_1', price: 189 }),
      ]);

      expect(result).toEqual({ status: 'unresolved', reason: 'no-candidate' });
    });

    it('should NOT fall back to offerId or price when the sku positively excluded every line, even carrying a matching offerId', () => {
      // sku is the stronger axis: its presence decides the outcome and a
      // co-reported offerId is never consulted once sku has spoken.
      const result = resolveReturnLineOrderLine(
        line({ sku: 'GHOST-1', offerId: 'offer-abc', unitPrice: 189 }),
        [order({ id: 'oi_1', sku: 'offer-abc', price: 189 })]
      );

      expect(result).toEqual({ status: 'unresolved', reason: 'no-candidate' });
    });

    it('should NOT fall back to price when the offerId positively excluded every line', () => {
      const result = resolveReturnLineOrderLine(
        line({ sku: null, offerId: 'GHOST-OFFER', unitPrice: 189 }),
        [order({ id: 'oi_1', sku: 'offer-abc', price: 189 })]
      );

      expect(result).toEqual({ status: 'unresolved', reason: 'no-candidate' });
    });

    it('should refuse a same-offerId tie when no unit price was reported', () => {
      const result = resolveReturnLineOrderLine(line({ sku: null, offerId: 'offer-abc' }), [
        order({ id: 'oi_1', sku: 'offer-abc', price: 189 }),
        order({ id: 'oi_2', sku: 'offer-abc', price: 179 }),
      ]);

      expect(result).toEqual({ status: 'unresolved', reason: 'ambiguous' });
    });

    it('should treat a sku differing only in case as a different sku', () => {
      // SKUs are operator-authored identifiers, not display text. The folding
      // that `normalizeCorrectionLineName` applies to names must not leak here.
      const result = resolveReturnLineOrderLine(line({ sku: 'earb-01' }), [order({ id: 'oi_1' })]);

      expect(result).toEqual({ status: 'unresolved', reason: 'no-candidate' });
    });

    it('should refuse against an empty order', () => {
      expect(resolveReturnLineOrderLine(line(), [])).toEqual({
        status: 'unresolved',
        reason: 'no-candidate',
      });
    });

    it('should treat a blank sku as absent rather than as a value to match', () => {
      const result = resolveReturnLineOrderLine(line({ sku: '   ', unitPrice: null }), [
        order({ id: 'oi_1' }),
      ]);

      expect(result).toEqual({ status: 'unresolved', reason: 'no-axis' });
    });

    it('should ignore a non-finite unit price rather than matching on NaN', () => {
      const result = resolveReturnLineOrderLine(line({ sku: null, unitPrice: Number.NaN }), [
        order({ id: 'oi_1' }),
      ]);

      expect(result).toEqual({ status: 'unresolved', reason: 'no-axis' });
    });
  });

  describe('contract', () => {
    it('should never mutate the order lines it was given', () => {
      const lines = [order({ id: 'oi_1' }), order({ id: 'oi_2', price: 179 })];
      const before = JSON.stringify(lines);

      resolveReturnLineOrderLine(line({ unitPrice: 179 }), lines);

      expect(JSON.stringify(lines)).toBe(before);
    });

    it('should expose every unresolved reason the rule can actually return', () => {
      // Guards the vocabulary against a member nothing produces, and against a
      // produced reason nobody declared — the caller counts by these keys.
      expect([...ReturnOrderLineUnresolvedReasonValues].sort()).toEqual([
        'ambiguous',
        'no-axis',
        'no-candidate',
      ]);
    });

    it('should expose every match axis the rule can actually stamp', () => {
      expect([...ReturnOrderLineMatchAxisValues]).toEqual([
        'sku',
        'sku+price',
        'offerId',
        'offerId+price',
        'price',
      ]);
    });

    it('should be pure: no I/O, no injected dependency, no framework import', () => {
      // Purity is the property that lets this rule be pinned by a fixture table
      // rather than a database, so it is asserted rather than assumed — the
      // discipline `evaluateAutomationRules` already holds.
      const source = readFileSync(
        join(__dirname, '..', 'return-order-line-resolution.domain-service.ts'),
        'utf8'
      );

      expect(source).not.toMatch(/@nestjs|typeorm|from 'node:|require\(/);
      expect(source).not.toMatch(/\basync\b|\bawait\b|Promise</);
      expect(source).not.toMatch(/@Inject|@Injectable/);
    });
  });
});
