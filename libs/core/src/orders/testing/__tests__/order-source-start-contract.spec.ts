/**
 * The order-sync-start contract suite must be able to fail (#4265)
 *
 * A contract kit can look thorough and assert nothing. Each case below is
 * broken on purpose in the one way it exists to catch, and the spec asserts
 * that exactly that case fails and its siblings do not. A suite that cannot
 * fail cannot protect the seventh adapter.
 *
 * @module libs/core/src/orders/testing/__tests__
 */
import {
  ORDER_SOURCE_START_CONTRACT_CASE_IDS,
  checkOrderSourceStartContract,
  expectedOrderSourceStartContractCaseIds,
} from '../order-source-start-contract.suite';
import type { OrderSourceStartContractCaseId } from '../order-source-start-contract.suite';
import { ContractSubjectMissingError } from '../../../fulfillment/testing/contract-result.types';
import { makeSubject } from './order-source-start.fixtures';
import type { Flaw } from './order-source-start.fixtures';

async function failedIds(flaws: Flaw[]): Promise<OrderSourceStartContractCaseId[]> {
  const result = await checkOrderSourceStartContract(makeSubject({ flaws }));
  return result.cases.filter((c) => c.failures.length > 0).map((c) => c.id as OrderSourceStartContractCaseId);
}

describe('order-source start contract', () => {
  it('should pass every case for a conforming adapter and record real checks', async () => {
    const result = await checkOrderSourceStartContract(makeSubject());
    expect(result.cases.map((c) => c.id).sort()).toEqual([...ORDER_SOURCE_START_CONTRACT_CASE_IDS].sort());
    for (const c of result.cases) {
      expect({ id: c.id, failures: c.failures }).toEqual({ id: c.id, failures: [] });
      expect({ id: c.id, ran: c.checks > 0 }).toEqual({ id: c.id, ran: true });
    }
  });

  const BROKEN: ReadonlyArray<readonly [Flaw, OrderSourceStartContractCaseId]> = [
    ['fabricate-head-on-empty-shop', 'head-null-on-empty-shop'],
    ['swallow-head-failure', 'head-failure-throws-never-null'],
    ['head-feed-includes-older', 'head-then-feed-reads-only-newer'],
    ['feed-duplicates-newer', 'head-then-feed-reads-only-newer'],
    ['untyped-date-error', 'date-invalid-is-typed-refusal'],
    ['date-ignored', 'date-then-feed-skips-older'],
    ['window-repeats-an-order', 'window-walk-is-complete-and-disjoint'],
    ['window-never-ends', 'window-walk-is-complete-and-disjoint'],
    ['window-done-mismatch', 'window-walk-is-complete-and-disjoint'],
    ['window-restarts-on-bad-cursor', 'window-bad-input-throws'],
    ['window-ignores-bad-from', 'window-bad-input-throws'],
  ];

  it.each(BROKEN)('should fail the matching case when the adapter has flaw %s', async (flaw, caseId) => {
    expect(await failedIds([flaw])).toContain(caseId);
  });

  it('should fail the declaration case when the manifest lies about the implementation', async () => {
    const lies = [
      { orderSyncStartModes: ['now', 'all'], orderWindowImport: true },
      { orderSyncStartModes: ['now', 'from', 'all'], orderWindowImport: false },
    ] as const;
    for (const manifest of lies) {
      const result = await checkOrderSourceStartContract(makeSubject({ manifest }));
      const declaration = result.cases.find((c) => c.id === 'declaration-matches-implementation');
      expect(declaration?.failures.length).toBeGreaterThan(0);
    }
  });

  it("should fail the declaration case when 'now' is declared without a headCursor", async () => {
    const subject = makeSubject();
    const feedOnly = { listOrderFeed: subject.adapter.listOrderFeed.bind(subject.adapter) } as never;
    const result = await checkOrderSourceStartContract({ ...subject, adapter: feedOnly });
    expect(result.cases.map((c) => c.id)).toEqual(['declaration-matches-implementation']);
    expect(result.cases[0].failures.join(' ')).toContain('headCursor');
  });

  it('should only expect the cases an adapter has the capability for', () => {
    const noDate = makeSubject({ manifest: { orderSyncStartModes: ['now', 'all'] } });
    const bare = { ...noDate, adapter: { listOrderFeed: noDate.adapter.listOrderFeed } as never };
    expect(expectedOrderSourceStartContractCaseIds(bare)).toEqual(['declaration-matches-implementation']);
    expect(expectedOrderSourceStartContractCaseIds(makeSubject({ noDateScenario: true }))).not.toContain(
      'date-then-feed-skips-older',
    );
  });

  it('should throw, not skip, when handed no usable subject', async () => {
    await expect(checkOrderSourceStartContract(undefined as never)).rejects.toBeInstanceOf(
      ContractSubjectMissingError,
    );
    await expect(
      checkOrderSourceStartContract({ ...makeSubject(), adapter: {} as never }),
    ).rejects.toBeInstanceOf(ContractSubjectMissingError);
    await expect(
      checkOrderSourceStartContract({ ...makeSubject(), scenario: undefined as never }),
    ).rejects.toBeInstanceOf(ContractSubjectMissingError);
  });

  it('should report a throwing case as a failure rather than swallowing it', async () => {
    const subject = makeSubject();
    const exploding = {
      ...subject,
      scenario: { ...subject.scenario, shopWithOrders: () => Promise.reject(new Error('boom')) },
    };
    const result = await checkOrderSourceStartContract(exploding);
    expect(result.cases.some((c) => c.failures.some((f) => f.startsWith('case threw: boom')))).toBe(true);
  });

  it('should keep the flawed fixtures honest: every case has at least one mutation that targets it', () => {
    const targeted = new Set(BROKEN.map(([, id]) => id));
    // declaration is covered by the manifest-lie tests above.
    for (const id of ORDER_SOURCE_START_CONTRACT_CASE_IDS) {
      if (id === 'declaration-matches-implementation') continue;
      expect({ id, targeted: targeted.has(id) }).toEqual({ id, targeted: true });
    }
  });
});
