#!/usr/bin/env node
/**
 * Render Template Fixture Drift Guard
 *
 * The FE hand-ports `renderTemplate` + its fixtures to stay out of the web
 * bundle's NestJS transitive-dependency graph. The plan calls for a CI
 * check that keeps the two fixture surfaces in lockstep so algorithm drift
 * between runtimes fails before merge.
 *
 * This script dynamically imports both fixture modules and asserts
 * structural equality on the happy-path and throwing test vectors. Runs
 * under pure Node (no vitest / jest context) so it can live inside
 * `pnpm lint` without adding a test-runner dependency.
 *
 * Exits non-zero on drift.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const CORE_FIXTURES = resolve(
  ROOT,
  'libs/core/src/ai/application/internal/render-template.fixtures.ts',
);
const FE_FIXTURES = resolve(
  ROOT,
  'apps/web/src/features/prompt-templates/lib/render-template.test.ts',
);

/**
 * Read fixture arrays as raw text and extract the literal JS/TS object
 * structure by running a tiny regex extraction. We avoid transpiling TS to
 * keep this script free of tsc / ts-node deps — the assertion is on the
 * source text of the fixture arrays, not their interpreted form.
 */
function extractArrayLiteral(source, exportName) {
  // Matches `export const <name> ... = [` up to the matching `];`
  // Uses a balanced-bracket walker because fixtures nest objects.
  const startRegex = new RegExp(
    `(?:export\\s+)?const\\s+${exportName}[^=]*=\\s*\\[`,
  );
  const match = source.match(startRegex);
  if (match === null) {
    throw new Error(`Could not find literal for ${exportName}`);
  }
  const startIndex = match.index + match[0].length;
  let depth = 1;
  let index = startIndex;
  while (depth > 0 && index < source.length) {
    const ch = source[index];
    if (ch === '[') depth += 1;
    else if (ch === ']') depth -= 1;
    index += 1;
  }
  if (depth !== 0) {
    throw new Error(`Unbalanced brackets when extracting ${exportName}`);
  }
  // Normalise: strip comments + trim whitespace on each line so trivial
  // formatting differences don't trip the diff.
  return source
    .slice(startIndex, index - 1)
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, '').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function diff(expected, actual, label) {
  if (expected === actual) return null;
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const max = Math.max(expectedLines.length, actualLines.length);
  const diffLines = [];
  for (let i = 0; i < max; i += 1) {
    if (expectedLines[i] !== actualLines[i]) {
      diffLines.push(`  line ${i + 1}:`);
      diffLines.push(`    core: ${expectedLines[i] ?? '<missing>'}`);
      diffLines.push(`    fe:   ${actualLines[i] ?? '<missing>'}`);
      if (diffLines.length > 24) {
        diffLines.push('    …(truncated)');
        break;
      }
    }
  }
  return `${label} drift:\n${diffLines.join('\n')}`;
}

const coreSource = readFileSync(CORE_FIXTURES, 'utf8');
const feSource = readFileSync(FE_FIXTURES, 'utf8');

const pairs = [
  { core: 'RENDER_HAPPY_PATH_FIXTURES', fe: 'HAPPY_FIXTURES', label: 'happy-path fixtures' },
  { core: 'RENDER_THROW_FIXTURES', fe: 'THROW_FIXTURES', label: 'throwing fixtures' },
];

let failed = false;
for (const { core, fe, label } of pairs) {
  const coreLiteral = extractArrayLiteral(coreSource, core);
  const feLiteral = extractArrayLiteral(feSource, fe);
  const result = diff(coreLiteral, feLiteral, label);
  if (result !== null) {
    console.error(`fixture-drift: ${result}\n`);
    failed = true;
  }
}

if (failed) {
  console.error(
    'fixture-drift: FE/BE render-template fixtures diverged. Keep the FE copy at apps/web/src/features/prompt-templates/lib/render-template.test.ts in lockstep with libs/core/src/ai/application/internal/render-template.fixtures.ts.',
  );
  process.exit(1);
}

console.log('fixture-drift: OK');
