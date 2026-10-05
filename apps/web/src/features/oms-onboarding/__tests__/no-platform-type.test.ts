/**
 * No platform comparison in the packing wizard (#3457, D19)
 *
 * Product masters are chosen by capability, and the packing connection is
 * resolved by the PAGE. A `platformType` comparison inside this feature would
 * mean a new platform declaring `ProductMaster` + `InventoryMaster` does not
 * qualify without editing the wizard — the failure D19 exists to prevent.
 *
 * A lookup in a set for DISPLAY metadata (`resolveDataSource`) is not a
 * comparison and is not matched here.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const FEATURE_ROOT = path.resolve(__dirname, '..');
const COMPARISON = /platformType\s*(===|!==|==|!=)|(===|!==|==|!=)\s*[\w.?]*platformType\b/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('features/oms-onboarding', () => {
  it('should not compare platformType anywhere in the feature', () => {
    const sources = walk(FEATURE_ROOT).filter(
      (file) => /\.(ts|tsx)$/.test(file) && !/\.test\.[tj]sx?$/.test(file)
    );
    expect(sources.length).toBeGreaterThan(0);

    const offenders = sources.filter((file) => COMPARISON.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => path.relative(FEATURE_ROOT, file))).toEqual([]);
  });
});
