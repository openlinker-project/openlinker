/**
 * Structural guard (#4277): no code path sends stock or price through OF24.
 *
 * OF24 (`POST /api/offers`) resets every offer field it does not receive; a
 * partial write on Empik staging zeroed the quantity and reset the
 * description, lead time and logistic class. Stock goes through STO01 and
 * price through PRI01, which change only their own field. This spec fails the
 * build if any production file in the plugin POSTs to `/api/offers` itself.
 *
 * @module libs/integrations/mirakl/src
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' ? [] : productionFiles(path);
    }
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('Mirakl offer writes never use OF24', () => {
  it('should not POST to /api/offers from any production file', () => {
    const offenders = productionFiles(SRC).filter((file) =>
      /\.post(?:File)?(?:<[^>]*>)?\(\s*['"`]\/api\/offers['"`]/.test(readFileSync(file, 'utf8'))
    );

    expect(offenders).toEqual([]);
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
