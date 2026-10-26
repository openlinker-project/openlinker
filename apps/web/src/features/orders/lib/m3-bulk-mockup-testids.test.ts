/**
 * Mockup M3 `bulk` contract (#3619): every `orders-bulk-*` `data-testid` pinned
 * in the committed mockup's `bulk` state is carried by the implemented
 * components, so one selector set drives both the mockup and the live app.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MOCKUP = resolve(
  __dirname,
  '../../../../../../docs/plans/mockups/oms-mvp/m3-order-notes-and-tags.html',
);
const SRC = resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(tsx?)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

describe('mockup M3 bulk testids (#3619)', () => {
  it('should be carried by the implementation', () => {
    const html = readFileSync(MOCKUP, 'utf8');
    const start = html.indexOf('data-mk-state="bulk"');
    const end = html.indexOf('data-mk-state="viewer"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const ids = [
      ...new Set(
        [...html.slice(start, end).matchAll(/data-testid="(orders-bulk-[^"]+)"/g)].map((m) => m[1]),
      ),
    ];
    expect(ids.length).toBeGreaterThanOrEqual(10);

    const source = sourceFiles(SRC)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const missing = ids.filter((id) => !source.includes(`"${id}"`) && !source.includes(`'${id}'`));

    expect(missing).toEqual([]);
  });
});
