/**
 * The API offers no route that closes a parcel (#2418 D18 / story E5; #2905)
 *
 * `libs/core/src/fulfillment/__tests__/no-parcel-commit-control.spec.ts` claims
 * the guarantee holds at *"three layers, because a commit control can be
 * introduced at any of them"* — core, the API and the browser. Core asserted its
 * own seam and `bench-parcel.test.tsx` asserts the browser's; the API layer had
 * **no assertion at all**, so a third of a stated three-layer guard was prose.
 * A docblock claiming a layer is covered is how that layer gets reviewed as
 * covered, so the layer is built rather than the sentence trimmed.
 *
 * ## It reads route METADATA, not source text
 *
 * The core spec greps two seam files, correctly: it is guarding a declaration in
 * a known place. The question here is different — *is there an HTTP route a
 * button could POST to?* — and a text scan answers that badly: it misses a
 * multi-line decorator, matches prose in a file header, and cannot see a path
 * assembled from a constant. Nest's own metadata is the same source
 * `route-authorization-coverage.spec.ts` and `packer-exclusion.spec.ts` both
 * read, and it reports exactly what the router will serve.
 *
 * ## Why an ALLOW-LIST of paths rather than a denied word list
 *
 * A `/close` matcher can only refuse the spelling somebody thought of —
 * `/seal`, `/commit`, `/mark-packed`, `/ready` all sail past it. Every write
 * route on the bench is enumerated instead, so ANY new one fails here until it
 * is decided against D18. Adding a line is a decision; the two that exist are
 * the two story E5 names.
 *
 * @module apps/api/src/bench/__tests__
 */
import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BENCH_HTTP_ROOT = resolve(__dirname, '..', 'http');

/**
 * Every non-GET route the bench serves, as `METHOD /path`.
 *
 * Pinned with `toEqual`, so a new write is a failing assertion rather than a
 * quiet append — which is the whole mechanism. `verify` closes the box as a
 * CONSEQUENCE of the last unit (D18) and `reopen` is E6's correction path.
 * `verifications/undo` (#3405) is neither a close nor a reopen — it is the
 * OPPOSITE of a commit, voiding the single most recent scan on an OPEN
 * parcel, and it cannot reach a closed box (refused `parcel-closed` rather
 * than reopening one as a side effect). `presence` (#3406) closes nothing
 * either — it is an ephemeral Redis TTL heartbeat with no effect on parcel
 * state at all. `claim` (#3412) is a self-assignment write, not a packing
 * one — it moves `assignedToUserId`, never `parcelClosedAt`. `completion`
 * (pack-bench completion) is a fourth kind of write, not a third spelling of a close: D18 is
 * about the box CONTENTS, closed silently on the last verification with
 * nothing left for a control to confirm, while completion asks whether an
 * ALREADY-CLOSED parcel has actually left the bench — a later, explicit act
 * with real prior art (ShipHero's "Complete Order", Brightpearl's `Packed`
 * state before `Shipped`) for treating it as its own step. Listed here as a
 * decision, never smuggled past the guard. `complete/undo` (#3415) is the
 * `verifications/undo` case one act up: it is the OPPOSITE of a commit,
 * clearing `completedAt` alone while every scan and `parcelClosedAt` stand,
 * and it exists because a completion was otherwise a one-way door whose only
 * exit was `reopen` - which unpacks a box that was packed correctly. All
 * listed as deliberate writes rather than silently exempted from the guard
 * this file exists to be.
 */
const EXPECTED_BENCH_WRITES = [
  'POST bench/work/:workId/claim',
  'POST bench/work/:workId/complete',
  'POST bench/work/:workId/complete/undo',
  'POST bench/work/:workId/presence',
  'POST bench/work/:workId/reopen',
  'POST bench/work/:workId/verifications',
  'POST bench/work/:workId/verifications/undo',
  'POST bench/work/claim-next',
] as const;

/** Nest's metadata keys. Literals for the reason the coverage spec states. */
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

/** `RequestMethod` is an enum; only the members a write could arrive under. */
const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface DiscoveredRoute {
  readonly verb: string;
  readonly path: string;
}

function controllerFiles(): string[] {
  return readdirSync(BENCH_HTTP_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.controller.ts'))
    .map((entry) => join(BENCH_HTTP_ROOT, entry.name))
    .sort();
}

function collect(): DiscoveredRoute[] {
  // Deliberately NOT `RequestMethod[verb]`: importing the enum for a reverse
  // lookup buys nothing a fixed table does not, and the table is what makes an
  // unexpected verb visible rather than silently `undefined`.
  const VERB_BY_INDEX = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
  const routes: DiscoveredRoute[] = [];

  for (const file of controllerFiles()) {
    // Discovery is a filesystem walk, so the path is only known at runtime.
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- runtime-discovered module path
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      const base = Reflect.getMetadata(PATH_METADATA, exported) as string | undefined;
      if (base === undefined) continue;

      const proto = (exported as unknown as { prototype: Record<string, unknown> }).prototype;
      for (const handler of Object.getOwnPropertyNames(proto)) {
        if (handler === 'constructor' || typeof proto[handler] !== 'function') continue;
        const fn = proto[handler] as object;
        const verbIndex = Reflect.getMetadata(METHOD_METADATA, fn) as number | undefined;
        if (verbIndex === undefined) continue;
        const path = (Reflect.getMetadata(PATH_METADATA, fn) as string | undefined) ?? '';
        routes.push({
          verb: VERB_BY_INDEX[verbIndex] ?? `VERB_${String(verbIndex)}`,
          path: `${base}/${path}`.replace(/\/+/g, '/').replace(/\/$/, ''),
        });
      }
    }
  }
  return routes;
}

const ROUTES = collect();

describe('the bench API exposes no parcel-commit route (#2418, D18)', () => {
  it('discovers the bench controllers at all', () => {
    // Without this every assertion below passes vacuously on a broken walk —
    // the "check that cannot fail" shape.
    expect(controllerFiles().length).toBeGreaterThan(1);
    expect(ROUTES.length).toBeGreaterThan(3);
  });

  it('serves exactly the writes decided against D18, and no undecided one', () => {
    const writes = ROUTES.filter((route) => WRITE_VERBS.has(route.verb))
      .map((route) => `${route.verb} ${route.path}`)
      .sort();

    expect(writes).toEqual([...EXPECTED_BENCH_WRITES]);
  });

  it('serves no route whose path reads like a commit, whatever its verb', () => {
    // The allow-list above is the guard; this is the reader-facing half, so a
    // failure names the decision rather than only the diff. GET included: a
    // close reached by a read would be worse, not better.
    //
    // `POST bench/work/:workId/complete` is EXCLUDED from this scan, not from
    // the guard: it is already in `EXPECTED_BENCH_WRITES` above, with the
    // reasoning spelled out there — the decided, documented completion act, a
    // fourth kind of write and not a spelling of the D18 close this scan
    // exists to catch. Excluding it here (by exact path, not by loosening the
    // keyword) is what keeps the scan able to catch the NEXT undecided one,
    // including a second route that also happens to use the word "complete".
    // Exact paths, never a looser keyword, for the reason stated above: a
    // third route spelling "complete" must still fail here. `complete/undo`
    // earns its place by being the opposite of a commit - see the docblock.
    const DECIDED_COMPLETION_ROUTES = new Set([
      'POST bench/work/:workId/complete',
      'POST bench/work/:workId/complete/undo',
    ]);
    const suspicious = ROUTES.filter(
      (route) =>
        !DECIDED_COMPLETION_ROUTES.has(`${route.verb} ${route.path}`) &&
        /close|commit|finish|seal|complete|done/i.test(route.path)
    ).map(
      (route) =>
        `${route.verb} ${route.path} reads like a parcel commit. Decision D18: the box closes ` +
        'on the LAST VERIFICATION, inside `verifyUnit`\'s own transaction, with no confirmation ' +
        'step — so there is nothing for such a route to do. If this is deliberate it is an ' +
        'amendment to D18 and belongs in the spec first.'
    );

    expect(suspicious).toEqual([]);
  });
});
