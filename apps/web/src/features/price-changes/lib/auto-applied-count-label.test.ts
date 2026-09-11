import { describe, expect, it } from 'vitest';
import { AUTO_APPLIED_ITEM_LIMIT, formatAutoAppliedCount } from './auto-applied-count-label';

describe('formatAutoAppliedCount', () => {
  it('renders the exact count when under the limit', () => {
    expect(formatAutoAppliedCount(1)).toEqual({ label: '1', plural: false });
    expect(formatAutoAppliedCount(3)).toEqual({ label: '3', plural: true });
    expect(formatAutoAppliedCount(0)).toEqual({ label: '0', plural: true });
  });

  it('renders a capped "N+" label, never the bare capped number, once the read hit its limit', () => {
    expect(formatAutoAppliedCount(AUTO_APPLIED_ITEM_LIMIT)).toEqual({
      label: `${AUTO_APPLIED_ITEM_LIMIT}+`,
      plural: true,
    });
  });

  it('still renders "N+" if a caller somehow reports more than the limit (defensive, not reachable via the API today)', () => {
    expect(formatAutoAppliedCount(AUTO_APPLIED_ITEM_LIMIT + 5)).toEqual({
      label: `${AUTO_APPLIED_ITEM_LIMIT}+`,
      plural: true,
    });
  });
});
