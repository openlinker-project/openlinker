/**
 * TFormaPlatnosci Drift Guard
 *
 * `'1'..'7'` is declared three times by design (plugin connection-config
 * layer, FA3 schema layer, FE schema in `apps/web`) with cross-reference
 * comments at each site. This spec makes the "add the 8th code in all three
 * places" instruction self-enforcing (PR #1317 review): the two in-package
 * arrays are compared by import, and the FE array — unreachable by import
 * from a backend jest suite — is extracted from its source file, so a
 * one-sided edit (or moving/renaming the FE declaration) fails the suite.
 *
 * @module libs/integrations/ksef/src/domain/types
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KsefFormaPlatnosciValues } from '../ksef-connection.types';
import { Fa3FormaPlatnosciValues } from '../../../infrastructure/fa3/domain/fa3-schema.types';

const FE_SCHEMA_PATH = resolve(
  __dirname,
  '../../../../../../../apps/web/src/features/connections/components/ksef-setup.schema.ts',
);

describe('TFormaPlatnosci declaration drift', () => {
  it('should keep the plugin connection-config and FA3 schema value lists identical', () => {
    expect([...KsefFormaPlatnosciValues]).toEqual([...Fa3FormaPlatnosciValues]);
  });

  it('should keep the FE KSEF_FORMA_PLATNOSCI_VALUES list identical to the plugin list', () => {
    const source = readFileSync(FE_SCHEMA_PATH, 'utf8');
    const match = source.match(
      /export const KSEF_FORMA_PLATNOSCI_VALUES = \[([^\]]*)\] as const;/,
    );
    expect(match).not.toBeNull();
    const feValues = match![1]
      .split(',')
      .map((token) => token.trim().replace(/^'(.*)'$/, '$1'))
      .filter((token) => token.length > 0);
    expect(feValues).toEqual([...KsefFormaPlatnosciValues]);
  });
});
