#!/usr/bin/env node
/**
 * check-types-sub-barrels
 *
 * Guards the `@openlinker/core/<ctx>/types` cycle-breaker sub-barrel family
 * (`orders/types` #2155, `invoicing/types` + `fiscalization/types` #2515).
 *
 * Why a guard is needed. These sub-barrels exist so a leaf concern that may not
 * depend on a sibling context can still NAME that context's vocabulary through
 * an erased `import type`. They are exported from `libs/core/package.json`, so
 * anything in the repo can import them - and neither
 * `check-cross-context-imports.mjs` (whose matcher fires on the BARE
 * `@openlinker/core/<ctx>` shape) nor the `.eslintrc.js` deep-import bans
 * (which list `domain/**`, `application/**`, `infrastructure/**`,
 * `orm-entities`, `*.tokens`) inspect them. Left unguarded, a later
 * `export type { InvoiceRepositoryPort }` added to one of these files would
 * hand every plugin and host app a repository port through a channel no
 * invariant looks at.
 *
 * The rule, and the reason it is the right one. A `<ctx>/types.ts` may only
 * re-export from `./domain/types/**`. That directory holds exactly the
 * vocabulary these seams exist to publish - statuses, unions, value shapes -
 * while every symbol shape the cross-context contract FORBIDS lives somewhere
 * else: repository ports in `domain/ports/`, ORM entities in
 * `infrastructure/persistence/entities/`, adapters in
 * `infrastructure/adapters/`, DTOs in `interfaces/`. So the narrow
 * source-side rule enforces the broad consumer-side contract without having
 * to enumerate symbol names.
 *
 * @see docs/engineering-standards.md#import-aliases
 * @see libs/core/src/__tests__/barrel-purity.spec.ts
 */
import {
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';

const CORE_SRC = 'libs/core/src';
const ALLOWED_RE_EXPORT_PREFIX = './domain/types/';

/**
 * Sub-barrels permitted to re-export a RUNTIME VALUE, and why.
 *
 * Bounding the re-export PATH is not by itself enough. `domain/types/**`
 * legitimately holds runtime functions under the pure-rule exception in
 * `docs/engineering-standards.md`, so a value export could otherwise be added
 * to a type-only seam and still pass. That matters because a value import is
 * the one thing that turns an erased edge back into a real `require()` - which
 * is exactly what these seams exist to avoid.
 *
 * The consumer side is already guarded (`barrel-purity.spec.ts` fails any
 * non-type-only cross-context import inside `sales-documents`), but only for
 * that one leaf. This list is the producer-side half, and it is an ALLOW list
 * so that adding a value export is a deliberate act with a written reason
 * rather than an accident.
 *
 * Keyed by `(file, symbol)`, NOT by file, following the same reasoning
 * `check-cross-context-imports.mjs` gives for its own per-symbol gate: a
 * file-level entry silences the rule for that file forever, so an allowed
 * seam could grow a second, unrelated value export in silence. The path rule
 * still bounds where such an export may point, but bounding the path is
 * exactly what the value rule exists to go beyond.
 */
const VALUE_EXPORT_ALLOWED = new Map([
  [
    'libs/core/src/orders/types.ts',
    new Map([
      [
        'PAYMENT_STATUS',
        '#2155 - InvoicingModule value-imports it, which is the cycle this seam was created to break.',
      ],
      ['PaymentStatusValues', '#2155 - the runtime array beside PAYMENT_STATUS, same consumer.'],
    ]),
  ],
]);

/** Strip block and line comments so prose about imports cannot masquerade as one. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '');
}

/**
 * Both spellings a `<ctx>/types` export can resolve to: the flat `types.ts`
 * every instance uses today, and the `types/index.ts` directory form, which
 * would carry the identical package-exports subpath and otherwise evade this
 * guard entirely.
 */
function findTypesSubBarrels(root = CORE_SRC) {
  if (!existsSync(root)) return [];
  const candidates = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    candidates.push(join(root, entry.name, 'types.ts'));
    candidates.push(join(root, entry.name, 'types', 'index.ts'));
  }
  return candidates.filter((file) => existsSync(file) && statSync(file).isFile());
}

/**
 * The symbols a file re-exports as RUNTIME VALUES, or an empty array when it
 * re-exports types only. Both the statement form (`export type { A } from
 * ...`) and the per-specifier form (`export { type A } from ...`) count as
 * type-only; a bare `export * from` is a value re-export, since a star cannot
 * be narrowed to types, and is reported under the symbol `*`.
 */
function valueReExportsOf(source) {
  const withoutComments = stripComments(source);
  const reExports = [...withoutComments.matchAll(/export\s+([\s\S]*?)from\s+['"][^'"]+['"]/g)];
  const symbols = [];
  for (const [, clause] of reExports) {
    const head = clause.trim();
    if (head.startsWith('type')) continue;
    if (head.startsWith('*')) {
      symbols.push('*');
      continue;
    }
    const names = head
      .replace(/^\{|\}$/g, '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    for (const name of names) {
      if (name.startsWith('type ')) continue;
      // `A as B` re-exports A under the name B; the allow list names what the
      // CONSUMER sees, so record the exported name.
      const parts = name.split(/\s+as\s+/);
      symbols.push((parts[1] ?? parts[0]).trim());
    }
  }
  return symbols;
}

function specifiersOf(source) {
  const withoutComments = stripComments(source);
  return [...withoutComments.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

function run() {
  const selfCheck = process.argv.includes('--self-check');

  if (selfCheck) {
    let failed = 0;
    let checked = 0;

    // The PATH rule: where a re-export may point. Note that case 2 is `ok`
    // here and still rejected by a real run - this set exercises the path
    // rule alone, and the value rule below is what refuses it.
    const pathCases = [
      { source: "export type { A } from './domain/types/a.types';", ok: true },
      { source: "export { A } from './domain/types/a.types';", ok: true },
      { source: "export type { A } from './domain/ports/a.port';", ok: false },
      { source: "export * from '../invoicing/domain/types/a.types';", ok: false },
      { source: "export type { A } from '@openlinker/core/orders';", ok: false },
      {
        // Prose naming a forbidden path must not be read as a re-export.
        source:
          "/** never from './domain/ports/x.port' */\nexport type { A } from './domain/types/a.types';",
        ok: true,
      },
    ];
    for (const [i, testCase] of pathCases.entries()) {
      const bad = specifiersOf(testCase.source).filter(
        (s) => !s.startsWith(ALLOWED_RE_EXPORT_PREFIX),
      );
      const ok = bad.length === 0;
      checked += 1;
      if (ok !== testCase.ok) {
        console.error(`  path case ${i} expected ok=${testCase.ok}, got ok=${ok}`);
        failed += 1;
      }
    }

    // The VALUE rule: which symbols cross as runtime values. A missing case
    // here is what would let an erased edge quietly become a real one.
    const valueCases = [
      { source: "export type { A } from './domain/types/a.types';", symbols: [] },
      { source: "export type { A, B } from './domain/types/a.types';", symbols: [] },
      { source: "export { type A, type B } from './domain/types/a.types';", symbols: [] },
      { source: "export { A } from './domain/types/a.types';", symbols: ['A'] },
      { source: "export { type A, B } from './domain/types/a.types';", symbols: ['B'] },
      { source: "export * from './domain/types/a.types';", symbols: ['*'] },
      { source: "export { A as B } from './domain/types/a.types';", symbols: ['B'] },
      {
        source: "export {\n  A,\n  type B,\n} from './domain/types/a.types';",
        symbols: ['A'],
      },
      {
        // A comment mentioning a value export is not one.
        source: "// export { A } from './domain/types/a.types'\nexport type { B } from './domain/types/b.types';",
        symbols: [],
      },
    ];
    for (const [i, testCase] of valueCases.entries()) {
      const actual = valueReExportsOf(testCase.source);
      checked += 1;
      if (JSON.stringify(actual) !== JSON.stringify(testCase.symbols)) {
        console.error(
          `  value case ${i} expected [${testCase.symbols}], got [${actual}]`,
        );
        failed += 1;
      }
    }

    // DISCOVERY: the directory form carries the same package-exports subpath,
    // so a walker that finds only the flat file leaves it ungoverned.
    //
    // Run against a TEMPORARY FIXTURE, not the real tree: no `types/index.ts`
    // exists in the repo today, so an assertion over the real tree would
    // iterate flat files only and could never fail - a self-check that cannot
    // fail is worse than none, because it reports coverage it does not have.
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'ol-types-sub-barrel-'));
    try {
      mkdirSync(join(fixtureRoot, 'flat'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'flat', 'types.ts'),
        "export type { A } from './domain/types/a.types';\n",
      );
      mkdirSync(join(fixtureRoot, 'nested', 'types'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'nested', 'types', 'index.ts'),
        "export type { B } from './domain/types/b.types';\n",
      );
      // A neighbouring index that is NOT a types sub-barrel must be ignored.
      mkdirSync(join(fixtureRoot, 'unrelated'), { recursive: true });
      writeFileSync(join(fixtureRoot, 'unrelated', 'index.ts'), 'export const x = 1;\n');

      const discovered = findTypesSubBarrels(fixtureRoot)
        .map((file) => file.split(sep).join('/'))
        .sort();
      checked += 1;
      const foundFlat = discovered.some((file) => file.endsWith('/flat/types.ts'));
      const foundNested = discovered.some((file) => file.endsWith('/nested/types/index.ts'));
      const foundUnrelated = discovered.some((file) => file.endsWith('/unrelated/index.ts'));
      if (!foundFlat || !foundNested || foundUnrelated || discovered.length !== 2) {
        console.error(
          `  discovery case: expected exactly the flat and nested sub-barrels, got [${discovered.join(', ')}]`,
        );
        failed += 1;
      }
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }

    if (failed > 0) {
      console.error(`✗ check-types-sub-barrels --self-check: ${failed} case(s) failed.`);
      process.exit(1);
    }
    console.log(`✓ check-types-sub-barrels --self-check: ${checked} case(s) passed.`);
    return;
  }

  const files = findTypesSubBarrels();
  const violations = [];

  const valueExports = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const specifier of specifiersOf(source)) {
      if (!specifier.startsWith(ALLOWED_RE_EXPORT_PREFIX)) {
        violations.push({ file, specifier });
      }
    }
    const normalized = file.split(sep).join('/');
    const allowedSymbols = VALUE_EXPORT_ALLOWED.get(normalized) ?? new Map();
    for (const symbol of valueReExportsOf(source)) {
      if (!allowedSymbols.has(symbol)) {
        valueExports.push({ file: normalized, symbol });
      }
    }
  }

  if (violations.length > 0) {
    console.error('✗ check-types-sub-barrels: a <ctx>/types.ts re-exported outside domain/types.');
    console.error(
      '  These sub-barrels publish vocabulary only. A repository port, ORM entity, adapter or',
    );
    console.error(
      '  DTO reached through one would bypass every cross-context guard in the repo.',
    );
    for (const violation of violations) {
      console.error(`  ${violation.file}: re-exports from '${violation.specifier}'`);
    }
    process.exit(1);
  }

  if (valueExports.length > 0) {
    console.error('✗ check-types-sub-barrels: a type-only <ctx>/types sub-barrel re-exported a value.');
    console.error(
      '  A value import emits a require() and turns the erased edge these seams exist for back',
    );
    console.error(
      '  into a real one. Either export the symbol as a type, or add the (file, symbol) pair',
    );
    console.error('  to VALUE_EXPORT_ALLOWED in this script with the reason.');
    for (const violation of valueExports) {
      console.error(`  ${violation.file}: re-exports the value '${violation.symbol}'`);
    }
    process.exit(1);
  }

  const approvedSymbolCount = [...VALUE_EXPORT_ALLOWED.values()].reduce(
    (total, symbols) => total + symbols.size,
    0,
  );
  console.log(
    `✓ check-types-sub-barrels: ${files.length} <ctx>/types sub-barrel(s) checked. All re-export vocabulary only, with ${approvedSymbolCount} approved value export(s) across ${VALUE_EXPORT_ALLOWED.size} file(s).`,
  );
}

run();
