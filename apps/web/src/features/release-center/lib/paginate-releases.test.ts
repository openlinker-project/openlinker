import { describe, expect, it } from 'vitest';
import { clampPage, findReleaseIndex, pageOfIndex, paginateReleases } from './paginate-releases';

const items = Array.from({ length: 21 }, (_, i) => i);

describe('paginateReleases', () => {
  it('should return the first five items when no page is given', () => {
    const result = paginateReleases(items, null);
    expect(result.items).toEqual([0, 1, 2, 3, 4]);
    expect(result.pageCount).toBe(5);
    expect(result.page).toBe(1);
  });

  it('should slice the requested page and report its offset', () => {
    const result = paginateReleases(items, '2');
    expect(result.items).toEqual([5, 6, 7, 8, 9]);
    expect(result.offset).toBe(5);
  });

  it('should return a short last page', () => {
    expect(paginateReleases(items, '5').items).toEqual([20]);
  });

  it('should clamp out-of-range and invalid pages without erroring', () => {
    expect(clampPage('99', 5)).toBe(5);
    expect(clampPage('0', 5)).toBe(1);
    expect(clampPage('-3', 5)).toBe(1);
    expect(clampPage('abc', 5)).toBe(1);
    expect(clampPage('2.5', 5)).toBe(1);
  });

  it('should handle an empty list as a single empty page', () => {
    const result = paginateReleases([], '4');
    expect(result).toMatchObject({ page: 1, pageCount: 1, items: [] });
  });
});

describe('findReleaseIndex', () => {
  const releases = [{ version: '1.4.2' }, { version: '1.4.0' }, { version: '1.3.0' }];

  it('should match an exact version', () => {
    expect(findReleaseIndex(releases, '1.4.0')).toBe(1);
  });

  it('should resolve a minor to its newest release', () => {
    expect(findReleaseIndex(releases, '1.4')).toBe(0);
  });

  it('should return -1 for an unknown or missing target', () => {
    expect(findReleaseIndex(releases, '9.9')).toBe(-1);
    expect(findReleaseIndex(releases, null)).toBe(-1);
  });

  it('should land a deep link on the page holding the release', () => {
    expect(pageOfIndex(findReleaseIndex(releases, '1.3.0'), 2)).toBe(2);
  });
});
