/**
 * Structural guard (#4277, #4278): stock and price never go through OF24.
 *
 * OF24 (`POST /api/offers`) resets every offer field it does not receive; a
 * partial write on Empik staging zeroed the quantity and reset the
 * description, lead time and logistic class. So:
 *
 * - stock goes through STO01 and price through PRI01, which change only their
 *   own field;
 * - OF24 is used in exactly one place, the offer creator, once per offer and
 *   with the full field set a new offer needs (#4278).
 *
 * This spec fails the build if any other production file references the OF24
 * path or posts to it.
 *
 * @module libs/integrations/mirakl/src
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..');
const OF24_LITERAL = /['"`]\/api\/offers['"`]/;
const OFFER_CREATOR = 'infrastructure/adapters/mirakl-offer-creator.ts';
/** OF21 reads the same path with GET; it never posts. */
const OF21_READER = 'infrastructure/adapters/mirakl-offer-manager.adapter.ts';

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' ? [] : productionFiles(path);
    }
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('Mirakl stock and price never use OF24', () => {
  it('should reference the OF24 path only in the offer creator and the OF21 reader', () => {
    const referencing = productionFiles(SRC)
      .filter((file) => OF24_LITERAL.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))
      .sort();

    expect(referencing).toEqual([OFFER_CREATOR, OF21_READER].sort());
  });

  it('should never post from the OF21 reader', () => {
    const reader = readFileSync(join(SRC, OF21_READER), 'utf8');

    expect(reader).not.toMatch(/\.post(?:File)?\s*(?:<[^>]*>)?\s*\(/);
  });

  it('should send stock and price only to their own import endpoints', () => {
    const reconciler = readFileSync(
      join(SRC, 'infrastructure/adapters/mirakl-offer-write-reconciler.ts'),
      'utf8'
    );

    expect(reconciler).toContain("stock: '/api/offers/stock/imports'");
    expect(reconciler).toContain("price: '/api/offers/pricing/imports'");
  });
});
