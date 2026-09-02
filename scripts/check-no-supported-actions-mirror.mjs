#!/usr/bin/env node
/**
 * check-no-supported-actions-mirror.mjs
 *
 * Lint-time invariant for #2406 (`W3a-19`): the frontend must not recompute
 * `supportedActions`.
 *
 * ## Why an INVERSE guard, and why it needs a self-check more than a mirror does
 *
 * The `check-*-mirror.mjs` family asserts that two copies AGREE. This one
 * asserts a copy does not exist — so "matched nothing" is the PASS condition,
 * which means the script is green on a correct repo, green on an empty repo,
 * and green if its own matcher is broken. A guard whose passing state is
 * indistinguishable from its broken state is theatre. `--self-check` plants
 * known-bad and known-good strings and asserts the matchers answer correctly;
 * it is what makes the real run mean anything, and it is why this is wired as
 * `--self-check && <run>` like every other guard in `check:invariants`.
 *
 * The model is `check-contract-suite-not-in-production.mjs` /
 * `check-no-injection-contracts.mjs` — the repo's two existing inverse guards —
 * NOT the mirror family.
 *
 * ## What it asserts
 *
 * DESIGN §5.2: *"the server tells the client what is legal next, which kills
 * client-side state-machine drift across heterogeneous executors."* #2391
 * deliberately kept `supportedActions` off the `FulfillmentWork` aggregate for
 * the same reason. So `apps/web` must not:
 *
 *   1. declare a `deriveSupportedActions`-shaped function, or
 *   2. hold a local copy of the `FulfillmentWorkActionValues` vocabulary.
 *
 * ## WHAT THIS DOES NOT CATCH — stated, because an overstated gate is worse than none
 *
 *   - A frontend needs NEITHER symbol to drift. One
 *     `if (status === 'open') showSchedule` inside a component is the real drift
 *     shape and no static guard here detects it. This raises the cost of the
 *     obvious copy; it does not make the defect unreachable.
 *   - It is textual, and comments are STRIPPED before scanning — otherwise the
 *     plan document and this very docblock would trip it. Prose naming the
 *     symbols is fine; a declaration is not.
 *   - It says nothing about whether the server-side derivation is correct.
 *
 * Usage:
 *   node scripts/check-no-supported-actions-mirror.mjs --self-check
 *   node scripts/check-no-supported-actions-mirror.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOT = 'apps/web/src';
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/** Strip block and line comments so prose naming a symbol is not a match. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** A function/const named `deriveSupportedActions` (or a near-spelling) being DECLARED. */
export function declaresDerivation(text) {
  const src = stripComments(text);
  return /(?:function|const|let|var)\s+derive[A-Za-z]*SupportedActions\b/.test(src);
}

/** A local copy of the action vocabulary array. */
export function declaresActionVocabulary(text) {
  const src = stripComments(text);
  return /(?:const|let|var|enum|type)\s+FulfillmentWorkAction(?:Values)?\b/.test(src);
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      yield* walk(full);
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      yield full;
    }
  }
}

function selfCheck() {
  const failures = [];

  // --- must MATCH (the defect this exists to catch)
  if (!declaresDerivation('export function deriveSupportedActions(w) { return []; }')) {
    failures.push('declaresDerivation missed a plain function declaration');
  }
  if (!declaresDerivation('const deriveWorkSupportedActions = (w) => [];')) {
    failures.push('declaresDerivation missed a near-spelling const arrow');
  }
  if (!declaresActionVocabulary("const FulfillmentWorkActionValues = ['schedule'] as const;")) {
    failures.push('declaresActionVocabulary missed a local vocabulary copy');
  }
  if (!declaresActionVocabulary("type FulfillmentWorkAction = 'schedule' | 'close';")) {
    failures.push('declaresActionVocabulary missed a local union retype');
  }

  // --- must NOT match (or the guard is unusable)
  if (declaresDerivation(' * The server derives supportedActions; see deriveSupportedActions.')) {
    failures.push('declaresDerivation matched a docblock mention');
  }
  if (declaresDerivation('// deriveSupportedActions lives in libs/core')) {
    failures.push('declaresDerivation matched a line comment');
  }
  if (declaresDerivation('const actions = view.supportedActions;')) {
    failures.push('declaresDerivation matched ordinary CONSUMPTION of the server value');
  }
  if (declaresActionVocabulary("import type { FulfillmentWorkAction } from './api';")) {
    failures.push('declaresActionVocabulary matched an import rather than a declaration');
  }
  if (declaresActionVocabulary('/* FulfillmentWorkActionValues is owned by core */')) {
    failures.push('declaresActionVocabulary matched a block comment');
  }

  if (failures.length > 0) {
    console.error('check-no-supported-actions-mirror SELF-CHECK FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('check-no-supported-actions-mirror self-check OK (9 assertions)');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const problems = [];
  const scanDir = join(repoRoot, SCAN_ROOT);
  let scanned = 0;

  for await (const file of walk(scanDir)) {
    scanned += 1;
    const text = await readFile(file, 'utf8');
    const rel = relative(repoRoot, file);
    if (declaresDerivation(text)) {
      problems.push(
        `${rel} declares a supported-actions derivation. The server tells the client what is ` +
          'legal next (DESIGN §5.2) — read `supportedActions` off the work, never recompute it.'
      );
    }
    if (declaresActionVocabulary(text)) {
      problems.push(
        `${rel} declares a local copy of the fulfilment work-action vocabulary. Consume the ` +
          'values the API returns instead; a second copy is the drift this guard exists to stop.'
      );
    }
  }

  // A scan that found no FILES is a moved directory, not a clean repo.
  if (scanned === 0) {
    console.error(
      `check-no-supported-actions-mirror: scanned 0 files under ${SCAN_ROOT} — did it move? ` +
        'Refusing to report a pass over an empty scan.'
    );
    process.exit(1);
  }

  if (problems.length > 0) {
    console.error('check-no-supported-actions-mirror FAILED:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(
    `check-no-supported-actions-mirror OK (${String(scanned)} files scanned, no FE mirror found)`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
