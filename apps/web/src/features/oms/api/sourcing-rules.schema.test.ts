/**
 * Sourcing-rule boundary schema (#3056)
 *
 * The property worth a test is the one that is easy to "tidy away": an
 * unrecognised `kind` / `name` / `afterAction` must PARSE. The API reports such
 * a row with `recognised: false` precisely so an operator can find and delete
 * it; a `z.enum` here would make the whole list fail to parse instead, and the
 * table would report "no rules" for a connection that has some.
 */
import { describe, expect, it } from 'vitest';

import { parseSourcingRule, parseSourcingRuleList } from './sourcing-rules.schema';

const base = {
  id: 'rule_1',
  connectionId: 'conn_1',
  position: 1,
  kind: 'filter',
  name: 'country-served',
  afterAction: 'continue',
  priorityLocationIds: ['loc_a'],
  effectiveFrom: null,
  effectiveTo: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  recognised: true,
};

describe('sourcing-rule schema', () => {
  it('parses a rule this build does not recognise, rather than rejecting it', () => {
    const parsed = parseSourcingRule({
      ...base,
      kind: 'sort-from-the-future',
      name: 'invented-later',
      afterAction: 'something-new',
      recognised: false,
    });

    expect(parsed.name).toBe('invented-later');
    expect(parsed.recognised).toBe(false);
  });

  it('keeps ONE unrecognised row from taking the whole list down', () => {
    const parsed = parseSourcingRuleList([
      base,
      { ...base, id: 'rule_2', name: 'invented-later', recognised: false },
    ]);

    expect(parsed.map((entry) => entry.id)).toEqual(['rule_1', 'rule_2']);
  });

  it('normalises a nullish list to an empty array rather than failing', () => {
    // OpenLinker serialises an absent optional as JSON null (#939), so
    // `.optional()` here would make the whole object unparseable.
    const parsed = parseSourcingRule({ ...base, priorityLocationIds: null });
    expect(parsed.priorityLocationIds).toEqual([]);

    expect(parseSourcingRuleList(null)).toEqual([]);
  });

  it('normalises both effective bounds to null', () => {
    const parsed = parseSourcingRule({ ...base, effectiveFrom: undefined, effectiveTo: null });
    expect(parsed.effectiveFrom).toBeNull();
    expect(parsed.effectiveTo).toBeNull();
  });

  it('keeps timestamps as strings', () => {
    // The DTO emits ISO strings; a Date-typed field holding one type-checks and
    // then throws on .toLocaleString().
    expect(typeof parseSourcingRule(base).createdAt).toBe('string');
  });

  it('rejects a payload missing a required field', () => {
    const withoutPosition: Record<string, unknown> = { ...base };
    delete withoutPosition['position'];
    expect(() => parseSourcingRule(withoutPosition)).toThrow();
  });
});
