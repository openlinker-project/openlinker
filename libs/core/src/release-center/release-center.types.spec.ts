import { compareReleaseVersions, parseReleaseVersion } from './domain/types/release-center.types';

describe('release version rules', () => {
  it('should rank prereleases below the final release when comparing', () => {
    const rc = parseReleaseVersion('1.2.0-rc.3')!;
    const final = parseReleaseVersion('1.2.0')!;
    const beta = parseReleaseVersion('1.2.0-beta.9')!;
    expect(compareReleaseVersions(rc, final)).toBeLessThan(0);
    expect(compareReleaseVersions(beta, rc)).toBeLessThan(0);
    expect(compareReleaseVersions(final, final)).toBe(0);
  });

  it('should compare numerically when minor versions differ', () => {
    const a = parseReleaseVersion('0.9.0')!;
    const b = parseReleaseVersion('0.10.0')!;
    expect(compareReleaseVersions(a, b)).toBeLessThan(0);
  });

  it('should return null when the version is unrecognised', () => {
    expect(parseReleaseVersion('1.2')).toBeNull();
    expect(parseReleaseVersion('1.2.3-gamma.1')).toBeNull();
    expect(parseReleaseVersion(5)).toBeNull();
  });
});
