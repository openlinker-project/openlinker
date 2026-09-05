/**
 * The bench eligibility rule has ONE definition (#2420, `W3b-7`, story G4)
 *
 * Story D2 asks that opening a parcel refuse with *"the same eligibility rule as
 * the list, so the two can never disagree"*, and #2418 extracted
 * `deriveBenchWorkState` to make that true. G4 asks for the property to be
 * **pinned**: a rule that is shared today and copied tomorrow fails silently, and
 * the way it fails is a packer told a parcel is packable by one surface and
 * unpackable by the other, with neither answer obviously wrong.
 *
 * ## This spec is a HEURISTIC. The behavioural specs are what catch drift
 *
 * Stated first because it is the thing most likely to be over-read. A textual
 * walk cannot decide whether a function reimplements a rule; it can only notice
 * the shapes a reimplementation usually takes. The assertions that actually bite
 * are in `bench-work.service.spec.ts` and `bench-parcel.service.spec.ts`, which
 * drive both services over the shared `BENCH_ELIGIBILITY_FIXTURES` table — a copy
 * that DRIFTS fails there. This file catches the copy earlier, while it still
 * agrees, which is the window in which it is cheap to remove.
 *
 * ## Why the precedent's rule is inverted here, and what that costs
 *
 * `libs/core/src/__tests__/no-direct-buffer-read.spec.ts` forbids an **import**,
 * which works because the thing it polices is *reaching for a helper*. The
 * question here is the opposite — *producing a value without reaching for the
 * helper* — and that inversion does not transfer cleanly. A rule of the form
 * "any file mentioning `'packable'` must import the derivation" was tried and
 * rejected in review: it misses the realistic copy, which is refusal-shaped and
 * mentions neither the literal nor the import —
 *
 *     if (work.status === 'cancelled') return 'cancelled';
 *     if (work.activeHolds.length > 0) return 'held';
 *     return null;
 *
 * — while forcing any future consumer that merely *branches on* a state it was
 * handed to import a derivation it does not need. So two halves instead:
 *
 * 1. **Positive.** Both known callers must import `deriveBenchWorkState`. This
 *    is also the non-vacuity guard: rewire either to an inline copy and it fails.
 * 2. **Negative.** No production file outside the owner may contain a
 *    `'cancelled'` comparison *and* a hold-count expression — the derivation's
 *    distinguishing input shape, and what the refusal-shaped copy above cannot
 *    avoid.
 *
 * The walk covers **production source only**, exactly as the precedent's
 * `collectSourceFiles` does. That is not an exemption: the precedent's
 * "no exemptions, deliberately" is about production carve-outs ("display only"),
 * and putting `__tests__` in an authorized-paths list would manufacture the
 * appearance of the very thing it warns against. A spec asserting
 * `expect(state).toBe('packable')` cannot ship a divergent production answer.
 *
 * @module apps/api/src/bench/application/__tests__
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BENCH_ROOT = join(__dirname, '..', '..');

/**
 * The module that DEFINES the rule, plus the vocabulary it answers in.
 *
 * Two entries, each a role rather than a convenience: `bench-work-eligibility.ts`
 * owns the derivation, and `bench-work.types.ts` owns `BenchWorkStateValues` —
 * the `as const` array every state literal in the codebase is ultimately drawn
 * from. Pinned with `toEqual` below so widening this list is a deliberate edit
 * to a failing assertion rather than a quiet append.
 */
const AUTHORIZED_PATHS = [
  'application/bench-work-eligibility.ts',
  'application/types/bench-work.types.ts',
] as const;

/** The two callers story D2 exists to keep in agreement. */
const KNOWN_CALLERS = [
  'application/services/bench-work.service.ts',
  'application/services/bench-parcel.service.ts',
] as const;

/**
 * Every production `.ts` file under `apps/api/src/bench`.
 *
 * Tests and fixtures are excluded in the WALKER, following the precedent, so
 * they never reach an authorized-paths list.
 */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.int-spec.ts')) continue;
    acc.push(full);
  }
  return acc;
}

/** Path relative to `apps/api/src/bench`, POSIX separators. */
function relative(file: string): string {
  return file.slice(BENCH_ROOT.length + 1).split('\\').join('/');
}

/** Source with comments stripped — the derivation is DISCUSSED in several docblocks. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

const SOURCE_FILES = collectSourceFiles(BENCH_ROOT);

describe('one bench eligibility rule, two callers (#2420, G4)', () => {
  it('walks a non-empty set of production files', () => {
    // The precedent's empty-walk guard. A walk that matched nothing would pass
    // every assertion below for ever — the "check that cannot fail" shape.
    expect(SOURCE_FILES.length).toBeGreaterThan(10);
  });

  it('pins the authorized list, so widening it is a deliberate edit', () => {
    expect([...AUTHORIZED_PATHS]).toEqual([
      'application/bench-work-eligibility.ts',
      'application/types/bench-work.types.ts',
    ]);
  });

  describe('the positive half — both callers reach for the shared rule', () => {
    it.each(KNOWN_CALLERS)('%s imports `deriveBenchWorkState`', (caller) => {
      const file = SOURCE_FILES.find((candidate) => relative(candidate) === caller);
      // Non-vacuity: a renamed caller must fail here rather than silently drop
      // out of the assertion.
      expect(file).toBeDefined();
      expect(code(file as string)).toContain('deriveBenchWorkState');
    });

    it('finds exactly the two callers the story is about, and no third', () => {
      // A third caller is not forbidden — it is a signal that this spec's
      // "two callers" framing, and D2's, need revisiting rather than extending
      // by reflex.
      const callers = SOURCE_FILES.filter(
        (file) =>
          !(AUTHORIZED_PATHS as readonly string[]).includes(relative(file)) &&
          code(file).includes('deriveBenchWorkState(')
      ).map(relative);
      expect(callers.sort()).toEqual([...KNOWN_CALLERS].sort());
    });
  });

  describe('the negative half — nobody else re-derives it', () => {
    it.each(SOURCE_FILES.map((file) => [relative(file), file] as const))(
      '%s does not restate the derivation',
      (name, file) => {
        if ((AUTHORIZED_PATHS as readonly string[]).includes(name)) return;
        const source = code(file);
        // The derivation's distinguishing input shape: it is the ONLY rule in
        // the bench that decides on a cancelled status AND a hold count.
        // `case 'cancelled':` is included because a `switch (work.status)` copy
        // is as likely as an `if` chain and would otherwise sail through.
        const readsCancellation = /===\s*'cancelled'|'cancelled'\s*===|case\s+'cancelled'/.test(
          source
        );
        const readsHoldCount =
          /activeHolds\s*\.\s*length|activeHoldCount/.test(source);
        expect(
          readsCancellation && readsHoldCount
            ? `${name} decides on BOTH a cancelled status and a hold count — the input shape ` +
                'of `deriveBenchWorkState`. Story D2 requires one rule with two callers: the ' +
                'list colours a row with it and the parcel read refuses with it, so a second ' +
                'copy is a packer told a parcel is packable by one surface and unpackable by ' +
                'the other. Call `deriveBenchWorkState` from ' +
                '`application/bench-work-eligibility.ts` instead.'
            : null
        ).toBeNull();
      }
    );
  });

  /**
   * The blind spot the two halves above share (#2905 review).
   *
   * Both catch a RESTATEMENT of the rule. Neither catches an OMISSION — and an
   * omission is what shipped: `BenchDocumentsService.listUnlabelled` filtered
   * the worklist on connection + `accepted` + `parcelClosed` and simply left
   * `status` off, so it was a third spelling of "is this a bench parcel" that
   * agreed with nobody. A work at `incomplete` was listed there and 404'd when
   * a packer clicked it, which is D2's disagreement arriving through the door
   * neither half was watching.
   *
   * The rule below is positional rather than semantic — any file that SELECTS
   * bench work from the worklist must reach for the shared constants — which is
   * the same heuristic posture the file header already declares. It cannot
   * decide whether a filter object is correct; it can insist that the one thing
   * every bench selection must say is said.
   */
  describe('a selection path cannot silently omit the shared statuses', () => {
    const SELECTS = /this\.worklist\s*\.\s*list\s*\(/;

    it('finds at least one production selection site, so the rule is not vacuous', () => {
      const selectors = SOURCE_FILES.filter((file) => SELECTS.test(code(file))).map(relative);
      expect(selectors.length).toBeGreaterThan(0);
    });

    it.each(SOURCE_FILES.map((file) => [relative(file), file] as const))(
      '%s applies BENCH_WORK_STATUSES wherever it selects work',
      (name, file) => {
        const source = code(file);
        if (!SELECTS.test(source)) return;
        expect(
          source.includes('BENCH_WORK_STATUSES')
            ? null
            : `${name} selects bench work from the worklist without applying ` +
                '`BENCH_WORK_STATUSES`. The list and the open path both scope on it, so a ' +
                'selection that omits it returns work neither of the other two would — a ' +
                'parcel this surface offers and the bench then refuses, which is story D2 ' +
                'exactly. Import it from `application/bench-work-eligibility.ts`.'
        ).toBeNull();
      }
    );
  });

  describe('the selection half is shared too', () => {
    it.each(SOURCE_FILES.map((file) => [relative(file), file] as const))(
      '%s does not restate the selected statuses',
      (name, file) => {
        if ((AUTHORIZED_PATHS as readonly string[]).includes(name)) return;
        const source = code(file);
        // The list SELECTS on these and the open path refuses on them. A status
        // added to one restatement and not the other is a parcel the list shows
        // and the bench refuses, or the reverse — which is D2's failure exactly.
        const restatesStatuses =
          source.includes("'in_progress'") && source.includes("'scheduled'");
        expect(
          restatesStatuses
            ? `${name} restates the bench's selected statuses. Import ` +
                '`BENCH_WORK_STATUSES` / `BENCH_WORK_REQUEST_STATUSES` from ' +
                '`application/bench-work-eligibility.ts`, which the list query and the open ' +
                "path's `isBenchWorkSelectable` both already read."
            : null
        ).toBeNull();
      }
    );
  });
});
