/**
 * `@openlinker/oms` barrel smoke test.
 *
 * Keeps the package's own `pnpm test` non-vacuous while the package is a
 * scaffold (#2390) — a suite that runs zero tests and a suite that passes
 * are indistinguishable from the exit code alone.
 *
 * @module libs/oms/src
 */
import { OmsModule } from './index';

describe('@openlinker/oms barrel', () => {
  it('should export OmsModule when the barrel is imported', () => {
    expect(OmsModule).toBeDefined();
    expect(typeof OmsModule).toBe('function');
  });
});
