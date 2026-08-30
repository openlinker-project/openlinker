#!/usr/bin/env node
/**
 * No-Injection Contract Invariant (#2390, ADR-053)
 *
 * ADR-053 places the six fulfilment-authority resolutions in the context that
 * owns each write, and epic #2412 makes one of those placements a hard
 * boundary rule:
 *
 *   > the `fulfillment` context injects **no** `orders` / `inventory` service.
 *   > Order data enters as arguments; type needs go through
 *   > `@openlinker/core/orders/types`.
 *
 * This script enforces that rule as a **prohibition**, which is why it is
 * useful before it has a single live subject. Its claim — "if a watched
 * context exists, it is registered with a non-empty forbidden list, and it
 * imports nothing on that list" — is true today, fails closed, and arms
 * itself the moment #2391 (`W3a-2`) creates `libs/core/src/fulfillment/`.
 * A guard added *after* the context exists is a guard someone has to
 * remember to add.
 *
 * ## READ THIS IF YOU ARE CREATING `libs/core/src/fulfillment/` (#2391)
 *
 * This script fails your build until you add a contract for it. That is
 * intentional, and the fix is NOT to delete the watch or to register an empty
 * list — R2 below refuses that explicitly. Add an entry to
 * `NO_INJECTION_CONTRACTS` with a NON-EMPTY `forbidden` list, naming the
 * barrels the context may not import:
 *
 *     {
 *       dir: 'libs/core/src/fulfillment',
 *       forbidden: ['@openlinker/core/orders', '@openlinker/core/inventory'],
 *       reason: 'ADR-053 / epic #2412: order data enters as arguments.',
 *     }
 *
 * Why those two, and why the rule exists at all: ADR-053 places each
 * fulfilment-authority resolution in the context that owns its write, and
 * epic #2412 makes this particular placement a hard boundary — the
 * `fulfillment` context injects NO `orders` / `inventory` service. Type needs
 * go through `@openlinker/core/orders/types`, which is a different specifier
 * and therefore allowed automatically (R3 matches exact specifiers). Pair this
 * with the boot integration test #2391 owns; see "What this guard cannot see".
 *
 * Three rules, all total — there is deliberately no state that reads as a
 * pass while meaning "pending":
 *
 *   R1  A directory in WATCHED_CONTEXTS that EXISTS on disk must have an
 *       entry in NO_INJECTION_CONTRACTS. An unregistered one fails.
 *   R2  Every contract entry must declare a NON-EMPTY `forbidden` list.
 *       This exists because the cheapest way to make R1 green is to
 *       register `forbidden: []` — registered, asserting nothing, which is
 *       precisely the shape this guard exists to prevent.
 *   R3  Within a registered directory that exists, no file may import from
 *       a forbidden specifier. Matching is on the EXACT specifier, so
 *       `@openlinker/core/orders/types` is permitted automatically — that
 *       is the escape hatch ADR-053 itself names.
 *
 * ## What this guard cannot see, and what covers the rest
 *
 * It is a source-text scan, so it cannot see runtime resolution:
 * `ModuleRef.get(TOKEN, { strict: false })` acquires a service with no
 * import statement at all, and that idiom is already established in this
 * codebase — `InvoiceService` uses exactly it to avoid a module cycle
 * (see docs/architecture-overview.md § Cross-context dependencies in core).
 * This guard is therefore the **necessary but insufficient** half. The
 * complement is the boot integration test #2391 ships against the real Nest
 * container, which observes the resolved provider graph rather than the
 * import text. Neither alone is sufficient; do not treat a green run here as
 * proof the invariant holds.
 *
 * It also shells out to no `git` binary, so the #1020 self-hosted-runner
 * caveat that several neighbouring invariant scripts carry does not apply
 * here. That is stated because the silence would otherwise read as an
 * oversight.
 *
 * ## Why `libs/oms` is NOT a subject
 *
 * Tempting, and wrong. ADR-053 constrains a **core context**. `libs/oms` is
 * a plugin that ADR-055 explicitly designs to *receive* those very services:
 * "Core services reach the plugin via factory deps
 * (`createOmsPlugin({inventoryQuery, orderRecords, products, shipping,
 * mappingConfig})` — all `I*Service`)." Registering `libs/oms` here would
 * forbid what the design of record mandates, and #2405 would have to delete
 * the contract in its first commit.
 *
 * Run with `--self-check` to exercise the validator against inline fixtures.
 *
 * @module scripts
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const ADR_REF = 'docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md';
const EPIC_REF = 'epic #2412 (Wave 3a) § Boundary rule';

/**
 * Repo-root-relative directories that MUST carry a no-injection contract the
 * moment they exist. Absence is not a pass and not a skip — it is simply the
 * antecedent of R1 being false, which is a fact about the tree, not a
 * suppressed check.
 *
 * `libs/core/src/fulfillment` is watched from #2390 and does not exist yet.
 * **#2391 creates it and owes this file a contract entry** (see the header
 * block for the exact shape). Removing the watch instead of registering the
 * contract silently retires the ADR-053 boundary rule.
 */
const WATCHED_CONTEXTS = ['libs/core/src/fulfillment'];

/**
 * The contracts themselves. EMPTY TODAY, on purpose: the only watched
 * context does not exist yet (#2391 creates it), and no other directory in
 * the tree carries this rule.
 *
 * **Do not "fix" the emptiness by registering `libs/oms`.** That is the
 * tempting and wrong move, and it inverts the design: ADR-053 constrains a
 * CORE CONTEXT, whereas ADR-055 designs the `libs/oms` plugin to *receive*
 * exactly those services as factory deps —
 * `createOmsPlugin({inventoryQuery, orderRecords, products, shipping,
 * mappingConfig})`, all `I*Service`. A contract here would forbid what the
 * design of record mandates, and #2405 would have to delete it in its first
 * commit. An empty list is the correct state until #2391 lands.
 *
 * Shape: `{ dir, forbidden: string[], reason }` — `forbidden` holds EXACT
 * module specifiers, so a subpath such as `@openlinker/core/orders/types` is
 * a different specifier and remains allowed.
 *
 * @type {ReadonlyArray<{dir: string, forbidden: readonly string[], reason: string}>}
 */
const NO_INJECTION_CONTRACTS = [];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);

const IMPORT_RE =
  /(?:^|\n)\s*(?:import\b[\s\S]*?from\s*|import\s*|export\b[\s\S]*?from\s*)['"]([^'"]+)['"]/g;
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
// Dynamic `import('…')` is a CALL, not a statement, so the statement matcher
// above cannot see it — and it is the most natural way to reach a forbidden
// barrel without writing a top-level import. Covered for the same reason
// `require()` is; `ModuleRef.get()` remains out of reach of any text scan.
const IMPORT_CALL_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Pure validator for R1 + R2. Kept side-effect-free so `--self-check` can
 * drive it with inline fixtures rather than touching the filesystem.
 *
 * @param {{watched: readonly string[], contracts: ReadonlyArray<{dir: string, forbidden: readonly string[]}>, existing: readonly string[]}} input
 * @returns {string[]} violation messages (empty ⇒ ok)
 */
export function validateContractRegistrations({ watched, contracts, existing }) {
  const errors = [];
  const byDir = new Map(contracts.map((c) => [c.dir, c]));

  // R1 — a watched context that exists must be registered.
  for (const dir of watched) {
    if (!existing.includes(dir)) continue;
    if (!byDir.has(dir)) {
      errors.push(
        `${dir} exists but has no entry in NO_INJECTION_CONTRACTS ` +
          `(scripts/check-no-injection-contracts.mjs). ${ADR_REF} and ${EPIC_REF} require ` +
          `this context to inject no orders/inventory service — register it with the ` +
          `specifiers it may not import. Do NOT register an empty list to get green.`,
      );
    }
  }

  // R2 — a registered contract must actually forbid something.
  for (const contract of contracts) {
    if (!Array.isArray(contract.forbidden) || contract.forbidden.length === 0) {
      errors.push(
        `${contract.dir} is registered in NO_INJECTION_CONTRACTS with an empty "forbidden" ` +
          `list, which asserts nothing. ${ADR_REF} and ${EPIC_REF} require a real contract — ` +
          `list the module specifiers this context may not import (order data enters as ` +
          `arguments; type needs go through '@openlinker/core/orders/types').`,
      );
    }
  }

  return errors;
}

/**
 * Pure validator for R3. Exact-specifier match by design.
 *
 * @param {{dir: string, file: string, source: string, forbidden: readonly string[]}} input
 * @returns {string[]} violation messages (empty ⇒ ok)
 */
export function validateFileImports({ file, source, forbidden }) {
  const found = new Set();
  for (const re of [IMPORT_RE, REQUIRE_RE, IMPORT_CALL_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) found.add(m[1]);
  }
  return [...found]
    .filter((spec) => forbidden.includes(spec))
    .map(
      (spec) =>
        `${file}: imports '${spec}', which this context's no-injection contract forbids. ` +
        `Order data enters as arguments; type needs go through '@openlinker/core/orders/types'. ` +
        `See ${ADR_REF}.`,
    );
}

async function isDirectory(abs) {
  try {
    return (await stat(abs)).isDirectory();
  } catch {
    return false;
  }
}

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await walk(join(dir, entry.name))));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

async function main() {
  const existing = [];
  for (const dir of WATCHED_CONTEXTS) {
    if (await isDirectory(join(REPO_ROOT, ...dir.split('/')))) existing.push(dir);
  }

  const errors = validateContractRegistrations({
    watched: WATCHED_CONTEXTS,
    contracts: NO_INJECTION_CONTRACTS,
    existing,
  });

  let filesScanned = 0;
  for (const contract of NO_INJECTION_CONTRACTS) {
    const abs = join(REPO_ROOT, ...contract.dir.split('/'));
    if (!(await isDirectory(abs))) continue;
    for (const file of await walk(abs)) {
      filesScanned += 1;
      const source = await readFile(file, 'utf8');
      errors.push(
        ...validateFileImports({
          dir: contract.dir,
          file: relative(REPO_ROOT, file).split(sep).join('/'),
          source,
          forbidden: contract.forbidden,
        }),
      );
    }
  }

  if (errors.length > 0) {
    for (const msg of errors) {
      process.stderr.write(`check-no-injection-contracts: ${msg}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `check-no-injection-contracts: OK (${NO_INJECTION_CONTRACTS.length} contract(s), ` +
      `${filesScanned} file(s) scanned, ${WATCHED_CONTEXTS.length} watched context(s), ` +
      `${existing.length} present)\n`,
  );
}

function selfCheck() {
  const cases = [
    {
      name: 'R1: a watched context that does not exist yet is not a violation',
      run: () =>
        validateContractRegistrations({
          watched: ['libs/core/src/fulfillment'],
          contracts: [],
          existing: [],
        }).length === 0,
    },
    {
      name: 'R1: a watched context that EXISTS but is unregistered fails',
      run: () => {
        const e = validateContractRegistrations({
          watched: ['libs/core/src/fulfillment'],
          contracts: [],
          existing: ['libs/core/src/fulfillment'],
        });
        return e.length === 1 && e[0].includes('no entry in NO_INJECTION_CONTRACTS');
      },
    },
    {
      name: 'R2: a contract registered with an empty forbidden list fails',
      run: () => {
        const e = validateContractRegistrations({
          watched: ['libs/core/src/fulfillment'],
          contracts: [{ dir: 'libs/core/src/fulfillment', forbidden: [] }],
          existing: ['libs/core/src/fulfillment'],
        });
        return e.length === 1 && e[0].includes('empty "forbidden" list');
      },
    },
    {
      name: 'R1+R2: a properly registered existing context passes',
      run: () =>
        validateContractRegistrations({
          watched: ['libs/core/src/fulfillment'],
          contracts: [
            { dir: 'libs/core/src/fulfillment', forbidden: ['@openlinker/core/orders'] },
          ],
          existing: ['libs/core/src/fulfillment'],
        }).length === 0,
    },
    {
      name: 'R3: a forbidden barrel import is reported',
      run: () => {
        const e = validateFileImports({
          file: 'libs/core/src/fulfillment/x.ts',
          source: "import { ORDER_RECORD_SERVICE_TOKEN } from '@openlinker/core/orders';",
          forbidden: ['@openlinker/core/orders'],
        });
        return e.length === 1 && e[0].includes("imports '@openlinker/core/orders'");
      },
    },
    {
      name: 'R3: the ADR-sanctioned /types subpath is NOT a violation',
      run: () =>
        validateFileImports({
          file: 'libs/core/src/fulfillment/x.ts',
          source: "import type { Order } from '@openlinker/core/orders/types';",
          forbidden: ['@openlinker/core/orders'],
        }).length === 0,
    },
    {
      name: 'R3: a forbidden dynamic import() is reported',
      run: () =>
        validateFileImports({
          file: 'libs/core/src/fulfillment/x.ts',
          source: "const m = await import('@openlinker/core/orders');",
          forbidden: ['@openlinker/core/orders'],
        }).length === 1,
    },
    {
      name: 'R3: a multiline named import is reported',
      run: () =>
        validateFileImports({
          file: 'libs/core/src/fulfillment/x.ts',
          source: "import {\n  ORDER_INGESTION_SERVICE_TOKEN,\n} from '@openlinker/core/orders';",
          forbidden: ['@openlinker/core/orders'],
        }).length === 1,
    },
    {
      name: 'R3: a forbidden require() is reported',
      run: () => {
        const e = validateFileImports({
          file: 'libs/core/src/fulfillment/x.ts',
          source: "const m = require('@openlinker/core/inventory');",
          forbidden: ['@openlinker/core/inventory'],
        });
        return e.length === 1;
      },
    },
    {
      name: 'R3: a type-only import of a forbidden barrel is still reported',
      run: () =>
        validateFileImports({
          file: 'libs/core/src/fulfillment/x.ts',
          source: "import type { Order } from '@openlinker/core/orders';",
          forbidden: ['@openlinker/core/orders'],
        }).length === 1,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    let ok = false;
    try {
      ok = c.run() === true;
    } catch (err) {
      ok = false;
      process.stderr.write(`  threw: ${String(err)}\n`);
    }
    if (!ok) {
      failed += 1;
      process.stderr.write(`check-no-injection-contracts self-check FAILED: ${c.name}\n`);
    }
  }
  if (failed > 0) process.exit(1);
  process.stdout.write(`check-no-injection-contracts: self-check OK (${cases.length} cases)\n`);
}

// Run only when invoked as the entry point. Importing this module (a spec
// exercising the pure validators, for instance) must not execute the scan —
// a guard with a side effect on import is a guard that runs where nobody
// asked it to and reports into somebody else's output.
const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  if (process.argv.includes('--self-check')) {
    selfCheck();
  } else {
    await main();
  }
}
