/**
 * Activity-filter tests (#2386)
 *
 * The AC's operative rule: an unrecognised value is IGNORED, never thrown. Every
 * one of the five filters is covered, including the two dates that have no `is*`
 * guard of their own.
 */
import { describe, expect, it } from 'vitest';
import {
  clearAutomationActivityFilters,
  hasActiveAutomationActivityFilters,
  readAutomationActivityFilters,
  readAutomationActivityOffset,
  readIsoDateParam,
  setAutomationActivityFilterParam,
  setAutomationActivityOffsetParam,
} from './automation-activity-filters';

const params = (query: string): URLSearchParams => new URLSearchParams(query);

describe('readAutomationActivityFilters', () => {
  it('should read every recognised filter', () => {
    const filters = readAutomationActivityFilters(
      params(
        'ruleId=rule-1&trigger=order.packed&outcome=failed&from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z&orderId=ol_order_1',
      ),
    );
    expect(filters).toEqual({
      ruleId: 'rule-1',
      trigger: 'order.packed',
      outcome: 'failed',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-20T00:00:00.000Z',
      orderId: 'ol_order_1',
    });
  });

  it('should IGNORE an unrecognised trigger rather than throw', () => {
    // A URL is operator-editable, and a shared link outliving a vocabulary
    // change must degrade to a wider view — not a crash.
    expect(() => readAutomationActivityFilters(params('trigger=order.teleported'))).not.toThrow();
    expect(readAutomationActivityFilters(params('trigger=order.teleported')).trigger).toBeUndefined();
  });

  it('should IGNORE an unrecognised outcome rather than throw', () => {
    expect(readAutomationActivityFilters(params('outcome=exploded')).outcome).toBeUndefined();
  });

  it('should IGNORE an unparseable date rather than throw', () => {
    // There is no `is*` guard for a date — without `readIsoDateParam`,
    // `from=banana` reaches the API as an Invalid Date that either throws at
    // the query layer or silently matches nothing.
    const filters = readAutomationActivityFilters(params('from=banana&to=2026-13-45'));
    expect(filters.from).toBeUndefined();
    expect(filters.to).toBeUndefined();
  });

  it('should treat an empty value as absent, not as a filter on the empty string', () => {
    expect(readAutomationActivityFilters(params('ruleId=&orderId=')).ruleId).toBeUndefined();
  });

  it('should accept `blocked` as a filter value even though nothing produces it', () => {
    // Omitting one of four documented outcomes would be its own lie; the empty
    // state is what explains that it matches nothing today.
    expect(readAutomationActivityFilters(params('outcome=blocked')).outcome).toBe('blocked');
  });
});

describe('readIsoDateParam', () => {
  it('should accept a valid ISO instant and a plain date', () => {
    expect(readIsoDateParam('2026-08-01T00:00:00.000Z')).toBe('2026-08-01T00:00:00.000Z');
    expect(readIsoDateParam('2026-08-01')).toBe('2026-08-01');
  });

  it('should return undefined for anything unparseable', () => {
    for (const bad of ['banana', '2026-13-45', '', 'null']) {
      expect(readIsoDateParam(bad)).toBeUndefined();
    }
    expect(readIsoDateParam(null)).toBeUndefined();
  });
});

describe('offset and mutation helpers', () => {
  it('should read a sane offset and reject nonsense', () => {
    expect(readAutomationActivityOffset(params('offset=50'))).toBe(50);
    expect(readAutomationActivityOffset(params('offset=-5'))).toBe(0);
    expect(readAutomationActivityOffset(params('offset=banana'))).toBe(0);
  });

  it('should drop the offset when a filter changes', () => {
    // Narrowing while on page 4 lands the operator on an arbitrary page —
    // usually empty, which reads as "no results" rather than "past the end".
    const next = setAutomationActivityFilterParam(params('offset=100'), 'outcome', 'failed');
    expect(next.get('offset')).toBeNull();
    expect(next.get('outcome')).toBe('failed');
  });

  it('should delete a filter when set to empty', () => {
    const next = setAutomationActivityFilterParam(params('outcome=failed'), 'outcome', '');
    expect(next.get('outcome')).toBeNull();
  });

  it('should clear every filter and the offset in one call', () => {
    const next = clearAutomationActivityFilters(
      params('ruleId=r&trigger=order.packed&outcome=failed&from=x&to=y&orderId=o&offset=50&keep=1'),
    );
    expect(next.toString()).toBe('keep=1');
  });

  it('should drop the offset param entirely at the first page', () => {
    expect(setAutomationActivityOffsetParam(params('offset=50'), 0).get('offset')).toBeNull();
    expect(setAutomationActivityOffsetParam(params(''), 50).get('offset')).toBe('50');
  });
});

describe('hasActiveAutomationActivityFilters', () => {
  it('should be false for an unfiltered URL', () => {
    expect(hasActiveAutomationActivityFilters(readAutomationActivityFilters(params('')))).toBe(
      false,
    );
  });

  it('should be false when every supplied value was unrecognised', () => {
    // Nothing was narrowed, so offering "Clear filters" would be misleading.
    expect(
      hasActiveAutomationActivityFilters(
        readAutomationActivityFilters(params('trigger=nope&from=banana')),
      ),
    ).toBe(false);
  });

  it('should be true once any filter is honoured', () => {
    expect(
      hasActiveAutomationActivityFilters(readAutomationActivityFilters(params('outcome=done'))),
    ).toBe(true);
  });
});
