/**
 * No-localStorage-JWT Regression Guard
 *
 * #710 removed all access-token persistence to `localStorage`. The
 * token now lives in memory inside `createJwtBearerSessionAdapter` and
 * is rotated via the HttpOnly `ol_refresh` cookie. This test fails if
 * anyone reintroduces the legacy storage key (`ol_access_token`) into
 * any non-test source file under `apps/web/src/`.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN = 'ol_access_token';
const SRC_ROOT = path.resolve(__dirname, '../..');

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // Skip node_modules just in case; vitest already excludes it.
      if (entry === 'node_modules') continue;
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function isProductionSource(file: string): boolean {
  if (!/\.(ts|tsx)$/.test(file)) return false;
  if (/\.test\.[tj]sx?$/.test(file)) return false;
  if (/\.spec\.[tj]sx?$/.test(file)) return false;
  return true;
}

describe('no-localstorage-jwt regression guard', () => {
  it(`no production file under apps/web/src references "${FORBIDDEN}"`, () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      if (!isProductionSource(file)) continue;
      const contents = readFileSync(file, 'utf8');
      if (contents.includes(FORBIDDEN)) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
