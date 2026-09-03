import {
  type AuthorityHolderCandidate,
  selectAuthorityHolder,
} from './authority-selection.types';
import type { AuthorityScope } from './authority-scope.types';

const GLOBAL: AuthorityScope = { kind: 'global' };
const WAREHOUSE_A: AuthorityScope = { kind: 'location', locationId: 'loc-a' };
const WAREHOUSE_B: AuthorityScope = { kind: 'location', locationId: 'loc-b' };

const candidate = (
  connectionId: string,
  scope: AuthorityScope,
  isPrimary?: boolean,
): AuthorityHolderCandidate => ({ connectionId, scope, ...(isPrimary === undefined ? {} : { isPrimary }) });

describe('selectAuthorityHolder', () => {
  it('should report none when no candidate claims the requested scope', () => {
    expect(selectAuthorityHolder([], WAREHOUSE_A)).toEqual({ kind: 'none' });
    expect(selectAuthorityHolder([candidate('c1', WAREHOUSE_B)], WAREHOUSE_A)).toEqual({
      kind: 'none',
    });
  });

  it('should select a lone candidate when no primary flag is set at all', () => {
    // The #2047 zero-config property: an operator who never heard of `isPrimary`
    // must not silently lose the authority.
    expect(selectAuthorityHolder([candidate('c1', WAREHOUSE_A)], WAREHOUSE_A)).toEqual({
      kind: 'selected',
      connectionId: 'c1',
      scope: WAREHOUSE_A,
    });
  });

  it('should select a lone candidate when its primary flag is explicitly false', () => {
    expect(selectAuthorityHolder([candidate('c1', GLOBAL, false)], GLOBAL)).toEqual({
      kind: 'selected',
      connectionId: 'c1',
      scope: GLOBAL,
    });
  });

  it('should prefer an exact-scope claim over an enclosing global one when both are present', () => {
    const result = selectAuthorityHolder(
      [candidate('blanket', GLOBAL, true), candidate('specific', WAREHOUSE_A)],
      WAREHOUSE_A,
    );
    // A specific grant is a deliberate act; a blanket one is a default, and even
    // a PRIMARY blanket claim must not override a specific instruction.
    expect(result).toEqual({ kind: 'selected', connectionId: 'specific', scope: WAREHOUSE_A });
  });

  it('should fall back to an enclosing global claim when no exact claim exists', () => {
    expect(selectAuthorityHolder([candidate('blanket', GLOBAL)], WAREHOUSE_A)).toEqual({
      kind: 'selected',
      connectionId: 'blanket',
      scope: GLOBAL,
    });
  });

  it('should elect the single primary when several global claimants compete', () => {
    const result = selectAuthorityHolder(
      [candidate('c1', GLOBAL), candidate('c2', GLOBAL, true), candidate('c3', GLOBAL)],
      GLOBAL,
    );
    expect(result).toEqual({ kind: 'selected', connectionId: 'c2', scope: GLOBAL });
  });

  it('should report no-primary ambiguity when several enclosing claimants have no primary', () => {
    const result = selectAuthorityHolder(
      [candidate('c1', GLOBAL), candidate('c2', GLOBAL)],
      WAREHOUSE_A,
    );
    expect(result).toEqual({
      kind: 'ambiguous',
      reason: 'no-primary',
      candidateIds: ['c1', 'c2'],
    });
  });

  it('should report multiple-primaries ambiguity naming only the primaries', () => {
    const result = selectAuthorityHolder(
      [candidate('c1', GLOBAL, true), candidate('c2', GLOBAL, true), candidate('c3', GLOBAL)],
      GLOBAL,
    );
    expect(result).toEqual({
      kind: 'ambiguous',
      reason: 'multiple-primaries',
      candidateIds: ['c1', 'c2'],
    });
  });

  it('should report same-scope ambiguity when two claimants share one exact scope', () => {
    // Exact-scope claims are supposed to partition, so this is a partitioning
    // failure — not a primary election the operator forgot to hold.
    const result = selectAuthorityHolder(
      [candidate('c1', WAREHOUSE_A), candidate('c2', WAREHOUSE_A)],
      WAREHOUSE_A,
    );
    expect(result).toEqual({
      kind: 'ambiguous',
      reason: 'multiple-claimants-same-scope',
      candidateIds: ['c1', 'c2'],
    });
  });

  it('should never throw when handed degenerate candidate lists', () => {
    const degenerate: readonly AuthorityHolderCandidate[][] = [
      [],
      [candidate('dup', WAREHOUSE_A), candidate('dup', WAREHOUSE_A)],
      [candidate('', GLOBAL)],
      [candidate('c1', { kind: 'work', workId: 'w1' })],
    ];
    for (const candidates of degenerate) {
      expect(() => selectAuthorityHolder(candidates, WAREHOUSE_A)).not.toThrow();
      expect(() => selectAuthorityHolder(candidates, GLOBAL)).not.toThrow();
    }
  });

  it('should not mutate the candidate array when it resolves', () => {
    const candidates = [candidate('c1', GLOBAL), candidate('c2', GLOBAL, true)];
    const snapshot = JSON.parse(JSON.stringify(candidates)) as unknown;
    selectAuthorityHolder(candidates, GLOBAL);
    expect(JSON.parse(JSON.stringify(candidates))).toEqual(snapshot);
  });
});
