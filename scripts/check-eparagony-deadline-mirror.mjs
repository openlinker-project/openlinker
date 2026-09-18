#!/usr/bin/env node
/**
 * check-eparagony-deadline-mirror.mjs
 *
 * Lint-time invariant for the eparagony.pl fiscal double-issue guard (#3192).
 *
 * Core holds an in-flight lease around every provider call and documents the
 * invariant that the lease must STRICTLY EXCEED the longest supported provider
 * round-trip (`MAX_SUPPORTED_PROVIDER_TIMEOUT_MS`). Overrunning it lets an
 * expired lease be re-claimed while a call is still in flight, and one sale gets
 * two documents - a legal event for the seller, and unrecoverable.
 *
 * The eparagony plugin therefore caps each lane's whole-call wall clock at its
 * own deadline constant, and MIRRORS core's ceiling rather than importing it,
 * because core exports it from a service module and not from its barrel (#591 -
 * a deep import fails at Node runtime and is ESLint-banned in plugin packages).
 * Both constants say so in their own docblocks.
 *
 * A mirror nobody checks is the shape this repo has ~30 guards for. The adapters
 * already assert their poll ceiling against their own deadline at module load;
 * NOTHING checked the deadline against core's, so lowering core's ceiling would
 * have left both plugin constants silently above it.
 *
 * Both sides are parsed TEXTUALLY so this stays a zero-dependency
 * `check:invariants` step like its siblings. Run with `--self-check` to exercise
 * the pure parser and the comparison against synthetic input.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const PLUGIN_CONSTANTS_FILE = 'libs/integrations/eparagony/src/eparagony.constants.ts';

/**
 * Each lane's plugin deadline, and the core ceiling it must stay strictly below.
 * The two core constants are separate declarations in separate services that
 * happen to hold the same value today; they are read independently so a change
 * to one is caught even if the other stays put.
 */
const LANES = [
  {
    lane: 'invoicing',
    pluginName: 'EPARAGONY_ISSUE_DEADLINE_MS',
    coreFile: 'libs/core/src/invoicing/application/services/invoice.service.ts',
    coreName: 'MAX_SUPPORTED_PROVIDER_TIMEOUT_MS',
  },
  {
    lane: 'fiscalization',
    pluginName: 'EPARAGONY_REGISTER_DEADLINE_MS',
    coreFile: 'libs/core/src/fiscalization/application/services/fiscal-registration.service.ts',
    coreName: 'MAX_SUPPORTED_PROVIDER_TIMEOUT_MS',
  },
];

/**
 * Read a numeric `const <name> = <expr>;` declaration, evaluating only the
 * arithmetic this repo actually writes for durations: integer literals with
 * optional `_` separators, and products of them (`120 * 1000`).
 *
 * Returns `null` when the declaration is absent or is not that shape - which is
 * a FAILURE rather than a pass, because a guard that cannot read its input must
 * not report success.
 */
export function parseNumericConst(source, name) {
  const pattern = new RegExp(`\\bconst\\s+${name}\\s*(?::\\s*number\\s*)?=\\s*([^;]+);`);
  const match = pattern.exec(source);
  if (match === null) {
    return null;
  }
  const expression = match[1].trim().replace(/_/g, '');
  if (!/^\d+(\s*\*\s*\d+)*$/.test(expression)) {
    return null;
  }
  return expression
    .split('*')
    .map((part) => Number(part.trim()))
    .reduce((product, part) => product * part, 1);
}

/** `null` when the lane is safe; an explanatory string when it is not. */
export function checkLane({ lane, pluginName, pluginValue, coreName, coreValue }) {
  if (pluginValue === null) {
    return `${lane}: could not read ${pluginName}`;
  }
  if (coreValue === null) {
    return `${lane}: could not read ${coreName}`;
  }
  if (pluginValue >= coreValue) {
    return (
      `${lane}: ${pluginName} (${pluginValue}ms) must stay strictly below core's ` +
      `${coreName} (${coreValue}ms), or one call can outlive the in-flight lease and ` +
      `issue the same sale twice`
    );
  }
  return null;
}

function selfCheck() {
  const failures = [];
  const expect = (condition, label) => {
    if (!condition) failures.push(label);
  };

  expect(
    parseNumericConst('export const A_MS = 110_000;', 'A_MS') === 110000,
    'underscore literal',
  );
  expect(parseNumericConst('export const B_MS = 120 * 1000;', 'B_MS') === 120000, 'product');
  expect(parseNumericConst('const C_MS: number = 90_000;', 'C_MS') === 90000, 'annotated');
  expect(parseNumericConst('const D_MS = 1;', 'OTHER_MS') === null, 'absent reads null');
  expect(parseNumericConst('const E_MS = someCall();', 'E_MS') === null, 'non-literal reads null');

  const base = { lane: 'x', pluginName: 'P', coreName: 'C' };
  expect(checkLane({ ...base, pluginValue: 110000, coreValue: 120000 }) === null, 'below passes');
  expect(checkLane({ ...base, pluginValue: 120000, coreValue: 120000 }) !== null, 'equal fails');
  expect(checkLane({ ...base, pluginValue: 130000, coreValue: 120000 }) !== null, 'above fails');
  expect(checkLane({ ...base, pluginValue: null, coreValue: 120000 }) !== null, 'unreadable fails');
  expect(checkLane({ ...base, pluginValue: 1, coreValue: null }) !== null, 'unreadable core fails');

  if (failures.length > 0) {
    process.stderr.write(`check-eparagony-deadline-mirror self-check failed:\n`);
    for (const failure of failures) process.stderr.write(`  ${failure}\n`);
    process.exit(1);
  }
  process.stdout.write('check-eparagony-deadline-mirror: self-check ok\n');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const pluginSource = await readFile(join(ROOT, PLUGIN_CONSTANTS_FILE), 'utf8');
  const problems = [];
  for (const lane of LANES) {
    const coreSource = await readFile(join(ROOT, lane.coreFile), 'utf8');
    const problem = checkLane({
      lane: lane.lane,
      pluginName: lane.pluginName,
      pluginValue: parseNumericConst(pluginSource, lane.pluginName),
      coreName: lane.coreName,
      coreValue: parseNumericConst(coreSource, lane.coreName),
    });
    if (problem !== null) problems.push(problem);
  }

  if (problems.length > 0) {
    process.stderr.write('eparagony.pl deadline mirror drifted.\n');
    for (const problem of problems) process.stderr.write(`  ${problem}\n`);
    process.exit(1);
  }

  process.stdout.write(`check-eparagony-deadline-mirror: ok (${LANES.length} lanes in sync)\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
