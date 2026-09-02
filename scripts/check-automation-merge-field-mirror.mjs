#!/usr/bin/env node
/**
 * check-automation-merge-field-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the automation
 * merge-field vocabulary (#2358 / spec §5.3b).
 *
 * Rule. `AUTOMATION_MERGE_FIELDS` in
 *   libs/core/src/automation/domain/domain-services/render-automation-template.ts  (backend, authoritative)
 * and
 *   apps/web/src/features/automation/api/automation.types.ts                       (frontend mirror)
 * MUST name exactly the same fields, in the same order. The backend stores bare
 * tokens (`order.reference`); the frontend stores `{ token: '{order.reference}',
 * renders: '…' }` because the composer renders a tooltip beside each chip. The
 * braces are stripped before comparison — the field NAMES are what must agree.
 *
 * Why this guard exists, specifically. The backend renderer resolves six fields
 * and returns anything else VERBATIM. The frontend restated the spec's nine
 * instead of mirroring the six, so the composer offered `{order.source}`,
 * `{buyer.name}` and `{shipment.tracking}` — and a buyer received
 * `Hi {buyer.name}, your order {shipment.tracking} has shipped`, literally,
 * while the automation step recorded `done`. Offering a field the backend cannot
 * render is a promise the composer makes and the backend cannot keep, and it
 * fails silently in front of a customer.
 *
 * `apps/web` has no `@openlinker/*` dependency, so the frontend cannot import
 * the backend list — hence a copy, hence this script.
 *
 * SCOPE, so the wrong guard is not trusted: this script compares two lists of
 * field NAMES. It says nothing about whether each `renders` string is an
 * accurate description of what the executor produces — the reviewer found
 * `{order.placedAt}` promising "the operator's locale" while the executor sent
 * `.toISOString()`, and no textual guard can catch that. Unit tests on
 * `formatMergeDate` / `formatMergeAmount` cover it. Adding a token to both lists
 * and resolving it in neither passes here.
 *
 * Both files are parsed TEXTUALLY (no TypeScript import, no transpile) so this
 * script stays a zero-dependency `check:invariants` step like its siblings.
 *
 * Run with `--self-check` to exercise the pure parsers + differ against
 * synthetic inputs (no filesystem) — mirrors `check-parameter-restriction-mirror.mjs`.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const BACKEND_FILE = join(
  'libs',
  'core',
  'src',
  'automation',
  'domain',
  'domain-services',
  'render-automation-template.ts',
);
const FRONTEND_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'automation',
  'api',
  'automation.types.ts',
);

const MIRRORED_DECLARATION = 'AUTOMATION_MERGE_FIELDS';
const DOCS_REF = 'docs/specs/product-spec-oms-wave2-operator-experience.md §5.3b';

/** Slice out the body of `export const <name> = [ ... ] as const;`, comments stripped. */
function declarationBody(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  // Brace-aware scan: the frontend entries are objects, so the first `]` is the
  // right one only because no entry contains a nested array. Scan anyway, so a
  // future nested shape does not silently truncate the list.
  let depth = 0;
  let closeBracket = -1;
  for (let i = openBracket; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        closeBracket = i;
        break;
      }
    }
  }
  if (closeBracket === -1) return null;

  const body = content
    .slice(openBracket + 1, closeBracket)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  return { body, line: content.slice(0, declMatch.index).split('\n').length };
}

/** Backend shape: a flat list of bare token literals. */
export function parseBackendFields(content, name = MIRRORED_DECLARATION) {
  const declaration = declarationBody(content, name);
  if (!declaration) return null;

  const values = [];
  const literalRe = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = literalRe.exec(declaration.body)) !== null) {
    values.push(m[1] ?? m[2]);
  }
  return { line: declaration.line, values };
}

/**
 * Frontend shape: `{ token: '{order.reference}', renders: '…' }`.
 *
 * Keyed on `token:` rather than scraping every literal, or each entry's `renders`
 * prose would be compared against the backend's tokens and every run would fail.
 * Braces are stripped so the two vocabularies are comparable.
 */
export function parseFrontendFields(content, name = MIRRORED_DECLARATION) {
  const declaration = declarationBody(content, name);
  if (!declaration) return null;

  const values = [];
  const tokenRe = /token\s*:\s*(?:'([^']*)'|"([^"]*)")/g;
  let m;
  while ((m = tokenRe.exec(declaration.body)) !== null) {
    const raw = m[1] ?? m[2];
    values.push(raw.replace(/^\{/, '').replace(/\}$/, ''));
  }
  return { line: declaration.line, values };
}

/** Pure differ. Returns `{ ok, issues }` with one human-readable reason each. */
export function diffFields(backend, frontend) {
  const issues = [];
  const backendSet = new Set(backend);
  const frontendSet = new Set(frontend);

  const missingInFrontend = backend.filter((v) => !frontendSet.has(v));
  const offeredButUnresolvable = frontend.filter((v) => !backendSet.has(v));

  if (offeredButUnresolvable.length > 0) {
    issues.push(
      `OFFERED BY THE COMPOSER but not resolvable by the backend renderer: ` +
        `${offeredButUnresolvable.map((v) => `'{${v}}'`).join(', ')} — an operator can insert ` +
        `these and they reach the recipient verbatim while the step records 'done'`,
    );
  }
  if (missingInFrontend.length > 0) {
    issues.push(
      `resolvable by the backend but MISSING from the composer's list: ` +
        `${missingInFrontend.map((v) => `'{${v}}'`).join(', ')} — operators cannot discover them`,
    );
  }
  if (issues.length === 0 && backend.join('|') !== frontend.join('|')) {
    issues.push(
      `same fields but different order (backend: ${backend.join(', ')} / frontend: ${frontend.join(', ')})`,
    );
  }

  return { ok: issues.length === 0, issues };
}

async function main() {
  const [backendContent, frontendContent] = await Promise.all([
    readFile(join(repoRoot, BACKEND_FILE), 'utf8'),
    readFile(join(repoRoot, FRONTEND_FILE), 'utf8'),
  ]);

  const backend = parseBackendFields(backendContent);
  const frontend = parseFrontendFields(frontendContent);

  const fatal = [];
  if (!backend)
    fatal.push(`${BACKEND_FILE}: no 'export const ${MIRRORED_DECLARATION} = [...]' found`);
  if (!frontend)
    fatal.push(`${FRONTEND_FILE}: no 'export const ${MIRRORED_DECLARATION} = [...]' found`);
  if (fatal.length > 0) {
    console.error('✗ check-automation-merge-field-mirror: could not locate the declaration.\n');
    for (const f of fatal) console.error(`  ${f}`);
    console.error('');
    process.exit(1);
  }

  const { ok, issues } = diffFields(backend.values, frontend.values);
  if (ok) {
    console.log(
      `✓ check-automation-merge-field-mirror: ${backend.values.length} merge field(s) identical in ` +
        `${BACKEND_FILE} and ${FRONTEND_FILE}.`,
    );
    process.exit(0);
  }

  console.error('✗ check-automation-merge-field-mirror: the mirror drifted.\n');
  console.error(`  ${MIRRORED_DECLARATION}`);
  console.error(`    ${BACKEND_FILE}:${backend.line}  (authoritative — what can be RENDERED)`);
  console.error(`    ${FRONTEND_FILE}:${frontend.line}  (hand-maintained mirror — what is OFFERED)`);
  for (const issue of issues) {
    console.error(`      rule: the composer may offer exactly what the renderer resolves - ${issue}`);
  }
  console.error(`    docs: ${DOCS_REF}`);
  console.error('');
  process.exit(1);
}

/** Self-test the pure parsers + differ against synthetic inputs (no filesystem). */
function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`  ✗ ${label}: expected ${wanted}, got ${actual}`);
  };

  const name = MIRRORED_DECLARATION;
  const backendFile = (entries) =>
    `/** header */\nexport const ${name} = [\n${entries}\n] as const;\n`;
  const frontendFile = (entries) =>
    `/** header */\nexport const ${name} = [\n${entries}\n] as const;\n`;

  const be = parseBackendFields(backendFile("  'order.reference',\n  'rule.name',"), name);
  expect('backend parses bare tokens', be?.values.join(','), 'order.reference,rule.name');
  expect('backend reports the declaration line', be?.line, 2);

  const fe = parseFrontendFields(
    frontendFile(
      "  { token: '{order.reference}', renders: 'the reference' },\n" +
        "  { token: '{rule.name}', renders: 'the name' },",
    ),
    name,
  );
  expect('frontend parses tokens and strips braces', fe?.values.join(','), 'order.reference,rule.name');

  // The regression this whole script exists for: `renders` prose must never be
  // mistaken for a token, or every run fails for the wrong reason.
  const prose = parseFrontendFields(
    frontendFile("  { token: '{order.total}', renders: 'the gross total with its currency' },"),
    name,
  );
  expect('frontend ignores the renders prose', prose?.values.join(','), 'order.total');

  const commented = parseBackendFields(
    backendFile("  'order.reference',\n  // 'buyer.name' — not resolvable\n  'rule.name',"),
    name,
  );
  expect('backend strips line comments', commented?.values.join(','), 'order.reference,rule.name');

  expect('identical lists pass', diffFields(['a', 'b'], ['a', 'b']).ok, true);
  expect(
    'an offered-but-unresolvable field fails',
    diffFields(['a'], ['a', 'buyer.name']).ok,
    false,
  );
  expect(
    'the failure names the unrenderable field',
    diffFields(['a'], ['a', 'buyer.name']).issues[0].includes('{buyer.name}'),
    true,
  );
  expect('a backend field missing from the composer fails', diffFields(['a', 'b'], ['a']).ok, false);
  expect('a reordered list fails', diffFields(['a', 'b'], ['b', 'a']).ok, false);
  expect('a missing declaration returns null', parseBackendFields('const other = [];', name), null);

  if (failures.length > 0) {
    console.error('✗ check-automation-merge-field-mirror --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log('✓ check-automation-merge-field-mirror --self-check: parsers + differ behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  await main();
}
