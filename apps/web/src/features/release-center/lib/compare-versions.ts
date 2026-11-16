/**
 * Semver comparison for the release center (#4145, ADR-085)
 *
 * Full semver precedence including prereleases (`0.20.0-rc.1 < 0.20.0`), pure
 * and dependency free. Invalid input is reported as `null` by `parseVersion`
 * and as a thrown error by `compareVersions`, so a caller that needs to degrade
 * (the dialog) checks validity first instead of guessing an order.
 *
 * @module features/release-center
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly string[];
}

const SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseVersion(value: string | null | undefined): ParsedVersion | null {
  if (typeof value !== 'string') return null;
  const match = SEMVER.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

export function isValidVersion(value: string | null | undefined): boolean {
  return parseVersion(value) !== null;
}

function comparePrereleaseId(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
  // Numeric identifiers have lower precedence than alphanumeric ones.
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareParsed(a: ParsedVersion, b: ParsedVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return Math.sign(a[key] - b[key]);
  }
  // A version without a prerelease outranks the same core with one.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const result = comparePrereleaseId(left, right);
    if (result !== 0) return result;
  }
  return 0;
}

/** Returns -1, 0 or 1. Throws on an invalid version: check `isValidVersion` first. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) {
    throw new Error(`Invalid semver passed to compareVersions: "${a}" vs "${b}"`);
  }
  return compareParsed(left, right);
}

/** True when `to` raises the major or the minor over `from` (a patch never does). */
export function isMinorOrMajorIncrease(from: string, to: string): boolean {
  const left = parseVersion(from);
  const right = parseVersion(to);
  if (!left || !right) return false;
  if (right.major !== left.major) return right.major > left.major;
  return right.minor > left.minor;
}
