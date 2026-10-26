/**
 * Mockup M1 edit-states contract (#3544): every `order-edit-*` `data-testid`
 * pinned in the committed mockup is carried by the implemented components, so one
 * selector set drives both the mockup and the live app. Reads the mockup from the
 * repo. The `order-cancel-*` ids are #3541's and are guarded by their own test.
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

describe('mockup M1 edit testids (#3544)', () => {
  const ids = [
    ...new Set(
      [...readFileSync(MOCKUP, 'utf8').matchAll(/data-testid="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((id) => id.startsWith('order-edit-')),
    ),
  ];

  it('should pin a testid for every implemented edit state', () => {
    // One or more per state: order (entry), edit-form, edit-review, edit-blocked, edit-saved.
    expect(ids).toEqual(
      expect.arrayContaining([
        'order-edit-button',
        'order-edit-dialog',
        'order-edit-review-button',
        'order-edit-diff',
        'order-edit-money',
        'order-edit-save',
        'order-edit-blocked',
        'order-edit-locked-lines',
        'order-edit-saved-badge',
        'order-edit-notice',
        'order-edit-pricing-note',
      ]),
    );
    expect(ids.length).toBeGreaterThan(25);
  });

  it('should be carried by the implementation', () => {
    const source = sourceFiles(SRC)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const missing = ids.filter((id) => !source.includes(`'${id}'`) && !source.includes(`"${id}"`));

    expect(missing).toEqual([]);
  });
});
