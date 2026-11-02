/**
 * Mockup M1 cancel-states contract (#3541): every `order-cancel-*` `data-testid`
 * pinned in the committed mockup is carried by the implemented components, so
 * one selector set drives both the mockup and the live app. Reads the mockup
 * from the repo. The `edit-*` states are #3544's and carry their own prefix, so
 * they are deliberately not asserted here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MOCKUP = resolve(
  __dirname,
  '../../../../../../docs/plans/mockups/oms-mvp/m1-order-cancel-and-edit.html',
);
const SRC = resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(tsx?)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

describe('mockup M1 cancel testids (#3541)', () => {
  const ids = [
    ...new Set(
      [...readFileSync(MOCKUP, 'utf8').matchAll(/data-testid="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((id) => id.startsWith('order-cancel-')),
    ),
  ];

  it('should pin a testid for every implemented cancel state', () => {
    // One or more per state: order, cancel-confirm, cancel-progress,
    // cancel-label, cancel-shipped, cancel-done.
    expect(ids).toEqual(
      expect.arrayContaining([
        'order-cancel-button',
        'order-cancel-dialog',
        'order-cancel-submit',
        'order-cancel-progress',
        'order-cancel-label-refusal',
        'order-cancel-shipped-refusal',
        'order-cancel-done',
      ]),
    );
    expect(ids.length).toBeGreaterThan(15);
  });

  it('should be carried by the implementation', () => {
    const source = sourceFiles(SRC)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const missing = ids.filter((id) => !source.includes(`'${id}'`) && !source.includes(`"${id}"`));

    expect(missing).toEqual([]);
  });
});
