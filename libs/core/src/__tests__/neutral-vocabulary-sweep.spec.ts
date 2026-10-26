/**
 * Neutral-vocabulary sweep mechanics - the guard's own guard (#3183)
 *
 * `neutral-vocabulary-sweep.ts` is the subtlest thing the three sweeps depend
 * on: a three-pass matcher whose behaviour turns entirely on lookbehind and
 * lookahead interactions. Until this spec, NOTHING pinned it. Delete the
 * LEADING pass and all three sweeps still report green - not because the guard
 * still works, but because no forbidden term currently happens to appear in a
 * shape only that pass could see. That is the same hole this PR already shipped
 * once and fixed in `7977ecb8`, and it would come back silently.
 *
 * WRITTEN TO `docs/testing-guide.md` § Port-contract suites, whose standard is
 * exactly this class of machinery - "a contract suite is exactly the machinery
 * that can look thorough and assert nothing". Applied here that means ONE
 * DELIBERATE BREAKAGE FIXTURE PER DECLARED RULE: every rule below is asserted
 * through at least one input that changes its answer when that rule alone is
 * removed. Where a case is visible to more than one pass, the assertion is on
 * WHICH pass answered (`matchForbiddenTerm`), never on the sweeps' boolean -
 * a boolean cannot tell a live pass from a deleted one, and asserting `true`
 * over a case two passes catch pins neither.
 *
 * WHY THIS FILE MAY SPELL THE FORBIDDEN TERMS OUT. Every case below is a
 * literal `ksef` / `nip` / `vat` / `paragon` / `eparagony` / `printer`, which
 * is precisely what the three sweeps ban. It is not an offender because it
 * lives in `libs/core/src/__tests__`, a SIBLING of every swept context root
 * (each sweep passes `join(__dirname, '..')`, i.e. `libs/core/src/<ctx>`), so
 * no context's recursive walk can reach it. That is asserted below rather than
 * assumed, so moving this file into a context fails here instead of failing
 * three unrelated suites with a confusing message.
 *
 * WHAT IS NOT COVERED, stated so nobody over-trusts this (the
 * `check-ui-vocabulary.mjs` transparency convention):
 *   - `collectSweepFiles`'s `.int-spec.ts` exclusion. `libs/core/src` carries
 *     no integration spec at all, so the branch cannot be exercised against the
 *     real tree, and this spec writes no files to disk (the reason is in
 *     `barrel-purity.spec.ts`: a fixture-based walk assertion has to mutate real
 *     source and restore it, which fails dirty).
 *   - Name-scoped vs path-scoped exclusion is observed from the ONE direction
 *     the real tree offers - see the `__tests__`-as-root case below.
 *
 * @module libs/core/src/__tests__
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  collectSweepFiles,
  containsForbiddenTerm,
  matchForbiddenTerm,
  readSweepSource,
  stripCommentsAndStringLiterals,
} from './neutral-vocabulary-sweep';
import type { ForbiddenTermMatch } from './neutral-vocabulary-sweep';

/** Every case the matcher rules below are declared over. */
interface MatcherCase {
  readonly text: string;
  readonly term: string;
  readonly expected: ForbiddenTermMatch | null;
  readonly why: string;
}

/**
 * Visible to the BOUNDARY pass.
 *
 * The first entry is the breakage fixture for the pass AND for its
 * case-insensitivity in one: `KSeF` is the regime's own mixed-case branding, so
 * neither of the case-SENSITIVE passes can see it (they alternate over exactly
 * `ksef` / `Ksef` / `KSEF`). Drop the pass, or only its `i` flag, and this case
 * answers `null`.
 *
 * The rest are visible to pass 2 as well; they are asserted as `'boundary'`
 * because that pass runs first, which is itself the property - deleting pass 1
 * turns every one of them into `'leading'`.
 */
const BOUNDARY_CASES: readonly MatcherCase[] = [
  {
    text: '// KSeF clearance is relayed by the provider',
    term: 'ksef',
    expected: 'boundary',
    why: 'mixed-case prose - ONLY pass 1 (case-insensitive) can see it',
  },
  {
    text: "const id = 'conn-eparagony';",
    term: 'eparagony',
    expected: 'boundary',
    why: 'kebab-case id - the hyphen is a boundary on both sides',
  },
  {
    text: 'const KSEF_BASE_URL = process.env.X;',
    term: 'ksef',
    expected: 'boundary',
    why: 'SCREAMING_SNAKE - the underscore is a boundary',
  },
  {
    text: 'the nip is carried verbatim',
    term: 'nip',
    expected: 'boundary',
    why: 'standalone lowercase word in prose',
  },
];

/**
 * Visible to the LEADING pass ONLY - the term opening an identifier, closed by
 * the next segment's capital. All four are the shape
 * `docs/frontend-architecture.md` recommends for connection-config fields, i.e.
 * the most likely real violation, and all four answer `null` the moment pass 2
 * is removed: pass 1's `(?![a-zA-Z])` is blocked by the next segment's capital,
 * and pass 3's `(?<=[a-z])` has nothing before an identifier's first character.
 */
const LEADING_CASES: readonly MatcherCase[] = [
  { text: 'ksefEnvironment', term: 'ksef', expected: 'leading', why: 'lowercase camel head' },
  { text: 'nipValue', term: 'nip', expected: 'leading', why: 'lowercase camel head' },
  { text: 'VatRateResolver', term: 'vat', expected: 'leading', why: 'PascalCase head' },
  { text: 'paragonMode', term: 'paragon', expected: 'leading', why: 'lowercase camel head' },
];

/**
 * Visible to the HUMP pass ONLY - the term as a capitalized or all-caps segment
 * INSIDE a longer identifier. Passes 1 and 2 are both blocked by the preceding
 * lowercase letter, so each of these answers `null` if pass 3 is removed.
 */
const HUMP_CASES: readonly MatcherCase[] = [
  { text: 'buyerHasNip', term: 'nip', expected: 'hump', why: 'trailing capitalized hump' },
  { text: 'sellerNIP', term: 'nip', expected: 'hump', why: 'trailing all-caps hump' },
  { text: 'orderVatAmount', term: 'vat', expected: 'hump', why: 'interior capitalized hump' },
];

/**
 * Must stay invisible. These are the ordinary-English collisions that make a
 * plain `.includes()` unusable for `sales-documents` / `invoicing` (the
 * matcher's own docblock names them), plus two shapes that pin a specific
 * lookaround rather than a word:
 *
 *   - `nipple` pins pass 2's `(?![a-z])`. Drop that lookahead and a term
 *     opening an ordinary English word starts failing the build.
 *   - `turnip` pins pass 3's case-SENSITIVITY. Make it case-insensitive and
 *     `(?<=[a-z])nip(?![a-z])` matches here - the exact over-match the
 *     docblock's "a lowercase run is ordinary English" rule exists to prevent.
 *
 * The all-caps and PascalCase entries pin that the `ALLCAPS` / `Titled`
 * alternations do not leak into SCREAMING_CASE or PascalCase English.
 */
const NEGATIVE_CASES: readonly MatcherCase[] = [
  { text: 'private readonly repository: X;', term: 'vat', expected: null, why: 'pri-vat-e' },
  { text: 'activate', term: 'vat', expected: null, why: 'acti-vat-e' },
  { text: 'derivation', term: 'vat', expected: null, why: 'deri-vat-ion' },
  { text: 'innovation', term: 'vat', expected: null, why: 'inno-vat-ion' },
  { text: 'manipulate', term: 'nip', expected: null, why: 'ma-nip-ulate' },
  { text: 'principal', term: 'nip', expected: null, why: 'named in the matcher docblock' },
  { text: 'nipple', term: 'nip', expected: null, why: "pins pass 2's (?![a-z]) lookahead" },
  { text: 'turnip', term: 'nip', expected: null, why: 'pins pass 3 staying case-sensitive' },
  {
    text: 'PRIVATE_ACTIVATE_DERIVATION',
    term: 'vat',
    expected: null,
    why: 'SCREAMING_CASE English',
  },
  { text: 'Private', term: 'vat', expected: null, why: 'PascalCase English' },
  { text: 'ActivateHandler', term: 'vat', expected: null, why: 'PascalCase English' },
];

/**
 * The residual difference from `fiscalization`'s `.includes()`, recorded in the
 * matcher's own docblock: a term followed immediately by a LOWERCASE letter is
 * invisible here. Pinned deliberately - closing it would change the two
 * matchers' relative strength, which that docblock calls an owner decision
 * rather than a refactor, so it must not happen by accident.
 */
const DOCUMENTED_RESIDUAL_CASES: readonly MatcherCase[] = [
  { text: 'two printers are wired', term: 'printer', expected: null, why: 'plural in prose' },
];

const ALL_CASES: readonly MatcherCase[] = [
  ...BOUNDARY_CASES,
  ...LEADING_CASES,
  ...HUMP_CASES,
  ...NEGATIVE_CASES,
  ...DOCUMENTED_RESIDUAL_CASES,
];

const CORE_SRC = join(__dirname, '..');
/** A real context root, with nested directories, specs, and its own sweep spec. */
const SAMPLE_CONTEXT = join(CORE_SRC, 'fiscalization');
/** Every context that actually runs a sweep - i.e. everything this file must stay outside of. */
const SWEPT_CONTEXTS = ['fiscalization', 'invoicing', 'sales-documents'] as const;

describe('matchForbiddenTerm - the three passes, pinned separately', () => {
  it.each(BOUNDARY_CASES)(
    'pass 1 BOUNDARY sees $text as "$term" - $why',
    ({ text, term, expected }) => {
      expect([text, matchForbiddenTerm(text, term)]).toEqual([text, expected]);
    },
  );

  it.each(LEADING_CASES)(
    'pass 2 LEADING sees $text as "$term" - $why',
    ({ text, term, expected }) => {
      expect([text, matchForbiddenTerm(text, term)]).toEqual([text, expected]);
    },
  );

  it.each(HUMP_CASES)('pass 3 HUMP sees $text as "$term" - $why', ({ text, term, expected }) => {
    expect([text, matchForbiddenTerm(text, term)]).toEqual([text, expected]);
  });

  it.each(NEGATIVE_CASES)('never flags ordinary English: $text ($why)', ({ text, term }) => {
    expect([text, matchForbiddenTerm(text, term)]).toEqual([text, null]);
  });

  it.each(DOCUMENTED_RESIDUAL_CASES)(
    'leaves the documented residual unmatched: $text ($why)',
    ({ text, term }) => {
      expect([text, matchForbiddenTerm(text, term)]).toEqual([text, null]);
    },
  );

  /**
   * Anti-vacuity, in the shape `docs/testing-guide.md` requires of a contract
   * suite: assert declared === covered, failing on EITHER side. Without it a
   * rule's whole fixture list could be dropped and the remaining `it.each`
   * blocks would report a green run over an unasked question.
   */
  it('declares a fixture for every pass, and every fixture belongs to a declared pass', () => {
    const declared: readonly (ForbiddenTermMatch | null)[] = ['boundary', 'leading', 'hump', null];
    const covered = [...new Set(ALL_CASES.map((c) => c.expected))];
    expect(covered.sort()).toEqual([...declared].sort());

    // …and every pass needs at least one fixture of its own. A non-empty list
    // is sufficient BECAUSE the assertions above are on the ANSWERING pass and
    // the passes short-circuit in order: a deleted pass can never be the answer,
    // so any case asserted `'leading'` fails whether deletion turns it into
    // `'hump'` or `null`. That is what makes each list a breakage fixture even
    // where a case is visible to more than one pass - which is also why the
    // boolean is not asserted here (it would survive all three deletions
    // wherever a second pass still matched).
    expect([
      ['boundary', BOUNDARY_CASES.length > 0],
      ['leading', LEADING_CASES.length > 0],
      ['hump', HUMP_CASES.length > 0],
    ]).toEqual([
      ['boundary', true],
      ['leading', true],
      ['hump', true],
    ]);
  });

  /**
   * The three sweeps consume the BOOLEAN, not the discriminant, so the two must
   * not be able to drift: a boundary-only refactor of `containsForbiddenTerm`
   * would otherwise leave every assertion above true and every sweep wrong.
   */
  it('containsForbiddenTerm is exactly "some pass matched"', () => {
    for (const { text, term, expected } of ALL_CASES) {
      expect([text, containsForbiddenTerm(text, term)]).toEqual([text, expected !== null]);
    }
  });
});

describe('stripCommentsAndStringLiterals', () => {
  it.each([
    [
      'line comment is removed, newline kept',
      'const a = 1; // ksef\nconst b = 2;',
      'const a = 1; \nconst b = 2;',
    ],
    ['block comment collapses to ONE space, so boundaries survive', 'a/*ksef*/b', 'a b'],
    ['single-quoted literal collapses to one space', "const t = 'ksef';", 'const t =  ;'],
    ['double-quoted literal collapses to one space', 'const t = "ksef";', 'const t =  ;'],
    ['template literal collapses to one space', 'const t = `ksef ${x}`;', 'const t =  ;'],
    [
      'an escaped quote does not end the literal early',
      "const t = 'it\\'s ksef'; const u = 1;",
      'const t =  ; const u = 1;',
    ],
    [
      'an unterminated literal consumes to EOF rather than hanging',
      "const t = 'ksef",
      'const t =  ',
    ],
    ['an unterminated block comment consumes to EOF', 'code /* ksef', 'code  '],
    ['code is copied verbatim', 'const ksefEnvironment = 1;', 'const ksefEnvironment = 1;'],
  ])('%s', (_label, source, expected) => {
    expect(stripCommentsAndStringLiterals(source)).toBe(expected);
  });

  /**
   * The stripper's stated failure direction: a regex literal reads as code, so
   * a term inside one is still visible. Over-flagging is the safe half of a
   * textual scanner, and a "fix" that started treating `/…/` as a literal would
   * quietly open a hole in the contract-surface sweep.
   */
  it('leaves a regex literal as code (over-flags rather than under-flags)', () => {
    const stripped = stripCommentsAndStringLiterals('const r = /ksef/.test(x);');
    expect([stripped, containsForbiddenTerm(stripped, 'ksef')]).toEqual([
      'const r = /ksef/.test(x);',
      true,
    ]);
  });
});

describe('readSweepSource', () => {
  /**
   * Pinned against the real `invoicing` tree rather than a fixture, and
   * non-vacuously: the assertion is that stripping actually REMOVES matches
   * that raw source carries. `invoicing` is the one context that strips, and it
   * does so precisely because ~25 of its files name a clearance regime in
   * sanctioned prose - so an inverted flag would not merely be untested, it
   * would fail that sweep on documentation its own ADR permits.
   */
  it('strips only when asked, and the difference is real in the tree that relies on it', () => {
    const files = collectSweepFiles(join(CORE_SRC, 'invoicing'), { includeTests: false });
    const terms = ['nip', 'ksef', 'vat', 'jpk', 'faktura'] as const;

    const proseOnly = files.filter((file) => {
      const raw = readSweepSource(file, { stripNonCode: false });
      const stripped = readSweepSource(file, { stripNonCode: true });
      return terms.some(
        (term) => containsForbiddenTerm(raw, term) && !containsForbiddenTerm(stripped, term),
      );
    });

    expect(proseOnly.length).toBeGreaterThan(0);
  });

  it('returns the file verbatim when stripNonCode is false', () => {
    const [file] = collectSweepFiles(SAMPLE_CONTEXT, { includeTests: false });
    expect(readSweepSource(file, { stripNonCode: false })).toBe(readFileSync(file, 'utf8'));
  });
});

describe('collectSweepFiles', () => {
  /**
   * An independent reference walk. Deliberately NOT a second copy of the
   * matcher - it is a plain recursive `.ts` listing with no exclusions at all,
   * so comparing against it states the collector's whole contract (recurse,
   * `.ts` only, drop specs when asked, drop this context's own sweep spec) as
   * one exact equality rather than a handful of spot checks.
   */
  const listEveryTsFile = (dir: string): string[] => {
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) found.push(...listEveryTsFile(full));
      else if (entry.endsWith('.ts')) found.push(full);
    }
    return found;
  };

  const ownSweepSpec = join(SAMPLE_CONTEXT, '__tests__', 'neutral-vocabulary.spec.ts');

  it('the sample context really carries the files these assertions are about', () => {
    // Without this the exclusion assertions below would pass vacuously the day
    // the sample context is renamed or its sweep spec moves.
    const everyTsFile = listEveryTsFile(SAMPLE_CONTEXT);
    expect([
      existsSync(ownSweepSpec),
      everyTsFile.length > 0,
      everyTsFile.some((f) => f.endsWith('.spec.ts') && f !== ownSweepSpec),
      everyTsFile.some((f) => relative(SAMPLE_CONTEXT, f).split(sep).length >= 3),
    ]).toEqual([true, true, true, true]);
  });

  it('with includeTests, collects every .ts file except this context\'s own sweep spec', () => {
    const expected = listEveryTsFile(SAMPLE_CONTEXT)
      .filter((file) => file !== ownSweepSpec)
      .sort();
    expect(collectSweepFiles(SAMPLE_CONTEXT, { includeTests: true }).sort()).toEqual(expected);
  });

  it('without includeTests, additionally drops every *.spec.ts', () => {
    const expected = listEveryTsFile(SAMPLE_CONTEXT)
      .filter((file) => file !== ownSweepSpec && !file.endsWith('.spec.ts'))
      .sort();
    const collected = collectSweepFiles(SAMPLE_CONTEXT, { includeTests: false }).sort();
    expect(collected).toEqual(expected);
    // The exclusion must be doing work, not describing an empty set.
    expect(collected.length).toBeLessThan(
      collectSweepFiles(SAMPLE_CONTEXT, { includeTests: true }).length,
    );
  });

  /**
   * The sweep-spec exclusion is scoped to `<contextRoot>/__tests__/…`, not to a
   * bare filename. Observed without writing anything to disk, by handing the
   * collector a DIFFERENT root: rooted at the `__tests__` directory itself, the
   * exempt path resolves to `__tests__/__tests__/neutral-vocabulary.spec.ts`,
   * which does not exist - so the file is collected. A bare-filename rule would
   * skip it here too and return an empty list. This is the one direction the
   * real tree can show; the mirror case (a same-named file elsewhere under a
   * context) has no instance on disk and this spec does not create one.
   */
  it('exempts the context\'s OWN sweep spec by path, not any file of that name', () => {
    const rootedAtTestsDir = collectSweepFiles(join(SAMPLE_CONTEXT, '__tests__'), {
      includeTests: true,
    });
    expect(rootedAtTestsDir).toEqual([ownSweepSpec]);
  });
});

describe('this spec file is outside every swept context', () => {
  /**
   * The cases above are literal forbidden terms. They are legal here only
   * because no sweep's recursive walk can reach this directory - so that is
   * asserted, not assumed. Moving this file under a context must fail HERE,
   * with this sentence, rather than as three unrelated sweeps reporting a dozen
   * offenders each.
   */
  it.each(SWEPT_CONTEXTS)('%s cannot reach it', (context) => {
    const contextRoot = join(CORE_SRC, context);
    expect([context, relative(contextRoot, __filename).startsWith('..')]).toEqual([context, true]);
    expect(collectSweepFiles(contextRoot, { includeTests: true })).not.toContain(__filename);
  });
});
