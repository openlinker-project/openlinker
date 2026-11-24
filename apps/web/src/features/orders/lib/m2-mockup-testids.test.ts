/**
 * Mockup M2 contract (#3539): every `data-testid` pinned in the committed
 * mockup is carried by the implemented components, so one selector set drives
 * both the mockup and the live app. Reads the mockup from the repo.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MOCKUP = resolve(
  __dirname,
  '../../../../../../docs/plans/mockups/oms-mvp/m2-buyer-message-to-seller.html',
);
const SRC = resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(tsx?)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

describe('mockup M2 testids (#3539)', () => {
  it('should be carried by the implementation', () => {
    const ids = [
      ...new Set([...readFileSync(MOCKUP, 'utf8').matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1])),
    ];
    expect(ids.length).toBeGreaterThan(15);

    const source = sourceFiles(SRC)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const missing = ids.filter((id) => !source.includes(`'${id}'`) && !source.includes(`"${id}"`));

    expect(missing).toEqual([]);
  });
});
