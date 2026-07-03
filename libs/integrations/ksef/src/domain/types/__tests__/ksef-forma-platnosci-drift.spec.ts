/**
 * TFormaPlatnosci Drift Guard (in-package half)
 *
 * `'1'..'7'` is declared three times by design (plugin connection-config
 * layer, FA3 schema layer, FE schema in `apps/web`) with cross-reference
 * comments at each site. The two in-package arrays are compared here by
 * import; the FE array lives in a different workspace package, so its
 * comparison is a repo-level invariant instead —
 * `scripts/check-ksef-forma-platnosci-drift.mjs`, run under
 * `pnpm check:invariants` (PR #1317 review: a source-file read via a
 * 7-level relative path into `apps/web` coupled this suite to the monorepo
 * layout).
 *
 * @module libs/integrations/ksef/src/domain/types
 */
import { KsefFormaPlatnosciValues } from '../ksef-connection.types';
import { Fa3FormaPlatnosciValues } from '../../../infrastructure/fa3/domain/fa3-schema.types';

describe('TFormaPlatnosci declaration drift', () => {
  it('should keep the plugin connection-config and FA3 schema value lists identical', () => {
    expect([...KsefFormaPlatnosciValues]).toEqual([...Fa3FormaPlatnosciValues]);
  });
});
