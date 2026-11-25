/**
 * `OrderSourcePort` order-sync-start contract suite (#4265)
 *
 * One suite every order-source adapter must pass for the three optional
 * capabilities that decide where order sync starts: `OrderFeedBootstrap`
 * (`headCursor`, the "from now" start), `OrderFeedDateBootstrap`
 * (`cursorForDate`, the "from a date" start) and `OrderWindowReader`
 * (`listOrdersInWindow`, importing history). Before this existed each adapter
 * spec asserted its own reading of those methods, so a seventh adapter could
 * satisfy the type guards and still seed past orders, return null from a failed
 * head read, or restart a window walk silently.
 *
 * ## Shape: a PURE checker plus a thin jest wrapper
 *
 * Same split as the fulfilment contract suites (#2404): `checkOrderSourceStartContract`
 * holds every rule and names no jest global, so "a broken adapter fails" and
 * "every case really asserts something" are ordinary unit tests
 * (`__tests__/`). `runOrderSourceStartContract` is the jest entry point and never
 * skips: a case the adapter's capabilities do not call for is simply not part of
 * its expected case list, and a case that did not run fails.
 *
 * ## The scenario is the adapter's side of the bargain
 *
 * Adapters read HTTP; the suite cannot know how to place an order in a shop. The
 * caller therefore supplies an in-memory `OrderSourceStartScenario` built on the
 * adapter spec's own mock harness. The suite only needs to be able to put the
 * fake shop into a few states and read the order ids back out of the feed.
 *
 * @module libs/core/src/orders/testing
 */
import {
  ContractSubjectMissingError,
  EmptyContractSuiteError,
} from '../../fulfillment/testing/contract-result.types';
import type {
  ContractCaseRecorder,
  ContractCaseResult,
  ContractRunResult,
} from '../../fulfillment/testing/contract-result.types';
import { OrderSyncStartUnavailableError } from '../domain/exceptions/order-sync-start-unavailable.error';
import { isOrderFeedBootstrap } from '../domain/ports/capabilities/order-feed-bootstrap.capability';
import { isOrderFeedDateBootstrap } from '../domain/ports/capabilities/order-feed-date-bootstrap.capability';
import {
  isOrderWindowReader,
  OrderImportDirectionValues,
} from '../domain/ports/capabilities/order-window-reader.capability';
import type { OrderImportDirection } from '../domain/ports/capabilities/order-window-reader.capability';
import type { OrderSourcePort } from '../domain/ports/order-source.port';

const CONTRACT_NAME = 'OrderSourcePort order-sync-start contract';

/** Pages a walk may take before the suite calls it non-terminating. */
const MAX_PAGES = 40;
const WALK_LIMIT = 2;

export const ORDER_SOURCE_START_CONTRACT_CASE_IDS = [
  'declaration-matches-implementation',
  'head-null-on-empty-shop',
  'head-failure-throws-never-null',
  'head-then-feed-reads-only-newer',
  'date-invalid-is-typed-refusal',
  'date-then-feed-skips-older',
  'window-walk-is-complete-and-disjoint',
  'window-bad-input-throws',
] as const;

export type OrderSourceStartContractCaseId = (typeof ORDER_SOURCE_START_CONTRACT_CASE_IDS)[number];

/** The manifest fields the suite cross-checks against the implementation. */
export interface OrderSourceStartDeclaration {
  readonly orderSyncStartModes?: readonly ('now' | 'from' | 'all')[];
  readonly orderWindowImport?: boolean;
}

/**
 * An in-memory shop the suite can steer. Every method must leave the fake
 * shop in the described state; calls are made in sequence, never concurrently.
 */
export interface OrderSourceStartScenario {
  /** The shop has no orders at all. */
  emptyShop(): Promise<void> | void;
  /** The shop holds some orders; returns their external ids. */
  shopWithOrders(): Promise<{ readonly existingIds: readonly string[] }>;
  /** A new order arrives after the head was taken; returns its external id. */
  placeNewerOrder(): Promise<string>;
  /** Every following call to the shop fails with a transport error. */
  breakTransport(): void;
  /** Undo `breakTransport`. */
  fixTransport(): void;
  /** A shop with orders on both sides of `date`. Omit when the adapter has no date start. */
  dateBetween?(): Promise<{
    readonly date: string;
    readonly olderIds: readonly string[];
    readonly newerIds: readonly string[];
  }>;
  /**
   * A shop whose orders in the window are exactly `ids` (at least five, so a
   * limit-2 walk needs several pages). Omit when the adapter has no window reader.
   */
  windowOrders?(): Promise<{
    readonly from?: string;
    readonly to?: string;
    readonly ids: readonly string[];
  }>;
  /** A date string the adapter must refuse. Defaults to a non-date. */
  readonly unusableDate?: string;
}

export interface OrderSourceStartSubject {
  readonly adapter: OrderSourcePort;
  readonly manifest: OrderSourceStartDeclaration;
  readonly scenario: OrderSourceStartScenario;
}

interface MutableCaseResult {
  id: OrderSourceStartContractCaseId;
  checks: number;
  failures: string[];
}

function createRecorder(into: MutableCaseResult): ContractCaseRecorder {
  return {
    check(condition: boolean, failureMessage: string): void {
      into.checks += 1;
      if (!condition) {
        into.failures.push(failureMessage);
      }
    },
  };
}

type ContractCase = (
  subject: OrderSourceStartSubject,
  record: ContractCaseRecorder
) => Promise<void>;

async function settle<T>(
  fn: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Every external id the feed yields from `cursor`, page after page. */
async function readFeedIds(adapter: OrderSourcePort, cursor: string | null): Promise<string[]> {
  const ids: string[] = [];
  let next = cursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const out = await adapter.listOrderFeed({ fromCursor: next, limit: 50 });
    for (const item of out.items) {
      ids.push(item.externalOrderId);
    }
    if (out.nextCursor === null || out.items.length === 0) {
      return ids;
    }
    next = out.nextCursor;
  }
  throw new Error(`the feed did not terminate within ${MAX_PAGES} pages`);
}

function declaresMode(manifest: OrderSourceStartDeclaration, mode: 'now' | 'from'): boolean {
  return (manifest.orderSyncStartModes ?? []).includes(mode);
}

/** The case ids that apply to a subject, derived from what it declares. */
export function expectedOrderSourceStartContractCaseIds(
  subject: OrderSourceStartSubject
): OrderSourceStartContractCaseId[] {
  const ids: OrderSourceStartContractCaseId[] = ['declaration-matches-implementation'];
  if (isOrderFeedBootstrap(subject.adapter)) {
    ids.push(
      'head-null-on-empty-shop',
      'head-failure-throws-never-null',
      'head-then-feed-reads-only-newer'
    );
  }
  if (isOrderFeedDateBootstrap(subject.adapter)) {
    ids.push('date-invalid-is-typed-refusal');
    if (subject.scenario.dateBetween !== undefined) {
      ids.push('date-then-feed-skips-older');
    }
  }
  if (isOrderWindowReader(subject.adapter)) {
    ids.push('window-walk-is-complete-and-disjoint', 'window-bad-input-throws');
  }
  return ids;
}

const CONTRACT_CASES: Record<OrderSourceStartContractCaseId, ContractCase> = {
  // The manifest drives the UI and the import route; the implementation drives
  // the job. They are two hand-written statements of one fact.
  'declaration-matches-implementation': ({ adapter, manifest }, record) => {
    record.check(
      !declaresMode(manifest, 'now') || isOrderFeedBootstrap(adapter),
      "manifest declares 'now' but the adapter has no headCursor()"
    );
    record.check(
      declaresMode(manifest, 'from') === isOrderFeedDateBootstrap(adapter),
      "manifest 'from' must be declared exactly when the adapter has cursorForDate()"
    );
    record.check(
      (manifest.orderWindowImport === true) === isOrderWindowReader(adapter),
      'manifest orderWindowImport must be true exactly when the adapter has listOrdersInWindow()'
    );
    return Promise.resolve();
  },

  // An empty shop has nothing to anchor on, so an adapter may answer null (the
  // first poll retries) or a position at "now". What must NOT happen is a cursor
  // the feed cannot read, or one that reads history. (A scenario cannot place an
  // order newer than "now", so the first order after the head is not asserted.)
  'head-null-on-empty-shop': async ({ adapter, scenario }, record) => {
    if (!isOrderFeedBootstrap(adapter)) return;
    await scenario.emptyShop();
    const head = await settle(() => adapter.headCursor());
    record.check(head.ok, 'headCursor() threw on an empty shop instead of answering');
    if (!head.ok || head.value === null) return;

    const headCursor = head.value;
    const before = await settle(() => readFeedIds(adapter, headCursor));
    record.check(before.ok, 'the feed could not read the head cursor of an empty shop');
    if (before.ok) {
      record.check(
        before.value.length === 0,
        `feed from the head of an empty shop returned orders: ${before.value.join(', ')}`
      );
    }
  },

  // A null head means "retry later". A swallowed transport failure that reads as
  // null would be indistinguishable from an empty shop, and a wrong seed follows.
  'head-failure-throws-never-null': async ({ adapter, scenario }, record) => {
    if (!isOrderFeedBootstrap(adapter)) return;
    await scenario.shopWithOrders();
    scenario.breakTransport();
    let outcome: { ok: true; value: string | null } | { ok: false; error: unknown };
    try {
      outcome = await settle(() => adapter.headCursor());
    } finally {
      scenario.fixTransport();
    }
    record.check(
      !outcome.ok,
      `headCursor() must throw when the shop is unreachable, but answered ${
        outcome.ok ? JSON.stringify(outcome.value) : ''
      }`
    );
  },

  // The round trip that matters: seed at the head, and the feed from there has
  // none of what was already in the shop and exactly one copy of what came after.
  'head-then-feed-reads-only-newer': async ({ adapter, scenario }, record) => {
    if (!isOrderFeedBootstrap(adapter)) return;
    const { existingIds } = await scenario.shopWithOrders();
    const head = await adapter.headCursor();
    record.check(head !== null, 'headCursor() must not be null on a shop with orders');
    if (head === null) return;

    const before = await readFeedIds(adapter, head);
    const olderBefore = before.filter((id) => existingIds.includes(id));
    record.check(
      olderBefore.length === 0,
      `feed from the head returned orders that existed at head time: ${olderBefore.join(', ')}`
    );

    const newerId = await scenario.placeNewerOrder();
    const after = await readFeedIds(adapter, head);
    const olderAfter = after.filter((id) => existingIds.includes(id));
    record.check(
      olderAfter.length === 0,
      `feed from the head returned older orders after a new one arrived: ${olderAfter.join(', ')}`
    );
    record.check(
      after.filter((id) => id === newerId).length === 1,
      `the order placed after the head must appear exactly once, saw ${
        after.filter((id) => id === newerId).length
      }`
    );
  },

  // An unusable date is the operator's to fix. A plain Error would be retried
  // ten times and end in a dead job; the typed error is what the poll turns into
  // a visible, non-retried refusal.
  'date-invalid-is-typed-refusal': async ({ adapter, scenario }, record) => {
    if (!isOrderFeedDateBootstrap(adapter)) return;
    await scenario.shopWithOrders();
    const outcome = await settle(() =>
      adapter.cursorForDate(scenario.unusableDate ?? 'not-a-date')
    );
    record.check(!outcome.ok, 'cursorForDate() accepted a value that is not a date');
    if (!outcome.ok) {
      record.check(
        outcome.error instanceof OrderSyncStartUnavailableError,
        `cursorForDate() must refuse with OrderSyncStartUnavailableError, got ${
          (outcome.error as Error)?.name ?? typeof outcome.error
        }`
      );
    }
  },

  'date-then-feed-skips-older': async ({ adapter, scenario }, record) => {
    if (!isOrderFeedDateBootstrap(adapter) || scenario.dateBetween === undefined) return;
    const { date, olderIds, newerIds } = await scenario.dateBetween();
    const cursor = await adapter.cursorForDate(date);
    const ids = await readFeedIds(adapter, cursor);
    const older = ids.filter((id) => olderIds.includes(id));
    record.check(
      older.length === 0,
      `feed from the date cursor returned older orders: ${older.join(', ')}`
    );
    const missing = newerIds.filter((id) => !ids.includes(id));
    record.check(
      missing.length === 0,
      `feed from the date cursor lost newer orders: ${missing.join(', ')}`
    );
  },

  // Walk both directions to the end. Complete (every order seen), disjoint (none
  // twice), terminating, and `done` agrees with a null cursor.
  'window-walk-is-complete-and-disjoint': async ({ adapter, scenario }, record) => {
    if (!isOrderWindowReader(adapter) || scenario.windowOrders === undefined) {
      record.check(
        false,
        'the scenario must provide windowOrders() for an adapter with a window reader'
      );
      return;
    }
    const window = await scenario.windowOrders();
    for (const direction of OrderImportDirectionValues as readonly OrderImportDirection[]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      let terminated = false;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const out = await adapter.listOrdersInWindow({
          ...(window.from !== undefined ? { from: window.from } : {}),
          ...(window.to !== undefined ? { to: window.to } : {}),
          direction,
          cursor,
          limit: WALK_LIMIT,
        });
        record.check(
          out.items.length <= WALK_LIMIT,
          `${direction}: a page of ${out.items.length} exceeds the limit of ${WALK_LIMIT}`
        );
        record.check(
          out.done === (out.nextCursor === null),
          `${direction}: done (${out.done}) must be true exactly when nextCursor is null`
        );
        for (const item of out.items) seen.push(item.externalOrderId);
        if (out.done || out.nextCursor === null) {
          terminated = true;
          break;
        }
        record.check(out.nextCursor !== cursor, `${direction}: nextCursor did not advance`);
        if (out.nextCursor === cursor) break;
        cursor = out.nextCursor;
      }
      record.check(
        terminated,
        `${direction}: the walk did not terminate within ${MAX_PAGES} pages`
      );
      record.check(
        new Set(seen).size === seen.length,
        `${direction}: an order was returned more than once (${seen.join(', ')})`
      );
      const missing = window.ids.filter((id) => !seen.includes(id));
      const extra = seen.filter((id) => !window.ids.includes(id));
      record.check(missing.length === 0, `${direction}: walk missed ${missing.join(', ')}`);
      record.check(
        extra.length === 0,
        `${direction}: walk returned orders outside the window: ${extra.join(', ')}`
      );
    }
  },

  // Bad input must be loud. A garbage cursor that quietly restarts the walk
  // re-imports everything; a garbage bound that is ignored imports the world.
  'window-bad-input-throws': async ({ adapter, scenario }, record) => {
    if (!isOrderWindowReader(adapter)) return;
    await scenario.shopWithOrders();
    const badCursor = await settle(() =>
      adapter.listOrdersInWindow({
        direction: 'oldest-first',
        cursor: '%%not-a-cursor%%',
        limit: WALK_LIMIT,
      })
    );
    record.check(!badCursor.ok, 'a malformed cursor must throw, not restart the walk');
    const badFrom = await settle(() =>
      adapter.listOrdersInWindow({
        from: 'not-a-date',
        direction: 'oldest-first',
        cursor: null,
        limit: WALK_LIMIT,
      })
    );
    record.check(!badFrom.ok, 'a malformed from bound must throw, not be ignored');
  },
};

/**
 * Run every applicable rule against `subject` and report per-case results.
 *
 * @throws ContractSubjectMissingError when there is nothing to test.
 * @throws EmptyContractSuiteError when the case table is empty.
 */
export async function checkOrderSourceStartContract(
  subject: OrderSourceStartSubject,
  options: { readonly subject?: string } = {}
): Promise<ContractRunResult> {
  if (subject === null || subject === undefined) {
    throw new ContractSubjectMissingError(CONTRACT_NAME, 'the factory produced no subject');
  }
  if (
    subject.adapter === null ||
    subject.adapter === undefined ||
    typeof subject.adapter.listOrderFeed !== 'function'
  ) {
    throw new ContractSubjectMissingError(
      CONTRACT_NAME,
      'the subject adapter has no listOrderFeed()'
    );
  }
  if (subject.scenario === null || subject.scenario === undefined || !subject.manifest) {
    throw new ContractSubjectMissingError(
      CONTRACT_NAME,
      'the subject needs a manifest and a scenario'
    );
  }

  const caseIds = expectedOrderSourceStartContractCaseIds(subject);
  if (caseIds.length === 0 || Object.keys(CONTRACT_CASES).length === 0) {
    throw new EmptyContractSuiteError(CONTRACT_NAME);
  }

  const cases: ContractCaseResult[] = [];
  for (const id of caseIds) {
    const result: MutableCaseResult = { id, checks: 0, failures: [] };
    try {
      await CONTRACT_CASES[id](subject, createRecorder(result));
    } catch (error) {
      result.failures.push(`case threw: ${(error as Error).message}`);
    }
    cases.push({ id: result.id, checks: result.checks, failures: result.failures });
  }

  return { subject: options.subject ?? subject.adapter.constructor?.name ?? 'order source', cases };
}

/**
 * Jest entry point. Call it from an adapter spec with a factory that returns a
 * FRESH subject (adapter, manifest, scenario) each time. Never skips: a case the
 * adapter's capabilities do not call for is not in its expected list, and an
 * expected case that did not run fails.
 */
export function runOrderSourceStartContract(
  makeSubject: () => OrderSourceStartSubject,
  options: {
    readonly subject?: string;
    /**
     * A case the adapter is KNOWN to fail, with the reason. The case is then
     * asserted to FAIL, so an adapter fixing the behaviour (or the entry rotting)
     * turns the run red instead of leaving a stale excuse. This records a finding
     * in the open; it is not a way to skip a case.
     */
    readonly knownDeviations?: Partial<Record<OrderSourceStartContractCaseId, string>>;
  } = {}
): void {
  describe(`${CONTRACT_NAME}${options.subject ? ` - ${options.subject}` : ''}`, () => {
    let result: ContractRunResult;
    let expected: OrderSourceStartContractCaseId[];

    beforeAll(async () => {
      const subject = makeSubject();
      expected = expectedOrderSourceStartContractCaseIds(subject);
      result = await checkOrderSourceStartContract(subject, { subject: options.subject });
    });

    it('runs every case its capabilities call for', () => {
      expect(result.cases.map((c) => c.id).sort()).toEqual([...expected].sort());
    });

    for (const id of ORDER_SOURCE_START_CONTRACT_CASE_IDS) {
      it(id, () => {
        if (!expected.includes(id)) {
          // Not applicable to this adapter: assert it was correctly left out.
          expect(result.cases.find((c) => c.id === id)).toBeUndefined();
          return;
        }
        const found = result.cases.find((c) => c.id === id);
        expect(found).toBeDefined();
        if (options.knownDeviations?.[id] !== undefined) {
          expect({
            id,
            deviation: options.knownDeviations[id],
            failed: (found?.failures.length ?? 0) > 0,
          }).toEqual({ id, deviation: options.knownDeviations[id], failed: true });
          return;
        }
        expect(found?.failures ?? ['case did not run']).toEqual([]);
        expect(found?.checks ?? 0).toBeGreaterThan(0);
      });
    }
  });
}
