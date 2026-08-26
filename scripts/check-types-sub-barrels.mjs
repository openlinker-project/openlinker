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
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

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
 */
const VALUE_EXPORT_ALLOWED = new Map([
  [
    'libs/core/src/orders/types.ts',
    'PAYMENT_STATUS / PaymentStatusValues (#2155) - InvoicingModule value-imports them, which is the cycle this seam was created to break.',
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
function findTypesSubBarrels() {
  if (!existsSync(CORE_SRC)) return [];
  const candidates = [];
  for (const entry of readdirSync(CORE_SRC, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    candidates.push(join(CORE_SRC, entry.name, 'types.ts'));
    candidates.push(join(CORE_SRC, entry.name, 'types', 'index.ts'));
  }
  return candidates.filter((file) => existsSync(file) && statSync(file).isFile());
}

/**
 * True when the file carries a re-export that is NOT type-only. Both the
 * statement form (`export type { A } from ...`) and the per-specifier form
 * (`export { type A } from ...`) count as type-only; a bare `export * from`
 * is a value re-export, since a star cannot be narrowed to types.
 */
function hasValueReExport(source) {
  const withoutComments = stripComments(source);
  const reExports = [...withoutComments.matchAll(/export\s+([\s\S]*?)from\s+['"][^'"]+['"]/g)];
  return reExports.some(([, clause]) => {
    const head = clause.trim();
    if (head.startsWith('type')) return false;
    if (head.startsWith('*')) return true;
    const names = head.replace(/^\{|\}$/g, '').split(',').map((n) => n.trim()).filter(Boolean);
    return names.some((name) => !name.startsWith('type '));
  });
}

function specifiersOf(source) {
  const withoutComments = stripComments(source);
  return [...withoutComments.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

function run() {
  const selfCheck = process.argv.includes('--self-check');

  if (selfCheck) {
    const cases = [
      { source: "export type { A } from './domain/types/a.types';", ok: true },
      { source: "export { A } from './domain/types/a.types';", ok: true },
      { source: "export type { A } from './domain/ports/a.port';", ok: false },
      { source: "export * from '../invoicing/domain/types/a.types';", ok: false },
      { source: "export type { A } from '@openlinker/core/orders';", ok: false },
      {
        // Prose naming a forbidden path must not be read as a re-export.
        source: "/** never from './domain/ports/x.port' */\nexport type { A } from './domain/types/a.types';",
        ok: true,
      },
    ];
    let failed = 0;
    for (const [i, testCase] of cases.entries()) {
      const bad = specifiersOf(testCase.source).filter(
        (s) => !s.startsWith(ALLOWED_RE_EXPORT_PREFIX),
      );
      const ok = bad.length === 0;
      if (ok !== testCase.ok) {
        console.error(`  case ${i} expected ok=${testCase.ok}, got ok=${ok}`);
        failed += 1;
      }
    }
    if (failed > 0) {
      console.error(`✗ check-types-sub-barrels --self-check: ${failed} case(s) failed.`);
      process.exit(1);
    }
    console.log(`✓ check-types-sub-barrels --self-check: ${cases.length} case(s) passed.`);
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
    if (!VALUE_EXPORT_ALLOWED.has(normalized) && hasValueReExport(source)) {
      valueExports.push(normalized);
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
      '  into a real one. Either export the symbol as a type, or add the file to',
    );
    console.error('  VALUE_EXPORT_ALLOWED in this script with the reason.');
    for (const file of valueExports) {
      console.error(`  ${file}`);
    }
    process.exit(1);
  }

  console.log(
    `✓ check-types-sub-barrels: ${files.length} <ctx>/types sub-barrel(s) checked. All re-export vocabulary only, and only ${VALUE_EXPORT_ALLOWED.size} carries an approved value export.`,
  );
}

run();
